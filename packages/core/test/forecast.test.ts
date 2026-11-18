/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { loadOrders } from "../src/data";
import { runForecast, zScore } from "../src/forecast";
import type { ForecastSpec, Order } from "../src/types";

const CSV = fileURLToPath(new URL("../../../data/mock_logistics_data.csv", import.meta.url));
const orders: Order[] = await loadOrders(CSV);

const ALL: ForecastSpec = { target: { kind: "all" }, horizonMonths: 4 };
const sumUnits = (xs: Order[]) => xs.reduce((a, o) => a + o.quantity, 0);
const categories = [...new Set(orders.map((o) => o.product_category))].sort();

describe("runForecast history", () => {
  test("all-target history has 12 months and sums to 1310 units", () => {
    const { history } = runForecast(orders, ALL);
    expect(history).toHaveLength(12);
    expect(history[0].month).toBe("2025-01");
    expect(history[11].month).toBe("2025-12");
    expect(history.reduce((a, h) => a + h.units, 0)).toBe(1310);
  });

  test("each category's history sums to its SUM(quantity)", () => {
    for (const category of categories) {
      const { history } = runForecast(orders, { target: { kind: "category", value: category }, horizonMonths: 4 });
      const expected = sumUnits(orders.filter((o) => o.product_category === category));
      expect(history.reduce((a, h) => a + h.units, 0)).toBe(expected);
      expect(history).toHaveLength(12);
    }
  });

  test("category match is case-insensitive", () => {
    const upper = runForecast(orders, { target: { kind: "category", value: "paint" }, horizonMonths: 2 });
    const lower = runForecast(orders, { target: { kind: "category", value: "PAINT" }, horizonMonths: 2 });
    expect(upper.history).toEqual(lower.history);
  });
});

describe("runForecast output", () => {
  test("forecast length equals horizon and months continue after 2025-12", () => {
    const { forecast } = runForecast(orders, { target: { kind: "all" }, horizonMonths: 4 });
    expect(forecast.map((f) => f.month)).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"]);
    expect(runForecast(orders, { target: { kind: "all" }, horizonMonths: 12 }).forecast).toHaveLength(12);
  });

  test("forecasts and lower bounds are never negative", () => {
    for (const category of categories) {
      const { forecast } = runForecast(orders, { target: { kind: "category", value: category }, horizonMonths: 12 });
      for (const f of forecast) {
        expect(f.units).toBeGreaterThanOrEqual(0);
        expect(f.lower).toBeGreaterThanOrEqual(0);
        expect(f.upper).toBeGreaterThanOrEqual(f.lower);
      }
    }
  });

  test("recommended inventory covers forecast units", () => {
    const { recommendation } = runForecast(orders, { target: { kind: "all" }, horizonMonths: 6 });
    expect(recommendation.recommendedInventory).toBeGreaterThanOrEqual(recommendation.forecastUnits);
    expect(recommendation.safetyStock).toBeGreaterThanOrEqual(0);
  });

  test("chosen method has the lowest holdout MAE", () => {
    for (const category of categories) {
      const result = runForecast(orders, { target: { kind: "category", value: category }, horizonMonths: 3 });
      const best = Math.min(...result.methodsCompared.map((m) => m.mae));
      const chosen = result.methodsCompared.find((m) => m.method === result.method);
      expect(chosen?.mae).toBe(best);
    }
  });

  test("safety stock uses the requested service level", () => {
    const low = runForecast(orders, { target: { kind: "all" }, horizonMonths: 4, serviceLevel: 0.5 });
    const high = runForecast(orders, { target: { kind: "all" }, horizonMonths: 4, serviceLevel: 0.99 });
    expect(low.recommendation.safetyStock).toBe(0);
    expect(high.recommendation.safetyStock).toBeGreaterThan(0);
  });
});

describe("runForecast warnings and errors", () => {
  test("sparse SKU (one order) warns and suggests its category", () => {
    const counts = new Map<string, number>();
    for (const o of orders) counts.set(o.sku, (counts.get(o.sku) ?? 0) + 1);
    const sku = orders.find((o) => counts.get(o.sku) === 1)!;
    const { warnings } = runForecast(orders, { target: { kind: "sku", value: sku.sku }, horizonMonths: 4 });
    expect(warnings).toContain(
      `Only 1 month(s) of history for SKU ${sku.sku}; forecast is unreliable — consider category ${sku.product_category} instead.`,
    );
  });

  test("invalid horizon throws", () => {
    for (const horizonMonths of [0, 13, 2.5, Number.NaN]) {
      expect(() => runForecast(orders, { target: { kind: "all" }, horizonMonths })).toThrow();
    }
  });

  test("out-of-range service level throws", () => {
    expect(() => runForecast(orders, { ...ALL, serviceLevel: 0.999 })).toThrow();
    expect(() => runForecast(orders, { ...ALL, serviceLevel: Number.NaN })).toThrow();
  });

  test("unknown category throws with the known list", () => {
    expect(() => runForecast(orders, { target: { kind: "category", value: "nope" }, horizonMonths: 4 })).toThrow(
      `Unknown category "nope". Known: ${categories.join(", ")}`,
    );
  });
});

describe("zScore", () => {
  test("z(0.95) is 1.645", () => {
    expect(zScore(0.95).toFixed(3)).toBe("1.645");
  });

  test("z(0.5) is 0 and z(0.99) is 2.326", () => {
    expect(zScore(0.5)).toBeCloseTo(0, 6);
    expect(zScore(0.99).toFixed(3)).toBe("2.326");
  });
});
