import { describe, expect, test } from "bun:test";
import { runQuery } from "@app/core";
import { loadDataset } from "../src/data";
import { interpretRules } from "../src/ai/rules";
import { answerQuery, refusalAnswer } from "../src/ai/answer";

const { orders, meta } = await loadDataset();

describe("answer templates", () => {
  test("highest delay rate names the top group and the leader among bigger groups", () => {
    const r = interpretRules("Which carrier has the highest delay rate?", meta);
    if (r.tool !== "query") throw new Error("expected a query");
    const text = answerQuery(runQuery(orders, r.args));
    expect(text).toContain("GLS");
    expect(text).toContain("37.5%");
    expect(text).toContain("USPS");
    expect(text).toContain("25.5%");
  });

  test("scalar answer carries the value and the resolved range", () => {
    const text = answerQuery(
      runQuery(orders, { metric: "delayed_count", dateRange: { last: 1, unit: "month" } }),
    );
    expect(text).toContain("2025-11-01 to 2025-11-30");
    expect(text).toMatch(/Delayed orders: \d+/);
  });

  test("refusal lists the supported questions", () => {
    const text = refusalAnswer("no metric recognised.", meta.examples);
    expect(text).toStartWith("I can't answer that from this dataset");
    expect(text).toContain(meta.examples[0]);
  });
});
