import { describe, expect, test } from "bun:test";
import { runQuery } from "@app/core";
import { loadDataset } from "../src/data";
import { interpretRules } from "../src/ai/rules";

const { meta, orders } = await loadDataset();
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
    expect(route("what's the weather")).toMatchObject({
      tool: "unsupported",
      source: "rules",
      reasoning: "I couldn't tell which measure you mean.",
    });
  });

  test("unknown carrier value is refused, not silently dropped", () => {
    const r = route("delay rate for carrier Foo");
    expect(r.tool).toBe("unsupported");
    expect(r.reasoning).toBe("There is no carrier “Foo”.");
  });

  test("unsupported range is refused, not answered for the whole dataset", () => {
    const r = route("Revenue last quarter");
    expect(r.tool).toBe("unsupported");
    expect(r.reasoning).toBe("“last quarter” isn't supported yet; try a month name or “last 3 months”.");
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

  test("unknown SKU with a real category prefix suggests that category", () => {
    for (const q of ["How much inventory should I plan for SKU PAINT-0001?", "Predict demand for PAINT-0001"]) {
      const r = route(q);
      expect(r.tool).toBe("unsupported");
      expect(r.reasoning).toBe("There is no SKU PAINT-0001. Try “Predict demand for PAINT”.");
    }
  });

  test("unknown SKU with no known category has no suggestion", () => {
    expect(route("Predict demand for ZZZ-0001").reasoning).toBe("There is no SKU ZZZ-0001.");
  });

  test("filter values are found in free text", () => {
    expect(route("Revenue for FedEx in EU")).toMatchObject({
      tool: "query",
      args: { metric: "revenue", filters: { carrier: ["FedEx"], region: ["EU"] } },
    });
  });

  test("reasoning is plain English with no env var or internal prefix", () => {
    expect(route("Which carrier has the highest delay rate?").reasoning).toBe(
      "Matched “delay rate”, grouped by carrier.",
    );
    expect(route("Show delayed orders by week for the last 3 months").reasoning).toBe(
      "Matched “delayed”, by week, last 3 months.",
    );
    expect(route("Predict demand for PAINT for the next 4 months").reasoning).toBe(
      "Forecast for category PAINT, 4 months.",
    );
  });

  test("range phrases echo in canonical case in the reasoning", () => {
    expect(route("orders by region in Q1").reasoning).toBe("Matched “orders”, grouped by region, Q1.");
    expect(route("orders in november").reasoning).toBe("Matched “orders”, November.");
  });

  test("trend, over time and monthly mean a monthly series", () => {
    for (const q of ["revenue trend", "orders over time", "delayed orders per month", "monthly delayed orders"]) {
      expect(route(q)).toMatchObject({ tool: "query", args: { timeGrain: "month" } });
    }
  });

  test("an explicit week still wins over trend", () => {
    expect(route("weekly revenue trend")).toMatchObject({ args: { timeGrain: "week" } });
  });

  test("top N sets the limit and keeps descending", () => {
    expect(route("top 5 destinations by orders")).toMatchObject({
      tool: "query",
      args: { metric: "order_count", groupBy: "destination_city", sort: "desc", limit: 5 },
    });
    expect(route("top five destinations by orders").reasoning).toBe(
      "Matched “orders”, grouped by destination city, top 5.",
    );
  });

  test("bottom N sets the limit and sorts ascending", () => {
    expect(route("bottom 3 carriers by on-time rate")).toMatchObject({
      args: { metric: "on_time_rate", groupBy: "carrier", sort: "asc", limit: 3 },
    });
    expect(route("bottom 3 carriers by on-time rate").reasoning).toContain("bottom 3");
  });

  test("top without a number keeps the full list", () => {
    const r = route("top carriers by delay rate");
    expect(r).toMatchObject({ args: { groupBy: "carrier", sort: "desc" } });
    expect(r.tool === "query" && r.args.limit).toBeFalsy();
  });

  test("compare two values of one dimension groups by it and filters to both", () => {
    const r = route("compare UPS and FedEx on-time rate");
    expect(r.tool).toBe("query");
    if (r.tool !== "query") return;
    expect(r.args).toMatchObject({ metric: "on_time_rate", groupBy: "carrier" });
    expect([...(r.args.filters?.carrier ?? [])].sort()).toEqual(["FedEx", "UPS"]);
  });

  test("vs between regions groups by region", () => {
    expect(route("EU vs UK orders")).toMatchObject({
      tool: "query",
      args: { metric: "order_count", groupBy: "region", filters: { region: ["EU", "UK"] } },
    });
  });

  test("a carrier with no measure gets the on-time rate, not a refusal", () => {
    for (const q of ["how is FedEx doing", "FedEx performance"]) {
      expect(route(q)).toMatchObject({
        tool: "query",
        source: "rules",
        args: { metric: "on_time_rate", filters: { carrier: ["FedEx"] } },
      });
    }
  });

  test("canceled is a status filter, and the count is 3", () => {
    const r = route("How many orders were canceled?");
    expect(r).toMatchObject({ tool: "query", args: { metric: "order_count", filters: { status: ["canceled"] } } });
    expect(r.tool === "query" && runQuery(orders, r.args).value).toBe(3);
  });

  test("in transit is a status filter, and the count is 27", () => {
    const r = route("How many orders are in transit?");
    expect(r).toMatchObject({ tool: "query", args: { metric: "order_count", filters: { status: ["in_transit"] } } });
    expect(r.tool === "query" && runQuery(orders, r.args).value).toBe(27);
  });

  test("exceptions by carrier: status filter, grouped by carrier, counting orders", () => {
    expect(route("show me exceptions by carrier")).toMatchObject({
      tool: "query",
      args: { metric: "order_count", groupBy: "carrier", filters: { status: ["exception"] } },
    });
  });

  test("from a city is an origin, to a city is a destination, full names still work", () => {
    expect(route("show orders from London")).toMatchObject({
      tool: "query",
      args: { metric: "order_count", filters: { origin_city: ["London, UK"] } },
    });
    expect(route("orders to London")).toEqual({
      tool: "unsupported",
      source: "rules",
      reasoning: "No orders ship to London. London, UK is an origin city; try “orders from London”.",
    });
    expect(route("deliveries to Leeds")).toMatchObject({
      tool: "query",
      args: { metric: "delivered_count", filters: { destination_city: ["Leeds, UK"] } },
    });
    expect(route("orders from London, UK")).toMatchObject({
      tool: "query",
      args: { filters: { origin_city: ["London, UK"] } },
    });
  });

  test("a city on the wrong side of to or from is refused with a hint, not sent to core", () => {
    expect(route("deliveries from Leeds")).toEqual({
      tool: "unsupported",
      source: "rules",
      reasoning: "No orders ship from Leeds. Leeds, UK is a destination city; try “orders to Leeds”.",
    });
  });

  test("deliver as a verb counts deliveries, while delivery time stays a time", () => {
    expect(route("How many orders did FedEx deliver in October?")).toMatchObject({
      tool: "query",
      args: {
        metric: "delivered_count",
        filters: { carrier: ["FedEx"] },
        dateRange: { from: "2025-10-01", to: "2025-10-31" },
      },
    });
    expect(route("delivery time for DHL")).toMatchObject({
      args: { metric: "avg_delivery_days" },
    });
  });

  test("several groupings: the first named is used, and the reasoning says the rest were dropped", () => {
    const r = route("orders by carrier and region");
    expect(r).toMatchObject({ tool: "query", args: { groupBy: "carrier" } });
    expect(r.reasoning).toBe("Matched “orders”, one grouping per question, so grouped by carrier only.");
  });

  test("reliable and best mean the on-time rate by carrier, highest first", () => {
    for (const q of ["Which carrier is the most reliable?", "Which carrier is the best?"]) {
      expect(route(q)).toMatchObject({
        tool: "query",
        args: { metric: "on_time_rate", groupBy: "carrier", sort: "desc" },
      });
    }
  });

  test("worst and unreliable mean the delay rate by carrier, highest first", () => {
    for (const q of ["Which carrier is the worst?", "Which carrier is the most unreliable?"]) {
      expect(route(q)).toMatchObject({
        tool: "query",
        args: { metric: "delay_rate", groupBy: "carrier", sort: "desc" },
      });
    }
  });

  test("slowest and fastest mean delivery time by warehouse", () => {
    expect(route("Which warehouse is slowest?")).toMatchObject({
      tool: "query",
      args: { metric: "avg_delivery_days", groupBy: "warehouse", sort: "desc" },
    });
    expect(route("Which warehouse is fastest?")).toMatchObject({
      tool: "query",
      args: { metric: "avg_delivery_days", groupBy: "warehouse", sort: "asc" },
    });
  });

  test("promotions are refused, not answered without the filter", () => {
    expect(route("promo orders count")).toEqual({
      tool: "unsupported",
      source: "rules",
      reasoning: "Promotions aren't a supported filter yet.",
    });
  });

  test("forecasts beyond 12 months are refused with the range, not the core error", () => {
    expect(route("predict demand for next 24 months")).toEqual({
      tool: "unsupported",
      source: "rules",
      reasoning: "Forecasts cover 1 to 12 months.",
    });
  });
});
