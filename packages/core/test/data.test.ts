import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { datasetMeta, loadOrders, parseCsv } from "../src";

const CSV_PATH = join(import.meta.dir, "../../../data/mock_logistics_data.csv");
const HEADER =
  "client_id,order_id,order_date,delivery_date,carrier,origin_city,destination_city,status,sku,product_category,quantity,unit_price_usd,order_value_usd,is_promo,promo_discount_pct,region,warehouse";
const row = (over: Record<string, string> = {}) => {
  const base: Record<string, string> = {
    client_id: "CL-1",
    order_id: "ORD-1",
    order_date: "2025-03-08",
    delivery_date: "2025-03-10",
    carrier: "UPS",
    origin_city: "London, UK",
    destination_city: "Leeds, UK",
    status: "delivered",
    sku: "PAPER-0001",
    product_category: "PAPER",
    quantity: "2",
    unit_price_usd: "10.00",
    order_value_usd: "20.00",
    is_promo: "0",
    promo_discount_pct: "0",
    region: "UK",
    warehouse: "LON-FC1",
  };
  const merged = { ...base, ...over };
  return Object.values(merged)
    .map((v) => (v.includes(",") ? `"${v}"` : v))
    .join(",");
};

describe("parseCsv", () => {
  test("keeps quoted commas inside a field", () => {
    const [order] = parseCsv(`${HEADER}\n${row()}`);
    expect(order.origin_city).toBe("London, UK");
  });

  test("lead time uses UTC date math, so the US DST change (2025-03-09) does not shift it", () => {
    const [order] = parseCsv(`${HEADER}\n${row()}`);
    expect(order.lead_time_days).toBe(2);
  });

  test("throws with the row number on an unknown status", () => {
    const text = `${HEADER}\n${row()}\n${row({ status: "shipped" })}`;
    expect(() => parseCsv(text)).toThrow('row 3: unknown status "shipped"');
  });

  test("throws when delivery is before the order", () => {
    expect(() => parseCsv(`${HEADER}\n${row({ delivery_date: "2025-03-01" })}`)).toThrow(
      "row 2: delivery_date is before order_date",
    );
  });

  test("throws on an invalid calendar date", () => {
    expect(() => parseCsv(`${HEADER}\n${row({ order_date: "2025-02-30" })}`)).toThrow(/row 2: order_date/);
  });
});

describe("mock_logistics_data.csv", () => {
  test("loads 400 orders with the documented lead-time buckets", async () => {
    const orders = await loadOrders(CSV_PATH);
    expect(orders).toHaveLength(400);
    const lead = orders.map((o) => o.lead_time_days).filter((d): d is number => d !== null);
    expect(lead).toHaveLength(370);
    expect(lead.filter((d) => d >= 1 && d <= 2)).toHaveLength(98);
    expect(lead.filter((d) => d >= 3 && d <= 4)).toHaveLength(158);
    expect(lead.filter((d) => d >= 5)).toHaveLength(114);
  });

  test("datasetMeta: anchor, range, dimension values, categories, skus", async () => {
    const meta = datasetMeta(await loadOrders(CSV_PATH));
    expect(meta.anchorDate).toBe("2025-12-30");
    expect(meta.dateRange).toEqual({ from: "2025-01-01", to: "2025-12-30" });
    expect(meta.values.carrier).toHaveLength(9);
    expect(meta.values.region).toHaveLength(5);
    expect(meta.values.sku).toBeUndefined();
    expect(meta.categories).toHaveLength(8);
    expect(meta.skus).toHaveLength(355);
    expect(meta.skus[0].orders).toBeGreaterThanOrEqual(meta.skus[1].orders);
  });
});
