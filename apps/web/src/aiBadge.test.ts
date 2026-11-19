import { describe, expect, test } from "bun:test";
import type { Health } from "./api";
import type { AsyncState } from "./hooks";
import { aiBadge } from "./aiBadge";

const state = (data?: Health, error?: string): AsyncState<Health> => ({ data, error, loading: false, retry: () => {} });

describe("aiBadge", () => {
  test("llm and ok shows AI on with the model in the title", () => {
    const badge = aiBadge(state({ ok: true, aiMode: "llm", model: "gpt-4o-mini", aiStatus: "ok" }));
    expect(badge).toEqual({ label: "AI on", tone: "accent", title: "Questions are interpreted by gpt-4o-mini" });
  });

  test("llm without model or status still reads as AI on", () => {
    expect(aiBadge(state({ ok: true, aiMode: "llm" })).title).toBe("Questions are interpreted by an LLM");
    expect(aiBadge(state({ ok: true, aiMode: "llm" })).label).toBe("AI on");
  });

  test("llm and failing shows a warn AI fallback", () => {
    const badge = aiBadge(state({ ok: true, aiMode: "llm", model: "m", aiStatus: "failing" }));
    expect(badge).toEqual({ label: "AI fallback", tone: "warn", title: "The AI model is unavailable; using keyword matching" });
  });

  test("llm and limited shows a warn AI limit reached until tomorrow", () => {
    const badge = aiBadge(state({ ok: true, aiMode: "llm", model: "m", aiStatus: "limited" }));
    expect(badge).toEqual({
      label: "AI limit reached",
      tone: "warn",
      title: "Daily AI budget used up; using keyword matching until tomorrow (UTC)",
    });
  });

  test("rules shows keyword mode", () => {
    expect(aiBadge(state({ ok: true, aiMode: "rules" })).label).toBe("Keyword mode");
  });

  test("offline, loading and unknown modes", () => {
    expect(aiBadge(state(undefined, "Can't reach the server.")).label).toBe("API offline");
    expect(aiBadge(state()).label).toBe("Checking…");
    expect(aiBadge(state({ ok: true, aiMode: "other" as Health["aiMode"] })).label).toBe("Unknown");
  });
});
