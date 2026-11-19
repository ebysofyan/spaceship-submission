import { join, resolve, sep } from "node:path";
import { runForecast, runQuery } from "@app/core";
import { ask, InputError, type AiState } from "./ask";
import { aiConfigFromEnv, type AiConfig } from "./ai/llm";
import { buildSchemas, parseForecast, parseQuery } from "./ai/schemas";
import { loadDataset, type Dataset } from "./data";

// Repo-relative, so the server works from any cwd.
const WEB_DIST = resolve(import.meta.dir, "../../web/dist");
const INDEX_HTML = join(WEB_DIST, "index.html");

const json = (body: unknown, status = 200) => Response.json(body, { status });
const badRequest = (e: unknown) => json({ error: e instanceof Error ? e.message : String(e) }, 400);

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
  if (pathname !== "/" && (await file.exists())) return new Response(file);
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
  const state: AiState = { cache: new Map(), lastAttemptFailed: false };
  const allowAsk = fixedWindow(20, 60_000);

  return Bun.serve({
    port,
    routes: {
      "/api/health": {
        GET: () =>
          json(
            ai.apiKey
              ? { ok: true, aiMode: "llm", model: ai.model, aiStatus: state.lastAttemptFailed ? "failing" : "ok" }
              : { ok: true, aiMode: "rules" },
          ),
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
          // Only the paid LLM path is limited; rules mode is free.
          // Behind Fly's proxy the socket IP is the proxy, so prefer the client IP header it sets.
          const ip = req.headers.get("fly-client-ip") ?? server.requestIP(req)?.address ?? "unknown";
          if (ai.apiKey && !allowAsk(ip)) {
            return json({ error: "Too many questions, try again in a minute." }, 429);
          }
          try {
            const question = ((await readJson(req)) as { question?: unknown } | null)?.question;
            if (typeof question !== "string") throw new InputError("question must be a string");
            return json(await ask(question, { orders, meta, schemas, ai, state }));
          } catch (e) {
            if (e instanceof InputError) return badRequest(e);
            console.error(e);
            return json({ error: "Internal error" }, 500);
          }
        },
      },
    },
    fetch(req) {
      const { pathname } = new URL(req.url);
      if (pathname.startsWith("/api/")) return json({ error: "Not found" }, 404);
      return serveWeb(pathname);
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
