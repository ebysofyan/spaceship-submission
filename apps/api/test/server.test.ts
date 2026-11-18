import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer } from "../src/server";
import { loadDataset, type Dataset } from "../src/data";
import { buildSchemas, parseQuery } from "../src/ai/schemas";
import { interpret } from "../src/ask";
import { toolDefinitions } from "../src/ai/llm";
import type { AiConfig } from "../src/ai/llm";

// Explicit config with no key: tests stay in rules mode even if AI_API_KEY is set in the shell.
const RULES_ONLY: AiConfig = { apiKey: undefined, baseUrl: "https://api.openai.com/v1", model: "test" };

const dataset: Dataset = await loadDataset();
let server: ReturnType<typeof createServer>;
let base: string;

beforeAll(() => {
  server = createServer(dataset, RULES_ONLY, 0);
  base = `http://localhost:${server.port}`;
});
afterAll(() => server.stop(true));

// Test-only: response bodies are checked by the assertions that follow.
const jsonOf = async (res: Response): Promise<any> => res.json();

const post = (path: string, body: unknown) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("http api", () => {
  test("health reports rules mode without a key", async () => {
    const res = await fetch(`${base}/api/health`);
    expect(await jsonOf(res)).toEqual({ ok: true, aiMode: "rules" });
  });

  test("dashboard counts all orders", async () => {
    const body = await jsonOf(await fetch(`${base}/api/dashboard`));
    expect(body.kpis.totalOrders).toBe(400);
  });

  test("ask answers a carrier question with a query result", async () => {
    const res = await post("/api/ask", { question: "Which carrier has the highest delay rate?" });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.interpretation.tool).toBe("query");
    expect(body.query.rows[0].key).toBe("GLS");
  });

  test("ask refuses off-topic questions with status 200 and supported examples", async () => {
    const body = await jsonOf(await post("/api/ask", { question: "what's the weather" }));
    expect(body.interpretation.tool).toBe("unsupported");
    expect(body.supported.length).toBeGreaterThan(0);
    expect(body.answer).toBe("I can't answer that from this data. I couldn't tell which measure you mean.");
  });

  test("rules mode reasoning is plain English: no env var names, no interpreter prefix", async () => {
    const body = await jsonOf(await post("/api/ask", { question: "Which carrier has the highest delay rate?" }));
    expect(body.interpretation.reasoning).toBe("Matched “delay rate”, grouped by carrier.");
    expect(body.interpretation.reasoning).not.toContain("AI_API_KEY");
    expect(body.answer).not.toContain("AI");
  });

  test("ask rejects empty and over-long questions with 400", async () => {
    expect((await post("/api/ask", { question: "   " })).status).toBe(400);
    expect((await post("/api/ask", { question: "x".repeat(501) })).status).toBe(400);
    expect((await post("/api/ask", { question: 42 })).status).toBe(400);
  });

  test("query rejects an invalid body with 400 and an error message", async () => {
    const res = await post("/api/query", { metric: "nope" });
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error).toContain("Invalid query");
  });

  test("query rejects non-JSON with 400", async () => {
    expect((await post("/api/query", "{not json")).status).toBe(400);
  });

  test("forecast runs for a category", async () => {
    const res = await post("/api/forecast", { target: { kind: "category", value: "PAINT" } });
    expect(res.status).toBe(200);
    expect((await jsonOf(res)).forecast).toHaveLength(4);
  });

  test("unknown api route is a JSON 404", async () => {
    expect((await fetch(`${base}/api/nope`)).status).toBe(404);
  });
});

describe("schemas", () => {
  const schemas = buildSchemas(dataset.meta);

  test("normalises case to the dataset's spelling", () => {
    expect(parseQuery(schemas, { metric: "DELAY_RATE", groupBy: "Carrier", filters: { carrier: ["fedex"] } })).toEqual({
      metric: "delay_rate",
      groupBy: "carrier",
      filters: { carrier: ["FedEx"] },
    });
  });

  test("rejects values that are not in the dataset and unknown keys", () => {
    expect(() => parseQuery(schemas, { metric: "units", filters: { carrier: ["Foo"] } })).toThrow();
    expect(() => parseQuery(schemas, { metric: "units", bogus: 1 })).toThrow();
  });

  test("tool parameter schemas export for the LLM", () => {
    const [query, forecast] = toolDefinitions(schemas);
    expect(query.function.parameters.required).toContain("reasoning");
    expect(forecast.function.parameters.required).toContain("reasoning");
  });
});

describe("LLM path", () => {
  // Stub OpenAI-compatible endpoint, so the tests never touch the network.
  const stub = (handler: (req: Request) => Response) => Bun.serve({ port: 0, fetch: handler });

  test("a valid tool call is used and normalised", async () => {
    const srv = stub(() =>
      Response.json({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  function: {
                    name: "run_query",
                    arguments: JSON.stringify({ reasoning: "carrier ranking", metric: "delay_rate", groupBy: "carrier" }),
                  },
                },
              ],
            },
          },
        ],
      }),
    );
    try {
      const ai = { apiKey: "test-key", baseUrl: `http://localhost:${srv.port}`, model: "test" };
      const r = await interpret("Which carrier has the highest delay rate?", { meta: dataset.meta, schemas: buildSchemas(dataset.meta), ai });
      expect(r).toMatchObject({ tool: "query", source: "llm", reasoning: "carrier ranking", args: { metric: "delay_rate", groupBy: "carrier" } });
    } finally {
      srv.stop(true);
    }
  });

  test("an invalid tool call falls back to rules and says why", async () => {
    const srv = stub(() =>
      Response.json({
        choices: [{ message: { tool_calls: [{ function: { name: "run_query", arguments: JSON.stringify({ reasoning: "x", metric: "bogus" }) } }] } }],
      }),
    );
    try {
      const ai = { apiKey: "test-key", baseUrl: `http://localhost:${srv.port}`, model: "test" };
      const r = await interpret("Which carrier has the highest delay rate?", { meta: dataset.meta, schemas: buildSchemas(dataset.meta), ai });
      expect(r.source).toBe("rules");
      expect(r.reasoning).toBe("Matched “delay rate”, grouped by carrier. (AI unavailable, used keyword matching.)");
    } finally {
      srv.stop(true);
    }
  });

  test("an HTTP error falls back to rules", async () => {
    const srv = stub(() => new Response("nope", { status: 500 }));
    try {
      const ai = { apiKey: "test-key", baseUrl: `http://localhost:${srv.port}`, model: "test" };
      const r = await interpret("Which carrier has the highest delay rate?", { meta: dataset.meta, schemas: buildSchemas(dataset.meta), ai });
      expect(r).toMatchObject({ tool: "query", source: "rules" });
      expect(r.reasoning).toEndWith("(AI unavailable, used keyword matching.)");
    } finally {
      srv.stop(true);
    }
  });
});
