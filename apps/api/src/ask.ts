import { runForecast, runQuery, type AskResponse, type Interpretation, type MetaResponse, type Order } from "@app/core";
import { interpretWithLlm, type AiConfig } from "./ai/llm";
import { interpretRules } from "./ai/rules";
import { answerForecast, answerQuery, refusalAnswer } from "./ai/answer";
import type { Schemas } from "./ai/schemas";

// Bad input from the caller (maps to HTTP 400).
export class InputError extends Error {}

const MAX_QUESTION_CHARS = 500;

export interface AskDeps {
  orders: Order[];
  meta: MetaResponse;
  schemas: Schemas;
  ai: AiConfig;
}

const describe = (e: unknown) =>
  e instanceof Error ? (e.name === "TimeoutError" ? "timed out after 15s" : e.message) : String(e);

// `reason` is the bare explanation for user-facing refusals. `interpretation.reasoning` carries the
// audit trail (which interpreter ran, and why the LLM was not used).
export async function interpret(
  question: string,
  deps: Pick<AskDeps, "meta" | "schemas" | "ai">,
): Promise<{ interpretation: Interpretation; reason: string }> {
  // Rules mode is the normal mode without a key, not a failure.
  if (!deps.ai.apiKey) {
    const rules = interpretRules(question, deps.meta);
    return {
      reason: rules.reasoning,
      interpretation: { ...rules, reasoning: `Rules interpreter (no AI_API_KEY configured): ${rules.reasoning}` },
    };
  }
  try {
    const llm = await interpretWithLlm(question, deps.meta, deps.schemas, deps.ai);
    return { reason: llm.reasoning, interpretation: llm };
  } catch (e) {
    const rules = interpretRules(question, deps.meta);
    return {
      reason: rules.reasoning,
      interpretation: { ...rules, reasoning: `${rules.reasoning} (LLM unavailable: ${describe(e)}; used rules)` },
    };
  }
}

export async function ask(input: string, deps: AskDeps): Promise<AskResponse> {
  const question = input.trim();
  if (!question) throw new InputError("Question is required");
  if (question.length > MAX_QUESTION_CHARS) {
    throw new InputError(`Question must be ${MAX_QUESTION_CHARS} characters or fewer`);
  }

  const { interpretation, reason } = await interpret(question, deps);
  const refuse = (message: string, error?: string): AskResponse => ({
    question,
    interpretation,
    answer: refusalAnswer(message),
    supported: deps.meta.examples,
    ...(error === undefined ? {} : { error }),
  });

  if (interpretation.tool === "unsupported") return refuse(reason);

  // Core validates the spec (unknown values, bad horizon, ...). Its errors become a refusal, not a 500.
  try {
    if (interpretation.tool === "query") {
      const query = runQuery(deps.orders, interpretation.args);
      return { question, interpretation, query, answer: answerQuery(query) };
    }
    const forecast = runForecast(deps.orders, interpretation.args);
    return { question, interpretation, forecast, answer: answerForecast(forecast) };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return refuse(message, message);
  }
}
