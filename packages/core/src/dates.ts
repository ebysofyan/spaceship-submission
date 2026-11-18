import type { DateRange, TimeGrain } from "./types";

// All date math is UTC on plain YYYY-MM-DD strings, so no local-timezone (DST) shifts.
const DAY_MS = 86_400_000;

const toUtcMs = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const fromUtcMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && fromUtcMs(toUtcMs(s)) === s; // round-trip rejects 2025-02-30
}

export const daysBetween = (from: string, to: string) => (toUtcMs(to) - toUtcMs(from)) / DAY_MS;

const addDays = (d: string, n: number) => fromUtcMs(toUtcMs(d) + n * DAY_MS);

// YYYY-MM plus n months (negative n goes back).
const addMonths = (month: string, n: number) =>
  fromUtcMs(Date.UTC(+month.slice(0, 4), +month.slice(5, 7) - 1 + n, 1)).slice(0, 7);

// Monday of the ISO week containing d.
const mondayOf = (d: string) => addDays(d, -((new Date(toUtcMs(d)).getUTCDay() + 6) % 7));

export function bucketKey(date: string, grain: TimeGrain): string {
  if (grain === "month") return date.slice(0, 7);
  if (grain === "week") return mondayOf(date);
  return date;
}

const nextBucket = (key: string, grain: TimeGrain) =>
  grain === "month" ? addMonths(key, 1) : addDays(key, grain === "week" ? 7 : 1);

// Every bucket key from the one containing `from` through the one containing `to`, in order.
export function allBuckets(from: string, to: string, grain: TimeGrain): string[] {
  const end = bucketKey(to, grain);
  const keys: string[] = [];
  for (let k = bucketKey(from, grain); k <= end; k = nextBucket(k, grain)) keys.push(k);
  return keys;
}

// Relative ranges resolve against the anchor (MAX(order_date)), never the wall clock.
export function resolveRange(range: DateRange, anchor: string): { from: string; to: string } {
  if ("from" in range) {
    if (!isIsoDate(range.from) || !isIsoDate(range.to)) {
      throw new Error(`dateRange must use YYYY-MM-DD dates, got ${range.from}..${range.to}`);
    }
    if (range.from > range.to) throw new Error(`dateRange.from ${range.from} is after ${range.to}`);
    return { from: range.from, to: range.to };
  }

  const n = range.last;
  if (!Number.isInteger(n) || n < 1) throw new Error(`dateRange.last must be a positive integer, got ${n}`);
  const anchorMonth = anchor.slice(0, 7);
  switch (range.unit) {
    case "month":
      return { from: `${addMonths(anchorMonth, -n)}-01`, to: addDays(`${anchorMonth}-01`, -1) };
    case "week": {
      const monday = mondayOf(anchor);
      return { from: addDays(monday, -7 * n), to: addDays(monday, -1) };
    }
    case "day":
      return { from: addDays(anchor, 1 - n), to: anchor };
    default:
      throw new Error(`Unknown dateRange unit "${range.unit}"`);
  }
}
