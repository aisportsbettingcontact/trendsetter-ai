import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Search, TrendingUp, Database, Clock, ChevronRight,
  BarChart3, Zap, RefreshCw, Target, Activity, TrendingDown,
  Award, Filter,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────
interface SeasonSplit {
  season: number;
  games: number;
  wins: number;
  losses: number;
  winRate: number;
  roi: number;
}

interface SampleGame {
  game_date: string;
  away_team: string;
  home_team: string;
  away_score: number;
  home_score: number;
  ml_away: number | null;
  ml_home: number | null;
  rl_spread: number | null;
  rl_away_odds: number | null;
  rl_home_odds: number | null;
  total: number | null;
  over_odds: number | null;
  under_odds: number | null;
  away_ats_result: string | null;
  ou_result: string | null;
  winner: string;
}

interface TrendsResult {
  games: number;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number;
  roi: number;
  profit: number;
  queryType: "ml" | "ats" | "ou";
  seasonSplits: SeasonSplit[];
  sampleGames: SampleGame[];
  covers?: number;
  noCover?: number;
  atsCoverRate?: number;
  atsRoi?: number;
  overs?: number;
  unders?: number;
  totalPushes?: number;
  overRate?: number;
  underRate?: number;
  pushRate?: number;
  ouRoi?: number;
  underRoi?: number;
}

interface QueryResult {
  success: boolean;
  error?: string;
  teamAbbr?: string;
  teamName?: string;
  conditionsText?: string;
  queryTypeLabel?: string;
  winLabel?: string;
  summary?: string;
  roiText?: string;
  result?: TrendsResult;
  filters?: Record<string, unknown>;
  parseTimeMs?: number;
  dbTimeMs?: number;
}

interface HistoryItem {
  query: string;
  result: QueryResult;
  timestamp: Date;
}

// ── Team Colors ────────────────────────────────────────────────────────────────
const TEAM_COLORS: Record<string, string> = {
  NYY: "#003087", LAD: "#005A9C", BOS: "#BD3039", HOU: "#002D62",
  ATL: "#CE1141", NYM: "#002D72", PHI: "#E81828", CHC: "#0E3386",
  STL: "#C41E3A", SFG: "#FD5A1E", SDP: "#2F241D", TEX: "#003278",
  BAL: "#DF4601", TBR: "#092C5C", TOR: "#134A8E", SEA: "#0C2C56",
  MIN: "#002B5C", CLE: "#00385D", CWS: "#27251F", DET: "#0C2340",
  KCR: "#004687", ATH: "#003831", LAA: "#BA0021", ARI: "#A71930",
  COL: "#33006F", MIA: "#00A3E0", WSN: "#AB0003", PIT: "#FDB827",
  CIN: "#C6011F", MIL: "#12284B",
};

function TeamBadge({ abbr, size = "md" }: { abbr: string; size?: "sm" | "md" | "lg" }) {
  const color = TEAM_COLORS[abbr] || "#333";
  const sizeClasses = size === "lg" ? "w-14 h-14 text-lg" : size === "md" ? "w-10 h-10 text-sm" : "w-7 h-7 text-xs";
  return (
    <div
      className={`${sizeClasses} rounded-lg flex items-center justify-center font-bold font-mono flex-shrink-0`}
      style={{ backgroundColor: color, border: `1px solid ${color}88` }}
    >
      {abbr}
    </div>
  );
}

// ── Confidence Badge ───────────────────────────────────────────────────────────
function ConfidenceBadge({ games }: { games: number }) {
  const level = games >= 200 ? "high" : games >= 80 ? "medium" : games >= 30 ? "low" : "very-low";
  const config = {
    "high":     { label: "High Confidence", color: "text-emerald-400 border-emerald-400/30 bg-emerald-400/5", icon: "●●●●" },
    "medium":   { label: "Medium Confidence", color: "text-yellow-400 border-yellow-400/30 bg-yellow-400/5", icon: "●●●○" },
    "low":      { label: "Low Confidence", color: "text-orange-400 border-orange-400/30 bg-orange-400/5", icon: "●●○○" },
    "very-low": { label: "Small Sample", color: "text-red-400 border-red-400/30 bg-red-400/5", icon: "●○○○" },
  }[level];
  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-mono ${config.color}`}>
      <span className="tracking-widest text-[10px]">{config.icon}</span>
      <span>{config.label}</span>
      <span className="text-current/60">({games} games)</span>
    </div>
  );
}

// ── Sparkline ─────────────────────────────────────────────────────────────────
function SeasonSparkline({ splits }: { splits: SeasonSplit[] }) {
  if (!splits || splits.length < 2) return null;
  const maxWR = Math.max(...splits.map(s => s.winRate));
  const minWR = Math.min(...splits.map(s => s.winRate));
  const range = maxWR - minWR || 1;
  const W = 120, H = 32;
  const pts = splits.map((s, i) => {
    const x = (i / (splits.length - 1)) * W;
    const y = H - ((s.winRate - minWR) / range) * (H - 4) - 2;
    return `${x},${y}`;
  });
  const polyline = pts.join(" ");
  return (
    <svg width={W} height={H} className="overflow-visible">
      <polyline
        points={polyline}
        fill="none"
        stroke="oklch(0.82 0.18 155)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {splits.map((s, i) => {
        const [x, y] = pts[i].split(",").map(Number);
        return (
          <circle key={i} cx={x} cy={y} r="2.5"
            fill={s.winRate >= 50 ? "oklch(0.82 0.18 155)" : "oklch(0.65 0.2 25)"}
            stroke="transparent" strokeWidth="6"
          />
        );
      })}
    </svg>
  );
}

// ── Season Splits Table ────────────────────────────────────────────────────────
function SeasonSplitsTable({ splits, queryType }: { splits: SeasonSplit[]; queryType: string }) {
  if (!splits || splits.length === 0) return null;
  const winLabel = queryType === "ats" ? "Cover%" : queryType === "ou" ? "Rate" : "Win%";
  return (
    <div className="mt-4">
      <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono mb-2 flex items-center gap-2">
        <Activity className="w-3 h-3" />
        Year-by-Year Breakdown
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="text-left py-2 pr-4">Season</th>
              <th className="text-right py-2 pr-4">G</th>
              <th className="text-right py-2 pr-4">W-L</th>
              <th className="text-right py-2 pr-4">{winLabel}</th>
              <th className="text-right py-2">ROI</th>
            </tr>
          </thead>
          <tbody>
            {splits.map((s) => (
              <tr key={s.season} className="border-b border-border/30 hover:bg-card/50 transition-colors">
                <td className="py-2 pr-4 text-foreground font-medium">{s.season}</td>
                <td className="py-2 pr-4 text-right text-muted-foreground">{s.games}</td>
                <td className="py-2 pr-4 text-right">
                  <span className="text-emerald-400">{s.wins}</span>
                  <span className="text-muted-foreground">-</span>
                  <span className="text-red-400">{s.losses}</span>
                </td>
                <td className="py-2 pr-4 text-right">
                  <span className={s.winRate >= 55 ? "text-emerald-400" : s.winRate >= 50 ? "text-foreground" : "text-red-400"}>
                    {s.winRate}%
                  </span>
                </td>
                <td className="py-2 text-right">
                  <span className={s.roi >= 0 ? "text-emerald-400" : "text-red-400"}>
                    {s.roi >= 0 ? "+" : ""}{s.roi}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Recent Games Table ─────────────────────────────────────────────────────────
function RecentGamesTable({ games, teamAbbr, activeTab, totalsIntent = "over" }: {
  games: SampleGame[];
  teamAbbr?: string;
  activeTab: "ml" | "ats" | "ou";
  totalsIntent?: "over" | "under" | "push";
}) {
  return (
    <div className="mt-4">
      <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono mb-2">
        Most Recent Matching Games
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="text-left py-2 pr-3">Date</th>
              <th className="text-left py-2 pr-3">Matchup</th>
              <th className="text-right py-2 pr-3">Score</th>
              {activeTab === "ml" && <th className="text-right py-2 pr-3">ML</th>}
              {activeTab === "ats" && <th className="text-right py-2 pr-3">RL</th>}
              {activeTab === "ou" && <th className="text-right py-2 pr-3">Total</th>}
              <th className="text-right py-2">Result</th>
            </tr>
          </thead>
          <tbody>
            {games.map((g, i) => {
              const hasTeamContext = Boolean(teamAbbr);
              const teamIsAway = hasTeamContext ? g.away_team === teamAbbr : false;
              const teamScore = hasTeamContext ? (teamIsAway ? g.away_score : g.home_score) : g.away_score;
              const oppScore = hasTeamContext ? (teamIsAway ? g.home_score : g.away_score) : g.home_score;
              const opp = hasTeamContext ? (teamIsAway ? g.home_team : g.away_team) : `${g.away_team} @ ${g.home_team}`;
              const teamWon = hasTeamContext
                ? (teamIsAway && g.away_score > g.home_score) || (!teamIsAway && g.home_score > g.away_score)
                : g.away_score > g.home_score;

              // ATS result for this team
              const atsResult = teamIsAway
                ? g.away_ats_result
                : (g.away_ats_result === "cover" ? "no_cover" : g.away_ats_result === "no_cover" ? "cover" : g.away_ats_result);

              // Column value
              let colValue: string;
              let resultLabel: string;
              let resultClass: string;

              if (activeTab === "ml") {
                const ml = teamIsAway ? g.ml_away : g.ml_home;
                colValue = ml !== null ? (ml > 0 ? `+${Math.round(ml)}` : String(Math.round(ml))) : "—";
                resultLabel = teamWon ? "W" : "L";
                resultClass = teamWon ? "bg-emerald-400/10 text-emerald-400" : "bg-red-400/10 text-red-400";
              } else if (activeTab === "ats") {
                const rlOdds = teamIsAway ? g.rl_away_odds : g.rl_home_odds;
                const spread = g.rl_spread;
                // rl_spread is the HOME team's spread; invert for away team
                const teamSpread = spread !== null ? (teamIsAway ? -spread : spread) : null;
                const spreadStr = teamSpread !== null ? (teamSpread > 0 ? `+${teamSpread}` : `${teamSpread}`) : "—";
                const oddsStr = rlOdds !== null ? (rlOdds > 0 ? `+${Math.round(rlOdds)}` : String(Math.round(rlOdds))) : "";
                colValue = teamSpread !== null ? `${spreadStr} (${oddsStr})` : "—";
                resultLabel = atsResult === "cover" ? "COV" : atsResult === "no_cover" ? "NO" : "PSH";
                resultClass = atsResult === "cover" ? "bg-emerald-400/10 text-emerald-400" : atsResult === "no_cover" ? "bg-red-400/10 text-red-400" : "bg-muted text-muted-foreground";
              } else {
                const total = g.total;
                const marketOdds = totalsIntent === "under" ? g.under_odds : g.over_odds;
                const oddsStr = marketOdds !== null ? (marketOdds > 0 ? `+${Math.round(marketOdds)}` : String(Math.round(marketOdds))) : "";
                colValue = total !== null ? `${total} (${oddsStr})` : "—";
                resultLabel = g.ou_result === "over" ? "OVR" : g.ou_result === "under" ? "UND" : "PSH";
                resultClass = g.ou_result === "over" ? "bg-emerald-400/10 text-emerald-400" : g.ou_result === "under" ? "bg-red-400/10 text-red-400" : "bg-muted text-muted-foreground";
              }

              return (
                <tr key={i} className="border-b border-border/30 hover:bg-card/50 transition-colors">
                  <td className="py-2 pr-3 text-muted-foreground">{g.game_date}</td>
                  <td className="py-2 pr-3">
                    <span className="text-muted-foreground">{hasTeamContext ? (teamIsAway ? "@ " : "vs ") : ""}</span>
                    <span className="text-foreground">{opp}</span>
                  </td>
                  <td className="py-2 pr-3 text-right">
                    <span className={teamWon ? "text-emerald-400" : "text-red-400"}>{teamScore}</span>
                    <span className="text-muted-foreground">-{oppScore}</span>
                  </td>
                  <td className="py-2 pr-3 text-right text-muted-foreground">{colValue}</td>
                  <td className="py-2 text-right">
                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${resultClass}`}>
                      {resultLabel}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Metric Tabs ────────────────────────────────────────────────────────────────
function MetricTabs({ activeTab, onChange, result, totalsIntent }: {
  activeTab: "ml" | "ats" | "ou";
  onChange: (tab: "ml" | "ats" | "ou") => void;
  result: TrendsResult;
  totalsIntent: "over" | "under" | "push";
}) {
  const tabs: Array<{ id: "ml" | "ats" | "ou"; label: string; short: string }> = [
    { id: "ml", label: "Moneyline", short: "ML" },
    { id: "ats", label: "Run Line (ATS)", short: "ATS" },
    { id: "ou", label: "Over/Under", short: "O/U" },
  ];

  const getTabStats = (tab: "ml" | "ats" | "ou") => {
    if (tab === "ml") return { wr: result.winRate, roi: result.roi, w: result.wins, l: result.losses };
    if (tab === "ats") return { wr: result.atsCoverRate ?? 0, roi: result.atsRoi ?? 0, w: result.covers ?? 0, l: result.noCover ?? 0 };
    if (totalsIntent === "under") return { wr: result.underRate ?? 0, roi: result.underRoi ?? 0, w: result.unders ?? 0, l: result.overs ?? 0 };
    if (totalsIntent === "push") return { wr: result.pushRate ?? 0, roi: 0, w: result.totalPushes ?? 0, l: (result.games ?? 0) - (result.totalPushes ?? 0) };
    return { wr: result.overRate ?? 0, roi: result.ouRoi ?? 0, w: result.overs ?? 0, l: result.unders ?? 0 };
  };

  return (
    <div className="flex gap-1 p-1 bg-background rounded-lg border border-border">
      {tabs.map((tab) => {
        const stats = getTabStats(tab.id);
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={`flex-1 flex flex-col items-center gap-0.5 px-2 py-2 rounded-md text-xs font-mono transition-all duration-200 ${
              isActive
                ? "bg-card border border-border text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-card/50"
            }`}
          >
            <span className="font-bold text-[11px] uppercase tracking-wider">{tab.short}</span>
            <span className={`text-[11px] font-bold ${stats.wr >= 55 ? "text-emerald-400" : stats.wr >= 50 ? "text-foreground" : "text-red-400"}`}>
              {stats.wr}%
            </span>
            <span className={`text-[10px] ${stats.roi >= 0 ? "text-emerald-400/70" : "text-red-400/70"}`}>
              {stats.roi >= 0 ? "+" : ""}{stats.roi}% ROI
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Parsed Filters Display ─────────────────────────────────────────────────────
function ParsedFiltersDisplay({ filters }: { filters: Record<string, unknown> }) {
  const activeFilters = Object.entries(filters).filter(([k, v]) =>
    v !== null && v !== undefined && k !== "team" && k !== "query_type"
  );
  if (activeFilters.length === 0) return null;

  const formatFilter = (key: string, value: unknown): string => {
    const MONTH_NAMES = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    if (key === "home") return value ? "Home" : "Away";
    if (key === "favorite") return value ? "Favorite" : "Underdog";
    if (key === "previous_result") return `After ${value}`;
    if (key === "back_to_back") return "Back-to-Back";
    if (key === "rest_days") return `${value}d rest`;
    if (key === "streak_type" && filters.streak_length) return `${filters.streak_length}+ ${value} streak`;
    if (key === "streak_length") return "";
    if (key === "season") return String(value);
    if (key === "opponent") return `vs ${value}`;
    if (key === "division_game") return value ? "Division" : "Non-Div";
    if (key === "interleague") return "Interleague";
    if (key === "month") return MONTH_NAMES[value as number] || String(value);
    if (key === "day_of_week") return DOW_NAMES[value as number] || String(value);
    if (key === "over_under") return String(value).toUpperCase();
    if (key === "last_n") return `Last ${value}`;
    if (key === "first_n") return `First ${value}`;
    if (key === "total_exact") return `Total ${value}`;
    if (key === "total_min") return `Total ${value}+`;
    if (key === "total_max") return `Total ≤${value}`;
    if (key === "opponent_division") return `vs ${filters.opponent_league || ""}${value}`;
    if (key === "opponent_league") return filters.opponent_division ? "" : `vs ${value}`;
    return `${key}:${value}`;
  };

  const chips = activeFilters.map(([k, v]) => formatFilter(k, v)).filter(Boolean);
  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-2">
      <Filter className="w-3 h-3 text-muted-foreground flex-shrink-0" />
      {chips.map((chip, i) => (
        <span key={i} className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
          {chip}
        </span>
      ))}
    </div>
  );
}

// ── Results Panel ──────────────────────────────────────────────────────────────
function ResultsPanel({ result, query }: { result: QueryResult; query: string }) {
  const [activeTab, setActiveTab] = useState<"ml" | "ats" | "ou">(
    (result.result?.queryType as "ml" | "ats" | "ou") || "ml"
  );

  // Reset tab when result changes
  useEffect(() => {
    setActiveTab((result.result?.queryType as "ml" | "ats" | "ou") || "ml");
  }, [result]);

  if (!result.success) {
    return (
      <div className="bg-card border border-red-400/20 rounded-xl p-6">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-red-400/10 flex items-center justify-center flex-shrink-0 mt-0.5">
            <span className="text-red-400 text-sm font-bold">!</span>
          </div>
          <div>
            <div className="text-sm font-semibold text-red-400 mb-1">Query Error</div>
            <div className="text-sm text-muted-foreground">{result.error}</div>
          </div>
        </div>
      </div>
    );
  }

  const r = result.result!;
  const totalsIntent = result.filters?.over_under === "under"
    ? "under"
    : result.filters?.over_under === "push"
      ? "push"
      : "over";
  const ouMetricLabel =
    result.winLabel === "unders"
      ? "Under %"
      : result.winLabel === "pushes"
        ? "Push %"
        : "Over %";

  // Get stats for active tab
  const tabStats = activeTab === "ml"
    ? { wins: r.wins, losses: r.losses, pushes: r.pushes, winRate: r.winRate, roi: r.roi, profit: r.profit }
    : activeTab === "ats"
    ? { wins: r.covers ?? 0, losses: r.noCover ?? 0, pushes: 0, winRate: r.atsCoverRate ?? 0, roi: r.atsRoi ?? 0, profit: 0 }
    : totalsIntent === "under"
      ? { wins: r.unders ?? 0, losses: r.overs ?? 0, pushes: r.totalPushes ?? 0, winRate: r.underRate ?? 0, roi: r.underRoi ?? 0, profit: 0 }
      : totalsIntent === "push"
        ? { wins: r.totalPushes ?? 0, losses: (r.games ?? 0) - (r.totalPushes ?? 0), pushes: 0, winRate: r.pushRate ?? 0, roi: 0, profit: 0 }
        : { wins: r.overs ?? 0, losses: r.unders ?? 0, pushes: r.totalPushes ?? 0, winRate: r.overRate ?? 0, roi: r.ouRoi ?? 0, profit: 0 };

  const roiPositive = tabStats.roi >= 0;
  const winRateGood = tabStats.winRate >= 55;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-start gap-4 p-5 border-b border-border">
        {result.teamAbbr ? (
          <TeamBadge abbr={result.teamAbbr} size="lg" />
        ) : (
          <div className="w-14 h-14 rounded-lg flex items-center justify-center font-bold font-mono flex-shrink-0 bg-primary/10 border border-primary/20 text-primary">
            MLB
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-lg font-bold" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              {result.teamName}
            </div>
            <ConfidenceBadge games={r.games} />
          </div>
          <div className="text-sm text-muted-foreground font-mono mt-0.5">
            {result.conditionsText || "All games (2021–2025)"}
          </div>
          {activeTab === "ou" && (
            <div className="text-[11px] uppercase tracking-[0.2em] text-primary font-mono mt-2">
              Totals Market: {result.winLabel === "unders" ? "UNDER" : result.winLabel === "pushes" ? "PUSH" : "OVER"}
            </div>
          )}
          {result.filters && <ParsedFiltersDisplay filters={result.filters} />}
        </div>
        <div className="text-xs text-muted-foreground font-mono text-right flex-shrink-0 hidden sm:block">
          <div className="text-[10px]">{result.parseTimeMs}ms NLP</div>
          <div className="text-[10px]">{result.dbTimeMs}ms SQL</div>
        </div>
      </div>

      {/* Metric Tabs */}
      <div className="p-4 border-b border-border">
        <MetricTabs activeTab={activeTab} onChange={setActiveTab} result={r} totalsIntent={totalsIntent} />
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border">
        <div className="bg-card p-4">
          <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono mb-1">Record</div>
          <div className="text-2xl font-bold font-mono">
            <span className="text-emerald-400">{tabStats.wins}</span>
            <span className="text-muted-foreground">-</span>
            <span className="text-red-400">{tabStats.losses}</span>
            {tabStats.pushes > 0 && <span className="text-muted-foreground text-lg">-{tabStats.pushes}</span>}
          </div>
          <div className="text-xs text-muted-foreground font-mono">{r.games} total games</div>
        </div>
        <div className="bg-card p-4">
          <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono mb-1">
            {activeTab === "ats" ? "Cover %" : activeTab === "ou" ? ouMetricLabel : "Win %"}
          </div>
          <div className={`text-2xl font-bold font-mono ${winRateGood ? "text-emerald-400" : tabStats.winRate >= 50 ? "text-foreground" : "text-red-400"}`}>
            {tabStats.winRate}%
          </div>
          <div className="text-xs text-muted-foreground font-mono">
            {tabStats.winRate >= 55 ? "↑ Above avg" : tabStats.winRate >= 50 ? "→ Near avg" : "↓ Below avg"}
          </div>
        </div>
        <div className="bg-card p-4">
          <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono mb-1">ROI</div>
          <div className={`text-2xl font-bold font-mono ${roiPositive ? "text-emerald-400" : "text-red-400"}`}>
            {roiPositive ? "+" : ""}{tabStats.roi}%
          </div>
          <div className="text-xs text-muted-foreground font-mono">flat $100 bets</div>
        </div>
        <div className="bg-card p-4">
          <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono mb-1">Trend</div>
          <div className="flex items-center gap-2 mt-1">
            <SeasonSparkline splits={r.seasonSplits} />
          </div>
          <div className="text-xs text-muted-foreground font-mono mt-1">2021→2025</div>
        </div>
      </div>

      {/* Summary */}
      <div className="p-5 border-b border-border space-y-1">
        <p className="text-sm text-foreground leading-relaxed">{result.summary}</p>
        <p className="text-sm text-muted-foreground leading-relaxed">{result.roiText}</p>
      </div>

      {/* Season Splits + Recent Games */}
      <div className="p-5 space-y-0">
        <SeasonSplitsTable splits={r.seasonSplits} queryType={activeTab} />
        {r.sampleGames && r.sampleGames.length > 0 && (
          <RecentGamesTable games={r.sampleGames} teamAbbr={result.teamAbbr} activeTab={activeTab} totalsIntent={totalsIntent} />
        )}
      </div>
    </div>
  );
}

// ── DB Stats Bar ───────────────────────────────────────────────────────────────
function DbStatsBar() {
  const { data: stats } = trpc.trends.stats.useQuery();
  if (!stats) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs font-mono text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <Database className="w-3 h-3" />
        <span className="text-foreground font-medium">{stats.totalGames.toLocaleString()}</span> games
      </span>
      <span className="flex items-center gap-1.5">
        <BarChart3 className="w-3 h-3" />
        <span className="text-foreground font-medium">{stats.seasons}</span>
      </span>
      <span className="hidden sm:flex items-center gap-1.5">
        <TrendingUp className="w-3 h-3" />
        ML <span className="text-emerald-400 font-medium">{stats.mlCoverage}%</span>
      </span>
      <span className="hidden sm:flex items-center gap-1.5">
        <Target className="w-3 h-3" />
        ATS <span className="text-emerald-400 font-medium">{stats.atsCoverage}%</span>
      </span>
      <span className="hidden md:flex items-center gap-1.5">
        <Zap className="w-3 h-3" />
        O/U <span className="text-emerald-400 font-medium">{stats.ouCoverage}%</span>
      </span>
    </div>
  );
}

// ── Capability Pills ───────────────────────────────────────────────────────────
const CAPABILITIES = [
  { icon: Target, label: "Moneyline trends" },
  { icon: Activity, label: "ATS / Run Line" },
  { icon: TrendingUp, label: "Over/Under" },
  { icon: Award, label: "Season splits" },
  { icon: Filter, label: "Division / Interleague" },
  { icon: TrendingDown, label: "Streak analysis" },
];

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function Home() {
  const [query, setQuery] = useState("");
  const [currentResult, setCurrentResult] = useState<QueryResult | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: suggestedQueries } = trpc.trends.suggestedQueries.useQuery();

  const queryMutation = trpc.trends.query.useMutation({
    onMutate: () => setIsScanning(true),
    onSuccess: (data) => {
      setIsScanning(false);
      const result = data as QueryResult;
      setCurrentResult(result);
      if (query.trim()) {
        setHistory((prev) => [{ query: query.trim(), result, timestamp: new Date() }, ...prev.slice(0, 9)]);
      }
    },
    onError: (err) => {
      setIsScanning(false);
      toast.error("Query failed: " + err.message);
    },
  });

  const handleSubmit = (q?: string) => {
    const text = (q || query).trim();
    if (!text) return;
    if (q) setQuery(q);
    queryMutation.mutate({ query: text });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleSubmit();
  };

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Rotate placeholder
  const PLACEHOLDERS = [
    "How do the Yankees do as home favorites after a loss?",
    "Do the Dodgers cover the run line at home?",
    "Astros over/under in division games",
    "How profitable are overs when the closing total is 10.5 or higher?",
    "How many Mets vs Yankees games have gone under in the last 10?",
    "How often do totals of 7 land on a push?",
    "Red Sox vs Yankees in September",
    "Braves on a 3+ game win streak",
    "Padres as underdogs on the road in 2024",
  ];
  const [placeholderIdx] = useState(() => Math.floor(Math.random() * PLACEHOLDERS.length));

  return (
    <div className="min-h-screen bg-background bg-grid-dots">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-primary" />
            </div>
            <div>
              <div className="text-sm font-bold tracking-tight text-foreground" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                MLB Trends Engine
              </div>
              <div className="text-xs text-muted-foreground font-mono hidden sm:block">
                2021–2025 · 12,042 games
              </div>
            </div>
          </div>
          <DbStatsBar />
        </div>
      </header>

      <main className="container py-8 space-y-8">
        {/* Hero */}
        <div className="max-w-3xl mx-auto text-center space-y-4">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            Ask anything about{" "}
            <span className="text-primary glow-green-text">MLB trends</span>
          </h1>
          <p className="text-muted-foreground text-lg">
            Natural language queries against 12,042 games. Moneyline, ATS, and O/U trends with year-by-year splits — instantly.
          </p>
          {/* Capability pills */}
          <div className="flex flex-wrap justify-center gap-2 pt-1">
            {CAPABILITIES.map(({ icon: Icon, label }) => (
              <div key={label} className="flex items-center gap-1.5 text-xs font-mono px-3 py-1.5 rounded-full border border-border text-muted-foreground bg-card/50">
                <Icon className="w-3 h-3 text-primary" />
                {label}
              </div>
            ))}
          </div>
        </div>

        {/* Query Input */}
        <div className="max-w-3xl mx-auto">
          <div className={`relative rounded-xl border transition-all duration-300 ${
            isScanning
              ? "border-primary/60 shadow-[0_0_30px_oklch(0.82_0.18_155/20%)]"
              : "border-border hover:border-border/80 focus-within:border-primary/40 focus-within:shadow-[0_0_20px_oklch(0.82_0.18_155/10%)]"
          } bg-card overflow-hidden`}>
            {isScanning && (
              <div className="absolute top-0 left-0 right-0 h-0.5 overflow-hidden">
                <div className="h-full w-1/4 bg-primary animate-scan rounded-full" />
              </div>
            )}
            <div className="flex items-center gap-3 px-4 py-4">
              {isScanning ? (
                <RefreshCw className="w-5 h-5 text-primary animate-spin flex-shrink-0" />
              ) : (
                <Search className="w-5 h-5 text-muted-foreground flex-shrink-0" />
              )}
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={PLACEHOLDERS[placeholderIdx]}
                className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground/50 outline-none text-base font-mono"
                disabled={isScanning}
              />
              {query && !isScanning && (
                <span className="text-muted-foreground/40 font-mono text-xs hidden sm:block flex-shrink-0">
                  Press Enter
                </span>
              )}
              <Button
                onClick={() => handleSubmit()}
                disabled={!query.trim() || isScanning}
                size="sm"
                className="flex-shrink-0 bg-primary text-primary-foreground hover:bg-primary/90 font-mono text-xs px-4"
              >
                {isScanning ? "Querying..." : "Run"}
                {!isScanning && <ChevronRight className="w-3 h-3 ml-1" />}
              </Button>
            </div>
          </div>

          {/* Suggested queries */}
          {!currentResult && suggestedQueries && (
            <div className="mt-4 flex flex-wrap gap-2">
              {suggestedQueries.slice(0, 8).map((q, i) => (
                <button
                  key={i}
                  onClick={() => handleSubmit(q)}
                  className="text-xs font-mono px-3 py-1.5 rounded-full border border-border text-muted-foreground hover:border-primary/40 hover:text-foreground hover:bg-card transition-all duration-200"
                >
                  {q}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Results */}
        {currentResult && (
          <div className="max-w-3xl mx-auto space-y-4">
            <div className="flex items-center gap-2 text-sm font-mono text-muted-foreground">
              <span className="text-primary">›</span>
              <span className="truncate">{history[0]?.query}</span>
            </div>
            <ResultsPanel result={currentResult} query={history[0]?.query || ""} />
            <div className="flex flex-wrap gap-2 pt-2">
              <span className="text-xs text-muted-foreground font-mono self-center">Try also:</span>
              {suggestedQueries?.filter(q => q !== history[0]?.query).slice(0, 5).map((q, i) => (
                <button
                  key={i}
                  onClick={() => handleSubmit(q)}
                  className="text-xs font-mono px-3 py-1.5 rounded-full border border-border text-muted-foreground hover:border-primary/40 hover:text-foreground hover:bg-card transition-all duration-200"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* History */}
        {history.length > 1 && (
          <div className="max-w-3xl mx-auto">
            <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono mb-3 flex items-center gap-2">
              <Clock className="w-3 h-3" />
              Query History
            </div>
            <div className="space-y-2">
              {history.slice(1).map((item, i) => (
                <button
                  key={i}
                  onClick={() => { setQuery(item.query); setCurrentResult(item.result); }}
                  className="w-full text-left flex items-center gap-3 px-4 py-3 rounded-lg border border-border hover:border-primary/30 hover:bg-card transition-all duration-200 group"
                >
                  {item.result.teamAbbr ? (
                    <TeamBadge abbr={item.result.teamAbbr} size="sm" />
                  ) : (
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center font-bold font-mono flex-shrink-0 bg-primary/10 border border-primary/20 text-primary text-xs">
                      MLB
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-mono text-foreground truncate">{item.query}</div>
                    {item.result.success && item.result.result && (
                      <div className="text-xs font-mono text-muted-foreground">
                        {item.result.result.wins}-{item.result.result.losses} ({item.result.result.winRate}%) ·{" "}
                        <span className={item.result.result.roi >= 0 ? "text-emerald-400" : "text-red-400"}>
                          {item.result.result.roi >= 0 ? "+" : ""}{item.result.result.roi}% ROI
                        </span>
                        {item.result.queryTypeLabel && (
                          <span className="text-muted-foreground/60"> · {item.result.queryTypeLabel}</span>
                        )}
                      </div>
                    )}
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors flex-shrink-0" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!currentResult && (
          <div className="max-w-3xl mx-auto">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                { icon: Search, title: "Natural Language", desc: "Ask in plain English. The engine understands team names, situations, and betting concepts like ATS, O/U, back-to-back, and more." },
                { icon: Database, title: "12,042 Games", desc: "Five complete MLB seasons (2021–2025) with closing ML, run line, and totals odds. ATS and O/U coverage above 98%." },
                { icon: Zap, title: "Instant Results", desc: "Precomputed condition fields + 31 SQLite indexes deliver sub-5ms query execution after NLP parsing. Season splits included in every result." },
              ].map(({ icon: Icon, title, desc }) => (
                <div key={title} className="bg-card border border-border rounded-xl p-5 space-y-2">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Icon className="w-4 h-4 text-primary" />
                  </div>
                  <div className="font-semibold text-sm" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{title}</div>
                  <div className="text-xs text-muted-foreground leading-relaxed">{desc}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      <footer className="border-t border-border mt-16 py-6">
        <div className="container">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-xs font-mono text-muted-foreground">
            <span>MLB Betting Trends Engine · 2021–2025 · 12,042 games</span>
            <span>Data: Baseball-Reference + SportsbookReview</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
