import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { getDashboard, loadOrders, type DashboardResponse, type Order } from "../src";

const CSV_PATH = join(import.meta.dir, "../../../data/mock_logistics_data.csv");
let orders: Order[];
let dash: DashboardResponse;
beforeAll(async () => {
  orders = await loadOrders(CSV_PATH);
  dash = getDashboard(orders);
});

describe("getDashboard", () => {
  test("KPIs match dataset.md", () => {
    expect(dash.kpis.totalOrders).toBe(400);
    expect(dash.kpis.deliveredOrders).toBe(304);
    expect(dash.kpis.delayedOrders).toBe(55);
    expect(dash.kpis.deliveryBase).toBe(370);
    expect(dash.kpis.onTimeRate).toBeCloseTo(0.822, 3);
    expect(dash.kpis.avgDeliveryDays).toBeCloseTo(3.83, 2);
  });

  test("orders by month: 12 zero-filled chronological buckets", () => {
    const rows = dash.ordersByMonth.rows;
    expect(rows).toHaveLength(12);
    expect(rows[0]).toMatchObject({ key: "2025-01", value: 75 });
    expect(rows[11]).toMatchObject({ key: "2025-12", value: 24 });
    expect(dash.ordersByMonth.chart.type).toBe("line");
  });

  test("delivery performance by month: totals reconcile and April has a zero delayed count", () => {
    const perf = dash.deliveryPerformanceByMonth;
    expect(perf).toHaveLength(12);
    expect(perf.reduce((s, m) => s + m.onTime, 0)).toBe(304);
    expect(perf.reduce((s, m) => s + m.delayed, 0)).toBe(55);
    expect(perf.reduce((s, m) => s + m.exception, 0)).toBe(11);
    expect(perf.find((m) => m.month === "2025-04")).toMatchObject({ onTime: 22, delayed: 0, exception: 1 });
  });

  test("delay rate by carrier: GLS first with base 8, 9 rows", () => {
    const rows = dash.delayRateByCarrier.rows;
    expect(rows).toHaveLength(9);
    expect(rows[0]).toMatchObject({ key: "GLS", base: 8 });
    expect(rows[0].value).toBeCloseTo(0.375, 3);
    expect(rows.at(-1)?.value).toBeCloseTo(0.069, 2);
  });

  test("orders by region sums to 400", () => {
    expect(dash.ordersByRegion.rows.reduce((s, r) => s + r.value, 0)).toBe(400);
  });

  test("definitions map has each metric's formula", () => {
    expect(dash.definitions.delay_rate).toBe("(delayed + exception) / (delivered + delayed + exception)");
    expect(Object.keys(dash.definitions)).toHaveLength(9);
  });
});
