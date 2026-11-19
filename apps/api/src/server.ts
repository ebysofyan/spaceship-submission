import { join, resolve, sep } from "node:path";
import type { Server } from "bun";
import { runForecast, runQuery } from "@app/core";
import { ask, dailyLimitReached, InputError, type AiState } from "./ask";
import { aiConfigFromEnv, type AiConfig } from "./ai/llm";
import { buildSchemas, parseForecast, parseQuery } from "./ai/schemas";
import { loadDataset, type Dataset } from "./data";

// Repo-relative, so the server works from any cwd.
const WEB_DIST = resolve(import.meta.dir, "../../web/dist");
const INDEX_HTML = join(WEB_DIST, "index.html");

const json = (body: unknown, status = 200) => Response.json(body, { status });
const badRequest = (e: unknown) => json({ error: e instanceof Error ? e.message : String(e) }, 400);

// The app has no inline script (Vite emits an external module). Inline styles come from Recharts.
const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

// Every response gets the headers. Cache-Control defaults to no-store for /api/* and no-cache otherwise; served assets set their own.
function secure(req: Request, res: Response): Response {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
  if (!res.headers.has("cache-control")) {
    res.headers.set("cache-control", new URL(req.url).pathname.startsWith("/api/") ? "no-store" : "no-cache");
  }
  return res;
}

type Handler = (req: Request, server: Server<undefined>) => Response | Promise<Response>;

// Bun.serve routes skip fetch(), so their responses are passed through secure() here.
const secureRoutes = <T extends Record<string, Record<string, Handler>>>(routes: T): T =>
  Object.fromEntries(
    Object.entries(routes).map(([path, methods]) => [
      path,
      Object.fromEntries(
        Object.entries(methods).map(([method, h]) => [
          method,
          async (req: Request, server: Server<undefined>) => secure(req, await h(req, server)),
        ]),
      ),
    ]),
  ) as T;

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new InputError("Request body must be JSON");
  }
}

async function serveWeb(pathname: string): Promise<Response> {
  if (!(await Bun.file(INDEX_HTML).exists())) {
    return new Response("Web app not built. Run `bun run build` first.", { status: 404 });
  }
  const filePath = join(WEB_DIST, pathname);
  if (!filePath.startsWith(WEB_DIST + sep) && filePath !== WEB_DIST) {
    return new Response("Forbidden", { status: 403 });
  }
  const file = Bun.file(filePath);
  // SPA fallback: any unknown path serves index.html so client routing works.
  if (pathname !== "/" && (await file.exists())) {
    // Built asset names carry a content hash, so they never change and can be cached forever.
    const headers = pathname.startsWith("/assets/") ? { "cache-control": "public, max-age=31536000, immutable" } : undefined;
    return new Response(file, { headers });
  }
  return new Response(Bun.file(INDEX_HTML));
}

// Fixed window per key (client IP). Returns false once a key has used up its quota for the window.
function fixedWindow(max: number, windowMs: number) {
  const hits = new Map<string, { start: number; count: number }>();
  return (key: string): boolean => {
    const now = Date.now();
    // shortcut: wipes all windows at 10k IPs to bound memory, upgrade to an LRU if traffic is real
    if (hits.size > 10_000) hits.clear();
    let w = hits.get(key);
    if (!w || now - w.start >= windowMs) hits.set(key, (w = { start: now, count: 0 }));
    w.count++;
    return w.count <= max;
  };
}

export function createServer(dataset: Dataset, ai: AiConfig, port = 3000) {
  const { orders, meta, dashboard } = dataset;
  const schemas = buildSchemas(meta);
  const state: AiState = {
    cache: new Map(),
    lastAttemptFailed: false,
    usage: { day: "", calls: 0 },
    ipUsage: { day: "", calls: new Map() },
  };
  const allowAsk = fixedWindow(20, 60_000);
  // Behind Fly's proxy the socket IP is the proxy, so the client-IP header is the real one. Anywhere else a client can send that header, so it is ignored.
  const trustFlyIp = Boolean(process.env.FLY_APP_NAME);

  return Bun.serve({
    port,
    // Questions are capped at 500 chars, so 16 KB is generous; bigger bodies are refused before they are read.
    maxRequestBodySize: 16 * 1024,
    routes: secureRoutes({
      "/api/health": {
        GET: () => {
          if (!ai.apiKey) return json({ ok: true, aiMode: "rules" });
          const aiStatus = dailyLimitReached({ ai, state }) ? "limited" : state.lastAttemptFailed ? "failing" : "ok";
          return json({ ok: true, aiMode: "llm", model: ai.model, aiStatus });
        },
      },
      "/api/meta": { GET: () => json(meta) },
      "/api/dashboard": { GET: () => json(dashboard) },
      "/api/query": {
        POST: async (req) => {
          try {
            return json(runQuery(orders, parseQuery(schemas, await readJson(req))));
          } catch (e) {
            return badRequest(e);
          }
        },
      },
      "/api/forecast": {
        POST: async (req) => {
          try {
            return json(runForecast(orders, parseForecast(schemas, await readJson(req))));
          } catch (e) {
            return badRequest(e);
          }
        },
      },
      "/api/ask": {
        POST: async (req, server) => {
          const ip = (trustFlyIp && req.headers.get("fly-client-ip")) || server.requestIP(req)?.address || "unknown";
          // Only the paid LLM path is limited; rules mode is free.
          if (ai.apiKey && !allowAsk(ip)) {
            return json({ error: "Too many questions, try again in a minute." }, 429);
          }
          try {
            const question = ((await readJson(req)) as { question?: unknown } | null)?.question;
            if (typeof question !== "string") throw new InputError("question must be a string");
            return json(await ask(question, { orders, meta, schemas, ai, state, ip }));
          } catch (e) {
            if (e instanceof InputError) return badRequest(e);
            console.error(e);
            return json({ error: "Internal error" }, 500);
          }
        },
      },
    }),
    async fetch(req) {
      const { pathname } = new URL(req.url);
      if (pathname.startsWith("/api/")) return secure(req, json({ error: "Not found" }, 404));
      return secure(req, await serveWeb(pathname));
    },
    error(e) {
      console.error(e);
      return new Response("Internal error", { status: 500, headers: { ...SECURITY_HEADERS, "cache-control": "no-store" } });
    },
  });
}

if (import.meta.main) {
  const ai = aiConfigFromEnv();
  const dataset = await loadDataset();
  const port = Number(process.env.PORT) || 3000;
  const server = createServer(dataset, ai, port);
  console.log(`Server listening on http://localhost:${server.port} (AI mode: ${ai.apiKey ? "llm" : "rules"})`);
}
