import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer } from "../src/server";
import { loadDataset, type Dataset } from "../src/data";
import { buildSchemas, parseQuery } from "../src/ai/schemas";
import { interpret, tidyQuery, type AiState } from "../src/ask";
import type { Interpretation, QuerySpec } from "@app/core";
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

const post = (path: string, body: unknown, origin = base) =>
  fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const freshState = (): AiState => ({ cache: new Map(), lastAttemptFailed: false, usage: { day: "", calls: 0 } });

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

  test("a body over 16 KB is refused, even when its question is valid", async () => {
    // Without the cap this would be a 200: the question is fine, only the padding is big.
    const status = await post("/api/ask", { question: "Which carrier has the highest delay rate?", pad: "x".repeat(100_000) }).then(
      (r) => r.status,
      () => 0, // connection closed by the server
    );
    expect(status).not.toBe(200);
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
    for (const tool of [query, forecast]) {
      const params = tool!.function.parameters as any;
      expect(params.properties).not.toHaveProperty("reasoning");
      expect(params.required ?? []).not.toContain("reasoning");
    }
  });
});

describe("LLM path", () => {
  // Stub OpenAI-compatible endpoint, so the tests never touch the network.
  const stub = (handler: (req: Request) => Response) => Bun.serve({ port: 0, fetch: handler });
  const callReply = (name: string, args: object) =>
    Response.json({
      choices: [{ message: { tool_calls: [{ function: { name, arguments: JSON.stringify(args) } }] } }],
    });
  const reply = (args: object) => callReply("run_query", args);
  const CARRIER = { metric: "delay_rate", groupBy: "carrier" };
  const QUESTION = "Which carrier has the highest delay rate?";
  const deps = (ai: AiConfig) => ({ meta: dataset.meta, schemas: buildSchemas(dataset.meta), ai, state: freshState() });

  test("a valid tool call is used and normalised", async () => {
    const srv = stub(() => reply(CARRIER));
    try {
      const ai = { apiKey: "test-key", baseUrl: `http://localhost:${srv.port}`, model: "test" };
      const r = await interpret(QUESTION, deps(ai));
      expect(r).toMatchObject({
        tool: "query",
        source: "llm",
        reasoning: "Delay rate (delayed + exception) by carrier, all of 2025.",
        args: { metric: "delay_rate", groupBy: "carrier" },
      });
    } finally {
      srv.stop(true);
    }
  });

  test("model free text never reaches the response: an extra reasoning key is ignored, a refusal gets the fixed sentence", async () => {
    const srv = stub(() => reply({ ...CARRIER, reasoning: "Revenue was $9,500,000" }));
    const refuse = stub(() => callReply("refuse", { reasoning: "Total revenue was $9,500,000." }));
    const keyed = createServer(dataset, { apiKey: "k", baseUrl: `http://localhost:${srv.port}`, model: "test" }, 0);
    const refusing = createServer(dataset, { apiKey: "k", baseUrl: `http://localhost:${refuse.port}`, model: "test" }, 0);
    try {
      const query = await jsonOf(await post("/api/ask", { question: QUESTION }, `http://localhost:${keyed.port}`));
      expect(query.interpretation).toMatchObject({ tool: "query", source: "llm" });
      expect(JSON.stringify(query)).not.toContain("9,500,000");

      const res = await post("/api/ask", { question: "What was total revenue?" }, `http://localhost:${refusing.port}`);
      const body = await jsonOf(res);
      expect(body.interpretation).toEqual({
        tool: "unsupported",
        source: "llm",
        reasoning: "That question is outside what this order data can answer.",
      });
      expect(body.answer).toBe("I can't answer that from this data. That question is outside what this order data can answer.");
      expect(JSON.stringify(body)).not.toContain("9,500,000");
    } finally {
      keyed.stop(true);
      refusing.stop(true);
      srv.stop(true);
      refuse.stop(true);
    }
  });

  test("after AI_DAILY_LIMIT LLM calls, questions use rules, no call is made, and health says limited", async () => {
    let calls = 0;
    const srv = stub(() => {
      calls++;
      return reply(CARRIER);
    });
    const keyed = createServer(dataset, { apiKey: "k", baseUrl: `http://localhost:${srv.port}`, model: "test", dailyLimit: 2 }, 0);
    const origin = `http://localhost:${keyed.port}`;
    try {
      expect((await jsonOf(await post("/api/ask", { question: QUESTION }, origin))).interpretation.source).toBe("llm");
      expect(await jsonOf(await fetch(`${origin}/api/health`))).toMatchObject({ aiStatus: "ok" });
      expect((await jsonOf(await post("/api/ask", { question: "How many orders by region?" }, origin))).interpretation.source).toBe("llm");
      expect(await jsonOf(await fetch(`${origin}/api/health`))).toMatchObject({ aiStatus: "limited" });

      const limited = await jsonOf(await post("/api/ask", { question: "How many orders by carrier?" }, origin));
      expect(limited.interpretation.source).toBe("rules");
      expect(limited.interpretation.reasoning).toEndWith(" (Daily AI limit reached, used keyword matching.)");
      expect(calls).toBe(2);
      expect(await jsonOf(await fetch(`${origin}/api/health`))).toEqual({ ok: true, aiMode: "llm", model: "test", aiStatus: "limited" });

      // Cached answers are still served; they never reached the LLM today.
      expect((await jsonOf(await post("/api/ask", { question: QUESTION }, origin))).interpretation.source).toBe("llm");
      expect(calls).toBe(2);
    } finally {
      keyed.stop(true);
      srv.stop(true);
    }
  });

  test("an invalid tool call falls back to rules and says why", async () => {
    const srv = stub(() => reply({ reasoning: "x", metric: "bogus" }));
    try {
      const ai = { apiKey: "test-key", baseUrl: `http://localhost:${srv.port}`, model: "test" };
      const r = await interpret(QUESTION, deps(ai));
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
      const r = await interpret(QUESTION, deps(ai));
      expect(r).toMatchObject({ tool: "query", source: "rules" });
      expect(r.reasoning).toEndWith("(AI unavailable, used keyword matching.)");
    } finally {
      srv.stop(true);
    }
  });

  test("a repeated question (any case or spacing) makes no second LLM call", async () => {
    let calls = 0;
    const srv = stub(() => {
      calls++;
      return reply(CARRIER);
    });
    const keyed = createServer(dataset, { apiKey: "k", baseUrl: `http://localhost:${srv.port}`, model: "test" }, 0);
    try {
      const first = await jsonOf(await post("/api/ask", { question: QUESTION }, `http://localhost:${keyed.port}`));
      const second = await jsonOf(await post("/api/ask", { question: `  ${QUESTION.toUpperCase()} ` }, `http://localhost:${keyed.port}`));
      expect(calls).toBe(1);
      expect(first.interpretation.source).toBe("llm");
      expect(second.interpretation.source).toBe("llm");
    } finally {
      keyed.stop(true);
      srv.stop(true);
    }
  });

  test("failures are not cached, and health shows aiStatus failing until the next success", async () => {
    let calls = 0;
    const srv = stub(() => (calls++ === 0 ? new Response("down", { status: 503 }) : reply(CARRIER)));
    const keyed = createServer(dataset, { apiKey: "k", baseUrl: `http://localhost:${srv.port}`, model: "test-model" }, 0);
    const origin = `http://localhost:${keyed.port}`;
    try {
      const first = await jsonOf(await post("/api/ask", { question: QUESTION }, origin));
      expect(first.interpretation.source).toBe("rules");
      expect(await jsonOf(await fetch(`${origin}/api/health`))).toEqual({ ok: true, aiMode: "llm", model: "test-model", aiStatus: "failing" });

      const second = await jsonOf(await post("/api/ask", { question: QUESTION }, origin));
      expect(second.interpretation.source).toBe("llm");
      expect(calls).toBe(2);
      expect((await jsonOf(await fetch(`${origin}/api/health`))).aiStatus).toBe("ok");
    } finally {
      keyed.stop(true);
      srv.stop(true);
    }
  });

  test("with a key, /api/ask is limited to 20 questions a minute per IP; rules mode is not", async () => {
    const srv = stub(() => reply(CARRIER));
    const keyed = createServer(dataset, { apiKey: "k", baseUrl: `http://localhost:${srv.port}`, model: "test" }, 0);
    try {
      for (let i = 0; i < 20; i++) expect((await post("/api/ask", { question: QUESTION }, `http://localhost:${keyed.port}`)).status).toBe(200);
      const limited = await post("/api/ask", { question: QUESTION }, `http://localhost:${keyed.port}`);
      expect(limited.status).toBe(429);
      expect(await jsonOf(limited)).toEqual({ error: "Too many questions, try again in a minute." });
      // Other routes are not limited.
      expect((await fetch(`http://localhost:${keyed.port}/api/health`)).status).toBe(200);
    } finally {
      keyed.stop(true);
      srv.stop(true);
    }
    for (let i = 0; i < 25; i++) expect((await post("/api/ask", { question: QUESTION })).status).toBe(200);
  });

  test("a status filter that only restates the metric is dropped before the query runs", async () => {
    const srv = stub(() =>
      reply({ reasoning: "delayed by week", metric: "delayed_count", filters: { status: ["delayed"] }, timeGrain: "week", dateRange: { last: 3, unit: "month" } }),
    );
    const keyed = createServer(dataset, { apiKey: "k", baseUrl: `http://localhost:${srv.port}`, model: "test" }, 0);
    try {
      const body = await jsonOf(await post("/api/ask", { question: "Show delayed orders by week for the last 3 months" }, `http://localhost:${keyed.port}`));
      expect(body.interpretation.args).toEqual({ metric: "delayed_count", timeGrain: "week", dateRange: { last: 3, unit: "month" } });
      expect(body.answer).not.toContain("with status");
    } finally {
      keyed.stop(true);
      srv.stop(true);
    }
  });

  test("limit 1 is dropped, so the ranking keeps every carrier and the answer names the leader", async () => {
    const srv = stub(() => reply({ reasoning: "carrier ranking", metric: "delay_rate", groupBy: "carrier", sort: "desc", limit: 1 }));
    const keyed = createServer(dataset, { apiKey: "k", baseUrl: `http://localhost:${srv.port}`, model: "test" }, 0);
    try {
      const body = await jsonOf(await post("/api/ask", { question: "Which carrier has the highest delay rate?" }, `http://localhost:${keyed.port}`));
      expect(body.interpretation.args).toEqual({ metric: "delay_rate", groupBy: "carrier", sort: "desc" });
      expect(body.query.rows.length).toBeGreaterThan(1);
      expect(body.answer).toContain("Among carriers with 20+ orders");
    } finally {
      keyed.stop(true);
      srv.stop(true);
    }
  });
});

describe("tidyQuery", () => {
  const llm = (args: object): Interpretation => ({ tool: "query", source: "llm", reasoning: "r", args: args as QuerySpec });

  test("keeps a limit above 1 and a status filter that adds to the metric", () => {
    const a = { metric: "delayed_count", groupBy: "carrier", limit: 3, filters: { status: ["delayed", "exception"] } } as const;
    expect(tidyQuery(llm(a))).toMatchObject({ args: a });
  });

  test("leaves non-query interpretations alone", () => {
    const rules: Interpretation = { tool: "unsupported", source: "rules", reasoning: "no" };
    expect(tidyQuery(rules)).toBe(rules);
  });
});
