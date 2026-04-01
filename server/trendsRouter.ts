import { z } from "zod";
import { publicProcedure, router } from "./_core/trpc";
import { invokeLLM } from "./_core/llm";
import { executeTrendsQuery, getDbStats, ParsedFilters } from "./mlbDb";

// ─── Team Dictionaries ─────────────────────────────────────────────────────────
const TEAM_ALIASES: Record<string, string> = {
  // Yankees
  yankees: "NYY", "new york yankees": "NYY", "ny yankees": "NYY", "new york (al)": "NYY",
  // Dodgers
  dodgers: "LAD", "los angeles dodgers": "LAD", "la dodgers": "LAD",
  // Red Sox
  "red sox": "BOS", boston: "BOS", "boston red sox": "BOS",
  // Astros
  astros: "HOU", houston: "HOU", "houston astros": "HOU",
  // Braves
  braves: "ATL", atlanta: "ATL", "atlanta braves": "ATL",
  // Mets
  mets: "NYM", "new york mets": "NYM", "ny mets": "NYM",
  // Phillies
  phillies: "PHI", philadelphia: "PHI", "philadelphia phillies": "PHI",
  // Cubs
  cubs: "CHC", "chicago cubs": "CHC",
  // Cardinals
  cardinals: "STL", "st. louis": "STL", "st louis": "STL", "saint louis": "STL", "st. louis cardinals": "STL",
  // Giants
  giants: "SFG", "san francisco": "SFG", "sf giants": "SFG", "san francisco giants": "SFG",
  // Padres
  padres: "SDP", "san diego": "SDP", "san diego padres": "SDP",
  // Rangers
  rangers: "TEX", texas: "TEX", "texas rangers": "TEX",
  // Orioles
  orioles: "BAL", baltimore: "BAL", "baltimore orioles": "BAL",
  // Rays
  rays: "TBR", "tampa bay": "TBR", "tampa bay rays": "TBR",
  // Blue Jays
  "blue jays": "TOR", toronto: "TOR", "toronto blue jays": "TOR",
  // Mariners
  mariners: "SEA", seattle: "SEA", "seattle mariners": "SEA",
  // Twins
  twins: "MIN", minnesota: "MIN", "minnesota twins": "MIN",
  // Guardians
  guardians: "CLE", cleveland: "CLE", "cleveland guardians": "CLE",
  // White Sox
  "white sox": "CWS", "chicago white sox": "CWS",
  // Tigers
  tigers: "DET", detroit: "DET", "detroit tigers": "DET",
  // Royals
  royals: "KCR", "kansas city": "KCR", "kansas city royals": "KCR",
  // Athletics
  athletics: "ATH", "oakland athletics": "ATH", "las vegas athletics": "ATH", "a's": "ATH",
  // Angels
  angels: "LAA", "los angeles angels": "LAA", "la angels": "LAA", anaheim: "LAA",
  // Diamondbacks
  diamondbacks: "ARI", arizona: "ARI", "arizona diamondbacks": "ARI", "d-backs": "ARI",
  // Rockies
  rockies: "COL", colorado: "COL", "colorado rockies": "COL",
  // Marlins
  marlins: "MIA", miami: "MIA", "miami marlins": "MIA",
  // Nationals
  nationals: "WSN", washington: "WSN", "washington nationals": "WSN", nats: "WSN",
  // Pirates
  pirates: "PIT", pittsburgh: "PIT", "pittsburgh pirates": "PIT",
  // Reds
  reds: "CIN", cincinnati: "CIN", "cincinnati reds": "CIN",
  // Brewers
  brewers: "MIL", milwaukee: "MIL", "milwaukee brewers": "MIL",
};

const TEAM_NAMES: Record<string, string> = {
  NYY: "New York Yankees", LAD: "Los Angeles Dodgers", BOS: "Boston Red Sox",
  HOU: "Houston Astros", ATL: "Atlanta Braves", NYM: "New York Mets",
  PHI: "Philadelphia Phillies", CHC: "Chicago Cubs", STL: "St. Louis Cardinals",
  SFG: "San Francisco Giants", SDP: "San Diego Padres", TEX: "Texas Rangers",
  BAL: "Baltimore Orioles", TBR: "Tampa Bay Rays", TOR: "Toronto Blue Jays",
  SEA: "Seattle Mariners", MIN: "Minnesota Twins", CLE: "Cleveland Guardians",
  CWS: "Chicago White Sox", DET: "Detroit Tigers", KCR: "Kansas City Royals",
  ATH: "Athletics", LAA: "Los Angeles Angels", ARI: "Arizona Diamondbacks",
  COL: "Colorado Rockies", MIA: "Miami Marlins", WSN: "Washington Nationals",
  PIT: "Pittsburgh Pirates", CIN: "Cincinnati Reds", MIL: "Milwaukee Brewers",
};

// ─── Regex Fallback ────────────────────────────────────────────────────────────
export function extractTeamFromText(text: string): string | null {
  const lower = text.toLowerCase();
  const sortedAliases = Object.entries(TEAM_ALIASES).sort((a, b) => b[0].length - a[0].length);
  let earliest: { index: number; abbr: string } | null = null;
  for (const [alias, abbr] of sortedAliases) {
    const idx = lower.indexOf(alias);
    if (idx !== -1 && (!earliest || idx < earliest.index)) {
      earliest = { index: idx, abbr };
    }
  }
  return earliest ? earliest.abbr : null;
}

export function extractSecondTeamFromText(text: string, firstTeam: string): string | null {
  const lower = text.toLowerCase();
  const sortedAliases = Object.entries(TEAM_ALIASES).sort((a, b) => b[0].length - a[0].length);
  let second: { index: number; abbr: string } | null = null;
  for (const [alias, abbr] of sortedAliases) {
    if (abbr === firstTeam) continue;
    const idx = lower.indexOf(alias);
    if (idx !== -1 && (!second || idx < second.index)) {
      second = { index: idx, abbr };
    }
  }
  return second ? second.abbr : null;
}

// ─── NLP System Prompt ─────────────────────────────────────────────────────────
const NLP_SYSTEM_PROMPT = `You are an elite MLB betting trends query parser with deep knowledge of baseball and sports betting.

Your job: extract ALL structured filters from the user's natural language query.

CRITICAL RULES:
1. "team" MUST always be the FIRST/PRIMARY team mentioned. NEVER return null if any team appears.
2. For comparison queries ("Dodgers vs Giants", "Are the Yankees better than..."), pick the FIRST team.
3. "query_type": detect what the user is asking about:
   - "ml" = moneyline win/loss record (default)
   - "ats" = against the spread / run line / cover / ATS
   - "ou" = over/under / totals / O/U
4. "opponent" = the SECOND team mentioned (for "vs" queries). Only set if user asks about a specific matchup.
5. For division/league filters, map correctly:
   - AL East: BAL, BOS, NYY, TBR, TOR
   - AL Central: CWS, CLE, DET, KCR, MIN
   - AL West: HOU, LAA, ATH, SEA, TEX
   - NL East: ATL, MIA, NYM, PHI, WSN
   - NL Central: CHC, CIN, MIL, PIT, STL
   - NL West: ARI, COL, LAD, SDP, SFG

Return ONLY valid JSON with these exact keys (null for absent):
{
  "team": "3-letter abbreviation — ALWAYS fill if any team mentioned",
  "query_type": "ml" | "ats" | "ou",
  "over_under": "over" | "under" | "push" | null,
  "home": true | false | null,
  "favorite": true | false | null,
  "previous_result": "W" | "L" | null,
  "back_to_back": true | false | null,
  "rest_days": integer | null,
  "streak_type": "win" | "loss" | null,
  "streak_length": integer | null,
  "season": integer | null,
  "opponent": "3-letter abbreviation" | null,
  "division_game": true | false | null,
  "interleague": true | false | null,
  "month": 1-12 integer | null,
  "day_of_week": 0-6 integer (0=Sun,1=Mon,2=Tue,3=Wed,4=Thu,5=Fri,6=Sat) | null,
  "game_number": 0 | 1 | null (0=doubleheader game 1, 1=regular/game 2),
  "last_n": integer | null,
  "first_n": integer | null,
  "total_exact": number | null,
  "total_min": number | null,
  "total_max": number | null,
  "opponent_division": "E" | "C" | "W" | null,
  "opponent_league": "AL" | "NL" | null
}

Team abbreviations:
NYY=Yankees, LAD=Dodgers, BOS=Red Sox, HOU=Astros, ATL=Braves, NYM=Mets,
PHI=Phillies, CHC=Cubs, STL=Cardinals, SFG=Giants, SDP=Padres, TEX=Rangers,
BAL=Orioles, TBR=Rays, TOR=Blue Jays, SEA=Mariners, MIN=Twins, CLE=Guardians,
CWS=White Sox, DET=Tigers, KCR=Royals, ATH=Athletics, LAA=Angels, ARI=Diamondbacks,
COL=Rockies, MIA=Marlins, WSN=Nationals, PIT=Pirates, CIN=Reds, MIL=Brewers

Examples:
- "Yankees home record" → team:NYY, home:true, query_type:ml
- "Do the Dodgers cover the run line at home?" → team:LAD, home:true, query_type:ats
- "Astros over/under in division games" → team:HOU, division_game:true, query_type:ou
- "How profitable are overs when the total is 10.5 or higher?" → over_under:over, total_min:10.5, query_type:ou
- "How many games out of their last 10 against the Yankees have Mets games gone under and what's the ROI?" → team:NYM, opponent:NYY, over_under:under, last_n:10, query_type:ou
- "How often do totals of 7 land on a push?" → query_type:ou, over_under:push, total_exact:7
- "Red Sox vs Yankees in September" → team:BOS, opponent:NYY, month:9, query_type:ml
- "Cubs on a 3-game losing streak" → team:CHC, streak_type:loss, streak_length:3
- "Orioles as big favorites after a win" → team:BAL, favorite:true, previous_result:W
- "Braves in interleague games on the road" → team:ATL, interleague:true, home:false
- "Padres on Fridays" → team:SDP, day_of_week:5
- "Mets in high-scoring games (over 10 runs)" → team:NYM, total_min:10, query_type:ou
- "Guardians vs AL West teams" → team:CLE, opponent_league:AL, opponent_division:W`;

// ─── LLM Parser ───────────────────────────────────────────────────────────────
async function parseQueryWithLLM(userInput: string): Promise<ParsedFilters> {
  const response = await invokeLLM({
    messages: [
      { role: "system", content: NLP_SYSTEM_PROMPT },
      { role: "user", content: userInput },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "mlb_filters",
        strict: true,
        schema: {
          type: "object",
          properties: {
            team: { type: ["string", "null"] },
            query_type: { type: ["string", "null"] },
            over_under: { type: ["string", "null"] },
            home: { type: ["boolean", "null"] },
            favorite: { type: ["boolean", "null"] },
            previous_result: { type: ["string", "null"] },
            back_to_back: { type: ["boolean", "null"] },
            rest_days: { type: ["integer", "null"] },
            streak_type: { type: ["string", "null"] },
            streak_length: { type: ["integer", "null"] },
            season: { type: ["integer", "null"] },
            opponent: { type: ["string", "null"] },
            division_game: { type: ["boolean", "null"] },
            interleague: { type: ["boolean", "null"] },
            month: { type: ["integer", "null"] },
            day_of_week: { type: ["integer", "null"] },
            game_number: { type: ["integer", "null"] },
            last_n: { type: ["integer", "null"] },
            first_n: { type: ["integer", "null"] },
            total_exact: { type: ["number", "null"] },
            total_min: { type: ["number", "null"] },
            total_max: { type: ["number", "null"] },
            opponent_division: { type: ["string", "null"] },
            opponent_league: { type: ["string", "null"] },
          },
          required: [
            "team", "query_type", "over_under", "home", "favorite", "previous_result",
            "back_to_back", "rest_days", "streak_type", "streak_length", "season",
            "opponent", "division_game", "interleague", "month", "day_of_week",
            "game_number", "last_n", "first_n", "total_exact", "total_min", "total_max",
            "opponent_division", "opponent_league",
          ],
          additionalProperties: false,
        },
      },
    },
  });

  const content = response.choices[0].message.content;
  const parsed = typeof content === "string" ? JSON.parse(content) : content;

  // Normalize team abbreviation
  const normalizeTeam = (t: string | null): string | null => {
    if (!t) return null;
    const upper = t.toUpperCase();
    if (TEAM_NAMES[upper]) return upper;
    return TEAM_ALIASES[t.toLowerCase()] || upper;
  };

  parsed.team = normalizeTeam(parsed.team);
  parsed.opponent = normalizeTeam(parsed.opponent);

  // Regex fallback for primary team
  if (!parsed.team) {
    parsed.team = extractTeamFromText(userInput);
  }

  // Regex fallback for opponent (second team)
  if (!parsed.opponent && parsed.team) {
    const secondTeam = extractSecondTeamFromText(userInput, parsed.team);
    if (secondTeam) parsed.opponent = secondTeam;
  }

  // Default query_type
  if (!parsed.query_type) parsed.query_type = "ml";

  applyQueryFallbacks(userInput, parsed as ParsedFilters);

  return parsed as ParsedFilters;
}

function applyQueryFallbacks(userInput: string, parsed: ParsedFilters): void {
  const lower = userInput.toLowerCase();

  if (!parsed.over_under) {
    if (/\bpush(?:es)?\b/.test(lower)) parsed.over_under = "push";
    else if (/\bunders?\b/.test(lower) || /\bgone under\b/.test(lower)) parsed.over_under = "under";
    else if (/\bovers?\b/.test(lower) || /\bgone over\b/.test(lower)) parsed.over_under = "over";
  }

  if (parsed.query_type === "ou") {
    const minMatch =
      lower.match(/\b(?:at least|or higher|and higher|minimum of|>=)\s*(\d+(?:\.\d+)?)\b/) ||
      lower.match(/\b(?:closing total|posted total|total|totals)(?: of)?\s*(\d+(?:\.\d+)?)\s*(?:or higher|and higher|\+)\b/) ||
      lower.match(/\b(\d+(?:\.\d+)?)\+/);
    if (!parsed.total_min && minMatch) {
      parsed.total_min = Number(minMatch[1]);
    }

    const maxMatch =
      lower.match(/\b(?:at most|or lower|and lower|<=)\s*(\d+(?:\.\d+)?)\b/) ||
      lower.match(/\b(?:closing total|posted total|total|totals)(?: of)?\s*(\d+(?:\.\d+)?)\s*(?:or lower|and lower|or less|and less)\b/) ||
      lower.match(/\b(\d+(?:\.\d+)?)\s*(?:or less|and less)\b/);
    if (!parsed.total_max && maxMatch) {
      parsed.total_max = Number(maxMatch[1]);
    }

    const exactMatch =
      lower.match(/\b(?:exactly|closing total|posted total|total(?:s)? of|lined at|set at|at)\s*(\d+(?:\.\d+)?)\s*(?:flat)?\b/) ||
      lower.match(/\b(\d+(?:\.\d+)?)\s*flat\b/);
    if (!parsed.total_exact && exactMatch && !parsed.total_min && !parsed.total_max) {
      parsed.total_exact = Number(exactMatch[1]);
    }
  }

  const lastNMatch = lower.match(/\blast\s+(\d+)\b/);
  if (!parsed.last_n && lastNMatch) {
    parsed.last_n = Number(lastNMatch[1]);
  }

  const firstNMatch = lower.match(/\bfirst\s+(\d+)\b/);
  if (!parsed.first_n && firstNMatch) {
    parsed.first_n = Number(firstNMatch[1]);
  }
}

export const __testUtils = {
  applyQueryFallbacksForTest(userInput: string, parsed: Partial<ParsedFilters>) {
    const next = { ...parsed } as ParsedFilters;
    applyQueryFallbacks(userInput, next);
    return next;
  },
};

// ─── Conditions Text Builder ───────────────────────────────────────────────────
const MONTH_NAMES = ["", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
const DOW_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function buildConditionsText(filters: ParsedFilters, teamName: string): string {
  const parts: string[] = [];

  if (filters.home === true) parts.push("at home");
  else if (filters.home === false) parts.push("on the road");

  if (filters.favorite === true) parts.push("as favorites");
  else if (filters.favorite === false) parts.push("as underdogs");

  if (filters.previous_result === "W") parts.push("after a win");
  else if (filters.previous_result === "L") parts.push("after a loss");

  if (filters.back_to_back === true) parts.push("on the second leg of a back-to-back");

  if (filters.rest_days !== null && filters.rest_days !== undefined)
    parts.push(`with ${filters.rest_days} days rest`);

  if (filters.streak_type && filters.streak_length)
    parts.push(`on a ${filters.streak_length}+ game ${filters.streak_type} streak`);

  if (filters.opponent) parts.push(`vs. ${TEAM_NAMES[filters.opponent] || filters.opponent}`);

  if (filters.division_game === true) parts.push("in division games");
  else if (filters.division_game === false) parts.push("in non-division games");

  if (filters.interleague === true) parts.push("in interleague games");

  if (filters.month) parts.push(`in ${MONTH_NAMES[filters.month]}`);

  if (filters.day_of_week !== null && filters.day_of_week !== undefined)
    parts.push(`on ${DOW_NAMES[filters.day_of_week]}s`);

  if (filters.last_n) parts.push(`across the last ${filters.last_n} matching games`);
  if (filters.first_n) parts.push(`across the first ${filters.first_n} matching games`);

  if (filters.total_exact !== null && filters.total_exact !== undefined)
    parts.push(`with a closing total of ${filters.total_exact}`);
  if (filters.total_min !== null && filters.total_min !== undefined)
    parts.push(`when the closing total was ${filters.total_min} or higher`);
  if (filters.total_max !== null && filters.total_max !== undefined)
    parts.push(`when the closing total was ${filters.total_max} or lower`);

  if (filters.opponent_division)
    parts.push(`vs. ${filters.opponent_league || ""}${filters.opponent_division} teams`.trim());
  else if (filters.opponent_league)
    parts.push(`vs. ${filters.opponent_league} teams`);

  if (filters.season) parts.push(`in ${filters.season}`);

  return parts.join(", ");
}

// ─── Suggested Queries ─────────────────────────────────────────────────────────
const SUGGESTED_QUERIES = [
  "How do the Yankees do as home favorites after a loss?",
  "Dodgers record on the road as underdogs",
  "Astros on the second leg of a back-to-back",
  "Orioles as favorites after a win in 2024",
  "Red Sox home record when on a 3+ game win streak",
  "Do the Braves cover the run line at home?",
  "Phillies vs NL East teams in 2024",
  "Cubs over/under in day games (Monday)",
  "Padres in interleague games as underdogs",
  "Guardians vs AL West teams on the road",
  "Mets after 3+ days rest at home",
  "Yankees in September as favorites",
  "Dodgers ATS record in division games",
  "Astros totals in high-scoring games (10+ runs)",
  "How profitable are unders when the posted total is 8.5 or less?",
  "How often do totals of 7 land on a push?",
  "How many of the last 10 Mets vs Yankees games have gone under?",
  "Cardinals on a 3-game losing streak",
];

// ─── Router ────────────────────────────────────────────────────────────────────
export const trendsRouter = router({
  query: publicProcedure
    .input(z.object({ query: z.string().min(2).max(500) }))
    .mutation(async ({ input }) => {
      const startTime = Date.now();

      const filters = await parseQueryWithLLM(input.query);
      const parseTimeMs = Date.now() - startTime;

      if (!filters.team && filters.query_type !== "ou") {
        return {
          success: false as const,
          error: "No MLB team found in your query. Try mentioning a team name, city, or nickname — e.g. \"Yankees\", \"Los Angeles Dodgers\", or \"Boston\".",
          filters,
          parseTimeMs,
        };
      }

      const teamAbbr = filters.team ? filters.team.toUpperCase() : null;
      const teamName = teamAbbr ? (TEAM_NAMES[teamAbbr] || teamAbbr) : "MLB";

      const dbStart = Date.now();
      const result = executeTrendsQuery(teamAbbr, filters);
      const dbTimeMs = Date.now() - dbStart;

      if (result.games === 0) {
        return {
          success: false as const,
          error: `No games found for the ${teamName} matching those conditions. Try broadening your filters.`,
          filters,
          teamAbbr: teamAbbr ?? undefined,
          teamName,
          parseTimeMs,
          dbTimeMs,
        };
      }

      const conditionsText = buildConditionsText(filters, teamName);
      const conditionsDisplay = conditionsText ? ` ${conditionsText}` : "";
      const roiSign = result.roi >= 0 ? "+" : "";

      const totalsIntent = filters.over_under ?? "over";
      const queryTypeLabel = filters.query_type === "ats" ? "ATS (Run Line)" : filters.query_type === "ou" ? "Totals" : "Moneyline";
      const winLabel =
        filters.query_type === "ats"
          ? "covers"
          : filters.query_type === "ou"
            ? totalsIntent === "under"
              ? "unders"
              : totalsIntent === "push"
                ? "pushes"
                : "overs"
            : "wins";

      const summary = filters.query_type === "ats"
        ? `The ${teamName} cover the run line ${result.wins}-${result.losses}${result.pushes > 0 ? `-${result.pushes}` : ""} (${result.winRate}%) in ${result.games} games${conditionsDisplay}.`
        : filters.query_type === "ou"
        ? totalsIntent === "under"
          ? `Games involving ${teamName === "MLB" ? "MLB teams" : `the ${teamName}`}${conditionsDisplay} go under ${result.wins}-${result.losses}${result.pushes > 0 ? `-${result.pushes}` : ""} (${result.winRate}%).`
          : totalsIntent === "push"
            ? `Games involving ${teamName === "MLB" ? "MLB teams" : `the ${teamName}`}${conditionsDisplay} land on a push ${result.wins} time${result.wins === 1 ? "" : "s"} out of ${result.games} (${result.winRate}%).`
            : `Games involving ${teamName === "MLB" ? "MLB teams" : `the ${teamName}`}${conditionsDisplay} go over ${result.wins}-${result.losses}${result.pushes > 0 ? `-${result.pushes}` : ""} (${result.winRate}%).`
        : `The ${teamName} are ${result.wins}-${result.losses} (${result.winRate}%) in ${result.games} games${conditionsDisplay}.`;

      // Wagered = $100 per game, excluding pushes (pushes return stake, no profit/loss)
      const decidedGames = result.decidedGames;
      const totalWagered = decidedGames * 100;
      const roiText =
        filters.query_type === "ou" && totalsIntent === "push"
          ? `Pushes don't have a meaningful flat-bet ROI because a push returns stake. This spot pushed ${result.wins} time${result.wins === 1 ? "" : "s"} in ${result.games} games.`
          : `That translates to a ${roiSign}${result.roi}% ROI on $100 flat bets (${roiSign}$${Math.abs(result.profit).toFixed(0)} ${result.roi >= 0 ? "profit" : "loss"} on $${totalWagered.toLocaleString()} wagered across ${decidedGames} decided games${result.pushes > 0 ? `, ${result.pushes} push${result.pushes > 1 ? "es" : ""}` : ""}).`;

      return {
        success: true as const,
        teamAbbr: teamAbbr ?? undefined,
        teamName,
        conditionsText,
        queryTypeLabel,
        winLabel,
        summary,
        roiText,
        result,
        filters,
        parseTimeMs,
        dbTimeMs,
      };
    }),

  stats: publicProcedure.query(() => {
    return getDbStats();
  }),

  suggestedQueries: publicProcedure.query(() => {
    return SUGGESTED_QUERIES;
  }),
});
