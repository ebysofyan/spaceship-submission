import type { Dimension, ForecastResult, ForecastSpec, Metric, QueryResult } from "@app/core";

// Sentences are built from core results only. This file formats numbers, it never computes them.

type Row = QueryResult["rows"][number];
type Range = { from: string; to: string };

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
// Groups with fewer orders than this are too small to rank on their own.
const SMALL_BASE = 20;

const count = (v: number) => Math.round(v).toLocaleString("en-US");
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const days = (v: number) => `${v.toFixed(2)} days`;
const money = (v: number) =>
  `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const FORMAT: Record<Metric, (v: number) => string> = {
  order_count: count,
  delivered_count: count,
  delayed_count: count,
  on_time_rate: pct,
  delay_rate: pct,
  avg_delivery_days: days,
  units: count,
  revenue: money,
  avg_order_value: money,
};

const DIM_PLURAL: Record<Dimension, string> = {
  carrier: "carriers",
  region: "regions",
  warehouse: "warehouses",
  origin_city: "origin cities",
  destination_city: "destinations",
  product_category: "product categories",
  sku: "SKUs",
  status: "statuses",
  client_id: "clients",
};

const join = (...parts: string[]) => parts.filter(Boolean).join(" ");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const listAnd = (xs: string[]) =>
  xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
const plural = (n: number, word: string) => `${count(n)} ${Math.round(n) === 1 ? word : `${word}s`}`;
const be = (n: number) => (Math.round(n) === 1 ? "was" : "were");

// Rates and averages are per base, so they cannot be summed or ranked without their base.
const isRatio = (q: QueryResult) => q.isRate || q.spec.metric.startsWith("avg_");

// Dates: "1 Sep", "November 2025", "2025-01" -> "January". Keys come from core as YYYY-MM-DD or YYYY-MM.
const monthName = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1];
const shortDate = (d: string) => `${Number(d.slice(8))} ${monthName(d).slice(0, 3)}`;
const endOfMonth = (d: string) => new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0)).toISOString().slice(0, 10);
const isFullMonth = (r: Range) => r.from.endsWith("-01") && r.to === endOfMonth(r.from);

// "1 Sep – 30 Nov 2025"; the year goes on the start too only when the years differ.
function spanText(r: Range): string {
  const [y1, y2] = [r.from.slice(0, 4), r.to.slice(0, 4)];
  return `${shortDate(r.from)}${y1 === y2 ? "" : ` ${y1}`} – ${shortDate(r.to)} ${y2}`;
}

// "Jan–Apr 2026" for forecast months.
function monthSpan(first: string, last: string): string {
  const [y1, y2] = [first.slice(0, 4), last.slice(0, 4)];
  if (first === last) return `${monthName(first).slice(0, 3)} ${y1}`;
  return `${monthName(first).slice(0, 3)}${y1 === y2 ? "" : ` ${y1}`}–${monthName(last).slice(0, 3)} ${y2}`;
}

// The period in a sentence. No dateRange means the whole dataset.
function when(q: QueryResult, data: Range): string {
  const r = q.spec.dateRange && q.resolvedRange;
  if (!r) return `in ${data.from.slice(0, 4)}`;
  if (isFullMonth(r)) return `in ${monthName(r.from)} ${r.from.slice(0, 4)}`;
  return `from ${spanText(r)}`;
}

// The filters the query applied, e.g. "for FedEx and UPS".
function who(q: QueryResult): string {
  const values = Object.values(q.spec.filters ?? {}).flatMap((v) => v ?? []);
  return values.length ? `for ${listAnd(values)}` : "";
}

// One result, one sentence. Each entry gets its value, base, filter phrase and period.
type Scalar = (v: number, base: number, w: string, t: string) => string;
const SCALAR: Record<Metric, Scalar> = {
  order_count: (v, _b, w, t) => join(`${plural(v, "order")} ${be(v)} placed`, w, t),
  delivered_count: (v, _b, w, t) => join(`${plural(v, "order")} ${be(v)} delivered`, w, t),
  delayed_count: (v, _b, w, t) => join(`${plural(v, "order")} ${be(v)} delayed`, w, t),
  units: (v, _b, w, t) => join(`${plural(v, "unit")} ${be(v)} shipped`, w, t),
  on_time_rate: (v, b, w, t) => join(join("On-time rate", w), `was ${pct(v)} (${Math.round(v * b)} of ${b} orders)`, t),
  delay_rate: (v, b, w, t) => join(join("Delay rate", w), `was ${pct(v)} (${Math.round(v * b)} of ${b} orders)`, t),
  avg_delivery_days: (v, b, w, t) =>
    join(join("Average delivery time", w), `was ${days(v)} across ${plural(b, "delivered order")}`, t),
  revenue: (v, _b, w, t) => `${join(join("Revenue", w), `was ${money(v)}`, t)} (gross, before promo discounts)`,
  avg_order_value: (v, _b, w, t) => join(join("Average order value", w), `was ${money(v)}`, t),
};

function scalarAnswer(q: QueryResult, data: Range): string {
  return `${SCALAR[q.spec.metric](q.value ?? 0, q.base ?? 0, who(q), when(q, data))}.`;
}

// Counts: top 3 with the rest. Rates and averages: the leader, with a caveat when its base is small.
function groupAnswer(q: QueryResult, dim: Dimension): string {
  const [top, ...others] = q.rows;
  const label = q.metricLabel.toLowerCase();
  const fmt = FORMAT[q.spec.metric];
  const lowest = q.spec.sort === "asc";
  const w = who(q);
  const prefix = w ? `${cap(w)}, ` : "";

  if (!isRatio(q)) {
    const rest = others.slice(0, 2).map((r) => `${r.key} (${fmt(r.value)})`);
    const tail = rest.length ? `, followed by ${listAnd(rest)}` : "";
    return `${prefix}${top.key} has the ${lowest ? "fewest" : "most"} ${label} (${fmt(top.value)})${tail}.`;
  }

  const sup = lowest ? "lowest" : "highest";
  const base = top.base ?? 0;
  const small = base < SMALL_BASE;
  let text = `${prefix}${top.key} has the ${sup} ${label} at ${fmt(top.value)}, ${small ? "but on only" : "on"} ${base} orders.`;
  const leader = q.rows.find((r) => (r.base ?? 0) >= SMALL_BASE);
  if (small && leader) {
    const leaderBase = leader.base ?? 0;
    text += ` Among ${DIM_PLURAL[dim]} with ${SMALL_BASE}+ orders, ${leader.key} is ${sup} at ${fmt(leader.value)} (${Math.round(leader.value * leaderBase)} of ${leaderBase}).`;
  }
  return text;
}

const busiest = (grain: string, name: (r: Row) => string, fmt: (v: number) => string, r: Row) =>
  grain === "month"
    ? `The busiest month was ${name(r)} (${fmt(r.value)}).`
    : `The busiest ${grain} (${grain === "week" ? "starting " : ""}${name(r)}) had ${fmt(r.value)}.`;

// Counts: total, then the busiest bucket. Rates and averages: the range of bucket values.
function seriesAnswer(q: QueryResult, grain: string, data: Range): string {
  const fmt = FORMAT[q.spec.metric];
  const w = who(q);
  const t = when(q, data);
  const name = (r: Row) => (grain === "month" ? monthName(r.key) : shortDate(r.key));

  if (isRatio(q)) {
    // Empty buckets have no value to rank, so skip them.
    const live = q.rows.filter((r) => r.orders > 0);
    const lo = live.reduce((a, b) => (b.value < a.value ? b : a));
    const hi = live.reduce((a, b) => (b.value > a.value ? b : a));
    const range = `ranged from ${fmt(lo.value)} (${name(lo)}) to ${fmt(hi.value)} (${name(hi)})`;
    return `${join(join(q.metricLabel, w), range, t)}.`;
  }

  const total = q.rows.reduce((s, r) => s + r.value, 0);
  const peak = q.rows.reduce((a, b) => (b.value > a.value ? b : a));
  return `${join(`${fmt(total)} ${q.metricLabel.toLowerCase()}`, w, t)}. ${busiest(grain, name, fmt, peak)}`;
}

export function answerQuery(q: QueryResult, data: Range): string {
  if (q.matchedOrders === 0) return "No orders match that question.";
  if (q.spec.timeGrain) return seriesAnswer(q, q.spec.timeGrain, data);
  if (q.spec.groupBy) return groupAnswer(q, q.spec.groupBy);
  return scalarAnswer(q, data);
}

// "Jan–Apr 2026": the forecast months, in the same shorthand as the other sentences.
export function answerForecast(f: ForecastResult): string {
  const { recommendation: r, forecast, spec } = f;
  const first = forecast[0].month;
  const last = forecast[forecast.length - 1].month;
  return join(
    `Expect about ${plural(r.forecastUnits, "unit")} of ${targetName(spec.target)} over the next ${plural(forecast.length, "month")} (${monthSpan(first, last)}).`,
    `Plan ${plural(r.recommendedInventory, "unit")}, including ${plural(r.safetyStock, "unit")} of safety stock.`,
    ...f.warnings,
  );
}

const targetName = (t: ForecastSpec["target"]) =>
  t.kind === "all" ? "all products" : t.kind === "sku" ? `SKU ${t.value}` : t.value;

// `reason` is one plain sentence from the rules or the core validator.
export const refusalAnswer = (reason: string) => `I can't answer that from this data. ${reason}`;
