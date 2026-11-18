import type { ForecastResult, ForecastSpec, Metric, QueryResult } from "@app/core";

// Numbers come only from the core results; this file just formats them.
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const days = (v: number) => `${v.toFixed(2)} days`;
const count = (v: number) => Math.round(v).toLocaleString("en-US");
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

const METHOD: Record<ForecastResult["method"], string> = {
  moving_average: "3-month moving average",
  exponential_smoothing: "exponential smoothing",
  linear_trend: "linear trend",
};

// Groups with fewer orders than this are too small to rank on their own.
const SMALL_BASE = 20;

const rangeText = (q: QueryResult) =>
  q.resolvedRange ? ` Range: ${q.resolvedRange.from} to ${q.resolvedRange.to}.` : "";

// Rates show their count over the base, e.g. "3 of 8 orders".
const baseNote = (q: QueryResult, r: QueryResult["rows"][number]) =>
  q.isRate && r.base !== null ? ` (${Math.round(r.value * r.base)} of ${r.base} orders)` : "";

// Counts add up. Rates and averages are re-weighted by their base, so the total is not a sum of percentages.
function overall(q: QueryResult): number {
  const { rows } = q;
  if (rows.every((r) => r.base !== null)) {
    const base = rows.reduce((s, r) => s + (r.base ?? 0), 0);
    const weighted = rows.reduce((s, r) => s + r.value * (r.base ?? 0), 0);
    return base ? weighted / base : 0;
  }
  return rows.reduce((s, r) => s + r.value, 0);
}

export function answerQuery(q: QueryResult): string {
  if (q.matchedOrders === 0) return `No orders match that question.${rangeText(q)}`;
  const fmt = FORMAT[q.spec.metric];
  const label = q.metricLabel.toLowerCase();

  if (q.spec.timeGrain) {
    const grain = q.spec.timeGrain;
    const peak = q.rows.reduce((best, r) => (r.value > best.value ? r : best));
    return `${q.metricLabel} by ${grain}: overall ${fmt(overall(q))}. Peak ${grain} ${peak.key} at ${fmt(peak.value)}.${rangeText(q)}`;
  }

  if (q.spec.groupBy) {
    const [top] = q.rows;
    const word = q.spec.sort === "asc" ? "lowest" : "highest";
    let text = `${top.key} has the ${word} ${label} at ${fmt(top.value)}${baseNote(q, top)}.`;
    // Only for rates: the top group is small, so also name the leader among groups that are big enough.
    const leader = q.rows.find((r) => r.base !== null && r.base >= SMALL_BASE);
    if (q.isRate && top.base !== null && top.base < SMALL_BASE && leader) {
      text += ` Among groups with a base of ${SMALL_BASE}+, ${leader.key} is the ${word} at ${fmt(leader.value)}${baseNote(q, leader)}.`;
    }
    return text + rangeText(q);
  }

  const over = q.base !== null ? ` over ${q.base} orders` : "";
  return `${q.metricLabel}: ${fmt(q.value ?? 0)}${over}.${rangeText(q)}`;
}

const targetLabel = (t: ForecastSpec["target"]) =>
  t.kind === "all" ? "All products" : t.kind === "category" ? `${t.value} category` : `SKU ${t.value}`;

export function answerForecast(f: ForecastResult): string {
  const { recommendation: r, forecast } = f;
  const span = `${forecast[0].month} to ${forecast[forecast.length - 1].month}`;
  const warnings = f.warnings.map((w) => ` ${w}`).join("");
  return `${targetLabel(f.spec.target)}: ${count(r.forecastUnits)} units forecast for ${forecast.length} months (${span}). Recommended inventory ${count(r.recommendedInventory)} units, including ${count(r.safetyStock)} safety stock. Method: ${METHOD[f.method]}.${warnings}`;
}

// One sentence. The supported examples travel separately in AskResponse.supported.
export function refusalAnswer(reason: string): string {
  return `I can't answer that from this dataset: ${reason.replace(/\.$/, "")}.`;
}
