import { describe, expect, test } from "bun:test";
import { loadDataset } from "../src/data";
import { interpretRules } from "../src/ai/rules";

const { meta } = await loadDataset();
const route = (q: string) => interpretRules(q, meta);

describe("rules router", () => {
  test("delayed orders by week for the last 3 months", () => {
    expect(route("Show delayed orders by week for the last 3 months")).toMatchObject({
      tool: "query",
      source: "rules",
      args: { metric: "delayed_count", timeGrain: "week", dateRange: { last: 3, unit: "month" } },
    });
  });

  test("highest delay rate by carrier", () => {
    expect(route("Which carrier has the highest delay rate?")).toMatchObject({
      tool: "query",
      args: { metric: "delay_rate", groupBy: "carrier", sort: "desc" },
    });
  });

  test("late orders last month", () => {
    expect(route("How many orders were delivered late last month?")).toMatchObject({
      tool: "query",
      args: { metric: "delayed_count", dateRange: { last: 1, unit: "month" } },
    });
  });

  test("on-time rate by region", () => {
    expect(route("What is the on-time rate by region?")).toMatchObject({
      tool: "query",
      args: { metric: "on_time_rate", groupBy: "region", sort: "desc" },
    });
  });

  test("forecast phrasing with a category", () => {
    expect(route("Predict demand for PAINT for the next 4 months")).toMatchObject({
      tool: "forecast",
      args: { target: { kind: "category", value: "PAINT" }, horizonMonths: 4 },
    });
  });

  test("forecast phrasing with a SKU defaults to 4 months", () => {
    const sku = meta.skus[0].sku;
    expect(route(`How much inventory should I plan for SKU ${sku}?`)).toMatchObject({
      tool: "forecast",
      args: { target: { kind: "sku", value: sku }, horizonMonths: 4 },
    });
  });

  test("off-topic question is unsupported", () => {
    expect(route("what's the weather")).toMatchObject({ tool: "unsupported", source: "rules" });
  });

  test("unknown carrier value is refused, not silently dropped", () => {
    const r = route("delay rate for carrier Foo");
    expect(r.tool).toBe("unsupported");
    expect(r.reasoning).toContain('"Foo"');
  });

  test("unsupported range is refused, not answered for the whole dataset", () => {
    expect(route("Revenue last quarter").tool).toBe("unsupported");
  });

  test("category plurals match for forecasts", () => {
    expect(route("How much inventory should I plan for markers?")).toMatchObject({
      tool: "forecast",
      args: { target: { kind: "category", value: "MARKER" }, horizonMonths: 4 },
    });
    expect(route("Predict demand for brushes next 2 months")).toMatchObject({
      tool: "forecast",
      args: { target: { kind: "category", value: "BRUSH" }, horizonMonths: 2 },
    });
  });

  test("category plurals match as product_category filters", () => {
    expect(route("Revenue for markers")).toMatchObject({
      tool: "query",
      args: { metric: "revenue", filters: { product_category: ["MARKER"] } },
    });
  });

  test("unknown SKU with a real category prefix suggests that category's real SKUs", () => {
    // PAINT-0001 is not in the dataset; the suggestion must be the 5 PAINT SKUs with the most orders.
    const top5 = meta.skus.filter((s) => s.sku.startsWith("PAINT-")).slice(0, 5).map((s) => s.sku);
    for (const q of ["How much inventory should I plan for SKU PAINT-0001?", "Predict demand for PAINT-0001"]) {
      const r = route(q);
      expect(r.tool).toBe("unsupported");
      expect(r.reasoning).toContain("SKU PAINT-0001 does not exist");
      expect(r.reasoning).toContain("Try: Predict demand for PAINT");
      expect(r.reasoning).toContain(`Real PAINT SKUs, most orders first: ${top5.join(", ")}`);
    }
  });

  test("filter values are found in free text", () => {
    expect(route("Revenue for FedEx in EU")).toMatchObject({
      tool: "query",
      args: { metric: "revenue", filters: { carrier: ["FedEx"], region: ["EU"] } },
    });
  });
});
