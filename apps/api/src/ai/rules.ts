import type {
  DateRange,
  Dimension,
  ForecastSpec,
  Interpretation,
  MetaResponse,
  Metric,
  QuerySpec,
  TimeGrain,
} from "@app/core";

// Deterministic fallback router: keyword matching only, no numbers are computed here.

interface Hit<T> {
  value: T;
  match: string;
}
type Filters = Partial<Record<Dimension, string[]>>;

const unsupported = (reasoning: string): Interpretation => ({ tool: "unsupported", source: "rules", reasoning });
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const preview = (values: string[]) =>
  values.slice(0, 12).join(", ") + (values.length > 12 ? ", ..." : "");

// Dimension words, most specific first: "origin city" must not be read as destination.
const DIM_WORDS: Array<[Dimension, string]> = [
  ["carrier", "carriers?"],
  ["region", "regions?"],
  ["warehouse", "warehouses?"],
  ["origin_city", "origins?(?: cit(?:y|ies))?"],
  ["destination_city", "destinations?|cit(?:y|ies)"],
  ["product_category", "categor(?:y|ies)|products?"],
  ["sku", "skus?"],
  ["status", "status(?:es)?"],
  ["client_id", "clients?|customers?"],
];

// Status is left out: "delayed" is a status word, so scanning for it would turn "delay rate" into a filter.
const SCAN_DIMS: Dimension[] = [
  "carrier",
  "region",
  "warehouse",
  "origin_city",
  "destination_city",
  "product_category",
  "sku",
  "client_id",
];

const valuesOf = (meta: MetaResponse, dim: Dimension): string[] =>
  dim === "sku" ? meta.skus.map((s) => s.sku) : (meta.values[dim] ?? []);

// Pulls filter values out of the question. Returns the text left over for metric, grain and range parsing.
function extractFilters(question: string, meta: MetaResponse): { filters: Filters; rest: string; error?: string } {
  const filters: Filters = {};
  const add = (dim: Dimension, value: string) => {
    const list = filters[dim] ?? [];
    filters[dim] = list.includes(value) ? list : [...list, value];
  };
  let rest = question;

  // "carrier Foo": a capitalised or code-like word after a dimension name is a value, not a grouping.
  for (const [dim, alt] of DIM_WORDS) {
    for (const m of question.matchAll(new RegExp(`\\b(?:${alt})\\s+([a-z0-9][\\w-]*)`, "gi"))) {
      const tok = m[1];
      if (!/^[A-Z0-9]/.test(tok) && !tok.includes("-")) continue;
      const known = valuesOf(meta, dim).find((v) => same(v, tok));
      if (!known) {
        const values = valuesOf(meta, dim);
        return { filters, rest, error: `unknown ${dim} value "${tok}" (known: ${preview(values)})` };
      }
      add(dim, known);
      rest = rest.replace(m[0], " ");
    }
  }

  // Bare values anywhere in the text ("for FedEx", "in EU"). Longest first, so "London, UK" beats "UK".
  const candidates = SCAN_DIMS.flatMap((dim) => valuesOf(meta, dim).map((value) => ({ dim, value }))).sort(
    (a, b) => b.value.length - a.value.length,
  );
  for (const { dim, value } of candidates) {
    const re = new RegExp(`(?<![\\w-])${escapeRe(value)}(?![\\w-])`, "i");
    const m = rest.match(re);
    if (!m) continue;
    add(dim, value);
    rest = rest.replace(re, " ".repeat(m[0].length));
  }
  return { filters, rest };
}

function firstHit<T>(text: string, table: Array<[T, RegExp]>): Hit<T> | undefined {
  for (const [value, re] of table) {
    const m = text.match(re);
    if (m) return { value, match: m[0] };
  }
  return undefined;
}

const LATE = /\b(late|lateness|delays?|delayed)\b/;
const RATE = /\b(rate|percent|percentage|share|ratio)\b|%/;
const METRIC_WORDS: Array<[Metric, RegExp]> = [
  ["on_time_rate", /\bon[- ]?time\b/],
  ["avg_delivery_days", /\b(lead time|delivery time|delivery days|days to deliver|how long)\b/],
  ["avg_order_value", /\b(aov|average order|avg order)\b/],
  ["revenue", /\b(revenue|sales|income|order value)\b/],
  ["units", /\b(units?|quantity|quantities|pieces)\b/],
  ["delivered_count", /\bdelivered\b/],
  ["order_count", /\b(orders?|volume|count)\b/],
];

function detectMetric(q: string): Hit<Metric> | undefined {
  // "late" wins over the table so "delivered late" is not read as delivered_count.
  const late = q.match(LATE);
  if (late) {
    const rate = q.match(RATE);
    return rate
      ? { value: "delay_rate", match: `${late[0]} + ${rate[0]}` }
      : { value: "delayed_count", match: late[0] };
  }
  return firstHit(q, METRIC_WORDS);
}

const GRAINS: Array<[TimeGrain, RegExp]> = [
  ["day", /\b(daily|per day|by day|each day)\b/],
  ["week", /\b(weekly|per week|by weeks?|each week)\b/],
  ["month", /\b(monthly|per month|by month|each month)\b/],
];

const DIM_REGEXES: Array<[Dimension, RegExp]> = DIM_WORDS.map(([dim, alt]) => [
  dim,
  new RegExp(`\\b(?:${alt})\\b`, "i"),
]);

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};
const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const pad = (n: number) => String(n).padStart(2, "0");
// Day 0 of the next month is the last day of this one.
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

// Calendar-style ranges. Year comes from the data anchor, not the wall clock.
function detectRange(q: string, anchor: string): Hit<DateRange> | undefined {
  const year = Number(anchor.slice(0, 4));

  const last = q.match(/\blast\s+(\d+|[a-z]+)?\s*(days?|weeks?|months?)\b/);
  const n = last ? (last[1] ? Number(last[1]) || NUMBER_WORDS[last[1]] : 1) : undefined;
  if (last && n) {
    return { value: { last: n, unit: last[2].replace(/s$/, "") as "day" | "week" | "month" }, match: last[0] };
  }

  const quarter = q.match(/\bq([1-4])\b/);
  if (quarter) {
    const start = (Number(quarter[1]) - 1) * 3 + 1;
    const end = start + 2;
    return {
      value: { from: `${year}-${pad(start)}-01`, to: `${year}-${pad(end)}-${pad(lastDay(year, end))}` },
      match: quarter[0],
    };
  }

  const month = q.match(new RegExp(`\\b(${MONTHS.join("|")})\\b`));
  if (month) {
    const m = MONTHS.indexOf(month[1]) + 1;
    return {
      value: { from: `${year}-${pad(m)}-01`, to: `${year}-${pad(m)}-${pad(lastDay(year, m))}` },
      match: month[1],
    };
  }
  return undefined;
}

// Ranges the rules cannot resolve. Refuse rather than silently answering for the whole dataset.
const UNSUPPORTED_RANGE = /\b(last|past|this|current)\s+(quarter|year|half)\b|\b(this|current)\s+(month|week)\b/;

function queryRules(rest: string, filters: Filters, meta: MetaResponse): Interpretation {
  const q = rest.toLowerCase();
  const badRange = q.match(UNSUPPORTED_RANGE);
  if (badRange) {
    return unsupported(`range "${badRange[0]}" is not supported; use last N days/weeks/months, Q1-Q4 or a month name`);
  }
  const metric = detectMetric(q);
  if (!metric) {
    return unsupported(
      "no metric recognised; try orders, late/delayed orders, on-time rate, delay rate, delivery time, revenue, units or average order value",
    );
  }

  const grain = firstHit(q, GRAINS);
  const range = detectRange(q, meta.anchorDate);
  const dimHit = firstHit(rest, DIM_REGEXES);
  const spec: QuerySpec = { metric: metric.value };
  const parts = [`metric ${metric.value} ("${metric.match}")`];

  if (grain) {
    spec.timeGrain = grain.value;
    parts.push(`by ${grain.value} ("${grain.match}")`);
  }
  if (dimHit && grain) parts.push(`${dimHit.match} ignored (one axis per chart)`);
  else if (dimHit) {
    spec.groupBy = dimHit.value;
    spec.sort = /\b(lowest|least|fewest|smallest|bottom)\b/.test(q) ? "asc" : "desc";
    parts.push(`group by ${dimHit.value}`);
  }
  if (range) {
    spec.dateRange = range.value;
    parts.push(`range ("${range.match}")`);
  }
  if (Object.keys(filters).length) {
    spec.filters = filters;
    parts.push(
      `filter ${Object.entries(filters)
        .map(([dim, values]) => `${dim}=${values?.join("|")}`)
        .join(", ")}`,
    );
  }
  return { tool: "query", args: spec, source: "rules", reasoning: parts.join("; ") };
}

const FORECAST_WORDS = /\b(predict|prediction|forecast|demand|inventory|stock)\b/i;

function forecastRules(question: string, meta: MetaResponse): Interpretation {
  let target: ForecastSpec["target"] = { kind: "all" };
  let label = "all products";

  const sku = question.match(/\b[a-z]+-\d{4}\b/i)?.[0];
  if (sku) {
    const known = meta.skus.find((s) => same(s.sku, sku));
    if (!known) return unsupported(`unknown SKU "${sku}"`);
    target = { kind: "sku", value: known.sku };
    label = `sku ${known.sku}`;
  } else {
    const category = meta.categories.find((c) => new RegExp(`\\b${escapeRe(c)}\\b`, "i").test(question));
    if (category) {
      target = { kind: "category", value: category };
      label = `category ${category}`;
    }
  }

  const months = question.match(/\b(\d+)\s+months?\b/i);
  const horizonMonths = months ? Number(months[1]) : 4;
  return {
    tool: "forecast",
    args: { target, horizonMonths },
    source: "rules",
    reasoning: `forecast ${label}; horizon ${horizonMonths} months${months ? "" : " (default)"}`,
  };
}

export function interpretRules(question: string, meta: MetaResponse): Interpretation {
  const { filters, rest, error } = extractFilters(question, meta);
  if (error) return unsupported(error);
  if (FORECAST_WORDS.test(question)) return forecastRules(question, meta);
  return queryRules(rest, filters, meta);
}
