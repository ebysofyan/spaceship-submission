import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { AskResponse, QuerySpec } from "@app/core";
import { AnswerCard } from "./AskAnswer";
import { Pending } from "./Ask";

describe("Pending", () => {
  test("shows the question at once, then the three pipeline steps with only the first active", () => {
    const html = renderToStaticMarkup(<Pending question="Delay rate by carrier?" />);
    expect(html).toContain("Delay rate by carrier?");
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    const at = ["Understanding the question", "Running the query", "Building the chart"].map((s) => html.indexOf(s));
    expect(at.every((i) => i > -1)).toBe(true);
    expect(at[0]).toBeLessThan(at[1]);
    expect(at[1]).toBeLessThan(at[2]);
    expect(html.split("animate-spin").length - 1).toBe(1); // spinner on the active step only
  });
});

describe("AnswerCard", () => {
  test("fades in, and only when motion is allowed", () => {
    const response: AskResponse = {
      question: "q",
      answer: "a",
      interpretation: { tool: "query", args: {} as QuerySpec, source: "rules", reasoning: "r" },
    };
    const html = renderToStaticMarkup(<AnswerCard response={response} examples={[]} onAsk={() => {}} />);
    expect(html).toContain("motion-safe:animate-answer-in");
  });
});
