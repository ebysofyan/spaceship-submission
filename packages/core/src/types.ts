// Shared contract between core (computation), api (AI + HTTP) and web (UI).
// Changing a shape here means updating all three. Owned by the orchestrator.

export const STATUSES = ["delivered", "delayed", "in_transit", "exception", "canceled"] as const;
export type Status = (typeof STATUSES)[number];

export interface Order {
  client_id: string;
  order_id: string;
  order_date: string; // YYYY-MM-DD, plain date
  delivery_date: string | null; // null for in_transit + canceled
  carrier: string;
  origin_city: string;
  destination_city: string;
  status: Status;
  sku: string;
  product_category: string;
  quantity: number;
  unit_price_usd: number;
  order_value_usd: number; // gross, discount NOT applied
  is_promo: 0 | 1;
  promo_discount_pct: number;
  region: string;
  warehouse: string;
  lead_time_days: number | null; // delivery_date - order_date, null when no delivery_date
}

// ---------- Query tool (Tool A) ----------

export const METRICS = [
  "order_count", //        COUNT(*)
  "delivered_count", //    status = delivered
  "delayed_count", //      status = delayed  ("delivered late")
  "on_time_rate", //       delivered / delivery base
  "delay_rate", //         (delayed + exception) / delivery base
  "avg_delivery_days", //  AVG(lead_time_days) over delivery base
  "units", //              SUM(quantity)
  "revenue", //            SUM(order_value_usd)
  "avg_order_value", //    AVG(order_value_usd)
] as const;
export type Metric = (typeof METRICS)[number];

export const DIMENSIONS = [
  "carrier",
  "region",
  "warehouse",
  "origin_city",
  "destination_city",
  "product_category",
  "sku",
  "status",
  "client_id",
] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export const TIME_GRAINS = ["day", "week", "month"] as const; // week = ISO week, Monday start
export type TimeGrain = (typeof TIME_GRAINS)[number];

// Relative ranges resolve against the dataset anchor (MAX(order_date) = 2025-12-30), never the wall clock.
// Convention (calendar months, anchor month = "current month"):
//   { last: 1, unit: "month" }  -> previous full calendar month (2025-11-01..2025-11-30)
//   { last: 3, unit: "month" }  -> the 3 full calendar months before the anchor month (2025-09-01..2025-11-30)
//   { last: N, unit: "week" }   -> the N full ISO weeks before the anchor week
//   { last: N, unit: "day" }    -> the N days ending at the anchor date (inclusive)
export type DateRange =
  | { from: string; to: string } // inclusive, YYYY-MM-DD
  | { last: number; unit: "day" | "week" | "month" };

export interface QuerySpec {
  metric: Metric;
  groupBy?: Dimension; // at most one dimension
  timeGrain?: TimeGrain; // bucket by order_date; mutually exclusive with groupBy (one axis per chart)
  filters?: Partial<Record<Dimension, string[]>>; // values must exist in the dataset (case-insensitive match)
  dateRange?: DateRange; // filters order_date
  sort?: "asc" | "desc"; // by metric value; default desc for groupBy, chronological for timeGrain
  limit?: number; // top-N for groupBy, 1..50
}

export type ChartType = "kpi" | "bar" | "line" | "table";

export interface QueryResult {
  spec: QuerySpec;
  resolvedRange: { from: string; to: string } | null;
  metricLabel: string; // e.g. "Delay rate"
  metricDefinition: string; // human formula, e.g. "(delayed + exception) / (delivered + delayed + exception)"
  isRate: boolean; // value in 0..1, UI formats as %
  value: number | null; // scalar answer when no groupBy/timeGrain, else null
  base: number | null; // denominator for rates (scalar case)
  // One row per bucket/group: { key: "GLS", value: 0.375, base: 8, orders: 8 }.
  // Time buckets are complete (empty buckets present with value 0) and chronological.
  rows: Array<{ key: string; value: number; base: number | null; orders: number }>;
  chart: { type: ChartType; xLabel?: string; yLabel: string };
  matchedOrders: number; // orders after filters + dateRange
  sampleOrders: Order[]; // first 100 matching orders (underlying data)
  notes: string[]; // e.g. "GLS base is only 8 orders — small sample"
}

// ---------- Forecast tool (Tool B) ----------

export interface ForecastSpec {
  target: { kind: "all" } | { kind: "category"; value: string } | { kind: "sku"; value: string };
  horizonMonths: number; // 1..12, default 4
  serviceLevel?: number; // 0.5..0.99, default 0.95, drives safety stock
}

export interface ForecastResult {
  spec: ForecastSpec;
  unit: "units"; // demand = SUM(quantity) per month by order_date
  history: Array<{ month: string; units: number }>; // YYYY-MM, all 12 months incl. zeros
  forecast: Array<{ month: string; units: number; lower: number; upper: number }>;
  method: "moving_average" | "exponential_smoothing" | "linear_trend";
  methodsCompared: Array<{ method: ForecastResult["method"]; mae: number }>; // holdout backtest
  methodology: string; // plain-English explanation
  recommendation: {
    forecastUnits: number; // sum over horizon
    safetyStock: number;
    recommendedInventory: number; // forecastUnits + safetyStock, rounded up
    explanation: string;
  };
  warnings: string[]; // e.g. sparse SKU history -> suggest category
}

// ---------- API ----------

export interface Kpis {
  totalOrders: number;
  deliveredOrders: number;
  delayedOrders: number;
  onTimeRate: number; // 0..1
  avgDeliveryDays: number;
  deliveryBase: number;
}

export interface DashboardResponse {
  kpis: Kpis;
  ordersByMonth: QueryResult;
  deliveryPerformanceByMonth: Array<{ month: string; onTime: number; delayed: number; exception: number }>;
  delayRateByCarrier: QueryResult;
  ordersByRegion: QueryResult;
  definitions: Record<string, string>;
}

export interface MetaResponse {
  anchorDate: string; // MAX(order_date)
  dateRange: { from: string; to: string };
  metrics: Array<{ id: Metric; label: string; definition: string }>;
  dimensions: Dimension[];
  values: Partial<Record<Dimension, string[]>>; // allow-listed filter values (sku omitted: use skus)
  categories: string[];
  skus: Array<{ sku: string; orders: number }>;
  examples: string[];
}

export type Interpretation =
  | { tool: "query"; args: QuerySpec; source: "llm" | "rules"; reasoning: string }
  | { tool: "forecast"; args: ForecastSpec; source: "llm" | "rules"; reasoning: string }
  | { tool: "unsupported"; source: "llm" | "rules"; reasoning: string };

export interface AskResponse {
  question: string;
  interpretation: Interpretation;
  answer: string; // built from the tool result by a template; never model-authored numbers
  query?: QueryResult;
  forecast?: ForecastResult;
  supported?: string[]; // set when refused: what the system can answer
  error?: string;
}
