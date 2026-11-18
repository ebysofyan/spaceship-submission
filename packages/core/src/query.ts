import { allBuckets, bucketKey, resolveRange } from "./dates";
import { dateSpan, distinct, groupOrders } from "./data";
import { METRIC_DEFS, type MetricDef } from "./metrics";
import {
  DIMENSIONS,
  METRICS,
  TIME_GRAINS,
  type Dimension,
  type Order,
  type QueryResult,
  type QuerySpec,
  type TimeGrain,
} from "./types";

type Row = QueryResult["rows"][number];

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 50;
const TABLE_ABOVE = 15; // more groups than this renders as a table, not bars
const SMALL_BASE = 20;
const SAMPLE_SIZE = 100;
const PREVIEW_VALUES = 20; // cap the "Known: ..." list for big dimensions like sku

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const isDimension = (s: string): s is Dimension => (DIMENSIONS as readonly string[]).includes(s);

function validate(spec: QuerySpec): void {
  if (!METRICS.includes(spec.metric)) {
    throw new Error(`Unknown metric "${spec.metric}". Known: ${METRICS.join(", ")}`);
  }
  if (spec.groupBy && spec.timeGrain) {
    throw new Error("Use groupBy or timeGrain, not both: one axis per chart");
  }
  if (spec.groupBy && !DIMENSIONS.includes(spec.groupBy)) {
    throw new Error(`Unknown dimension "${spec.groupBy}". Known: ${DIMENSIONS.join(", ")}`);
  }
  if (spec.timeGrain && !TIME_GRAINS.includes(spec.timeGrain)) {
    throw new Error(`Unknown time grain "${spec.timeGrain}". Known: ${TIME_GRAINS.join(", ")}`);
  }
  if (spec.limit !== undefined && !(Number.isInteger(spec.limit) && spec.limit >= 1 && spec.limit <= MAX_LIMIT)) {
    throw new Error(`limit must be an integer from 1 to ${MAX_LIMIT}, got ${spec.limit}`);
  }
}

const preview = (values: string[]) =>
  values.length > PREVIEW_VALUES
    ? `${values.slice(0, PREVIEW_VALUES).join(", ")}, ... (${values.length} total)`
    : values.join(", ");

// Matches case-insensitively, returns the dataset's own spelling.
function resolveValues(orders: Order[], dim: Dimension, values: string[]): Set<string> {
  const known = distinct(orders.map((o) => o[dim]));
  return new Set(
    values.map((v) => {
      const hit = known.find((k) => k.toLowerCase() === v.toLowerCase());
      if (hit === undefined) throw new Error(`Unknown ${dim} value "${v}". Known: ${preview(known)}`);
      return hit;
    }),
  );
}

function applyFilters(orders: Order[], filters: QuerySpec["filters"]): Order[] {
  let out = orders;
  for (const [key, values] of Object.entries(filters ?? {})) {
    if (!isDimension(key)) throw new Error(`Unknown filter dimension "${key}". Known: ${DIMENSIONS.join(", ")}`);
    if (!values?.length) continue; // empty list = no filter
    const allowed = resolveValues(orders, key, values);
    out = out.filter((o) => allowed.has(o[key]));
  }
  return out;
}

const toRow = (key: string, xs: Order[], def: MetricDef): Row => {
  const r = def.compute(xs);
  return { key, value: r.value, base: r.base, orders: xs.length };
};

// Zero-filled: buckets with no orders still appear, with value 0.
function timeRows(orders: Order[], grain: TimeGrain, range: { from: string; to: string }, def: MetricDef): Row[] {
  const groups = groupOrders(orders, (o) => bucketKey(o.order_date, grain));
  return allBuckets(range.from, range.to, grain).map((key) => toRow(key, groups.get(key) ?? [], def));
}

function groupRows(orders: Order[], dim: Dimension, def: MetricDef, sort: QuerySpec["sort"]): Row[] {
  const dir = sort === "asc" ? 1 : -1;
  return [...groupOrders(orders, (o) => o[dim])]
    .map(([key, xs]) => toRow(key, xs, def))
    .sort((a, b) => dir * (a.value - b.value) || cmp(a.key, b.key));
}

function smallBaseNotes(def: MetricDef, items: Array<{ key: string; base: number | null }>): string[] {
  if (!def.isRate) return [];
  return items
    .filter((i) => i.base !== null && i.base > 0 && i.base < SMALL_BASE)
    .map((i) => `${i.key ? `${i.key}: ` : ""}small base (${i.base} orders)`);
}

function chartFor(spec: QuerySpec, rowCount: number, def: MetricDef): QueryResult["chart"] {
  if (spec.timeGrain) return { type: "line", xLabel: spec.timeGrain, yLabel: def.label };
  if (spec.groupBy) {
    return { type: rowCount > TABLE_ABOVE ? "table" : "bar", xLabel: spec.groupBy, yLabel: def.label };
  }
  return { type: "kpi", yLabel: def.label };
}

export function runQuery(orders: Order[], spec: QuerySpec): QueryResult {
  validate(spec);
  if (orders.length === 0) throw new Error("No orders loaded");
  const def = METRIC_DEFS[spec.metric];

  // Without a dateRange, the window is the whole dataset: a no-op filter, but it gives time buckets their span.
  const span = dateSpan(orders);
  const range = spec.dateRange ? resolveRange(spec.dateRange, span.to) : span;
  const inRange = applyFilters(orders, spec.filters).filter(
    (o) => o.order_date >= range.from && o.order_date <= range.to,
  );

  const scalar = !spec.groupBy && !spec.timeGrain ? def.compute(inRange) : null;
  const all = spec.timeGrain
    ? timeRows(inRange, spec.timeGrain, range, def)
    : spec.groupBy
      ? groupRows(inRange, spec.groupBy, def, spec.sort)
      : [];
  // Limit applies to groupBy only; time buckets must never be cut.
  const shown = spec.groupBy ? all.slice(0, spec.limit ?? DEFAULT_LIMIT) : all;

  const notes: string[] = [];
  if (inRange.length === 0) notes.push("No orders match these filters");
  if (spec.groupBy && all.length > shown.length) {
    notes.push(`Showing top ${shown.length} of ${all.length} ${spec.groupBy} values`);
  }
  notes.push(...smallBaseNotes(def, scalar ? [{ key: "", base: scalar.base }] : shown));

  return {
    spec,
    resolvedRange: spec.dateRange || spec.timeGrain ? range : null,
    metricLabel: def.label,
    metricDefinition: def.definition,
    isRate: def.isRate,
    value: scalar?.value ?? null,
    base: scalar?.base ?? null,
    rows: shown,
    chart: chartFor(spec, shown.length, def),
    matchedOrders: inRange.length,
    sampleOrders: [...inRange].sort((a, b) => cmp(a.order_date, b.order_date)).slice(0, SAMPLE_SIZE),
    notes,
  };
}
