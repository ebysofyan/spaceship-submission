import { afterAll, describe, expect, test } from "bun:test";
import { aiConfigFromEnv, interpretWithLlm, toolDefinitions } from "../src/ai/llm";
import { buildSchemas } from "../src/ai/schemas";
import { loadDataset } from "../src/data";

const { meta } = await loadDataset();
const schemas = buildSchemas(meta);

describe("aiConfigFromEnv", () => {
  test("defaults to the SumoPod gpt-6-luna model with reasoning_effort none, a 500-call daily limit and a 40-call per-IP limit", () => {
    expect(aiConfigFromEnv({})).toEqual({
      apiKey: undefined,
      baseUrl: "https://ai.sumopod.com/v1",
      model: "gpt-6-luna",
      reasoningEffort: "none",
      dailyLimit: 500,
      ipDailyLimit: 40,
    });
  });

  test("AI_IP_DAILY_LIMIT is read as a number; garbage falls back to the default", () => {
    expect(aiConfigFromEnv({ AI_IP_DAILY_LIMIT: "12" }).ipDailyLimit).toBe(12);
    expect(aiConfigFromEnv({ AI_IP_DAILY_LIMIT: "lots" }).ipDailyLimit).toBe(40);
  });

  test("AI_DAILY_LIMIT is read as a number; 0 is kept, garbage falls back to the default", () => {
    expect(aiConfigFromEnv({ AI_DAILY_LIMIT: "0" }).dailyLimit).toBe(0);
    expect(aiConfigFromEnv({ AI_DAILY_LIMIT: "25" }).dailyLimit).toBe(25);
    expect(aiConfigFromEnv({ AI_DAILY_LIMIT: "lots" }).dailyLimit).toBe(500);
  });

  test("an explicitly empty AI_REASONING_EFFORT is kept as empty, meaning don't send", () => {
    expect(aiConfigFromEnv({ AI_REASONING_EFFORT: "" }).reasoningEffort).toBe("");
  });
});

describe("LLM request", () => {
  // Stub OpenAI-compatible endpoint: records each request body and replies with a valid tool call.
  const bodies: any[] = [];
  const srv = Bun.serve({
    port: 0,
    async fetch(req) {
      bodies.push(await req.json());
      return Response.json({
        usage: { prompt_tokens: 1234 },
        choices: [
          {
            message: {
              tool_calls: [{ function: { name: "refuse", arguments: JSON.stringify({ reasoning: "Revenue was $9,500,000" }) } }],
            },
          },
        ],
      });
    },
  });
  const ai = (reasoningEffort?: string) => ({ apiKey: "k", baseUrl: `http://localhost:${srv.port}`, model: "m", reasoningEffort });
  afterAll(() => srv.stop(true));

  test("sends reasoning_effort when set, not when empty, and reports prompt tokens", async () => {
    let tokens = 0;
    const r = await interpretWithLlm("weather?", meta, schemas, ai("none"), (n) => (tokens = n));
    expect(r).toMatchObject({ tool: "unsupported", source: "llm" });
    expect(bodies[0].reasoning_effort).toBe("none");
    expect(tokens).toBe(1234);

    await interpretWithLlm("weather?", meta, schemas, ai(""));
    expect(bodies[1]).not.toHaveProperty("reasoning_effort");
  });

  test("caps output tokens and asks the model for no free text", async () => {
    await interpretWithLlm("weather?", meta, schemas, ai());
    expect(bodies[0].max_tokens).toBe(300);
    expect(JSON.stringify(bodies[0].tools)).not.toContain("reasoning");
    expect(bodies[0].messages[0].content).not.toContain("reasoning");
  });

  test("a refuse call gets the fixed sentence, whatever text the model put in", async () => {
    const r = await interpretWithLlm("weather?", meta, schemas, ai());
    expect(r).toEqual({
      tool: "unsupported",
      source: "llm",
      reasoning: "That question is outside what this order data can answer.",
    });
  });

  test("large enums are trimmed to a format hint; small enums stay", () => {
    const [query] = toolDefinitions(schemas);
    const filters = (query!.function.parameters as any).properties.filters.properties;
    expect(filters.sku.items.enum).toBeUndefined();
    expect(filters.sku.items.description).toContain("e.g.");
    expect(filters.destination_city.items.enum).toBeUndefined();
    expect(filters.client_id.items.enum).toBeUndefined();
    expect(filters.carrier.items.enum).toHaveLength(meta.values.carrier!.length);
  });
});
