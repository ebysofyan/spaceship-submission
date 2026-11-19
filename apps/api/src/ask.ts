import {
  runForecast,
  runQuery,
  type AskResponse,
  type Interpretation,
  type MetaResponse,
  type Metric,
  type Order,
  type Status,
} from "@app/core";
import { DEFAULT_DAILY_LIMIT, DEFAULT_IP_DAILY_LIMIT, interpretWithLlm, InvalidToolCall, type AiConfig } from "./ai/llm";
import { interpretRules } from "./ai/rules";
import { answerForecast, answerQuery, refusalAnswer } from "./ai/answer";
import type { Schemas } from "./ai/schemas";

// Bad input from the caller (maps to HTTP 400).
export class InputError extends Error {}

const MAX_QUESTION_CHARS = 500;
const CACHE_LIMIT = 500;

// Per server instance. Only successful LLM interpretations are cached; rules and failures are not.
export interface AiState {
  cache: Map<string, Interpretation>;
  lastAttemptFailed: boolean;
  usage: { day: string; calls: number }; // LLM calls sent on one UTC day
  ipUsage: { day: string; calls: Map<string, number> }; // LLM calls per client IP on one UTC day
}

export interface AskDeps {
  orders: Order[];
  meta: MetaResponse;
  schemas: Schemas;
  ai: AiConfig;
  state: AiState;
  ip: string; // client IP for the per-IP budget
}

// Same question with other spacing, case or trailing ?.! gets the same cached answer.
export const cacheKey = (question: string) =>
  question.trim().toLowerCase().replace(/\s+/g, " ").replace(/[\s?.!]+$/, "");

// The metric already implies its status: a status filter that restates it changes nothing, so drop it.
const IMPLIED_STATUS: Partial<Record<Metric, Status>> = { delayed_count: "delayed", delivered_count: "delivered" };

// The LLM sometimes restates the metric as a filter, or sets limit 1. One bar is not a chart, and the answer names the leader.
export function tidyQuery(i: Interpretation): Interpretation {
  if (i.tool !== "query") return i;
  const { filters, limit, ...args } = i.args;
  const implied = IMPLIED_STATUS[args.metric];
  let kept = filters;
  // Only when the status filter is exactly the implied status: a wider list changes which rows count.
  if (implied && filters?.status?.every((s) => s === implied)) {
    const { status: _, ...others } = filters;
    kept = others;
  }
  return {
    tool: "query",
    source: i.source,
    reasoning: i.reasoning,
    args: {
      ...args,
      ...(kept && Object.keys(kept).length ? { filters: kept } : {}),
      ...(limit !== undefined && limit > 1 ? { limit } : {}),
    },
  };
}

// shortcut: the counter lives in this process and resets on restart; move it to a shared store if we run several instances.
export function todayUsage(state: AiState): AiState["usage"] {
  const day = new Date().toISOString().slice(0, 10);
  if (state.usage.day !== day) state.usage = { day, calls: 0 };
  return state.usage;
}

export const dailyLimitReached = (deps: Pick<AskDeps, "ai" | "state">) =>
  todayUsage(deps.state).calls >= (deps.ai.dailyLimit ?? DEFAULT_DAILY_LIMIT);

// shortcut: per-process like todayUsage, so a restart resets every IP; move to a shared store if we run several instances.
export function todayIpUsage(state: AiState): Map<string, number> {
  const day = new Date().toISOString().slice(0, 10);
  if (state.ipUsage.day !== day) state.ipUsage = { day, calls: new Map() };
  // Bounds memory like fixedWindow: past 10k IPs the counts are wiped.
  if (state.ipUsage.calls.size > 10_000) state.ipUsage.calls.clear();
  return state.ipUsage.calls;
}

// One reasoning string per interpretation. It is user-visible, so it stays in plain English.
export async function interpret(
  question: string,
  deps: Pick<AskDeps, "meta" | "schemas" | "ai" | "state" | "ip">,
): Promise<Interpretation> {
  // Rules mode is the normal mode without a key, not a failure.
  if (!deps.ai.apiKey) return interpretRules(question, deps.meta);
  const { cache } = deps.state;
  const key = cacheKey(question);
  const cached = cache.get(key);
  if (cached) return cached;
  if (dailyLimitReached(deps)) {
    const rules = interpretRules(question, deps.meta);
    return { ...rules, reasoning: `${rules.reasoning} (Daily AI limit reached, used keyword matching.)` };
  }
  const ipCalls = todayIpUsage(deps.state);
  const ipUsed = ipCalls.get(deps.ip) ?? 0;
  if (ipUsed >= (deps.ai.ipDailyLimit ?? DEFAULT_IP_DAILY_LIMIT)) {
    const rules = interpretRules(question, deps.meta);
    return { ...rules, reasoning: `${rules.reasoning} (Your daily AI limit is used up, used keyword matching.)` };
  }
  ipCalls.set(deps.ip, ipUsed + 1);
  todayUsage(deps.state).calls++;
  try {
    const llm = tidyQuery(await interpretWithLlm(question, deps.meta, deps.schemas, deps.ai));
    deps.state.lastAttemptFailed = false;
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string); // drop oldest
    cache.set(key, llm);
    return llm;
  } catch (e) {
    // A rejected reading (e.g. an invented SKU) is not an outage: the header stays "AI on".
    const rejected = e instanceof InvalidToolCall;
    deps.state.lastAttemptFailed = !rejected;
    console.warn("LLM interpreter failed, using keyword matching:", e);
    const rules = interpretRules(question, deps.meta);
    const why = rejected ? "AI reading failed validation" : "AI unavailable";
    return { ...rules, reasoning: `${rules.reasoning} (${why}, used keyword matching.)` };
  }
}

export async function ask(input: string, deps: AskDeps): Promise<AskResponse> {
  const question = input.trim();
  if (!question) throw new InputError("Question is required");
  if (question.length > MAX_QUESTION_CHARS) {
    throw new InputError(`Question must be ${MAX_QUESTION_CHARS} characters or fewer`);
  }

  const interpretation = await interpret(question, deps);
  const refuse = (message: string, error?: string): AskResponse => ({
    question,
    interpretation,
    answer: refusalAnswer(message),
    supported: deps.meta.examples,
    ...(error === undefined ? {} : { error }),
  });

  if (interpretation.tool === "unsupported") return refuse(interpretation.reasoning);

  // Core validates the spec (unknown values, bad horizon, ...). Its errors become a refusal, not a 500.
  try {
    if (interpretation.tool === "query") {
      const query = runQuery(deps.orders, interpretation.args);
      return { question, interpretation, query, answer: answerQuery(query, deps.meta.dateRange) };
    }
    const forecast = runForecast(deps.orders, interpretation.args);
    return { question, interpretation, forecast, answer: answerForecast(forecast) };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return refuse(message, message);
  }
}
