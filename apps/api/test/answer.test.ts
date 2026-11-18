import { describe, expect, test } from "bun:test";
import { runForecast, runQuery, type QuerySpec } from "@app/core";
import { loadDataset } from "../src/data";
import { interpretRules } from "../src/ai/rules";
import { answerForecast, answerQuery, refusalAnswer } from "../src/ai/answer";

const { orders, meta } = await loadDataset();

// Route a question through the rules, then run and answer it: the same path as /api/ask.
function say(question: string): string {
  const r = interpretRules(question, meta);
  if (r.tool === "query") return answerQuery(runQuery(orders, r.args), meta.dateRange);
  if (r.tool === "forecast") return answerForecast(runForecast(orders, r.args));
  return refusalAnswer(r.reasoning);
}
const query = (spec: QuerySpec) => answerQuery(runQuery(orders, spec), meta.dateRange);

describe("answer templates", () => {
  test("carrier delay rate: the top group, its base, and the leader among bigger groups", () => {
    expect(say("Which carrier has the highest delay rate?")).toBe(
      "GLS has the highest delay rate at 37.5% in 2025, but on only 8 orders. Among carriers with 20+ orders, USPS is highest at 25.5% (12 of 47).",
    );
  });

  test("last month's delayed count names the month", () => {
    expect(say("How many orders were delivered late last month?")).toBe(
      "4 orders were delayed in November 2025.",
    );
  });

  test("weekly delayed series: total over the range, then the busiest week", () => {
    expect(say("Show delayed orders by week for the last 3 months")).toBe(
      "9 delayed orders from 1 Sep – 30 Nov 2025. The busiest week (starting 6 Oct) had 2.",
    );
  });

  test("region order counts: top three, with the counts in brackets and the period", () => {
    expect(say("How many orders by region?")).toBe(
      "US-E has the most orders (95) in 2025, followed by US-W (92) and EU (81).",
    );
  });

  test("grouped counts in a quarter use the same range phrase as scalars", () => {
    expect(say("orders by region in Q1")).toBe(
      "US-E has the most orders (42) from 1 Jan – 31 Mar 2025, followed by US-W (39) and US-C (31).",
    );
  });

  test("compare names every compared value, in rank order", () => {
    expect(say("compare UPS and FedEx on-time rate")).toBe(
      "FedEx 85.9% (85 orders) vs UPS 75.6% (78 orders) on-time rate in 2025.",
    );
    expect(say("EU vs UK orders")).toBe("EU 81 vs UK 54 orders in 2025.");
  });

  test("PAINT forecast: units over the horizon, then the plan with safety stock", () => {
    expect(say("Predict demand for PAINT for the next 4 months")).toBe(
      "Expect about 45 units of PAINT over the next 4 months (Jan–Apr 2026). Plan 72 units, including 26 units of safety stock.",
    );
  });

  test("refusal is one sentence after the fixed opener", () => {
    expect(say("what is the weather")).toBe(
      "I can't answer that from this data. I couldn't tell which measure you mean.",
    );
  });

  test("scalar rate names the filters and the base", () => {
    expect(query({ metric: "on_time_rate", filters: { carrier: ["FedEx", "UPS"] } })).toBe(
      "On-time rate for FedEx and UPS was 81.0% (132 of 163 orders) in 2025.",
    );
  });

  test("scalar average uses the delivery base, with the filter in the middle", () => {
    expect(say("average delivery time for DHL")).toBe(
      "Average delivery time for DHL was 3.52 days across 58 completed deliveries in 2025.",
    );
  });

  test("scalar money is gross, with the note at the end", () => {
    expect(query({ metric: "revenue", filters: { carrier: ["DHL"] } })).toMatch(
      /^Revenue for DHL was \$[\d,]+\.\d{2} in 2025 \(gross, before promo discounts\)\.$/,
    );
  });

  test("average delivery time caveat names completed deliveries and drops the 'of' count", () => {
    expect(say("average delivery time by carrier")).toBe(
      "GLS has the highest avg delivery days at 5.13 days in 2025, but on only 8 completed deliveries. Among carriers with 20+ completed deliveries, USPS is highest at 4.64 days.",
    );
  });

  test("money series says highest, not busiest", () => {
    expect(say("revenue trend")).toBe(
      "$13,695.87 revenue (gross) in 2025. The highest month was January ($2,183.15).",
    );
  });

  test("monthly series names the busiest month", () => {
    expect(query({ metric: "order_count", timeGrain: "month" })).toBe(
      "400 orders in 2025. The busiest month was January (75).",
    );
  });

  test("rate series gives the range of bucket values", () => {
    expect(query({ metric: "on_time_rate", timeGrain: "month" })).toMatch(
      /^On-time rate ranged from \d+\.\d% \(\w+\) to \d+\.\d% \(\w+\) in 2025\.$/,
    );
  });

  test("a bare carrier with no measure reads as its on-time rate", () => {
    expect(say("how is FedEx doing")).toBe("On-time rate for FedEx was 85.9% (73 of 85 orders) in 2025.");
  });

  test("refusal sentence is fixed", () => {
    expect(refusalAnswer("There is no carrier “Foo”.")).toBe(
      "I can't answer that from this data. There is no carrier “Foo”.",
    );
  });
});
