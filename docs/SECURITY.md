# Security — threat model and checklist

## Scope

- **Public app, no authentication, no accounts.** Anyone with the URL can use the dashboard and the Ask API.
- **Data is read-only.** One public CSV (`data/mock_logistics_data.csv`) is loaded into memory at boot. No database, no write path.
- **Secrets:** the only secret is the server-side `AI_API_KEY` (a Fly secret). The system prompt holds dataset metadata only (metric definitions, dimension values, the anchor date).

## Threats and controls

| Threat | Control | Where in code | How verified |
|---|---|---|---|
| Prompt injection (question tells the model to say a number or write text) | The model can only call one of three tools (`run_query`, `run_forecast`, `refuse`). Arguments pass strict zod schemas (`z.strictObject`, enums from the data). A model `reasoning` key is dropped | `apps/api/src/ai/llm.ts` (`toolDefinitions`, `fromToolCall`), `ai/schemas.ts` | `server.test.ts` "model free text never reaches the response…"; `llm.test.ts` "a refuse call gets the fixed sentence…"; live injection checks (EVIDENCE §Security checks) |
| Model text shown to users | The explanation is built by the server (`describeSpec`). Refusals use a fixed sentence. Numbers come only from `packages/core` | `ai/llm.ts`, `ai/answer.ts`, `ask.ts` | `answer.test.ts` "LLM reasoning is described from the validated spec", "refusal sentence is fixed" |
| Tool misuse / SQL injection | No SQL anywhere. A question becomes a typed `QuerySpec` or `ForecastSpec` run by pure functions. Metric, dimension and grain are allow-lists | `packages/core/src/query.ts`, `forecast.ts`, `metrics.ts` | `grep` for SQL keywords in `apps/api/src` and `packages/core/src`: 0 matches |
| Writes to data | Orders load once at boot. No route writes to data | `apps/api/src/data.ts`, `server.ts` (route list) | Code read: the routes are `/api/meta`, `/api/dashboard`, `/api/query`, `/api/forecast`, `/api/ask`, `/api/health` |
| Data exfiltration | Data is public. The key is read from the environment on the server and is never returned. `/api/health` shows only mode, model and status | `ai/llm.ts` (`aiConfigFromEnv`), `server.ts` (`/api/health`) | Live `/api/health` output; app code never logs the key (only error objects are logged) |
| Cost abuse (denial of wallet) | 20 asks a minute per IP. `AI_IP_DAILY_LIMIT` LLM calls per IP per UTC day (default 40), then that IP gets keyword answers. `AI_DAILY_LIMIT` LLM calls per UTC day overall (default 500). `max_tokens` 300. 10 s timeout. 500-character question cap. Interpretation cache (500 entries, key ignores case, spacing and trailing `?.!`); cache hits cost nothing and do not count. Keyword fallback costs nothing | `server.ts` (`allowAsk`), `ask.ts` (`todayIpUsage`, `dailyLimitReached`, `cacheKey`, `MAX_QUESTION_CHARS`), `ai/llm.ts` (`MAX_TOKENS`, `TIMEOUT_MS`) | Tests "with a key, /api/ask is limited to 20 questions a minute per IP" (429); "per-IP budget: the 41st uncached question from one IP gets rules…"; "after AI_DAILY_LIMIT LLM calls…"; "spelling variants of one question make one LLM call…" |
| Spoofed client IP (to dodge per-IP limits) | `fly-client-ip` is trusted only when `FLY_APP_NAME` is set; elsewhere the socket address is used | `server.ts` (`trustFlyIp`) | Test "without FLY_APP_NAME a spoofed fly-client-ip does not change the rate-limit key"; live: 21 cached asks, each with a different fake `fly-client-ip`, got 20 × 200 then 429, so Fly's proxy overwrites the header (EVIDENCE §Security checks) |
| Clickjacking, MIME sniffing, injected scripts | Every response: CSP `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`. HTTPS is forced by Fly (`force_https`) | `server.ts` (`SECURITY_HEADERS`, `secure`, `secureRoutes`, `error`) | Test "security headers and cache-control on api, static, SPA fallback and 404 responses"; live `curl -sI`; headless Chrome on all three tabs: 0 CSP violations (EVIDENCE §Browser) |
| Large payloads | `maxRequestBodySize` 16 KB. Larger bodies are refused before they are read | `server.ts` | Test "a body over 16 KB is refused…"; local run: 100 KB body → HTTP 413 |
| Malformed input | Zod on every POST body. Bad input returns 400 with a message about the input. Question must be a string of 1–500 characters | `server.ts` (`readJson`, `badRequest`), `ai/schemas.ts`, `ask.ts` | `server.test.ts` "ask rejects empty and over-long questions with 400", "query rejects an invalid body with 400…" |
| XSS | React escapes all text. No `dangerouslySetInnerHTML`, `innerHTML`, `eval` or `new Function` in source. No `href` takes user input | `apps/web/src` | `grep -rn dangerouslySetInnerHTML apps/web/src` → 0 matches; `grep` for `innerHTML`, `eval(`, `new Function` → 0 matches |
| Static-file path traversal | The requested path is resolved under `apps/web/dist`, and anything outside that directory returns 403 | `server.ts` (`serveWeb`) | Code read only; no test (see limits) |
| Secrets in the repo | `.env` is git-ignored and excluded from the Docker context. `.env.example` has an empty key | `.gitignore`, `.dockerignore`, `.env.example` | `git check-ignore -v .env` → `.gitignore:3`; `git ls-files` has no `.env`; scan of working tree and `git log --all -p` for key-shaped strings (`AI_API_KEY=` + 8 or more characters, `sk-` + 20 or more characters): 0 matches. This is a pattern scan, not a full secret scanner |
| Secrets in deploy | The key is a Fly secret. `fly.toml` has no key | `fly.toml` `[env]` (no key), Fly secrets | `fly secrets list -a spaceship-logistics-eby` shows `AI_API_KEY` (digest only); health shows `aiMode: llm` |
| Error leakage | Unexpected errors return `500 {"error":"Internal error"}`; the stack goes to the server log. Unknown API routes return a JSON 404 | `server.ts` (`/api/ask` catch, `fetch` fallback) | Test "unknown api route is a JSON 404"; live `GET /api/nope` → `{"error":"Not found"}`; code read for the 500 path (no test) |

## Known limits / not done

- **Counters are in memory and per process.** The rate limit, the daily cap and the cache reset on restart and do not add up across instances.
- **The daily cap bounds cost, not availability.** One IP can use at most 40 LLM calls a day, but rotating many IPs (including IPv6) can still use up `AI_DAILY_LIMIT`. Then every question gets keyword answers until the next UTC day.
- **Rate limit covers only `/api/ask` with a key set.** Rules-mode questions and `/api/query`, `/api/forecast` and `/api/dashboard` are not rate-limited. They are cheap, in-memory computations, but they are not throttled.
- **The per-IP maps are cleared when they pass 10,000 entries** (shortcuts in `server.ts` and `ask.ts`). A flood of IPs can reset every window and every per-IP budget; the global daily cap still holds.
- **No auth and no CAPTCHA, by design.** The app is public and read-only.
- **Headers gaps.** No HSTS header (Fly forces HTTPS, but browsers are not told to remember it). `style-src` allows `'unsafe-inline'` because Recharts sets inline styles. Bun's own 413 (body over 16 KB) is sent before app code runs, so it has no security headers; it has no content.
- **Path-traversal guard and the 500 path have no tests.** Both were checked by reading the code.
- **Dependencies were not audited** (no `bun audit` or advisory scan was run for this pass).

## If this went to production

- Move the rate limit, daily cap and cache to a shared store (for example Redis), so that limits hold across instances and restarts.
- Set a provider-side spend cap on the SumoPod account, and rotate the key on a schedule.
- Add HSTS once the domain is final.
- Put a WAF or CDN (for example Cloudflare) in front, with bot and per-IP rules. Trust `fly-client-ip` only because Fly is the only ingress.
- Keep an audit log of questions, interpretations and refusals, without secrets, with a retention limit.
