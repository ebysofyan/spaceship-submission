import {
  METRIC_DEFS,
  resolveRange,
  type Dimension,
  type ForecastResult,
  type ForecastSpec,
  type MetaResponse,
  type Metric,
  type QueryResult,
  type QuerySpec,
} from "@app/core";

// Sentences are built from core results only. This file formats numbers, it never computes them.

type Row = QueryResult["rows"][number];
type Range = { from: string; to: string };

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
// Groups with fewer orders than this are too small to rank on their own.
const SMALL_BASE = 20;
// Counts that add up: these get "busiest"; money and units get "highest".
const COUNT_METRICS: Metric[] = ["order_count", "delivered_count", "delayed_count"];

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
const plural = (n: number, word: string, many = `${word}s`) =>
  `${count(n)} ${Math.round(n) === 1 ? word : many}`;
const be = (n: number) => (Math.round(n) === 1 ? "was" : "were");

// Rates and averages are per base, so they cannot be summed or ranked without their base.
const isRatio = (q: QueryResult) => q.isRate || q.spec.metric.startsWith("avg_");
// A delivery time's base is completed deliveries (delivered + delayed + exception), not orders.
const isDelivery = (m: Metric) => m === "avg_delivery_days";
const baseText = (m: Metric, n: number) =>
  isDelivery(m) ? plural(n, "completed delivery", "completed deliveries") : plural(n, "order");
const baseNoun = (m: Metric) => (isDelivery(m) ? "completed deliveries" : "orders");

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

// The filters the query applied, read as prepositions: "from London, UK", "to Leeds, UK", "for FedEx and UPS", "with status in transit".
// `except` skips a dimension already named elsewhere.
const PREPOSITION: Partial<Record<Dimension, string>> = {
  origin_city: "from",
  destination_city: "to",
  status: "with status",
};
function who(q: QueryResult, except?: Dimension): string {
  const byPreposition = new Map<string, string[]>();
  for (const [dim, values] of Object.entries(q.spec.filters ?? {})) {
    if (dim === except || !values?.length) continue;
    const prep = PREPOSITION[dim as Dimension] ?? "for";
    const names = values.map((v) => (dim === "status" ? v.replace("_", " ") : v));
    byPreposition.set(prep, [...(byPreposition.get(prep) ?? []), ...names]);
  }
  return [...byPreposition].map(([prep, names]) => `${prep} ${listAnd(names)}`).join(" ");
}

// One result, one sentence. Each entry gets its value, base, filter phrase and period.
type Scalar = (v: number, base: number, w: string, t: string) => string;
const SCALAR: Record<Metric, Scalar> = {
  order_count: (v, _b, w, t) => join(`${plural(v, "order")} ${be(v)} placed`, w, t),
  delivered_count: (v, _b, w, t) => join(`${plural(v, "order")} ${be(v)} delivered`, w, t),
  delayed_count: (v, _b, w, t) => join(`${plural(v, "order")} ${be(v)} delayed`, w, t),
  units: (v, _b, w, t) => join(`${plural(v, "unit")} ${be(v)} shipped`, w, t),
  on_time_rate: (v, b, w, t) => join(join("On-time rate", w), `was ${pct(v)} (${Math.round(v * b)} of ${b} orders)`, t),
  delay_rate: (v, b, w, t) => join(join("Delay rate (delayed + exception)", w), `was ${pct(v)} (${Math.round(v * b)} of ${b} orders)`, t),
  avg_delivery_days: (v, b, w, t) =>
    join(join("Average delivery time", w), `was ${days(v)} across ${baseText("avg_delivery_days", b)}`, t),
  revenue: (v, _b, w, t) => `${join(join("Revenue", w), `was ${money(v)}`, t)} (gross, before promo discounts)`,
  avg_order_value: (v, _b, w, t) => join(join("Average order value", w), `was ${money(v)}`, t),
};

// The same metric over every order: rates in points, averages against the overall average, counts as "x of y".
function overallText(q: QueryResult, b: NonNullable<QueryResult["baseline"]>): string {
  const { metric } = q.spec;
  const v = q.value ?? 0;
  const ov = b.value ?? 0;
  const fmt = FORMAT[metric];
  if (q.isRate) {
    const pts = (Math.abs(v - ov) * 100).toFixed(1);
    if (pts === "0.0") return `That is in line with the ${pct(ov)} overall rate.`;
    return `That is ${pts} pts ${v > ov ? "above" : "below"} the ${pct(ov)} overall rate.`;
  }
  if (isRatio(q)) {
    const [up, down] = isDelivery(metric) ? ["slower", "faster"] : ["higher", "lower"];
    const scope = `across all ${baseText(metric, isDelivery(metric) ? (b.base ?? 0) : b.matchedOrders)}`;
    const gap = fmt(Math.abs(v - ov));
    if (gap === fmt(0)) return `That is in line with the overall average of ${fmt(ov)} ${scope}.`;
    return `That is ${gap} ${v > ov ? up : down} than the overall average of ${fmt(ov)} ${scope}.`;
  }
  return `That is ${fmt(v)} of the ${fmt(ov)} ${q.metricLabel.toLowerCase()} overall.`;
}

function scalarAnswer(q: QueryResult, data: Range): string {
  const sentence = `${SCALAR[q.spec.metric](q.value ?? 0, q.base ?? 0, who(q), when(q, data))}.`;
  return q.baseline ? `${sentence} ${overallText(q, q.baseline)}` : sentence;
}

// Two to four values of the grouped dimension ("compare UPS and FedEx"): name every one, in rank order.
function compareAnswer(q: QueryResult, dim: Dimension, data: Range): string {
  const fmt = FORMAT[q.spec.metric];
  const items = q.rows.map((r) =>
    isRatio(q) ? `${r.key} ${fmt(r.value)} (${baseText(q.spec.metric, r.base ?? 0)})` : `${r.key} ${fmt(r.value)}`,
  );
  return `${join(items.join(" vs "), q.metricLabel.toLowerCase(), who(q, dim), when(q, data))}.`;
}

// Counts: top 3 with the rest. Rates and averages: the leader, with a caveat when its base is small.
function groupAnswer(q: QueryResult, dim: Dimension, data: Range): string {
  const filtered = q.spec.filters?.[dim] ?? [];
  if (filtered.length >= 2 && filtered.length <= 4) return compareAnswer(q, dim, data);

  const [top, ...others] = q.rows;
  const label = q.metricLabel.toLowerCase();
  const fmt = FORMAT[q.spec.metric];
  const lowest = q.spec.sort === "asc";
  const w = who(q);
  const prefix = w ? `${cap(w)}, ` : "";
  const t = when(q, data);

  if (!isRatio(q)) {
    const rest = others.slice(0, 2).map((r) => `${r.key} (${fmt(r.value)})`);
    const tail = rest.length ? `, followed by ${listAnd(rest)}` : "";
    return `${prefix}${top.key} has the ${lowest ? "fewest" : "most"} ${label} (${fmt(top.value)}) ${t}${tail}.`;
  }

  const sup = lowest ? "lowest" : "highest";
  const base = top.base ?? 0;
  const small = base < SMALL_BASE;
  let text = `${prefix}${top.key} has the ${sup} ${label} at ${fmt(top.value)} ${t}, ${small ? "but on only" : "on"} ${baseText(q.spec.metric, base)}.`;
  const leader = q.rows.find((r) => (r.base ?? 0) >= SMALL_BASE);
  if (small && leader) {
    // "x of n" only reads for rates; an average is not a count of its base.
    const detail = q.isRate ? ` (${Math.round(leader.value * (leader.base ?? 0))} of ${leader.base})` : "";
    text += ` Among ${DIM_PLURAL[dim]} with ${SMALL_BASE}+ ${baseNoun(q.spec.metric)}, ${leader.key} is ${sup} at ${fmt(leader.value)}${detail}.`;
  }
  return text;
}

// "The busiest month was January (75)." for counts; "The highest month was January ($2,183.15)." otherwise.
function peakText(q: QueryResult, grain: string, name: (r: Row) => string, fmt: (v: number) => string, r: Row): string {
  const word = COUNT_METRICS.includes(q.spec.metric) ? "busiest" : "highest";
  return grain === "month"
    ? `The ${word} month was ${name(r)} (${fmt(r.value)}).`
    : `The ${word} ${grain} (${grain === "week" ? "starting " : ""}${name(r)}) had ${fmt(r.value)}.`;
}

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
  return `${join(`${fmt(total)} ${q.metricLabel.toLowerCase()}`, w, t)}. ${peakText(q, grain, name, fmt, peak)}`;
}

export function answerQuery(q: QueryResult, data: Range): string {
  if (q.matchedOrders === 0) return "No orders match that question.";
  if (q.spec.timeGrain) return seriesAnswer(q, q.spec.timeGrain, data);
  if (q.spec.groupBy) return groupAnswer(q, q.spec.groupBy, data);
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

// Reasoning for an LLM interpretation, built from the validated spec: no model-written text reaches the browser.
export function describeSpec(spec: QuerySpec | ForecastSpec, meta: MetaResponse): string {
  if ("target" in spec) {
    const t = spec.target;
    const what = t.kind === "all" ? "all products" : t.kind === "sku" ? `SKU ${t.value}` : `category ${t.value}`;
    return `Forecast for ${what}, ${plural(spec.horizonMonths, "month")}.`;
  }
  const top = spec.limit ? `${spec.sort === "asc" ? "bottom" : "top"} ${spec.limit} ` : "";
  const by = spec.timeGrain ?? spec.groupBy;
  const values = Object.values(spec.filters ?? {}).flatMap((v) => v ?? []);
  const r = spec.dateRange ? resolveRange(spec.dateRange, meta.anchorDate) : null;
  const period = !r
    ? `all of ${meta.dateRange.from.slice(0, 4)}`
    : isFullMonth(r) ? `${monthName(r.from)} ${r.from.slice(0, 4)}` : spanText(r);
  return `${[
    `${cap(top + METRIC_DEFS[spec.metric].label.toLowerCase())}${by ? ` by ${by.replace("_", " ")}` : ""}`,
    values.length ? `filtered to ${values.join(", ")}` : "",
    period,
  ].filter(Boolean).join(", ")}.`;
}

// `reason` is one plain sentence from the rules or the core validator.
export const refusalAnswer = (reason: string) => `I can't answer that from this data. ${reason}`;
