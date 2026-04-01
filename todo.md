# MLB Betting Trends Engine — TODO

- [x] Upload master SQLite database to server and create tRPC query endpoint
- [x] Build tRPC `trends.query` procedure: NLP parse → SQL → results
- [x] Build dark terminal theme in index.css (Space Grotesk + JetBrains Mono)
- [x] Build Home page: hero query bar, suggested queries, results display
- [x] Build results card: W-L record, win%, ROI, parsed filters display
- [x] Build recent queries history panel
- [x] Build database stats panel (12,042 games, 5 seasons coverage)
- [x] Add suggested/example queries as clickable chips
- [x] Add loading animation (scanning bar) during query
- [x] Add error handling for invalid/ambiguous queries
- [x] Write vitest for tRPC query procedure
- [x] Final checkpoint and delivery
- [x] Fix NLP parser: handle multi-team comparison queries (pick first team)
- [x] Improve NLP system prompt: explicitly instruct to pick the primary/first team
- [x] Add fallback regex team extraction when LLM returns null team
- [x] Update error message to be more helpful for comparison queries
- [x] Fix SQLite DB path for production deployment (dist/ directory issue)
- [x] Ensure mlb_master.db is bundled/accessible in the deployed environment

## Major Enhancement: Most Powerful Query Tool

### Phase 1 — DB Audit & Indexing
- [x] Audit full schema columns available in master DB
- [x] Add SQLite indexes for all filter columns

### Phase 2 — Query Engine Expansion
- [x] Add ATS (against the spread / run line) query mode
- [x] Add O/U (over/under totals) query mode
- [x] Add opponent-specific filter (vs. Yankees, vs. AL East, etc.)
- [x] Add division/league filter (AL East, NL West, etc.)
- [x] Add month filter (April, May, June, etc.)
- [x] Add day-of-week filter (Monday, weekend, etc.)
- [x] Add series context (game 1/2/3 of series)
- [x] Add run total filter (high/low scoring games)
- [x] Add year-by-year breakdown in every result

### Phase 3 — NLP Overhaul
- [x] Expand system prompt with all new filter types
- [x] Add query type detection (ML / ATS / OU)
- [x] Add opponent team extraction
- [x] Add division/league extraction
- [x] Add time context extraction (month, day/night, weekday)
- [x] Improve disambiguation for edge cases

### Phase 4 — UI Enhancement
- [x] Add ML / ATS / O/U tab switcher on results
- [x] Add year-by-year breakdown table in results
- [x] Add trend sparkline chart (win% by season)
- [x] Add confidence badge (sample size indicator)
- [x] Add "related queries" suggestions based on result
- [x] Add query type label (showing what was parsed)

## ROI Calculation Audit
- [x] Verify ML ROI formula: profit / (decidedGames * 100) * 100 for $100 flat bets
- [x] Verify ATS ROI formula: atsProfit / (atsGames * 100) * 100 (exclude pushes)
- [x] Verify O/U ROI formula: ouProfit / (ouGames * 100) * 100 (exclude pushes)
- [x] Fix total wagered in roiText to exclude pushes
- [x] Fix RL spread display: rl_spread is HOME team spread, invert for away team
- [x] Validate ATS home/away result inversion logic (200/200 games = 100% correct)
- [x] Update test suite with ROI verification tests (31 tests passing)

## ROI Bug Fix — Use Actual Per-Game Odds
- [x] Audit actual ml_away/ml_home odds values in DB for LAD away underdog games
- [x] Diagnose why 20-25 record produces +98.8% ROI (corrupted 2021 end-of-season extreme odds)
- [x] Fix ML profit calculation: cap odds at ±600, exclude extreme/corrupted values
- [x] Apply same odds cap to ATS and O/U ROI calculations
- [x] Fix season splits ROI to use decidedGames (valid-odds games only)
- [x] Add decidedGames field to TrendsResult for accurate wagered amount display
- [x] Add 3 new tests: decidedGames bound, ROI inflation guard, ROI/profit consistency
- [x] 33 tests passing
