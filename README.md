# TrendSetter AI

TrendSetter AI is an MLB betting trends application with a React frontend, an Express+tRPC backend, and a historical SQLite query engine for moneyline, run line, and totals analysis.

## What The App Does

- Accepts natural-language betting prompts
- Parses team, opponent, market, totals line, and recency filters
- Queries a local MLB results database
- Returns records, ROI, season splits, and recent game samples

Example prompts:

- `How profitable are overs when the total is 10.5 or higher?`
- `How many games out of their last 10 against the Yankees have Mets games gone under and what's the ROI?`
- `How often do totals of 7 land on a push?`

## Stack

- Frontend: React 19, Vite, TanStack Query, tRPC
- Backend: Express, tRPC, TypeScript
- Data: SQLite (`server/mlb_master.db`) for MLB trends, Drizzle/MySQL for optional user auth persistence
- Testing: Vitest

## Local Development

1. Install dependencies

```bash
corepack pnpm install
```

2. Copy the environment template

```bash
cp .env.example .env
```

3. Fill in the required values for your environment

4. Start the app

```bash
corepack pnpm dev
```

The app runs on `http://localhost:3000` by default.

## Quality Gates

Run these before pushing:

```bash
corepack pnpm check
corepack pnpm test
corepack pnpm build
```

GitHub Actions runs the same checks automatically on pushes to `main` and on pull requests.

There is also a separate preview validation workflow that runs on pull requests, non-`main` pushes, and manual dispatch. It builds the app and uploads the `dist` folder as a preview artifact.

## Deployment Contract

This repo is designed to be GitHub-first and hosting-agnostic:

- GitHub is the source of truth
- CI validates every push
- Hosting platforms should deploy from GitHub, not from local machine state
- Runtime behavior is driven by environment variables instead of hardcoded provider assumptions

Recommended production flow:

1. Codex or a human developer pushes to GitHub
2. GitHub Actions runs `check`, `test`, and `build`
3. Manus pulls the latest successful `main` branch build and deploys it

## Environment Variables

See `.env.example` for the full template.

Important groups:

- Core app: `PORT`, `NODE_ENV`
- Auth/session: `JWT_SECRET`, `VITE_APP_ID`, `VITE_OAUTH_PORTAL_URL`, `OAUTH_SERVER_URL`
- Database: `DATABASE_URL`
- Optional analytics: `VITE_ANALYTICS_ENDPOINT`, `VITE_ANALYTICS_WEBSITE_ID`
- Optional Manus/Forge integrations: `BUILT_IN_FORGE_API_URL`, `BUILT_IN_FORGE_API_KEY`

## Manus Isolation Strategy

The app is not supposed to be hardcoded to either Codex or Manus.

To keep that boundary clean:

- Provider-specific auth now lives behind `server/integrations/manus/auth/sdk.ts` and `server/integrations/manus/auth/oauth.ts`
- Forge-specific service wiring now lives behind `server/integrations/manus/forge.ts`
- Manus Vite runtime hooks are isolated in `build/vite.manus.ts`
- Manus runtime and debug collector behavior are controlled by env flags instead of being implicitly required

That means:

- Codex can safely modify and push the repo
- GitHub remains the deployment handoff
- Manus can host and execute the app
- Future provider swaps are bounded to a smaller integration surface

## Repo Layout

- `client/src/pages/Home.tsx`: main product UI
- `server/trendsRouter.ts`: natural-language query parsing and response shaping
- `server/mlbDb.ts`: SQLite filtering, stats, ROI, season splits
- `server/_core/index.ts`: server bootstrap
- `server/integrations/manus/`: provider-specific integration boundary

## Hosting Notes For Manus

To keep Manus deployment seamless:

- connect Manus hosting directly to this GitHub repo
- deploy from `main`
- set the environment variables in Manus instead of hardcoding them in code
- keep all code changes flowing through GitHub commits

If Manus is the active runtime provider, enable:

- `ENABLE_MANUS_RUNTIME=true`

For local development, you can leave:

- `ENABLE_MANUS_DEBUG_COLLECTOR=false`

unless you explicitly want the extra debug collector.
