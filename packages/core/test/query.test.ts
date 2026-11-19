import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { allBuckets, loadOrders, resolveRange, runQuery, type Order } from "../src";

const CSV_PATH = join(import.meta.dir, "../../../data/mock_logistics_data.csv");
let orders: Order[];
beforeAll(async () => {
  orders = await loadOrders(CSV_PATH);
});

const run = (spec: Parameters<typeof runQuery>[1]) => runQuery(orders, spec);

describe("scalar metrics (dataset.md reference values)", () => {
  test("totals and rates", () => {
    expect(run({ metric: "order_count" }).value).toBe(400);
    expect(run({ metric: "delivered_count" }).value).toBe(304);
    expect(run({ metric: "delayed_count" }).value).toBe(55);

    const onTime = run({ metric: "on_time_rate" });
    expect(onTime.value).toBeCloseTo(304 / 370, 6);
    expect(onTime.base).toBe(370);
    expect(onTime.isRate).toBe(true);
  });

  test("average delivery time: all delivery-base orders and delivered only", () => {
    expect(run({ metric: "avg_delivery_days" }).value).toBeCloseTo(3.83, 2);
    const delivered = run({ metric: "avg_delivery_days", filters: { status: ["delivered"] } });
    expect(delivered.value).toBeCloseTo(3.25, 2);
  });

  test("average order value and units", () => {
    expect(run({ metric: "avg_order_value" }).value).toBeCloseTo(34.24, 2);
    expect(run({ metric: "units" }).value).toBe(1310);
  });

  test("filter matching is case-insensitive", () => {
    expect(run({ metric: "order_count", filters: { carrier: ["gls"] } }).value).toBe(9);
  });

  test("empty filter result gives 0 with base 0 and a note, never NaN", () => {
    const r = run({ metric: "on_time_rate", dateRange: { from: "2024-01-01", to: "2024-12-31" } });
    expect(r.value).toBe(0);
    expect(r.base).toBe(0);
    expect(r.matchedOrders).toBe(0);
    expect(r.notes).toContain("No orders match these filters");
    expect(r.chart.type).toBe("kpi");
  });
});

describe("baseline: the same metric over every order", () => {
  test("filtered average delivery time carries the overall figure and its base", () => {
    const r = run({ metric: "avg_delivery_days", filters: { region: ["EU"] } });
    expect(r.value).toBeCloseTo(4.15, 2);
    expect(r.baseline).toEqual({ value: expect.any(Number), base: 370, matchedOrders: 400 });
    expect(r.baseline?.value).toBeCloseTo(3.83, 2);
  });

  test("date-ranged count compares with the whole dataset", () => {
    const r = run({ metric: "delayed_count", dateRange: { last: 1, unit: "month" } });
    expect(r.value).toBe(4);
    expect(r.baseline).toEqual({ value: 55, base: null, matchedOrders: 400 });
  });

  test("no filter and no dateRange: no baseline", () => {
    expect(run({ metric: "delayed_count" }).baseline).toBeNull();
    expect(run({ metric: "delayed_count", filters: { carrier: [] } }).baseline).toBeNull();
  });

  test("grouped and time-bucketed results have no baseline", () => {
    expect(run({ metric: "delay_rate", groupBy: "carrier", filters: { region: ["EU"] } }).baseline).toBeNull();
    expect(run({ metric: "order_count", timeGrain: "month", dateRange: { last: 3, unit: "month" } }).baseline).toBeNull();
  });
});

describe("time buckets", () => {
  test("monthly order counts match dataset.md, zero-filled and chronological", () => {
    const rows = run({ metric: "order_count", timeGrain: "month" }).rows;
    expect(rows.map((r) => r.value)).toEqual([75, 36, 46, 25, 29, 21, 42, 34, 18, 26, 24, 24]);
    expect(rows.map((r) => r.key)[0]).toBe("2025-01");
    expect(rows.at(-1)?.key).toBe("2025-12");
  });

  test("delayed orders per month keep 2025-04 as an explicit zero", () => {
    const rows = run({ metric: "delayed_count", timeGrain: "month" }).rows;
    expect(rows.map((r) => r.value)).toEqual([12, 4, 5, 0, 7, 4, 7, 4, 2, 3, 4, 3]);
    expect(rows.find((r) => r.key === "2025-04")).toEqual({ key: "2025-04", value: 0, base: null, orders: 25 });
  });

  test("weekly buckets over last 3 months are Monday-keyed and include zero weeks", () => {
    const r = run({ metric: "order_count", timeGrain: "week", dateRange: { last: 3, unit: "month" } });
    expect(r.resolvedRange).toEqual({ from: "2025-09-01", to: "2025-11-30" });
    expect(r.rows[0].key).toBe("2025-09-01");
    for (const row of r.rows) {
      expect(new Date(`${row.key}T00:00:00Z`).getUTCDay()).toBe(1);
    }
    expect(r.rows).toHaveLength(13);
    expect(r.rows.reduce((sum, row) => sum + row.value, 0)).toBe(r.matchedOrders);
  });

  test("an empty week between two orders is zero-filled", () => {
    // The real data has no empty weeks, so use two synthetic orders three weeks apart.
    const at = (order_date: string) => ({ ...orders[0], order_date });
    const r = runQuery([at("2025-09-03"), at("2025-09-22")], { metric: "order_count", timeGrain: "week" });
    expect(r.rows.map((row) => [row.key, row.value])).toEqual([
      ["2025-09-01", 1],
      ["2025-09-08", 0],
      ["2025-09-15", 0],
      ["2025-09-22", 1],
    ]);
  });

  test("time buckets are never cut by the limit", () => {
    expect(run({ metric: "order_count", timeGrain: "month", limit: 2 }).rows).toHaveLength(12);
  });
});

describe("group by", () => {
  test("delay rate by carrier: GLS first (small base), DHL last, 9 rows", () => {
    const r = run({ metric: "delay_rate", groupBy: "carrier", sort: "desc" });
    expect(r.rows).toHaveLength(9);
    expect(r.rows[0]).toMatchObject({ key: "GLS", base: 8, orders: 9 });
    expect(r.rows[0].value).toBeCloseTo(0.375, 3);
    expect(r.rows.at(-1)?.key).toBe("DHL");
    expect(r.rows.at(-1)?.value).toBeCloseTo(0.069, 2);
    expect(r.chart.type).toBe("bar");
    expect(r.notes).toContain("GLS: small base (8 orders)");
  });

  test("more than 15 groups renders as a table", () => {
    expect(run({ metric: "order_count", groupBy: "sku" }).chart.type).toBe("table");
  });

  test("limit cuts groups and says so", () => {
    const r = run({ metric: "order_count", groupBy: "sku", limit: 5 });
    expect(r.rows).toHaveLength(5);
    expect(r.notes).toContain("Showing top 5 of 355 sku values");
  });
});

describe("dateRange resolution", () => {
  const anchor = "2025-12-30";

  test("last 1 month = Nov 2025", () => {
    expect(resolveRange({ last: 1, unit: "month" }, anchor)).toEqual({ from: "2025-11-01", to: "2025-11-30" });
  });

  test("last 3 months = Sep-Nov 2025", () => {
    expect(resolveRange({ last: 3, unit: "month" }, anchor)).toEqual({ from: "2025-09-01", to: "2025-11-30" });
  });

  test("last N weeks = full ISO weeks before the anchor's week", () => {
    // 2025-12-30 is a Tuesday; its week starts Mon 2025-12-29.
    expect(resolveRange({ last: 1, unit: "week" }, anchor)).toEqual({ from: "2025-12-22", to: "2025-12-28" });
  });

  test("last N days = N days ending at the anchor, inclusive", () => {
    expect(resolveRange({ last: 7, unit: "day" }, anchor)).toEqual({ from: "2025-12-24", to: "2025-12-30" });
  });

  test("absolute range is validated", () => {
    expect(resolveRange({ from: "2025-02-01", to: "2025-02-28" }, anchor)).toEqual({
      from: "2025-02-01",
      to: "2025-02-28",
    });
    expect(() => resolveRange({ from: "2025-02-30", to: "2025-03-01" }, anchor)).toThrow(/YYYY-MM-DD/);
    expect(() => resolveRange({ from: "2025-03-02", to: "2025-03-01" }, anchor)).toThrow(/after/);
    expect(() => resolveRange({ last: 0, unit: "day" }, anchor)).toThrow(/positive integer/);
  });

  test("bucket keys: week = Monday, month = YYYY-MM", () => {
    expect(allBuckets("2025-09-03", "2025-09-20", "week")).toEqual(["2025-09-01", "2025-09-08", "2025-09-15"]);
    expect(allBuckets("2025-11-30", "2026-01-02", "month")).toEqual(["2025-11", "2025-12", "2026-01"]);
  });
});

describe("validation errors", () => {
  test("unknown carrier filter lists known values", () => {
    expect(() => run({ metric: "order_count", filters: { carrier: ["Foo"] } })).toThrow(
      /Unknown carrier value "Foo"\. Known: /,
    );
  });

  test("groupBy + timeGrain is rejected", () => {
    expect(() => run({ metric: "order_count", groupBy: "carrier", timeGrain: "month" })).toThrow(
      /groupBy or timeGrain/,
    );
  });

  test("unknown metric, dimension, and out-of-range limit are rejected", () => {
    expect(() => run({ metric: "profit" as never })).toThrow(/Unknown metric "profit"/);
    expect(() => run({ metric: "order_count", groupBy: "color" as never })).toThrow(/Unknown dimension "color"/);
    expect(() => run({ metric: "order_count", groupBy: "carrier", limit: 0 })).toThrow(/limit must be/);
    expect(() => run({ metric: "order_count", groupBy: "carrier", limit: 51 })).toThrow(/limit must be/);
  });
});

describe("sample orders", () => {
  test("first 100 matched orders sorted by order_date", () => {
    const r = run({ metric: "order_count", filters: { status: ["delivered"] } });
    expect(r.matchedOrders).toBe(304);
    expect(r.sampleOrders).toHaveLength(100);
    const dates = r.sampleOrders.map((o) => o.order_date);
    expect([...dates].sort()).toEqual(dates);
  });
});
