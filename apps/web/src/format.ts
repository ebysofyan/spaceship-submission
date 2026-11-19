import type { ForecastResult, ForecastSpec, Interpretation, Metric, QuerySpec } from "@app/core";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_KEY = /^(\d{4})-(\d{2})$/;
const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const intFmt = new Intl.NumberFormat("en-US");
const usdFmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export const formatInt = (n: number) => intFmt.format(Math.round(n));
export const formatPercent = (rate: number) => `${(rate * 100).toFixed(1)}%`;
export const formatDays = (days: number) => `${days.toFixed(2)} days`;

// Rates are 0..1. Days get 2dp, money gets cents, counts are whole numbers.
export function formatMetric(value: number, metric: Metric, isRate: boolean): string {
  if (isRate) return formatPercent(value);
  if (metric === "avg_delivery_days") return formatDays(value);
  if (metric === "revenue" || metric === "avg_order_value") return usdFmt.format(value);
  return formatInt(value);
}

// Bucket keys: "2025-01" -> "Jan '25", "2025-01-05" -> "5 Jan"; anything else unchanged.
export function formatKey(key: string): string {
  const day = DAY_KEY.exec(key);
  if (day) return `${Number(day[3])} ${MONTHS[Number(day[2]) - 1]}`;
  const month = MONTH_KEY.exec(key);
  if (month) return `${MONTHS[Number(month[2]) - 1]} '${month[1].slice(2)}`;
  return key;
}

const dayLabel = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};
export const formatDayRange = (from: string, to: string) => `${dayLabel(from)} – ${dayLabel(to)}`;

// "2025-01-01", "2025-12-30" -> "Jan–Dec 2025"
export function formatMonthSpan(from: string, to: string): string {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  const start = fy === ty ? MONTHS[fm - 1] : `${MONTHS[fm - 1]} ${fy}`;
  return `${start}–${MONTHS[tm - 1]} ${ty}`;
}

// Signed gap to the overall figure: rates in points, everything else in its own unit ("+0.32 days", "-51").
export function formatDelta(value: number, overall: number, metric: Metric, isRate: boolean): string {
  const diff = value - overall;
  const sign = diff > 0 ? "+" : diff < 0 ? "-" : "";
  const abs = Math.abs(diff);
  return sign + (isRate ? `${(abs * 100).toFixed(1)} pts` : formatMetric(abs, metric, false));
}

export const formatStatus = (status: string) => status.replace("_", " ").replace(/^./, (c) => c.toUpperCase());

export function formatTarget(target: ForecastSpec["target"]): string {
  if (target.kind === "all") return "All products";
  return `${target.kind === "category" ? "Category" : "SKU"} ${target.value}`;
}

const METHOD_LABELS: Record<ForecastResult["method"], string> = {
  moving_average: "Moving average (3 months)",
  exponential_smoothing: "Exponential smoothing (α 0.3)",
  linear_trend: "Linear trend",
};
export const methodLabel = (method: ForecastResult["method"]) => METHOD_LABELS[method];

const TOOL_LABELS: Record<Interpretation["tool"], string> = {
  query: "Metric query",
  forecast: "Forecast",
  unsupported: "Not supported",
};
export const toolLabel = (tool: Interpretation["tool"]) => TOOL_LABELS[tool];

export const sourceLabel = (source: "llm" | "rules") => (source === "llm" ? "AI" : "Keyword matching");

// "Filters: carrier GLS; region North" or "Filters: none".
export function filterLabel(filters: QuerySpec["filters"]): string {
  const parts = Object.entries(filters ?? {}).flatMap(([dim, values]) =>
    values?.length ? [`${dim.replace("_", " ")} ${values.join(", ")}`] : [],
  );
  return `Filters: ${parts.length > 0 ? parts.join("; ") : "none"}`;
}

// Dashboard charts: "Delay rate · by carrier · All dates (Jan–Dec 2025) · Filters: none". Dashboard charts never filter by date.
export function scopeLine(metricLabel: string, grouping: string, dateRange: { from: string; to: string }, filters?: QuerySpec["filters"]): string {
  return [metricLabel, grouping, `All dates (${formatMonthSpan(dateRange.from, dateRange.to)})`, filterLabel(filters)].join(" · ");
}
