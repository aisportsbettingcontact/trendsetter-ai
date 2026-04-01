import Database from "better-sqlite3";
import fs from "fs";
import https from "https";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, "mlb_master.db");
const DB_CDN_URL = "https://d2xsxph8kpxj0f.cloudfront.net/310519663397752079/ZTNf5uThCjBDEX2kNSs593/mlb_master_87f63392.db";

let _db: Database.Database | null = null;
let _downloadPromise: Promise<void> | null = null;

function downloadDb(): Promise<void> {
  if (_downloadPromise) return _downloadPromise;
  _downloadPromise = new Promise((resolve, reject) => {
    if (fs.existsSync(DB_PATH)) {
      console.log(`[MLB DB] Found at ${DB_PATH}`);
      return resolve();
    }
    console.log(`[MLB DB] Downloading from CDN...`);
    const file = fs.createWriteStream(DB_PATH);
    https.get(DB_CDN_URL, (res) => {
      res.pipe(file);
      file.on("finish", () => {
        file.close();
        console.log(`[MLB DB] Downloaded successfully (${fs.statSync(DB_PATH).size} bytes)`);
        resolve();
      });
    }).on("error", (err) => {
      fs.unlink(DB_PATH, () => {});
      reject(err);
    });
  });
  return _downloadPromise;
}

export async function ensureDbReady(): Promise<void> {
  await downloadDb();
}

export function getMlbDb(): Database.Database {
  if (!_db) {
    if (!fs.existsSync(DB_PATH)) {
      throw new Error("MLB database not yet downloaded. Please try again in a moment.");
    }
    _db = new Database(DB_PATH, { readonly: true });
  }
  return _db;
}

// ─── Filter Interface ──────────────────────────────────────────────────────────
export interface ParsedFilters {
  // Core
  team?: string | null;
  query_type?: "ml" | "ats" | "ou" | null;  // moneyline, against-the-spread, over/under

  // Game context
  home?: boolean | null;
  favorite?: boolean | null;
  previous_result?: "W" | "L" | null;
  back_to_back?: boolean | null;
  rest_days?: number | null;
  streak_type?: "win" | "loss" | null;
  streak_length?: number | null;
  season?: number | null;

  // New: opponent & schedule context
  opponent?: string | null;           // vs. specific team (e.g. "NYY")
  division_game?: boolean | null;     // division rival games only
  interleague?: boolean | null;       // interleague games only
  month?: number | null;              // 1-12
  day_of_week?: number | null;        // 0=Sun, 1=Mon, ... 6=Sat
  game_number?: number | null;        // 0=doubleheader game 1, 1=single/game 2
  series_game?: number | null;        // 1=first game of series, 2=second, 3=third

  // New: totals context
  over_under?: "over" | "under" | "push" | null;  // totals-side intent
  total_min?: number | null;          // minimum total runs
  total_max?: number | null;          // maximum total runs
  total_exact?: number | null;        // exact closing total line

  // Result windowing
  last_n?: number | null;             // most recent N matching games
  first_n?: number | null;            // earliest N matching games

  // New: opponent division/league
  opponent_division?: "E" | "C" | "W" | null;
  opponent_league?: "AL" | "NL" | null;
}

// ─── Result Interfaces ─────────────────────────────────────────────────────────
export interface SampleGame {
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

export interface SeasonSplit {
  season: number;
  games: number;
  wins: number;
  losses: number;
  pushes?: number;
  winRate: number;
  roi: number;
}

export interface TrendsResult {
  games: number;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number;
  roi: number;
  profit: number;
  decidedGames: number; // games with valid odds used in ROI (excludes extreme/corrupted odds)
  queryType: "ml" | "ats" | "ou";
  seasonSplits: SeasonSplit[];
  sampleGames: SampleGame[];
  // ATS specific
  covers?: number;
  noCover?: number;
  atsCoverRate?: number;
  atsRoi?: number;
  // OU specific
  overs?: number;
  unders?: number;
  totalPushes?: number;
  overRate?: number;
  underRate?: number;
  pushRate?: number;
  ouRoi?: number;
  underRoi?: number;
}

export interface DbStats {
  totalGames: number;
  seasons: string;
  mlCoverage: number;
  rlCoverage: number;
  totCoverage: number;
  atsCoverage: number;
  ouCoverage: number;
  dateRange: string;
}

// ─── DB Stats ──────────────────────────────────────────────────────────────────
export function getDbStats(): DbStats {
  const db = getMlbDb();
  const row = db
    .prepare(
      `SELECT 
        COUNT(*) as total,
        MIN(season) as min_season,
        MAX(season) as max_season,
        SUM(CASE WHEN ml_away IS NOT NULL THEN 1 ELSE 0 END) as ml_cov,
        SUM(CASE WHEN rl_spread IS NOT NULL THEN 1 ELSE 0 END) as rl_cov,
        SUM(CASE WHEN total IS NOT NULL THEN 1 ELSE 0 END) as tot_cov,
        SUM(CASE WHEN away_ats_result IS NOT NULL THEN 1 ELSE 0 END) as ats_cov,
        SUM(CASE WHEN ou_result IS NOT NULL THEN 1 ELSE 0 END) as ou_cov,
        MIN(game_date) as first_game,
        MAX(game_date) as last_game
      FROM games`
    )
    .get() as {
    total: number; min_season: number; max_season: number;
    ml_cov: number; rl_cov: number; tot_cov: number;
    ats_cov: number; ou_cov: number;
    first_game: string; last_game: string;
  };

  return {
    totalGames: row.total,
    seasons: `${row.min_season}–${row.max_season}`,
    mlCoverage: Math.round((row.ml_cov / row.total) * 100),
    rlCoverage: Math.round((row.rl_cov / row.total) * 100),
    totCoverage: Math.round((row.tot_cov / row.total) * 100),
    atsCoverage: Math.round((row.ats_cov / row.total) * 100),
    ouCoverage: Math.round((row.ou_cov / row.total) * 100),
    dateRange: `${row.first_game} → ${row.last_game}`,
  };
}

// ─── Build WHERE clause ────────────────────────────────────────────────────────
function buildWhere(team: string | null, filters: ParsedFilters): { where: string; params: (string | number)[] } {
  const parts: string[] = [];
  const params: (string | number)[] = [];

  // Team must appear in game
  if (team) {
    parts.push(`(away_team = ? OR home_team = ?)`);
    params.push(team, team);
  }

  // Home/away
  if (team && filters.home === true) {
    parts.push(`home_team = ?`);
    params.push(team);
  } else if (team && filters.home === false) {
    parts.push(`away_team = ?`);
    params.push(team);
  }

  // Favorite/underdog
  if (team && filters.favorite === true) {
    parts.push(`((away_team = ? AND away_favorite = 1) OR (home_team = ? AND home_favorite = 1))`);
    params.push(team, team);
  } else if (team && filters.favorite === false) {
    parts.push(`((away_team = ? AND away_underdog = 1) OR (home_team = ? AND home_underdog = 1))`);
    params.push(team, team);
  }

  // Previous result
  if (team && filters.previous_result) {
    parts.push(`((away_team = ? AND away_prev_result = ?) OR (home_team = ? AND home_prev_result = ?))`);
    params.push(team, filters.previous_result, team, filters.previous_result);
  }

  // Back-to-back
  if (team && filters.back_to_back === true) {
    parts.push(`((away_team = ? AND away_back_to_back = 1) OR (home_team = ? AND home_back_to_back = 1))`);
    params.push(team, team);
  } else if (team && filters.back_to_back === false) {
    parts.push(`((away_team = ? AND away_back_to_back = 0) OR (home_team = ? AND home_back_to_back = 0))`);
    params.push(team, team);
  }

  // Rest days
  if (team && filters.rest_days !== undefined && filters.rest_days !== null) {
    parts.push(`((away_team = ? AND away_rest_days = ?) OR (home_team = ? AND home_rest_days = ?))`);
    params.push(team, filters.rest_days, team, filters.rest_days);
  }

  // Streak
  if (team && filters.streak_type && filters.streak_length) {
    if (filters.streak_type === "win") {
      parts.push(`((away_team = ? AND away_streak >= ?) OR (home_team = ? AND home_streak >= ?))`);
      params.push(team, filters.streak_length, team, filters.streak_length);
    } else if (filters.streak_type === "loss") {
      parts.push(`((away_team = ? AND away_streak <= ?) OR (home_team = ? AND home_streak <= ?))`);
      params.push(team, -filters.streak_length, team, -filters.streak_length);
    }
  }

  // Season
  if (filters.season) {
    parts.push(`season = ?`);
    params.push(filters.season);
  }

  // Opponent
  if (filters.opponent) {
    parts.push(`(away_team = ? OR home_team = ?)`);
    params.push(filters.opponent, filters.opponent);
  }

  // Division game
  if (filters.division_game === true) {
    parts.push(`division_game = 1`);
  } else if (filters.division_game === false) {
    parts.push(`division_game = 0`);
  }

  // Interleague
  if (filters.interleague === true) {
    parts.push(`interleague = 1`);
  } else if (filters.interleague === false) {
    parts.push(`interleague = 0`);
  }

  // Month (SQLite: substr(game_date, 6, 2) gives 'MM')
  if (filters.month) {
    parts.push(`CAST(substr(game_date, 6, 2) AS INTEGER) = ?`);
    params.push(filters.month);
  }

  // Day of week (SQLite: strftime('%w', game_date) gives 0=Sun...6=Sat)
  if (filters.day_of_week !== undefined && filters.day_of_week !== null) {
    parts.push(`CAST(strftime('%w', game_date) AS INTEGER) = ?`);
    params.push(filters.day_of_week);
  }

  // Game number (0 = doubleheader game 1, 1 = single game / game 2)
  if (filters.game_number !== undefined && filters.game_number !== null) {
    parts.push(`game_number = ?`);
    params.push(filters.game_number);
  }

  // Total runs filters
  if (filters.total_min !== undefined && filters.total_min !== null) {
    parts.push(`total >= ?`);
    params.push(filters.total_min);
  }
  if (filters.total_max !== undefined && filters.total_max !== null) {
    parts.push(`total <= ?`);
    params.push(filters.total_max);
  }
  if (filters.total_exact !== undefined && filters.total_exact !== null) {
    parts.push(`total = ?`);
    params.push(filters.total_exact);
  }

  // Opponent division/league
  if (team && filters.opponent_division) {
    parts.push(`((away_team = ? AND home_division = ?) OR (home_team = ? AND away_division = ?))`);
    params.push(team, filters.opponent_division, team, filters.opponent_division);
  }
  if (team && filters.opponent_league) {
    parts.push(`((away_team = ? AND home_league = ?) OR (home_team = ? AND away_league = ?))`);
    params.push(team, filters.opponent_league, team, filters.opponent_league);
  }

  return { where: parts.length > 0 ? parts.join(" AND ") : "1=1", params };
}

// ─── Main Query Executor ───────────────────────────────────────────────────────
export function executeTrendsQuery(
  team: string | null,
  filters: ParsedFilters
): TrendsResult {
  const db = getMlbDb();
  const queryType = filters.query_type || "ml";
  const totalsIntent = filters.over_under ?? "over";
  const { where, params } = buildWhere(team, filters);

  const teamLiteral = team ? `'${team}'` : "NULL";
  const sql = `
    SELECT 
      game_date, away_team, home_team, away_score, home_score,
      ml_away, ml_home, rl_spread, rl_away_odds, rl_home_odds,
      total, over_odds, under_odds,
      away_ats_result, ou_result,
      winner, winner_code, season,
      CASE WHEN away_team = ${teamLiteral} THEN ml_away WHEN home_team = ${teamLiteral} THEN ml_home ELSE NULL END as team_ml,
      CASE WHEN away_team = ${teamLiteral} THEN rl_away_odds WHEN home_team = ${teamLiteral} THEN rl_home_odds ELSE NULL END as team_rl_odds,
      CASE WHEN winner_code = ${teamLiteral} THEN 1 ELSE 0 END as win_flag,
      away_ats_result as ats_result_raw
    FROM games
    WHERE ${where}
    ORDER BY game_date DESC
  `;

  const rows = db.prepare(sql).all(...params) as Array<{
    game_date: string; away_team: string; home_team: string;
    away_score: number; home_score: number;
    ml_away: number | null; ml_home: number | null;
    rl_spread: number | null; rl_away_odds: number | null; rl_home_odds: number | null;
    total: number | null; over_odds: number | null; under_odds: number | null;
    away_ats_result: string | null; ou_result: string | null;
    winner: string; winner_code: string; season: number;
    team_ml: number | null; team_rl_odds: number | null;
    win_flag: number; ats_result_raw: string | null;
  }>;

  const filteredRows =
    filters.last_n !== undefined && filters.last_n !== null && filters.last_n > 0
      ? rows.slice(0, filters.last_n)
      : filters.first_n !== undefined && filters.first_n !== null && filters.first_n > 0
        ? rows.slice(-filters.first_n).reverse()
      : rows;

  const games = filteredRows.length;
  if (games === 0) {
    return {
      games: 0, wins: 0, losses: 0, pushes: 0,
      winRate: 0, roi: 0, profit: 0, decidedGames: 0,
      queryType,
      seasonSplits: [],
      sampleGames: [],
    };
  }

  // ── ML calculations ──
  // Valid odds range: ±600 max. Values beyond this are corrupted 2021 end-of-season
  // playoff-race data where sportsbooks posted extreme lines (e.g. -100000 / +5000)
  // for mathematically-eliminated teams. These are real lines but not representative
  // of normal betting conditions and would wildly distort ROI calculations.
  const ML_ODDS_MAX = 600;

  const wins = filteredRows.reduce((acc, r) => acc + r.win_flag, 0);
  const losses = games - wins;
  const winRate = Math.round((wins / games) * 1000) / 10;

  let mlProfit = 0;
  let mlDecidedGames = 0;
  for (const r of filteredRows) {
    const ml = r.team_ml;
    // Skip games with missing or extreme/corrupted odds
    if (ml === null || ml === undefined || Math.abs(ml) > ML_ODDS_MAX) continue;
    mlDecidedGames++;
    if (r.win_flag === 1) {
      mlProfit += ml > 0 ? ml : (100 / Math.abs(ml)) * 100;
    } else {
      mlProfit -= 100;
    }
  }
  const mlRoi = mlDecidedGames > 0 ? Math.round((mlProfit / (mlDecidedGames * 100)) * 1000) / 10 : 0;

  // ── ATS calculations ──
  let covers = 0, noCover = 0, atsPushes = 0, atsProfit = 0;
  for (const r of filteredRows) {
    const isAway = team ? r.away_team === team : false;
    const atsResult = isAway ? r.away_ats_result : (r.away_ats_result === "cover" ? "no_cover" : r.away_ats_result === "no_cover" ? "cover" : r.away_ats_result);
    const rlOdds = r.team_rl_odds;
    // Skip games with missing or extreme RL odds
    if (rlOdds === null || rlOdds === undefined || Math.abs(rlOdds) > ML_ODDS_MAX) {
      // Still count the cover/no_cover result, just don't include in profit
      if (atsResult === "cover") covers++;
      else if (atsResult === "no_cover") noCover++;
      else atsPushes++;
      continue;
    }

    if (atsResult === "cover") {
      covers++;
      atsProfit += rlOdds > 0 ? rlOdds : (100 / Math.abs(rlOdds)) * 100;
    } else if (atsResult === "no_cover") {
      noCover++;
      atsProfit -= 100;
    } else {
      atsPushes++;
    }
  }
  const atsGames = covers + noCover;
  const atsCoverRate = atsGames > 0 ? Math.round((covers / atsGames) * 1000) / 10 : 0;
  const atsRoi = atsGames > 0 ? Math.round((atsProfit / (atsGames * 100)) * 1000) / 10 : 0;

  // ── O/U calculations ──
  let overs = 0, unders = 0, ouPushes = 0, overProfit = 0, underProfit = 0;
  for (const r of filteredRows) {
    const overOdds = r.over_odds;
    const useOverOdds = (overOdds !== null && overOdds !== undefined && Math.abs(overOdds) <= ML_ODDS_MAX) ? overOdds : -110;
    const underOdds = r.under_odds;
    const useUnderOdds = (underOdds !== null && underOdds !== undefined && Math.abs(underOdds) <= ML_ODDS_MAX) ? underOdds : -110;
    if (r.ou_result === "over") {
      overs++;
      overProfit += useOverOdds > 0 ? useOverOdds : (100 / Math.abs(useOverOdds)) * 100;
      underProfit -= 100;
    } else if (r.ou_result === "under") {
      unders++;
      overProfit -= 100;
      underProfit += useUnderOdds > 0 ? useUnderOdds : (100 / Math.abs(useUnderOdds)) * 100;
    } else if (r.ou_result === "push") {
      ouPushes++;
    }
  }
  const ouGames = overs + unders;
  const overRate = ouGames > 0 ? Math.round((overs / ouGames) * 1000) / 10 : 0;
  const underRate = ouGames > 0 ? Math.round((unders / ouGames) * 1000) / 10 : 0;
  const pushRate = games > 0 ? Math.round((ouPushes / games) * 1000) / 10 : 0;
  const ouRoi = ouGames > 0 ? Math.round((overProfit / (ouGames * 100)) * 1000) / 10 : 0;
  const underRoi = ouGames > 0 ? Math.round((underProfit / (ouGames * 100)) * 1000) / 10 : 0;

  // ── Season splits ──
  const seasonMap = new Map<number, {
    ml: { wins: number; losses: number; pushes: number; profit: number; decidedGames: number };
    ats: { wins: number; losses: number; pushes: number; profit: number; decidedGames: number };
    ou: { wins: number; losses: number; pushes: number; profit: number; decidedGames: number };
  }>();
  for (const r of filteredRows) {
    const s = r.season;
    if (!seasonMap.has(s)) {
      seasonMap.set(s, {
        ml: { wins: 0, losses: 0, pushes: 0, profit: 0, decidedGames: 0 },
        ats: { wins: 0, losses: 0, pushes: 0, profit: 0, decidedGames: 0 },
        ou: { wins: 0, losses: 0, pushes: 0, profit: 0, decidedGames: 0 },
      });
    }
    const entry = seasonMap.get(s)!;
    const ml = r.team_ml;
    const rlOdds = r.team_rl_odds;
    const isAway = team ? r.away_team === team : false;
    const atsResult = isAway
      ? r.away_ats_result
      : (r.away_ats_result === "cover"
        ? "no_cover"
        : r.away_ats_result === "no_cover"
          ? "cover"
          : r.away_ats_result);

    if (r.win_flag === 1) entry.ml.wins++;
    else entry.ml.losses++;
    if (ml !== null && ml !== undefined && Math.abs(ml) <= ML_ODDS_MAX) {
      entry.ml.decidedGames++;
      if (r.win_flag === 1) {
        entry.ml.profit += ml > 0 ? ml : (100 / Math.abs(ml)) * 100;
      } else {
        entry.ml.profit -= 100;
      }
    }

    if (atsResult === "cover") {
      entry.ats.wins++;
      if (rlOdds !== null && rlOdds !== undefined && Math.abs(rlOdds) <= ML_ODDS_MAX) {
        entry.ats.decidedGames++;
        entry.ats.profit += rlOdds > 0 ? rlOdds : (100 / Math.abs(rlOdds)) * 100;
      }
    } else if (atsResult === "no_cover") {
      entry.ats.losses++;
      if (rlOdds !== null && rlOdds !== undefined && Math.abs(rlOdds) <= ML_ODDS_MAX) {
        entry.ats.decidedGames++;
        entry.ats.profit -= 100;
      }
    } else {
      entry.ats.pushes++;
    }

    if (r.ou_result === "over") {
      if (totalsIntent === "under") {
        entry.ou.losses++;
        entry.ou.decidedGames++;
        entry.ou.profit -= 100;
      } else if (totalsIntent === "push") {
        entry.ou.losses++;
      } else {
        entry.ou.wins++;
        entry.ou.decidedGames++;
        entry.ou.profit += getProfitFromOdds(r.over_odds, ML_ODDS_MAX);
      }
    } else if (r.ou_result === "under") {
      if (totalsIntent === "under") {
        entry.ou.wins++;
        entry.ou.decidedGames++;
        entry.ou.profit += getProfitFromOdds(r.under_odds, ML_ODDS_MAX);
      } else if (totalsIntent === "push") {
        entry.ou.losses++;
      } else {
        entry.ou.losses++;
        entry.ou.decidedGames++;
        entry.ou.profit -= 100;
      }
    } else if (r.ou_result === "push") {
      if (totalsIntent === "push") {
        entry.ou.wins++;
      } else {
        entry.ou.pushes++;
      }
    }
  }

  const seasonSplits: SeasonSplit[] = Array.from(seasonMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([season, data]) => {
      const selected = queryType === "ats" ? data.ats : queryType === "ou" ? data.ou : data.ml;
      const sg = selected.wins + selected.losses + selected.pushes;
      const decidedGames = selected.wins + selected.losses;
      const dg = selected.decidedGames;
      return {
        season,
        games: sg,
        wins: selected.wins,
        losses: selected.losses,
        pushes: selected.pushes > 0 ? selected.pushes : undefined,
        winRate: decidedGames > 0 ? Math.round((selected.wins / decidedGames) * 1000) / 10 : 0,
        roi: dg > 0 ? Math.round((selected.profit / (dg * 100)) * 1000) / 10 : 0,
      };
    });

  // ── Sample games ──
  const sampleGames: SampleGame[] = filteredRows.slice(0, 10).map((r) => ({
    game_date: r.game_date,
    away_team: r.away_team,
    home_team: r.home_team,
    away_score: r.away_score,
    home_score: r.home_score,
    ml_away: r.ml_away,
    ml_home: r.ml_home,
    rl_spread: r.rl_spread,
    rl_away_odds: r.rl_away_odds,
    rl_home_odds: r.rl_home_odds,
    total: r.total,
    over_odds: r.over_odds,
    under_odds: r.under_odds,
    away_ats_result: r.away_ats_result,
    ou_result: r.ou_result,
    winner: r.winner,
  }));

  // Determine primary result based on query type
  const primaryWins =
    queryType === "ats"
      ? covers
      : queryType === "ou"
        ? totalsIntent === "under"
          ? unders
          : totalsIntent === "push"
            ? ouPushes
            : overs
        : wins;
  const primaryLosses =
    queryType === "ats"
      ? noCover
      : queryType === "ou"
        ? totalsIntent === "under"
          ? overs
          : totalsIntent === "push"
            ? games - ouPushes
            : unders
        : losses;
  const primaryPushes = queryType === "ats" ? atsPushes : queryType === "ou" ? ouPushes : 0;
  const primaryWinRate =
    queryType === "ats"
      ? atsCoverRate
      : queryType === "ou"
        ? totalsIntent === "under"
          ? underRate
          : totalsIntent === "push"
            ? pushRate
            : overRate
        : winRate;
  const primaryRoi =
    queryType === "ats"
      ? atsRoi
      : queryType === "ou"
        ? totalsIntent === "under"
          ? underRoi
          : totalsIntent === "push"
            ? 0
            : ouRoi
        : mlRoi;
  const primaryProfit =
    queryType === "ats"
      ? atsProfit
      : queryType === "ou"
        ? totalsIntent === "under"
          ? underProfit
          : totalsIntent === "push"
            ? 0
            : overProfit
        : mlProfit;
  // decidedGames is the count of games with valid odds used in ROI (excludes extreme/missing odds)
  const decidedGames =
    queryType === "ats"
      ? atsGames
      : queryType === "ou"
        ? totalsIntent === "push"
          ? 0
          : ouGames
        : mlDecidedGames;

  return {
    games,
    wins: primaryWins,
    losses: primaryLosses,
    pushes: primaryPushes,
    winRate: primaryWinRate,
    roi: primaryRoi,
    profit: Math.round(primaryProfit * 100) / 100,
    decidedGames, // games with valid odds used in ROI calculation
    queryType,
    seasonSplits,
    sampleGames,
    // Always include all three for tab switching
    covers,
    noCover,
    atsCoverRate,
    atsRoi,
    overs,
    unders,
    totalPushes: ouPushes,
    overRate,
    underRate,
    pushRate,
    ouRoi,
    underRoi,
  };
}

function getProfitFromOdds(odds: number | null | undefined, maxAbsOdds: number): number {
  const normalizedOdds =
    odds !== null && odds !== undefined && Math.abs(odds) <= maxAbsOdds
      ? odds
      : -110;
  return normalizedOdds > 0 ? normalizedOdds : (100 / Math.abs(normalizedOdds)) * 100;
}
