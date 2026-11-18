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
- [ ] A1 root `package.json` (private, workspaces `apps/*`,`packages/*`), `tsconfig.base.json` (strict, ESNext, bundler resolution), `.gitignore` (node_modules, dist, .env), `.env.example` (AI_API_KEY, AI_BASE_URL, AI_MODEL, PORT).
- [ ] A2 `packages/core` package `@app/core` (keep `src/types.ts` as-is), `src/index.ts` re-exporting types.
- [ ] A3 `apps/api` package `@app/api`, deps `zod`, `@app/core: workspace:*`; `src/server.ts` with `GET /api/health` → `{ok:true}`, serves `apps/web/dist` with SPA fallback when present.
- [ ] A4 `apps/web` Vite React TS app `@app/web`, deps react, react-dom, recharts, lucide-react, tailwindcss v4 + `@tailwindcss/vite`; dev proxy `/api` → `http://localhost:3000`; placeholder page showing health.
- [ ] A5 root scripts: `dev` (api --watch + vite concurrently, e.g. `bun run --filter '*' dev`), `build` (web build), `start` (api serving dist), `test` (`bun test`), `typecheck` (`tsc --noEmit` per package).
- [ ] A6 verify: `bun install`, `bun run typecheck`, `bun run build`, `bun run start` then `curl /api/health` and `/` return 200.

### Phase B — Core computation (parallel: T2, T3)
T2 data + query + dashboard (`data.ts`, `dates.ts`, `metrics.ts`, `query.ts`, `dashboard.ts`, tests):
- [ ] B1 CSV parser handling quoted commas; typed `Order`; `lead_time_days` via UTC date math.
- [ ] B2 `datasetMeta(orders)`: anchor, range, distinct values per dimension, categories, sku counts.
- [ ] B3 `resolveRange(range, anchor)` per convention; `bucketKey(date, grain)`; `allBuckets(from,to,grain)`.
- [ ] B4 `metrics.ts`: `METRIC_DEFS[metric] = {label, definition, isRate, compute(orders) -> {value, base}}`.
- [ ] B5 `runQuery`: validate shape defensively, apply filters (case-insensitive) + range, group or bucket (zero-filled), sort/limit, chart type (scalar→kpi, timeGrain→line, groupBy→bar, >15 groups→table), notes (small base < 20, empty result).
- [ ] B6 `getDashboard` per `DashboardResponse`.
- [ ] B7 tests: 400 / 304 / 55 / 370 / 82.2% / 3.83 / 3.25 / 34.24 / 1310; monthly counts; delayed per month incl. April = 0; carrier delay rates (GLS 37.5% base 8, DHL 6.9%); "last month" = 2025-11-01..30; "last 3 months" = 2025-09-01..11-30; weekly buckets zero-filled.

T3 forecast (`forecast.ts`, `test/forecast.test.ts` only, plus one export line in index.ts):
- [ ] B8 monthly units series (12 months, zero-filled) for all/category/sku (case-insensitive).
- [ ] B9 three methods + holdout MAE selection + refit; non-negative forecasts; interval.
- [ ] B10 recommendation (forecastUnits, safetyStock, recommendedInventory, explanation) + methodology text + warnings (sparse SKU, synthetic data, unknown target throws a clear Error).
- [ ] B11 tests: history sums to 1310 for all; category sums match; horizon length; non-negative; sparse SKU warning.

### Phase C — API/AI and Web (parallel: T4, T5)
T4 api (`apps/api/**` only):
- [ ] C1 load orders once at boot from `data/mock_logistics_data.csv` (path relative to repo root, overridable `DATA_PATH`).
- [ ] C2 routes: `GET /api/meta`, `GET /api/dashboard`, `POST /api/query` (QuerySpec), `POST /api/forecast` (ForecastSpec), `POST /api/ask` ({question}) — zod-validated, 400 with message on invalid.
- [ ] C3 zod schemas with enum allow-lists from data (carrier, region, category …); unknown value → refusal, never silently dropped.
- [ ] C4 rules interpreter: handles the 3 example questions + forecast phrasing ("predict demand for SKU X next 4 months", "how much inventory for PAINT"), metric/dimension/grain/range keywords, filter values detected from meta; otherwise `unsupported`.
- [ ] C5 LLM interpreter: tools `run_query`, `run_forecast`, `refuse`; system prompt lists metrics/dimensions/values/anchor; 15s timeout; any failure → rules fallback (reasoning notes it).
- [ ] C6 templated answers (e.g. "GLS has the highest delay rate at 37.5% (3 of 8 orders) — small base; among carriers with ≥20 orders, USPS leads at 25.5%.").
- [ ] C7 tests: rules router on the 3 examples + forecast + nonsense question; `/api/ask` integration via `fetch` against a started server.

T5 web (`apps/web/**` only), against the contract types:
- [ ] C8 shell: header (name, dataset range, AI mode badge), tabs Dashboard / Ask / Forecast (hash-based), responsive, light theme, neutral palette + one accent.
- [ ] C9 Dashboard: 5 KPI cards with definitions tooltips; charts: orders by month (line/area), delivery performance by month (stacked bar), delay rate by carrier (bar with base labels), orders by region.
- [ ] C10 `DynamicChart` (kpi | bar | line | table from `QueryResult.chart`), rates formatted %.
- [ ] C11 Ask: input + example chips, loading/error states, answer card, chart, "How this was computed" panel (tool, source llm/rules, reasoning, filters, metric + definition, dimension/grain, resolved range, JSON spec), data table + underlying orders (collapsible), refusal card listing supported questions, session history list (click to re-open).
- [ ] C12 Forecast: target picker (All / category / SKU searchable), horizon 1–12, history+forecast chart with band, table, recommendation card, methodology, warnings, method comparison.
- [ ] C13 empty/loading/error states everywhere; keyboard accessible; no console errors.

### Phase D — Integration, docs, verification (T6)
- [ ] D1 `README.md`: Setup, env vars, Architecture (diagram + data flow), AI approach, supported query subset, Assumptions, Limitations, Future improvements, AI usage disclosure, deployment.
- [ ] D2 `Dockerfile` + `.dockerignore`; `bun run build && bun run start` works from clean clone.
- [ ] D3 end-to-end check: all definition-of-done items in `docs/requirements.md` §14 with evidence.
- [ ] D4 orchestrator: browser check of all 3 tabs, fix list → workers, final commit.

### Deferred (needs the owner)
- Public deployment (needs Fly/Render account). Config ready.
- `AI_API_KEY` (app runs in rules mode until set).
