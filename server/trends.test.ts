import { beforeAll, describe, expect, it } from "vitest";
import {
  ensureDbReady,
  executeTrendsQuery,
  getDbStats,
  getMlbDb,
} from "./mlbDb";
import { extractTeamFromText, extractSecondTeamFromText, __testUtils } from "./trendsRouter";

beforeAll(async () => {
  await ensureDbReady();
});

// ─── Team Extraction Tests ─────────────────────────────────────────────────────
describe("extractTeamFromText - regex fallback", () => {
  it("extracts first team from comparison query", () => {
    expect(extractTeamFromText("Are the Dodgers better ATS at home than the Giants?")).toBe("LAD");
  });

  it("extracts team from simple query", () => {
    expect(extractTeamFromText("How do the Yankees do at home?")).toBe("NYY");
  });

  it("extracts team with city name", () => {
    expect(extractTeamFromText("Boston Red Sox road record")).toBe("BOS");
  });

  it("returns null for no team", () => {
    expect(extractTeamFromText("What is the best team in baseball?")).toBeNull();
  });

  it("picks first team in multi-team query", () => {
    const result = extractTeamFromText("Dodgers vs Giants home record");
    expect(result).toBe("LAD");
  });

  it("extracts second team correctly", () => {
    const second = extractSecondTeamFromText("Dodgers vs Giants home record", "LAD");
    expect(second).toBe("SFG");
  });

  it("returns null for second team when only one team mentioned", () => {
    const second = extractSecondTeamFromText("Yankees home record", "NYY");
    expect(second).toBeNull();
  });
});

describe("totals query fallback parsing", () => {
  it("parses plus notation like 9.5+", () => {
    const parsed = __testUtils.applyQueryFallbacksForTest(
      "How profitable are overs when the posted total is 9.5+?",
      { query_type: "ou" }
    );
    expect(parsed.over_under).toBe("over");
    expect(parsed.total_min).toBe(9.5);
  });

  it("parses 'or less' notation", () => {
    const parsed = __testUtils.applyQueryFallbacksForTest(
      "How profitable are unders when the closing total is 9 or less?",
      { query_type: "ou" }
    );
    expect(parsed.over_under).toBe("under");
    expect(parsed.total_max).toBe(9);
  });

  it("parses exact totals from 'lined at' phrasing", () => {
    const parsed = __testUtils.applyQueryFallbacksForTest(
      "How often do totals lined at 7 land on a push?",
      { query_type: "ou" }
    );
    expect(parsed.over_under).toBe("push");
    expect(parsed.total_exact).toBe(7);
  });

  it("parses first_n independently from last_n", () => {
    const parsed = __testUtils.applyQueryFallbacksForTest(
      "How many of the first 5 Mets games against the Yankees have gone under?",
      { query_type: "ou", team: "NYM", opponent: "NYY" }
    );
    expect(parsed.first_n).toBe(5);
    expect(parsed.last_n).toBeUndefined();
  });
});

// ─── Database Stats Tests ──────────────────────────────────────────────────────
describe("mlbDb - getDbStats", () => {
  it("returns stats with expected shape and reasonable values", () => {
    const stats = getDbStats();
    expect(stats.totalGames).toBeGreaterThan(10000);
    expect(stats.totalGames).toBeLessThan(20000);
    expect(stats.seasons).toContain("2021");
    expect(stats.seasons).toContain("2025");
    expect(stats.mlCoverage).toBeGreaterThan(90);
    expect(stats.rlCoverage).toBeGreaterThan(90);
    expect(stats.totCoverage).toBeGreaterThan(90);
    expect(stats.dateRange).toBeTruthy();
  });
});

// ─── Core Query Tests ──────────────────────────────────────────────────────────
describe("mlbDb - executeTrendsQuery", () => {
  it("returns results for a known team with no filters", () => {
    const result = executeTrendsQuery("NYY", {});
    expect(result.games).toBeGreaterThan(500);
    // wins + losses should equal games for ML (no pushes in baseball ML)
    expect(result.wins + result.losses + result.pushes).toBe(result.games);
    expect(result.winRate).toBeGreaterThan(0);
    expect(result.winRate).toBeLessThan(100);
    expect(result.sampleGames.length).toBeLessThanOrEqual(10);
  });

  it("filters by home correctly", () => {
    const homeResult = executeTrendsQuery("LAD", { home: true });
    const awayResult = executeTrendsQuery("LAD", { home: false });
    const allResult = executeTrendsQuery("LAD", {});
    expect(homeResult.games + awayResult.games).toBeLessThanOrEqual(allResult.games + 5);
    expect(homeResult.games).toBeGreaterThan(0);
    expect(awayResult.games).toBeGreaterThan(0);
  });

  it("filters by favorite correctly", () => {
    const favResult = executeTrendsQuery("HOU", { favorite: true });
    const dogResult = executeTrendsQuery("HOU", { favorite: false });
    expect(favResult.games).toBeGreaterThan(0);
    expect(dogResult.games).toBeGreaterThan(0);
    expect(favResult.games).toBeGreaterThan(dogResult.games);
  });

  it("filters by previous result correctly", () => {
    const afterWin = executeTrendsQuery("BOS", { previous_result: "W" });
    const afterLoss = executeTrendsQuery("BOS", { previous_result: "L" });
    expect(afterWin.games).toBeGreaterThan(0);
    expect(afterLoss.games).toBeGreaterThan(0);
  });

  it("filters by back-to-back correctly", () => {
    const b2b = executeTrendsQuery("ATL", { back_to_back: true });
    const all = executeTrendsQuery("ATL", {});
    expect(b2b.games).toBeGreaterThan(0);
    expect(b2b.games).toBeLessThan(all.games);
  });

  it("filters by season correctly", () => {
    const s2024 = executeTrendsQuery("NYY", { season: 2024 });
    const s2025 = executeTrendsQuery("NYY", { season: 2025 });
    const all = executeTrendsQuery("NYY", {});
    expect(s2024.games).toBeGreaterThan(0);
    expect(s2025.games).toBeGreaterThan(0);
    expect(s2024.games).toBeLessThan(all.games);
  });

  it("returns zero games for unknown team", () => {
    const result = executeTrendsQuery("XYZ", {});
    expect(result.games).toBe(0);
    expect(result.wins).toBe(0);
    expect(result.losses).toBe(0);
  });

  it("combined filters return fewer games than individual filters", () => {
    const homeOnly = executeTrendsQuery("PHI", { home: true });
    const homeFav = executeTrendsQuery("PHI", { home: true, favorite: true });
    expect(homeFav.games).toBeLessThanOrEqual(homeOnly.games);
  });

  it("filters by month correctly", () => {
    const sep = executeTrendsQuery("NYY", { month: 9 });
    const all = executeTrendsQuery("NYY", {});
    expect(sep.games).toBeGreaterThan(0);
    expect(sep.games).toBeLessThan(all.games);
  });

  it("filters by opponent correctly", () => {
    const vsLAD = executeTrendsQuery("SFG", { opponent: "LAD" });
    const all = executeTrendsQuery("SFG", {});
    expect(vsLAD.games).toBeGreaterThan(0);
    expect(vsLAD.games).toBeLessThan(all.games);
  });
});

// ─── ROI Calculation Accuracy Tests ───────────────────────────────────────────
describe("ROI calculations - $100 flat unit bets", () => {
  it("ML ROI is consistent with profit and games", () => {
    const result = executeTrendsQuery("NYY", { home: true, favorite: true });
    expect(isNaN(result.roi)).toBe(false);
    expect(result.roi).toBeGreaterThan(-100);
    expect(result.roi).toBeLessThan(200);

    // Verify: ROI = profit / (decidedGames * 100) * 100
    // decidedGames excludes games with extreme/corrupted odds (>600)
    if (result.decidedGames > 0) {
      const expectedRoi = Math.round((result.profit / (result.decidedGames * 100)) * 1000) / 10;
      expect(result.roi).toBeCloseTo(expectedRoi, 0);
    }
  });

  it("decidedGames is <= total games (extreme odds excluded)", () => {
    const result = executeTrendsQuery("LAD", { home: false, favorite: false });
    expect(result.decidedGames).toBeLessThanOrEqual(result.games);
    expect(result.decidedGames).toBeGreaterThanOrEqual(0);
  });

  it("ROI is not inflated by extreme odds (LAD away underdog)", () => {
    // This query previously returned +98.8% ROI due to corrupted +4500 odds in 2021
    // After the fix, ROI should be in a realistic range for a losing record
    const result = executeTrendsQuery("LAD", { home: false, favorite: false });
    // A team going ~44% as underdog should not have >50% ROI
    // (the extreme odds were causing +98.8% ROI)
    expect(result.roi).toBeLessThan(50);
    expect(result.roi).toBeGreaterThan(-50);
  });

  it("ATS ROI is consistent with covers and no-covers", () => {
    const result = executeTrendsQuery("LAD", { query_type: "ats", home: true });
    if ((result.covers ?? 0) + (result.noCover ?? 0) > 0) {
      expect(isNaN(result.atsRoi ?? 0)).toBe(false);
      expect(result.atsRoi ?? 0).toBeGreaterThan(-100);
      expect(result.atsRoi ?? 0).toBeLessThan(200);
      // Cover rate should be between 0 and 100
      expect(result.atsCoverRate ?? 0).toBeGreaterThanOrEqual(0);
      expect(result.atsCoverRate ?? 0).toBeLessThanOrEqual(100);
    }
  });

  it("O/U ROI is consistent with overs and unders", () => {
    const result = executeTrendsQuery("HOU", { query_type: "ou" });
    if ((result.overs ?? 0) + (result.unders ?? 0) > 0) {
      expect(isNaN(result.ouRoi ?? 0)).toBe(false);
      expect(result.ouRoi ?? 0).toBeGreaterThan(-100);
      expect(result.ouRoi ?? 0).toBeLessThan(200);
      // Over rate should be between 0 and 100
      expect(result.overRate ?? 0).toBeGreaterThanOrEqual(0);
      expect(result.overRate ?? 0).toBeLessThanOrEqual(100);
    }
  });

  it("O/U ROI matches betting the over on every matching game", () => {
    const result = executeTrendsQuery("HOU", { query_type: "ou" });
    const db = getMlbDb();
    const rows = db.prepare(`
      SELECT over_odds, ou_result
      FROM games
      WHERE away_team = 'HOU' OR home_team = 'HOU'
    `).all() as Array<{ over_odds: number | null; ou_result: string | null }>;

    let profit = 0;
    let decidedGames = 0;
    for (const row of rows) {
      if (row.ou_result === "push" || row.ou_result === null) continue;
      decidedGames++;

      const useOverOdds =
        row.over_odds !== null && Math.abs(row.over_odds) <= 600
          ? row.over_odds
          : -110;

      if (row.ou_result === "over") {
        profit += useOverOdds > 0 ? useOverOdds : (100 / Math.abs(useOverOdds)) * 100;
      } else {
        profit -= 100;
      }
    }

    const expectedRoi =
      decidedGames > 0
        ? Math.round((profit / (decidedGames * 100)) * 1000) / 10
        : 0;

    expect(result.profit).toBeCloseTo(Math.round(profit * 100) / 100, 2);
    expect(result.roi).toBeCloseTo(expectedRoi, 1);
  });

  it("win rate is consistent with wins and losses", () => {
    const result = executeTrendsQuery("ATL", {});
    const decidedGames = result.wins + result.losses;
    if (decidedGames > 0) {
      const expectedWinRate = Math.round((result.wins / decidedGames) * 1000) / 10;
      expect(result.winRate).toBeCloseTo(expectedWinRate, 0);
    }
  });

  it("season splits sum to total games", () => {
    const result = executeTrendsQuery("NYY", {});
    const splitTotal = result.seasonSplits.reduce((acc, s) => acc + s.games, 0);
    expect(splitTotal).toBe(result.games);
  });

  it("ATS season splits track ATS results, not moneyline results", () => {
    const result = executeTrendsQuery("NYY", { query_type: "ats" });
    const splitWins = result.seasonSplits.reduce((acc, s) => acc + s.wins, 0);
    const splitLosses = result.seasonSplits.reduce((acc, s) => acc + s.losses, 0);
    expect(splitWins).toBe(result.covers);
    expect(splitLosses).toBe(result.noCover);
  });

  it("O/U season splits track over results, not moneyline results", () => {
    const result = executeTrendsQuery("HOU", { query_type: "ou" });
    const splitWins = result.seasonSplits.reduce((acc, s) => acc + s.wins, 0);
    const splitLosses = result.seasonSplits.reduce((acc, s) => acc + s.losses, 0);
    expect(splitWins).toBe(result.overs);
    expect(splitLosses).toBe(result.unders);
  });

  it("under queries flip totals wins/losses and ROI to the under side", () => {
    const overResult = executeTrendsQuery("HOU", { query_type: "ou", over_under: "over" });
    const underResult = executeTrendsQuery("HOU", { query_type: "ou", over_under: "under" });

    expect(underResult.wins).toBe(overResult.unders);
    expect(underResult.losses).toBe(overResult.overs);
    expect(underResult.winRate).toBe(overResult.underRate);
    expect(underResult.roi).toBe(overResult.underRoi);
  });

  it("push queries report push frequency without totals ROI", () => {
    const result = executeTrendsQuery("NYM", { query_type: "ou", over_under: "push", total_exact: 7 });
    expect(result.wins).toBe(result.totalPushes);
    expect(result.roi).toBe(0);
    expect(result.decidedGames).toBe(0);
  });

  it("last_n limits totals queries to the most recent matching games", () => {
    const result = executeTrendsQuery("NYM", {
      query_type: "ou",
      over_under: "under",
      opponent: "NYY",
      last_n: 10,
    });

    expect(result.games).toBeLessThanOrEqual(10);
    expect(result.sampleGames.length).toBeLessThanOrEqual(10);
  });

  it("first_n returns the earliest matching games instead of the most recent ones", () => {
    const result = executeTrendsQuery("NYM", {
      query_type: "ou",
      over_under: "under",
      opponent: "NYY",
      first_n: 5,
    });

    expect(result.games).toBeLessThanOrEqual(5);
    if (result.sampleGames.length > 1) {
      expect(result.sampleGames[0].game_date <= result.sampleGames[result.sampleGames.length - 1].game_date).toBe(true);
    }
  });

  it("supports league-wide totals queries without a team filter", () => {
    const result = executeTrendsQuery(null, {
      query_type: "ou",
      over_under: "push",
      total_exact: 7,
    });

    expect(result.games).toBeGreaterThan(0);
    expect(result.wins).toBe(result.totalPushes);
  });

  it("season splits ROI is consistent with season profit", () => {
    const result = executeTrendsQuery("NYY", { season: 2024 });
    if (result.seasonSplits.length > 0) {
      const split = result.seasonSplits[0];
      expect(isNaN(split.roi)).toBe(false);
      expect(split.roi).toBeGreaterThan(-100);
      expect(split.roi).toBeLessThan(200);
    }
  });

  it("profit sign matches ROI sign", () => {
    // Run multiple queries and verify profit and ROI always have the same sign
    const queries = [
      executeTrendsQuery("NYY", { home: true }),
      executeTrendsQuery("LAD", { favorite: true }),
      executeTrendsQuery("BOS", { previous_result: "L" }),
    ];
    for (const result of queries) {
      if (result.games > 0) {
        const roiPositive = result.roi >= 0;
        const profitPositive = result.profit >= 0;
        expect(roiPositive).toBe(profitPositive);
      }
    }
  });

  it("negative odds win profit is less than $100 per win", () => {
    // For a team that's mostly a favorite (negative ML), each win returns < $100
    const result = executeTrendsQuery("LAD", { favorite: true });
    if (result.wins > 0 && result.losses === 0) {
      // All wins: profit should be less than wins * 100 (since odds are negative)
      expect(result.profit).toBeLessThan(result.wins * 100);
    }
  });
});

// ─── ATS-specific Tests ────────────────────────────────────────────────────────
describe("ATS query mode", () => {
  it("returns ATS-specific fields", () => {
    const result = executeTrendsQuery("LAD", { query_type: "ats" });
    expect(result.queryType).toBe("ats");
    expect(result.covers).toBeDefined();
    expect(result.noCover).toBeDefined();
    expect(result.atsCoverRate).toBeDefined();
    expect(result.atsRoi).toBeDefined();
  });

  it("covers + noCover + pushes = total games with RL data", () => {
    const result = executeTrendsQuery("NYY", { query_type: "ats" });
    const total = (result.covers ?? 0) + (result.noCover ?? 0) + (result.pushes ?? 0);
    // Total should be <= result.games (some games may lack RL data)
    expect(total).toBeLessThanOrEqual(result.games);
    expect(total).toBeGreaterThan(0);
  });
});

// ─── O/U-specific Tests ────────────────────────────────────────────────────────
describe("O/U query mode", () => {
  it("returns O/U-specific fields", () => {
    const result = executeTrendsQuery("HOU", { query_type: "ou" });
    expect(result.queryType).toBe("ou");
    expect(result.overs).toBeDefined();
    expect(result.unders).toBeDefined();
    expect(result.overRate).toBeDefined();
    expect(result.ouRoi).toBeDefined();
  });

  it("overs + unders + pushes = total games with O/U data", () => {
    const result = executeTrendsQuery("ATL", { query_type: "ou" });
    const total = (result.overs ?? 0) + (result.unders ?? 0) + (result.pushes ?? 0);
    expect(total).toBeLessThanOrEqual(result.games);
    expect(total).toBeGreaterThan(0);
  });
});
