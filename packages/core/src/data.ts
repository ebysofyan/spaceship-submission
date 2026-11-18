import { isIsoDate, daysBetween } from "./dates";
import { DIMENSIONS, STATUSES, type Dimension, type Order, type Status } from "./types";

export interface DatasetMeta {
  anchorDate: string; // MAX(order_date)
  dateRange: { from: string; to: string };
  values: Partial<Record<Dimension, string[]>>; // every dimension except sku
  categories: string[];
  skus: Array<{ sku: string; orders: number }>; // most orders first
}

export const distinct = (xs: string[]) => [...new Set(xs)].sort();

export function dateSpan(orders: Order[]): { from: string; to: string } {
  const dates = orders.map((o) => o.order_date).sort();
  return { from: dates[0], to: dates[dates.length - 1] };
}

export function groupOrders(orders: Order[], key: (o: Order) => string): Map<string, Order[]> {
  const groups = new Map<string, Order[]>();
  for (const o of orders) {
    const k = key(o);
    const bucket = groups.get(k);
    if (bucket) bucket.push(o);
    else groups.set(k, [o]);
  }
  return groups;
}

// RFC 4180: quoted fields may hold commas, newlines and "" escapes. Returns every line, blank ones included.
function splitRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') cell += c;
      else if (text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const isStatus = (s: string): s is Status => (STATUSES as readonly string[]).includes(s);

// `row` is the 1-based file line, header = row 1, so errors point at the spreadsheet row.
function toOrder(r: Record<string, string>, row: number): Order {
  const fail = (msg: string) => new Error(`row ${row}: ${msg}`);
  const text = (name: string) => {
    const v = r[name];
    if (!v) throw fail(`missing ${name}`);
    return v;
  };
  const num = (name: string) => {
    const v = Number(text(name));
    if (!Number.isFinite(v)) throw fail(`${name} is not a number ("${r[name]}")`);
    return v;
  };
  const date = (name: string) => {
    const v = text(name);
    if (!isIsoDate(v)) throw fail(`${name} is not a YYYY-MM-DD date ("${v}")`);
    return v;
  };

  const status = text("status");
  if (!isStatus(status)) throw fail(`unknown status "${status}"`);
  const orderDate = date("order_date");
  const deliveryDate = r.delivery_date ? date("delivery_date") : null;
  const leadTime = deliveryDate === null ? null : daysBetween(orderDate, deliveryDate);
  if (leadTime !== null && leadTime < 0) throw fail("delivery_date is before order_date");
  const promo = text("is_promo");
  if (promo !== "0" && promo !== "1") throw fail(`is_promo must be 0 or 1 ("${promo}")`);

  return {
    client_id: text("client_id"),
    order_id: text("order_id"),
    order_date: orderDate,
    delivery_date: deliveryDate,
    carrier: text("carrier"),
    origin_city: text("origin_city"),
    destination_city: text("destination_city"),
    status,
    sku: text("sku"),
    product_category: text("product_category"),
    quantity: num("quantity"),
    unit_price_usd: num("unit_price_usd"),
    order_value_usd: num("order_value_usd"),
    is_promo: promo === "1" ? 1 : 0,
    promo_discount_pct: num("promo_discount_pct"),
    region: text("region"),
    warehouse: text("warehouse"),
    lead_time_days: leadTime,
  };
}

export function parseCsv(text: string): Order[] {
  const [header, ...lines] = splitRows(text.replace(/^\uFEFF/, ""));
  if (!header) throw new Error("CSV is empty");
  const orders = lines.flatMap((cells, i) => {
    if (cells.length === 1 && cells[0] === "") return [];
    const record = Object.fromEntries(header.map((name, j) => [name.trim(), cells[j] ?? ""]));
    return [toOrder(record, i + 2)];
  });
  if (orders.length === 0) throw new Error("CSV has no orders");
  return orders;
}

export async function loadOrders(path: string): Promise<Order[]> {
  return parseCsv(await Bun.file(path).text());
}

export function datasetMeta(orders: Order[]): DatasetMeta {
  const span = dateSpan(orders);
  const values = Object.fromEntries(
    DIMENSIONS.filter((d) => d !== "sku").map((d) => [d, distinct(orders.map((o) => o[d]))]),
  ) as Partial<Record<Dimension, string[]>>;
  const skus = [...groupOrders(orders, (o) => o.sku)]
    .map(([sku, xs]) => ({ sku, orders: xs.length }))
    .sort((a, b) => b.orders - a.orders || (a.sku < b.sku ? -1 : 1));
  return {
    anchorDate: span.to,
    dateRange: span,
    values,
    categories: distinct(orders.map((o) => o.product_category)),
    skus,
  };
}
