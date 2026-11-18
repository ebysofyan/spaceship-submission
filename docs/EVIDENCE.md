# Evidence — Definition of done (requirements §14)

Recorded for T6 on 2026-11-18 against commit `430078d` plus uncommitted work (Dockerfile,
.dockerignore, fly.toml, render.yaml, README.md, this file). Outputs below are trimmed from real runs.

**Environment**
- Bun 1.4.4, no `AI_API_KEY`, so every answer comes from the rules router.
- Server: `bun run build && PORT=3413 bun run start` (port 3413; port 3000 not used).
- Docker: client present, daemon not running (OrbStack socket missing). The container build and run
  could not be executed. See §0.

## Summary

| §14 item | Status | Section |
|---|---|---|
| Deployed URL loads with no local setup and no missing env vars | **Pending owner action** (deployment). Local run with no env vars verified | §1 |
| Dashboard renders all five KPIs and at least two charts from real data | **Data verified** (API). Visual check of the rendered page not done | §2 |
| Each of the three example questions returns a computed answer; the two aggregation questions also return a chart | **Verified** (API) | §3 |
| Every answer shows filters, metrics, dimensions, structured interpretation, underlying rows | **Verified** (API fields). Panel rendering not visually checked | §4 |
| No number in the UI originates from model text | **Verified** by construction and tests | §5 |
| Invalid or unanswerable questions produce an explicit refusal naming what is supported | **Verified** (API) | §6 |
| Forecast for a SKU or category: values, history+forecast chart, recommendation, methodology | **Data verified** (API). Chart not visually checked | §7 |
| Aggregate KPI figures match `dataset.md` | **Verified** | §8 |
| README covers all six required sections and discloses AI usage | **Verified** (headings) | §9 |

§0 Docker is not verified (daemon off).

---

## §0 Docker build and run — not run

```
$ docker ps
failed to connect to the docker API at unix:///Users/eby/.orbstack/run/docker.sock; ...
dial unix /Users/eby/.orbstack/run/docker.sock: connect: no such file or directory
```

`docker build` was not attempted because the daemon check failed.

Substitute check: the Dockerfile runtime stage was reproduced in a temp directory
(`/tmp/t6-runtime`). It had only the manifests, `bun install --frozen-lockfile --production`, the
`apps/api/src`, `packages/core/src`, `data` and the built `apps/web/dist`, then ran `bun apps/api/src/server.ts`:

```
$ bun install --frozen-lockfile --production
47 packages installed [278.00ms]
$ PORT=3413 NODE_ENV=production bun apps/api/src/server.ts
Server listening on http://localhost:3413 (AI mode: rules)
$ curl localhost:3413/api/health
{"ok":true,"aiMode":"rules"}
$ curl localhost:3413/api/dashboard | jq -c .kpis
{"totalOrders":400,"deliveredOrders":304,"delayedOrders":55,"onTimeRate":0.8216216216216217,"avgDeliveryDays":3.82972972972973,"deliveryBase":370}
$ curl -o /dev/null -w 'GET / HTTP %{http_code}\n' localhost:3413/
GET / HTTP 200
```

This is not a container test. Run `docker build` and `docker run` once the daemon is up.

---

## §1 Deployed URL — pending owner action

- Live URL: **TBD — pending deployment.** Set `AI_API_KEY` as a secret on the host (optional; the app
  works without it in rules mode).
- Local check that the app needs no env vars to run (`AI_API_KEY`, `DATA_PATH` unset):

```
$ bun run build && PORT=3413 bun run start
Server listening on http://localhost:3413 (AI mode: rules)
$ curl -s localhost:3413/api/health
{"ok":true,"aiMode":"rules"}
```

---

## §2 Dashboard — five KPIs and two or more charts

API data (`GET /api/dashboard`), trimmed:

```
$ curl -s localhost:3413/api/dashboard | jq -c '.kpis'
{"totalOrders":400,"deliveredOrders":304,"delayedOrders":55,"onTimeRate":0.8216,"avgDeliveryDays":3.8297,"deliveryBase":370}
$ curl -s localhost:3413/api/dashboard | jq -c '{ordersByMonth: .ordersByMonth.chart, delayRateByCarrier: .delayRateByCarrier.chart, ordersByRegion: .ordersByRegion.chart}'
{"ordersByMonth":{"type":"line","xLabel":"month","yLabel":"Orders"},"delayRateByCarrier":{"type":"bar","xLabel":"carrier","yLabel":"Delay rate"},"ordersByRegion":{"type":"bar","xLabel":"region","yLabel":"Orders"}}
$ curl -s localhost:3413/api/dashboard | jq -c '.delayRateByCarrier.rows[0]'
{"key":"GLS","value":0.375,"base":8,"orders":9}
```

- Five KPIs: total orders, delivered, delayed, on-time rate, average delivery time. All come from the core.
- Charts: order volume by month (12 buckets), delay rate by carrier (9 rows), orders by region (5 rows).
  The dashboard also returns `deliveryPerformanceByMonth` (data for the delivered/delayed/exception chart).
- **Not verified:** the rendered page. I did not open a browser. The web app is being re-themed by T7.

---

## §3 Three example questions

Each question was sent to `POST /api/ask` (rules mode).

**Q1 — "Show delayed orders by week for the last 3 months"**

```
$ curl -s -X POST localhost:3413/api/ask -H 'content-type: application/json' \
    -d '{"question":"Show delayed orders by week for the last 3 months"}' | jq ...
tool: query   source: rules
args: {"metric":"delayed_count","timeGrain":"week","dateRange":{"last":3,"unit":"month"}}
answer: "Delayed orders by week: overall 9. Peak week 2025-10-06 at 2. Range: 2025-09-01 to 2025-11-30."
chart: {"type":"line","xLabel":"week","yLabel":"Delayed orders"}
resolvedRange: {"from":"2025-09-01","to":"2025-11-30"}   matchedOrders: 68
rows (first 3): 2025-09-01 → 1, 2025-09-08 → 0, 2025-09-15 → 1   (zero-filled buckets present)
```

**Q2 — "Which carrier has the highest delay rate?"**

```
tool: query   source: rules
args: {"metric":"delay_rate","groupBy":"carrier","sort":"desc"}
answer: "GLS has the highest delay rate at 37.5% (3 of 8 orders). Among groups with a base of 20+, USPS is the highest at 25.5% (12 of 47 orders)."
chart: {"type":"bar","xLabel":"carrier","yLabel":"Delay rate"}
rows (first 3): GLS 0.375 base 8 | USPS 0.2553 base 47 | UPS 0.2436 base 78
notes: ["GLS: small base (8 orders)", "DPD: small base (18 orders)"]
```

Matches `docs/dataset.md` (GLS 37.5% base 8; USPS 25.5% base 47; UPS 24.4% base 78).

**Q3 — "How many orders were delivered late last month?"**

```
tool: query   source: rules
args: {"metric":"delayed_count","dateRange":{"last":1,"unit":"month"}}
answer: "Delayed orders: 4. Range: 2025-11-01 to 2025-11-30."
chart: {"type":"kpi"}     matchedOrders: 24
```

Extra example from the rules router: `"What is the on-time rate by region?"` → `on_time_rate`, `groupBy: region`,
bar chart; answer "US-W has the highest on-time rate at 86.4% (76 of 88 orders)."

---

## §4 Explainability fields on every answer

The response carries the interpretation, the metric and its definition, the resolved range, the notes and the underlying rows:

```
$ curl -s -X POST localhost:3413/api/ask -H 'content-type: application/json' -d '{"question":"Which carrier has the highest delay rate?"}' | jq -c '{metricLabel:.query.metricLabel, metricDefinition:.query.metricDefinition, isRate:.query.isRate, chart:.query.chart, matchedOrders:.query.matchedOrders, notes:.query.notes, sampleOrdersLen:(.query.sampleOrders|length)}'
{"metricLabel":"Delay rate","metricDefinition":"(delayed + exception) / (delivered + delayed + exception)","isRate":true,"chart":{"type":"bar","xLabel":"carrier","yLabel":"Delay rate"},"matchedOrders":400,"notes":["GLS: small base (8 orders)","DPD: small base (18 orders)"],"sampleOrdersLen":100}
```

- Interpretation: `interpretation.tool`, `interpretation.args`, `interpretation.source`, `interpretation.reasoning`
  (in the Q1–Q3 outputs above).
- Filters: `args.filters` (when present). Date range: `query.resolvedRange`. Metric and dimension: `args.metric`, `args.groupBy` / `args.timeGrain`.
- Underlying data: `query.rows` and `query.sampleOrders` (first 100 matching orders).
- **Not verified:** that the Ask panel renders all of these fields. `AskAnswer.tsx` is in T7's scope.

---

## §5 No number from model text

- The answer text is built by `apps/api/src/ai/answer.ts` from the core result. The LLM path returns only a spec
  (`apps/api/src/ai/llm.ts`), which zod re-validates and core recomputes.
- Tests in the run below cover this: "answer templates" (highest delay rate, scalar with resolved range, refusal
  without inlined examples) and "a valid tool call is used and normalised", "an invalid tool call falls back to rules
  and says why", "an HTTP error falls back to rules".
- Rules mode is what ran here: no key was set, so no model output was involved at all.

---

## §6 Refusals

```
$ curl -s -X POST localhost:3413/api/ask -H 'content-type: application/json' -d '{"question":"What'"'"'s the weather like in Berlin tomorrow?"}' | jq -c '{tool:.interpretation.tool, answer, supported:(.supported|length)}'
{"tool":"unsupported","answer":"I can't answer that from this dataset: no metric recognised; try orders, late/delayed orders, on-time rate, delay rate, delivery time, revenue, units or average order value.","supported":6}

$ ... -d '{"question":"Orders this month"}'
{"tool":"unsupported","answer":"I can't answer that from this dataset: range \"this month\" is not supported; use last N days/weeks/months, Q1-Q4 or a month name."}

$ ... -d '{"question":"Predict demand for SKU PAINT-9999"}'
{"tool":"unsupported","answer":"I can't answer that from this dataset: SKU PAINT-9999 does not exist. Try: Predict demand for PAINT. Real PAINT SKUs, most orders first: PAINT-0018, PAINT-0035, PAINT-0166, PAINT-0168, PAINT-0013."}
```

Each refusal returns HTTP 200 with `supported` (the example list). Invalid API bodies return 400:

```
$ curl -s -w '\nHTTP %{http_code}\n' -X POST localhost:3413/api/query -H 'content-type: application/json' -d '{"metric":"revenue_total"}'
{"error":"Invalid query: metric: Invalid option: expected one of \"order_count\"|...|\"avg_order_value\""}
HTTP 400
$ curl -s -w '\nHTTP %{http_code}\n' -X POST localhost:3413/api/ask -H 'content-type: application/json' -d '{"question":"  "}'
{"error":"Question is required"}
HTTP 400
```

---

## §7 Forecast — values, history+forecast, recommendation, methodology

```
$ curl -s -X POST localhost:3413/api/ask -H 'content-type: application/json' -d '{"question":"Predict demand for PAINT for the next 4 months"}' | jq ...
tool: forecast   source: rules   args: {"target":{"kind":"category","value":"PAINT"},"horizonMonths":4}
answer: "PAINT category: 45 units forecast for 4 months (2026-01 to 2026-04). Recommended inventory 72 units, including 26 safety stock. Method: 3-month moving average."
history (12 months): [9,6,17,5,4,11,15,4,0,3,17,14]
forecast: 2026-01..2026-04 units 11.3 each, lower 0, upper 27
methodsCompared: moving_average 7.23 | exponential_smoothing 7.33 | linear_trend 8.5   (holdout MAE)
recommendation: {"forecastUnits":45.2,"safetyStock":26.4,"recommendedInventory":72}
methodology: "Demand is units (SUM of quantity) per order month for category PAINT, over 12 months (2025-01 to 2025-12); ... Interval: forecast ± 1.96 × σ ... Safety stock = z × σ × √(horizon months), with z = 1.645 for a 95% service level. ..."
```

SKU with sparse history (warning and category suggestion):

```
$ ... -d '{"question":"How much inventory should I plan for SKU PAINT-0168?"}'
answer: "SKU PAINT-0168: 1 units forecast for 4 months (2026-01 to 2026-04). Recommended inventory 3 units, including 2 safety stock. Method: 3-month moving average. Only 2 month(s) of history for SKU PAINT-0168; forecast is unreliable — consider category PAINT instead. Only 2 units of history; treat this forecast as indicative only."
warnings: ["Only 2 month(s) of history for SKU PAINT-0168; forecast is unreliable — consider category PAINT instead.", "Only 2 units of history; treat this forecast as indicative only."]
```

Direct forecast endpoint:

```
$ curl -s -X POST localhost:3413/api/forecast -H 'content-type: application/json' -d '{"target":{"kind":"category","value":"BOOK"},"horizonMonths":3}' | jq -c '{method, forecast:(.forecast|map(.units)), recommendation}'
{"method":"moving_average","forecast":[12,12,12],"recommendation":{"forecastUnits":36,"safetyStock":15.6,"recommendedInventory":52,...}}
```

- Chart (history + forecast band), method comparison table and recommendation card are rendered by
  `apps/web/src/views/Forecast.tsx`. **Not visually checked** (T7 scope).
- Known wording issue: the answer reads "1 units forecast" (see worker_done). Found in `apps/api/src/ai/answer.ts`, not changed here.

---

## §8 Aggregate KPI reference values

`bun test` includes `getDashboard > KPIs match dataset.md` (`packages/core/test/dashboard.test.ts`).
Live values from the API (above) are 400 / 304 / 55 / 82.2% / 3.83 days. Average order value (34.24) and units
(1310) are checked in `packages/core/test/query.test.ts`, and the 1310 history total in `packages/core/test/forecast.test.ts`.

```
$ bun test packages/core/test/dashboard.test.ts
(pass) getDashboard > KPIs match dataset.md
(pass) getDashboard > orders by month: 12 zero-filled chronological buckets
(pass) getDashboard > delivery performance by month: totals reconcile and April has a zero delayed count
(pass) getDashboard > delay rate by carrier: GLS first with base 8, 9 rows
(pass) getDashboard > orders by region sums to 400
(pass) getDashboard > definitions map has each metric's formula
```

---

## §9 README sections and AI disclosure

```
$ grep -n "^## " README.md
## Overview · ## Quick start · ## Environment variables · ## Architecture · ## Data flow · ## AI approach
## Supported query subset · ## Metric definitions · ## Forecasting · ## Assumptions · ## Limitations
## Future improvements · ## Testing · ## Deployment · ## AI usage disclosure
```

The six required README sections are Setup (Quick start and Environment variables), Architecture (including
data flow), AI approach, Assumptions, Limitations and Future improvements. AI usage is disclosed in the final section.

---

## Test run

```
$ bun test
 82 pass
 0 fail
 504 expect() calls
Ran 82 tests across 7 files.
```

Per file: `packages/core/test` data 7, query 23, forecast 14, dashboard 6 (50); `apps/api/test` answer 3, rules 13,
server 16 (32).

## Stopped

The server on port 3413 was stopped after the checks. The runtime copy under `/tmp/t6-runtime` was stopped too.
