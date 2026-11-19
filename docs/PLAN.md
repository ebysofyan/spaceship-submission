# Build Plan — Logistics Analytics Dashboard

Read first: `docs/README.md`, `docs/requirements.md`, `docs/dataset.md`.
Contract (do not change shapes without orchestrator approval): `packages/core/src/types.ts`.

## Stack (decided)

| Layer | Choice | Why |
|---|---|---|
| Runtime / pkg manager | **Bun** (workspaces) | One tool: install, run, test, bundle. |
| Frontend | **Vite + React 19 + TypeScript** | No Next.js: no SSR/routing needed for one page; Vite is plain React, easy to read. |
| Styling / UI | **Tailwind CSS v4** + small local components (shadcn look) + **lucide-react** icons | reui.io/shadcn copy-in brings Radix deps for ~5 components we need; hand-rolled Card/Tabs/Badge are ~100 lines. |
| Charts | **Recharts** | Declarative, covers bar/line/area. |
| Backend | **Bun.serve() routes** (no framework) | 4 endpoints; Hono/Express add nothing. Serves built web in prod → one deployable. |
| Validation | **zod v4** | Trust boundary for AI output; `z.toJSONSchema` feeds LLM tool schemas. |
| Data | CSV loaded into memory at boot (400 rows), read-only | No DB needed at this size; computation is pure TS → unit-testable. |
| AI | OpenAI-compatible Chat Completions via `fetch` + tool calling; env `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL`. Deterministic rule-based router as fallback when no key / LLM fails. | App fully works without a key; LLM only interprets. |
| Tests | `bun test` | Built in. |
| Deploy | Dockerfile (oven/bun), single container, `PORT` env | Fly.io / Render / Railway. |

## Layout

```
spaceship-submission/
  package.json            # bun workspaces: apps/*, packages/*; scripts dev/build/start/test/typecheck
  data/mock_logistics_data.csv
  packages/core/          # PURE computation, no I/O except loadOrders(path)
    src/types.ts          # contract
    src/data.ts           # CSV parse -> Order[], lead_time_days, dataset meta
    src/dates.ts          # anchor, range resolution, ISO week/month buckets
    src/metrics.ts        # metric definitions (single source of truth)
    src/query.ts          # runQuery(orders, QuerySpec) -> QueryResult
    src/forecast.ts       # runForecast(orders, ForecastSpec) -> ForecastResult
    src/dashboard.ts      # getDashboard(orders) -> DashboardResponse
    src/index.ts          # exports
    test/*.test.ts        # reference values from docs/dataset.md
  apps/api/               # HTTP + AI orchestration (no metric math here)
    src/server.ts         # Bun.serve routes + static web dist
    src/ai/schemas.ts     # zod schemas for QuerySpec/ForecastSpec (allow-lists from data)
    src/ai/llm.ts         # OpenAI-compatible tool-calling interpreter
    src/ai/rules.ts       # deterministic fallback interpreter
    src/ai/answer.ts      # templated answer text from results
    src/ask.ts            # question -> interpretation -> validate -> tool -> answer
  apps/web/               # Vite React SPA
    src/App.tsx           # tabs: Dashboard | Ask | Forecast
    src/components/*      # Card, Kpi, DynamicChart, Explain panel, DataTable
```

## Layer rule

AI interpretation (`apps/api/src/ai`) → produces a `QuerySpec`/`ForecastSpec` only.
Business logic / metric definitions (`packages/core/src/metrics.ts`) → one place.
Computation (`packages/core`) → deterministic, tested. UI never computes metrics.

## Decisions (go into README Assumptions)

1. Delayed = `status = delayed`. Delay rate = (delayed + exception) / delivery base. On-time = delivered / delivery base.
2. Delivery base = delivered + delayed + exception (370). in_transit + canceled excluded from rates.
3. Relative time anchored to MAX(order_date) = 2025-12-30. Calendar convention: "last month" = Nov 2025; "last 3 months" = Sep–Nov 2025 (full months before anchor month). Resolved range is always shown.
4. Forecast unit = units (SUM quantity) by order month. Supports all / category / SKU; SKU with < 3 non-zero months gets a warning + category suggestion.
5. Forecast method: backtest moving average(3), simple exponential smoothing(α=0.3), linear trend on a 3-month holdout; pick lowest MAE; refit on all 12 months. Interval ±1.96·σ(residuals). Safety stock = z(serviceLevel)·σ·√horizon.
6. Answer text is a template over the tool result; the LLM never writes numbers.

## Tasks (DAG)

Each task: owner = one Orca pi worker, working in this repo's main worktree. Workers do NOT commit; the orchestrator verifies and commits after each phase.

### Phase A — T1 Scaffold (sequential)
- [x] A1 root `package.json` (private, workspaces `apps/*`,`packages/*`), `tsconfig.base.json` (strict, ESNext, bundler resolution), `.gitignore` (node_modules, dist, .env), `.env.example` (AI_API_KEY, AI_BASE_URL, AI_MODEL, PORT). — `package.json` (workspaces `apps/*`, `packages/*`), `tsconfig.base.json`, `.gitignore`, `.env.example`
- [x] A2 `packages/core` package `@app/core` (keep `src/types.ts` as-is), `src/index.ts` re-exporting types. — `packages/core/package.json` (`@app/core`), `packages/core/src/index.ts`, `types.ts`
- [x] A3 `apps/api` package `@app/api`, deps `zod`, `@app/core: workspace:*`; `src/server.ts` with `GET /api/health` → `{ok:true}`, serves `apps/web/dist` with SPA fallback when present. — `apps/api/package.json` (`@app/api`, `zod`, `@app/core`), `apps/api/src/server.ts` (health now also returns `aiMode`/`aiStatus`)
- [x] A4 `apps/web` Vite React TS app `@app/web`, deps react, react-dom, recharts, lucide-react, tailwindcss v4 + `@tailwindcss/vite`; dev proxy `/api` → `http://localhost:3000`; placeholder page showing health. — `apps/web/vite.config.ts` (`/api` proxy to `:3000`); the placeholder page was replaced by C8
- [x] A5 root scripts: `dev` (api --watch + vite concurrently, e.g. `bun run --filter '*' dev`), `build` (web build), `start` (api serving dist), `test` (`bun test`), `typecheck` (`tsc --noEmit` per package). — root `package.json` scripts `dev`, `build`, `start`, `test`, `typecheck` (`dev` runs `dev:api` and `dev:web` in parallel)
- [x] A6 verify: `bun install`, `bun run typecheck`, `bun run build`, `bun run start` then `curl /api/health` and `/` return 200. — EVIDENCE §1b: clean clone runs `bun install --frozen-lockfile`, `bun run build`, `bun run start`; `/api/health` and `/` return 200; EVIDENCE §Test: `bun run typecheck` exit 0

### Phase B — Core computation (parallel: T2, T3)
T2 data + query + dashboard (`data.ts`, `dates.ts`, `metrics.ts`, `query.ts`, `dashboard.ts`, tests):
- [x] B1 CSV parser handling quoted commas; typed `Order`; `lead_time_days` via UTC date math. — `packages/core/src/data.ts` (`parseCsv`); `packages/core/test/data.test.ts` "keeps quoted commas inside a field", "lead time uses UTC date math…"
- [x] B2 `datasetMeta(orders)`: anchor, range, distinct values per dimension, categories, sku counts. — `packages/core/src/data.ts` (`datasetMeta`); test "datasetMeta: anchor, range, dimension values, categories, skus"
- [x] B3 `resolveRange(range, anchor)` per convention; `bucketKey(date, grain)`; `allBuckets(from,to,grain)`. — `packages/core/src/dates.ts` (`resolveRange`, `bucketKey`, `allBuckets`); `query.test.ts` "last 3 months = Sep-Nov 2025", "weekly buckets … include zero weeks"
- [x] B4 `metrics.ts`: `METRIC_DEFS[metric] = {label, definition, isRate, compute(orders) -> {value, base}}`. — `packages/core/src/metrics.ts` (`METRIC_DEFS`: `label`, `definition`, `isRate`, `compute`)
- [x] B5 `runQuery`: validate shape defensively, apply filters (case-insensitive) + range, group or bucket (zero-filled), sort/limit, chart type (scalar→kpi, timeGrain→line, groupBy→bar, >15 groups→table), notes (small base < 20, empty result). — `packages/core/src/query.ts` (`runQuery`: shape checks throw, filters, zero-filled buckets, chart choice with `TABLE_ABOVE = 15`, small-base and empty notes); `query.test.ts`
- [x] B6 `getDashboard` per `DashboardResponse`. — `packages/core/src/dashboard.ts` (`getDashboard`); `packages/core/test/dashboard.test.ts`
- [x] B7 tests: 400 / 304 / 55 / 370 / 82.2% / 3.83 / 3.25 / 34.24 / 1310; monthly counts; delayed per month incl. April = 0; carrier delay rates (GLS 37.5% base 8, DHL 6.9%); "last month" = 2025-11-01..30; "last 3 months" = 2025-09-01..11-30; weekly buckets zero-filled. — `dashboard.test.ts` "KPIs match dataset.md", "delivery performance by month … April has a zero delayed count", "delay rate by carrier: GLS first with base 8"; `query.test.ts` DHL 6.9%, average order value 34.24; `forecast.test.ts` 1310 units

T3 forecast (`forecast.ts`, `test/forecast.test.ts` only, plus one export line in index.ts):
- [x] B8 monthly units series (12 months, zero-filled) for all/category/sku (case-insensitive). — `packages/core/src/forecast.ts` (12-month units series, zero-filled); `forecast.test.ts` "category match is case-insensitive"
- [x] B9 three methods + holdout MAE selection + refit; non-negative forecasts; interval. — `forecast.ts` (3 methods, `HOLDOUT = 3`, lowest-MAE pick, refit); `forecast.test.ts` "chosen method has the lowest holdout MAE", "forecasts and lower bounds are never negative"
- [x] B10 recommendation (forecastUnits, safetyStock, recommendedInventory, explanation) + methodology text + warnings (sparse SKU, synthetic data, unknown target throws a clear Error). — `forecast.ts` (recommendation, methodology, warnings); `forecast.test.ts` "sparse SKU (one order) warns…", "unknown category throws…". Note: the synthetic-data caveat is in the methodology text, not in `warnings`
- [x] B11 tests: history sums to 1310 for all; category sums match; horizon length; non-negative; sparse SKU warning. — `packages/core/test/forecast.test.ts`: "all-target history has 12 months and sums to 1310 units", "each category's history sums…", "forecast length equals horizon…", "forecasts and lower bounds are never negative", "sparse SKU…"

### Phase C — API/AI and Web (parallel: T4, T5)
T4 api (`apps/api/**` only):
- [x] C1 load orders once at boot from `data/mock_logistics_data.csv` (path relative to repo root, overridable `DATA_PATH`). — `apps/api/src/data.ts` (`loadDataset`, `DATA_PATH` override); loaded once at boot
- [x] C2 routes: `GET /api/meta`, `GET /api/dashboard`, `POST /api/query` (QuerySpec), `POST /api/forecast` (ForecastSpec), `POST /api/ask` ({question}) — zod-validated, 400 with message on invalid. — `apps/api/src/server.ts` (`/api/meta`, `/api/dashboard`, `/api/query`, `/api/forecast`, `/api/ask`); `server.test.ts` "query rejects an invalid body with 400…"
- [x] C3 zod schemas with enum allow-lists from data (carrier, region, category …); unknown value → refusal, never silently dropped. — `apps/api/src/ai/schemas.ts` (`buildSchemas`, allow-lists built from the data); `server.test.ts` "rejects values that are not in the dataset and unknown keys"
- [x] C4 rules interpreter: handles the 3 example questions + forecast phrasing ("predict demand for SKU X next 4 months", "how much inventory for PAINT"), metric/dimension/grain/range keywords, filter values detected from meta; otherwise `unsupported`. — `apps/api/src/ai/rules.ts`; `apps/api/test/rules.test.ts` (the 3 examples, forecast phrasing, off-topic question)
- [x] C5 LLM interpreter: tools `run_query`, `run_forecast`, `refuse`; system prompt lists metrics/dimensions/values/anchor; 15s timeout (10 s since the review); any failure → rules fallback (reasoning notes it). — `apps/api/src/ai/llm.ts` (`run_query`, `run_forecast`, `refuse`; 15 s timeout; any failure → rules in `ask.ts`); `llm.test.ts`. Note: the reasoning is now built by the server (`describeSpec`), not returned by the model
- [x] C6 templated answers (e.g. "GLS has the highest delay rate at 37.5% (3 of 8 orders) — small base; among carriers with ≥20 orders, USPS leads at 25.5%."). — `apps/api/src/ai/answer.ts`. Note: the wording differs from the example sentence; every number comes from core
- [x] C7 tests: rules router on the 3 examples + forecast + nonsense question; `/api/ask` integration via `fetch` against a started server. — `apps/api/test/rules.test.ts`; `apps/api/test/server.test.ts` (`/api/ask` end to end on a started server)

T5 web (`apps/web/**` only), against the contract types:
- [x] C8 shell: header (name, dataset range, AI mode badge), tabs Dashboard / Ask / Forecast (hash-based), responsive, light theme, neutral palette + one accent. — `apps/web/src/App.tsx` (header with date span, order count and AI badge; tabs); `apps/web/src/hooks.ts` (`useHashTab`)
- [x] C9 Dashboard: 5 KPI cards with definitions tooltips; charts: orders by month (line/area), delivery performance by month (stacked bar), delay rate by carrier (bar with base labels), orders by region. — `apps/web/src/views/Dashboard.tsx` (5 KPIs with `InfoHint` definitions; orders by month line, delivery performance stacked bars, delay rate by carrier, orders by region). Base is in the chart tooltip
- [x] C10 `DynamicChart` (kpi | bar | line | table from `QueryResult.chart`), rates formatted %. — `apps/web/src/components/DynamicChart.tsx` (kpi / bar / line / table; rate axes in whole percent)
- [x] C11 Ask: input + example chips, loading/error states, answer card, chart, "How this was computed" panel (tool, source llm/rules, reasoning, filters, metric + definition, dimension/grain, resolved range, JSON spec), data table + underlying orders (collapsible), refusal card listing supported questions, session history list (click to re-open). — `apps/web/src/views/Ask.tsx`, `apps/web/src/views/AskAnswer.tsx`. Renamed: the "How this was computed" panel is now the **Details** disclosure
- [x] C12 Forecast: target picker (All / category / SKU searchable), horizon 1–12, history+forecast chart with band, table, recommendation card, methodology, warnings, method comparison. — `apps/web/src/views/Forecast.tsx` (target picker with SKU list, horizon 1–12, Recommended inventory, Methodology, Method comparison); `apps/web/src/components/ForecastChart.tsx` (history solid, forecast dashed, band)
- [x] C13 empty/loading/error states everywhere; keyboard accessible; no console errors. — empty, loading and error states in `components/ui/States.tsx`; live CDP check of all three tabs plus one Ask: 0 console errors or warnings, Tab moves focus through the Ask button, Examples toggle and chart with a visible outline (EVIDENCE §Browser).

### Phase D — Integration, docs, verification (T6)
- [x] D1 `README.md`: Setup, env vars, Architecture (diagram + data flow), AI approach, supported query subset, Assumptions, Limitations, Future improvements, AI usage disclosure, deployment. — `README.md` headings: Setup, Architecture, AI approach, Supported queries, Assumptions, Limitations, Future improvements, Testing, Deployment, AI usage disclosure
- [x] D2 `Dockerfile` + `.dockerignore`; `bun run build && bun run start` works from clean clone. — `Dockerfile`, `.dockerignore`; clean-clone build and start verified (EVIDENCE §1b); image built by Fly's remote builder (EVIDENCE §0)
- [x] D3 end-to-end check: all definition-of-done items in `docs/requirements.md` §14 with evidence. — `docs/requirements.md` §14 (each item has a pointer) and `docs/EVIDENCE.md`. Browser checks remain open (D4)
- [x] D4 orchestrator: browser check of all 3 tabs, fix list → workers, final commit. — coordinator screenshots of the live Dashboard, Ask (pending and answered) and Forecast; fixes went to workers as T10–T16 (EVIDENCE §Browser).

### Deferred (needs the owner)
- ~~Public deployment~~ done: Fly app `spaceship-logistics-eby` (see Phase E). Render config (`render.yaml`) is not deployed.
- ~~`AI_API_KEY`~~ done: set as a Fly secret, so the live app runs in LLM mode. The app still runs in rules mode without it.

## Phase E — Review fixes (implementation checklist)

Review pass after Phase D. Each item is one commit, listed with what it changed.

- [x] T10 `5212971` — SumoPod endpoint with `gpt-6-luna` as default and `reasoning_effort: none`; trimmed tool schema (enums over 20 values become a format hint); in-memory interpretation cache; 20 asks a minute per IP on LLM `/api/ask`; honest `/api/health` (`aiStatus`); `apps/api/scripts/eval-llm.ts`.
- [x] T11 `e816f90` — rules router handles status words, origin and destination cities, `deliver` verbs and superlatives (reliable, best, worst, slowest); delay-rate label says "(delayed + exception)".
- [x] T12 `1164867` — "View data" disclosure on dashboard charts; honest AI badge (AI, AI fallback, AI limit reached, keyword mode). Follow-up `7eef519` hides the repeated Orders column and empty Base column in result tables.
- [x] T13 `a3e7f8b` (with accuracy fixes in `e74096a`) — README rewrite: live URL, Fly app name, evidence pointers.
- [x] T14 `d30bd24` — instant Ask progress card (three static steps), optimistic history entry, answer fade-in that respects reduced motion.
- [x] T15 `be50548` — no model-written text reaches users (server-built reasoning, fixed refusal sentence); daily AI cap `AI_DAILY_LIMIT` (default 500); `max_tokens` 300; 16 KB request body cap.
- [x] Deployed to Fly — https://spaceship-logistics-eby.fly.dev (app `spaceship-logistics-eby`, region `iad`, one machine). At check time `/api/health` returned `aiMode: llm`, `aiStatus: ok`. The machine was updated 2026-11-19 01:41Z, one minute after `be50548` (01:40Z); Fly does not label the image with a commit, so the match is by timing. Evidence: EVIDENCE §1.

### Review pass (2026-11-19, coordinator + Orca pi workers)

- [x] W1 `6c61952` — P0: horizontal bar charts (9+ groups) painted only during their entry animation; animation off for that chart only. Tooltip values in ink.
- [x] W2 `e954ea7` — per-IP daily AI budget (`AI_IP_DAILY_LIMIT` 40); `fly-client-ip` trusted only with `FLY_APP_NAME`; CSP, nosniff, no-referrer on every response; Cache-Control; normalised cache key; LLM timeout 15 s → 10 s.
- [x] W3 `62a7870`, `482d87b` — single-value answers compare with the overall figure (`baseline`); counts as a share; speed words about deliveries → average delivery time.
- [x] W4 `0622caf` — hash deep links (`#ask?q=`, `#forecast?kind&value&h`), "Ask a follow-up" on dashboard charts, "Adjust in Forecast", slow-answer note after 4 s, mobile scroll to the answer.
- [x] W5 `62b3434` — impeccable polish: plain KPI labels, quieter charts, colour-blind-safe exception colour, "AI on / AI fallback / Keyword mode" badge, forecast led by the recommendation, methodology as a list, band over forecast months only, consumed `#ask?q=` cleared.
- [x] Coordinator `fa5fbfa` — forecast recommendation above the controls on mobile. Docs commit — a rejected AI reading (zod) is labelled "AI reading failed validation" and is not counted as an outage.
- [x] Redeployed to Fly (image `deployment-01M7RZR7QBPJ9R560KJ4Q20968`); live checks in EVIDENCE.

