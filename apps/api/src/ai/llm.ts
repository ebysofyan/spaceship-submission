import { z } from "zod";
import type { Dimension, Interpretation, MetaResponse } from "@app/core";
import { parseForecast, parseQuery, type Schemas } from "./schemas";

export interface AiConfig {
  apiKey?: string;
  baseUrl: string;
  model: string;
}

export function aiConfigFromEnv(env: Record<string, string | undefined> = process.env): AiConfig {
  return {
    apiKey: env.AI_API_KEY || undefined,
    baseUrl: env.AI_BASE_URL || "https://api.openai.com/v1",
    model: env.AI_MODEL || "gpt-4o-mini",
  };
}

const TIMEOUT_MS = 15_000;

interface ToolCall {
  name: string;
  arguments: string;
}

export function systemPrompt(meta: MetaResponse): string {
  const list = (dim: Dimension) => (meta.values[dim] ?? []).join(", ");
  const metrics = meta.metrics.map((m) => `- ${m.id}: ${m.definition}`).join("\n");
  return `You route questions about a logistics order dataset to exactly one tool: run_query, run_forecast or refuse.
You are a router only. Never answer with numbers or claims about the data: the app computes every result from your arguments.

Metrics:
${metrics}

Dimensions for groupBy and filters: ${meta.dimensions.join(", ")}.
Allowed values (use exactly these spellings):
- carrier: ${list("carrier")}
- region: ${list("region")}
- product_category: ${meta.categories.join(", ")}
- status: ${list("status")}
- sku: format CATEGORY-NNNN. Use only SKUs from the tool's enum; never invent one.

Dates: relative ranges are anchored to the last order date, ${meta.anchorDate}, not to today.
- "last month" = {"last": 1, "unit": "month"} (the full calendar month before the anchor month)
- "last 3 months" = {"last": 3, "unit": "month"}
- Quarters and named months: explicit {"from", "to"} dates in ${meta.anchorDate.slice(0, 4)}.

Query shape:
- "top N" / "bottom N" -> limit N (bottom: sort "asc"). Plain "top" or "highest" with no number -> no limit.
- "compare A and B", "A vs B": two or more values of one dimension -> groupBy that dimension and filter to those values.
- "trend", "over time", "monthly" -> timeGrain "month", unless another grain is asked for.
- "how is X doing", "X performance" with no measure -> metric on_time_rate, filtered to X.

Use run_query for metric questions, run_forecast for demand, prediction or inventory planning, and refuse for anything else.
Put one short plain-English sentence in "reasoning" on every call; it is shown to the user.`;
}

// Tool schemas come from the same zod schemas that validate the reply. Each tool also takes a `reasoning` string.
export function toolDefinitions(schemas: Schemas) {
  const json = (schema: z.ZodType) => {
    const { $schema: _, ...rest } = z.toJSONSchema(schema, { io: "input" });
    return {
      ...rest,
      properties: { ...rest.properties, reasoning: { type: "string" } },
      required: [...(rest.required ?? []), "reasoning"],
    };
  };
  return [
    {
      type: "function",
      function: {
        name: "run_query",
        description: "Compute one metric over the orders, optionally grouped or bucketed by time.",
        parameters: json(schemas.QuerySpecSchema),
      },
    },
    {
      type: "function",
      function: {
        name: "run_forecast",
        description: "Forecast monthly unit demand and recommend inventory.",
        parameters: json(schemas.ForecastSpecSchema),
      },
    },
    {
      type: "function",
      function: {
        name: "refuse",
        description: "Use when the question cannot be answered from this dataset with these tools.",
        parameters: {
          type: "object",
          properties: { reasoning: { type: "string" } },
          required: ["reasoning"],
          additionalProperties: false,
        },
      },
    },
  ];
}

// Throws on anything unexpected; the caller falls back to rules and records why.
function fromToolCall(call: ToolCall, schemas: Schemas): Interpretation {
  let args: unknown;
  try {
    args = JSON.parse(call.arguments);
  } catch {
    throw new Error(`${call.name} arguments are not JSON`);
  }
  if (typeof args !== "object" || args === null) throw new Error(`${call.name} arguments are not an object`);
  const { reasoning, ...spec } = args as Record<string, unknown>;
  if (typeof reasoning !== "string") throw new Error(`${call.name} has no reasoning`);

  switch (call.name) {
    case "run_query":
      return { tool: "query", args: parseQuery(schemas, spec), source: "llm", reasoning };
    case "run_forecast":
      return { tool: "forecast", args: parseForecast(schemas, spec), source: "llm", reasoning };
    case "refuse":
      return { tool: "unsupported", source: "llm", reasoning };
    default:
      throw new Error(`unknown tool ${call.name}`);
  }
}

export async function interpretWithLlm(
  question: string,
  meta: MetaResponse,
  schemas: Schemas,
  ai: AiConfig,
): Promise<Interpretation> {
  const key = ai.apiKey;
  if (!key) throw new Error("AI_API_KEY not set");

  const res = await fetch(`${ai.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: ai.model,
      temperature: 0,
      tool_choice: "required",
      tools: toolDefinitions(schemas),
      messages: [
        { role: "system", content: systemPrompt(meta) },
        { role: "user", content: question },
      ],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const body = (await res.json()) as {
    choices?: Array<{ message?: { tool_calls?: Array<{ function: ToolCall }> } }>;
  };
  const call = body.choices?.[0]?.message?.tool_calls?.[0]?.function;
  if (!call) throw new Error("no tool call in reply");
  return fromToolCall(call, schemas);
}
