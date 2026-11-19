# Requirements — AI-Powered Logistics Analytics Dashboard

Normalized requirements extracted from `Coding_assignment.docx`. `MUST` items are graded;
`SHOULD` items are recommended by the brief; `BONUS` items are optional.

---

## 1. Product

A web application for a logistics client that lets users explore operational data through a
traditional analytics dashboard and a natural-language interface, over a single dataset.

The app must demonstrate three levels of analytics:

| Level | Surface |
|---|---|
| Descriptive — what happened | Dashboard KPIs and charts |
| Diagnostic — why | NL queries answered from data |
| Predictive / prescriptive — what next | Demand forecast + inventory recommendation |

## 2. Dashboard — MUST

KPIs, all five:

- Total orders
- Delivered orders
- Delayed orders
- On-time delivery rate
- Average delivery time

Charts, at least two:

- Order volume over time
- Delivery performance (delayed vs on-time)
- Carrier or destination breakdown

## 3. Natural-language queries — MUST

Illustrative questions the system is expected to handle:

- "Show delayed orders by week for the last 3 months"
- "Which carrier has the highest delay rate?"
- "How many orders were delivered late last month?"

Behaviour per question: interpret it, retrieve the relevant data, and return a **direct
answer, a chart, or both**.

## 4. Dynamic chart generation — MUST

- Select an appropriate chart type automatically, from the shape of the result.
- Render charts dynamically rather than from a fixed set of hand-built panels.
- Support a **defined subset** of analytical queries. The subset must be documented.

## 5. Explainability — MUST

Every answer or chart carries:

- Filters applied (e.g. time range)
- Metrics and dimensions used
- Query plan or structured interpretation *(recommended in the brief; treat as required in
  practice, it is what makes the AI layer auditable)*
- Access to the underlying data as a table or summary

## 6. Data handling — MUST

- Use the provided dataset or database (`mock_logistics_data.csv`).
- Treat all data as **read-only**.
- Aggregation and filtering must be correct. See `dataset.md` for the definitions to use.

## 7. AI orchestration — MUST

The AI layer is a **routing and orchestration system, not the source of truth**.

It must: interpret the question, choose the correct computation path, call the appropriate
tool, and present the result clearly. **It must never answer without computation.**

### Tool A — Query / analytics tool

Covers dashboard queries, aggregations, KPI calculations. Handles questions like "Show
delayed orders by week" and "Which carrier has the highest delay rate?".

### Tool B — Forecasting tool

Covers demand prediction. Handles questions like "Predict demand for SKU X for the next 4
months" and "How much inventory should I plan?".

Requirements: use historical data from the dataset, apply a basic forecasting method, and
return **all four** of:

1. Forecast values
2. Visualization of historical + forecast
3. Inventory recommendation
4. Methodology explanation

Acceptable methods: moving average, linear regression, exponential smoothing, simple trend
models. Anything more sophisticated is out of scope.

### System flow

```
User question → AI interpretation → tool selection → structured input
             → computation → result → explanation → visualization
```

## 8. Architecture — MUST

- **Do not execute raw AI-generated SQL without validation.**
- Prefer structured query generation (allow-listed dimensions, metrics, filters, time grains).
- Clearly separate AI interpretation, data computation, and business logic.

Any stack is acceptable. React / Next.js / Vue; Node / Python / Java / .NET; PostgreSQL are
named only as examples.

## 9. Deployment — MUST

- Publicly accessible URL.
- Fully usable without local setup.
- Stable and functional for reviewers for the duration of review.
- Test credentials if authentication is used.
- No secrets in the repository.

## 10. Deliverables — MUST

1. Source code repository
2. Live deployed application URL
3. `README.md`
4. Credentials, if auth is used

## 11. README — MUST contain

| Section | Content |
|---|---|
| Setup | Local setup instructions; environment variables |
| Architecture | System overview; key design decisions; data flow |
| AI approach | How questions are interpreted; how tools are selected |
| Assumptions | Simplifications made |
| Limitations | Unsupported features or queries |
| Future improvements | What you would build next |

Disclose AI usage.

## 12. Bonus — OPTIONAL

Query history · caching · tests · Docker setup · advanced explainability · handling
ambiguous queries.

Do not let any of these delay the graded core.

## 13. Stated values

- Expected effort: 6–10 hours.
- Clarity, correctness and reasoning are valued **over** completeness and polish.
- Do not over-engineer. Prefer simple, correct solutions and explain tradeoffs.
- Undisclosed AI usage may be treated negatively.

## 14. Definition of done

Checklist an implementation can be verified against. Pointers are to files, tests, or output in
`docs/EVIDENCE.md`. Rendering was checked by the coordinator on the live URL (EVIDENCE §Browser).

- [x] Deployed URL loads with no local setup and no missing env vars. — evidence: `curl https://spaceship-logistics-eby.fly.dev/` → HTTP 200 and `/api/health` → `{"ok":true,"aiMode":"llm",...}` (EVIDENCE §1); a clean clone runs `bun install --frozen-lockfile && bun run build && bun run start` and serves `/api/health` → `{"ok":true,"aiMode":"rules"}` with no env set (EVIDENCE §1b).
- [x] Dashboard renders all five KPIs and at least two charts from real data. — evidence: `apps/web/src/views/Dashboard.tsx` (`KpiGrid`: 5 KPIs; four `ChartCard`s), `/api/dashboard` KPIs (EVIDENCE §2), `packages/core/test/dashboard.test.ts` "KPIs match dataset.md". Browser: EVIDENCE §Browser.
- [x] Each of the three example questions returns a computed answer, and the two aggregation questions also return a chart. — evidence: rules-mode run on `be50548` (EVIDENCE §3): weekly delayed → line chart; carrier delay rate → bar chart; late last month → KPI. Tests: `apps/api/test/rules.test.ts` "delayed orders by week for the last 3 months", "highest delay rate by carrier", "late orders last month".
- [x] Every answer shows filters, metrics, dimensions, the structured interpretation, and the underlying rows. — evidence: `apps/web/src/views/AskAnswer.tsx` (badges: metric · grouping · range · filters; Details: reasoning, definition, JSON spec, result table, orders in scope). Forecast answers show target, horizon, method and the forecast table. Browser: EVIDENCE §Browser.
- [x] No number in the UI originates from model text; every value traces to a tool result. — evidence: `apps/api/src/ai/llm.ts` (`fromToolCall` drops model `reasoning`; refusal sentence is fixed), `apps/api/src/ai/answer.ts` (text built from core results); tests `apps/api/test/server.test.ts` "model free text never reaches the response…", `apps/api/test/llm.test.ts` "a refuse call gets the fixed sentence…"; live injection check in EVIDENCE §Security checks.
- [x] Invalid or unanswerable questions produce an explicit refusal naming what is supported, not an invented answer. — evidence: `apps/api/src/ask.ts` (`refuse` returns `supported: meta.examples`), `AskAnswer.tsx` `Refusal` (lists supported questions); test `server.test.ts` "ask refuses off-topic questions with status 200 and supported examples"; refusals in EVIDENCE §6.
- [x] Forecast for a SKU (or category) returns values, historical+forecast chart, inventory recommendation, and methodology text. — evidence: `packages/core/test/forecast.test.ts` ("forecast length equals horizon…", "recommended inventory covers forecast units"); `apps/web/src/components/ForecastChart.tsx` (history solid, forecast dashed, band); `apps/web/src/views/Forecast.tsx` ("Recommended inventory", "Methodology"). Browser: EVIDENCE §Browser.
- [x] Aggregate KPI figures match the reference values in `dataset.md`. — evidence: `packages/core/test/dashboard.test.ts` "KPIs match dataset.md" (400 / 304 / 55 / 370 / 82.2% / 3.83 days); `bun test` 154 pass (EVIDENCE §Test).
- [x] README covers all six required sections and discloses AI usage. — evidence: `README.md` headings Setup, Architecture, AI approach, Assumptions, Limitations, Future improvements, and "AI usage disclosure" (`grep -n "^## " README.md`).

### Bonus (§12 items)

- [x] Query history — done: the Ask list keeps this page load's questions, newest first, and adds an entry before the answer arrives. Not persisted: a reload clears it. — evidence: `apps/web/src/views/Ask.tsx` (`entries`, "optimistic history entry").
- [x] Caching — done: successful LLM interpretations are cached per process (500 entries, key = trimmed, lower-cased question); rules results and failures are not cached. — evidence: `apps/api/src/ask.ts` (`cache`, `CACHE_LIMIT`); test `apps/api/test/server.test.ts` "a repeated question (any case or spacing) makes no second LLM call".
- [x] Tests — done: 154 tests in 12 files (core, api, web). — evidence: `bun test` tail in EVIDENCE §Test.
- [x] Docker setup — done: `Dockerfile` (two stages, runs as `bun`) and `.dockerignore`. The live image was built by Fly's remote builder (EVIDENCE §0); a clean clone builds and starts from the same steps (EVIDENCE §1b). Not done: a local `docker build` was not re-run (daemon not running).
- [x] Advanced explainability — done: Details panel (reasoning, definition, JSON spec, result table, orders in scope) and "View data" on dashboard charts; the reasoning is built by the server. Limit: "why" questions get the computed number, not a cause. — evidence: `AskAnswer.tsx` (Details), `apps/web/src/views/Dashboard.tsx` (`ChartCard`, "View data"), `apps/api/src/ai/answer.ts`.
- [ ] Handling ambiguous queries — not done as a clarifying step: unknown measures, SKUs and wrong-side cities are refused with a reason and a suggested fix, but the app never asks a follow-up question. — evidence: `apps/api/test/rules.test.ts` "a city on the wrong side of to or from is refused with a hint", "unknown SKU with a real category prefix suggests that category".
