import { afterAll, describe, expect, test } from "bun:test";
import { aiConfigFromEnv, interpretWithLlm, toolDefinitions } from "../src/ai/llm";
import { buildSchemas } from "../src/ai/schemas";
import { loadDataset } from "../src/data";

const { meta } = await loadDataset();
const schemas = buildSchemas(meta);

describe("aiConfigFromEnv", () => {
  test("defaults to the SumoPod gpt-6-luna model with reasoning_effort none", () => {
    expect(aiConfigFromEnv({})).toEqual({
      apiKey: undefined,
      baseUrl: "https://ai.sumopod.com/v1",
      model: "gpt-6-luna",
      reasoningEffort: "none",
    });
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
              tool_calls: [{ function: { name: "refuse", arguments: JSON.stringify({ reasoning: "off topic" }) } }],
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
