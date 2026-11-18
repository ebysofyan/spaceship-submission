import { z } from "zod";
import {
  DIMENSIONS,
  METRICS,
  TIME_GRAINS,
  type ForecastSpec,
  type MetaResponse,
  type QuerySpec,
} from "@app/core";

// Matches case-insensitively and returns the dataset's own spelling. Anything else is passed through
// unchanged so the enum rejects it.
const canonical = (allowed: readonly string[]) => (v: unknown) =>
  typeof v === "string" ? (allowed.find((a) => a.toLowerCase() === v.toLowerCase()) ?? v) : v;

const oneOf = <T extends string>(allowed: readonly T[]) =>
  z.preprocess(canonical(allowed), z.enum(allowed as [T, ...T[]]));

// Built from the loaded data, so every value the schemas accept really exists in the dataset.
export function buildSchemas(meta: MetaResponse) {
  const valuesOf = (dim: (typeof DIMENSIONS)[number]): string[] =>
    dim === "sku" ? meta.skus.map((s) => s.sku) : (meta.values[dim] ?? []);

  const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
  const dateRange = z.union([
    z.strictObject({ from: isoDate, to: isoDate }),
    z.strictObject({ last: z.number().int().min(1), unit: z.enum(["day", "week", "month"]) }),
  ]);
  const filters = z.strictObject(
    Object.fromEntries(DIMENSIONS.map((d) => [d, oneOf(valuesOf(d)).array().optional()])),
  );

  const QuerySpecSchema = z.strictObject({
    metric: oneOf(METRICS),
    groupBy: oneOf(DIMENSIONS).optional(),
    timeGrain: oneOf(TIME_GRAINS).optional(),
    filters: filters.optional(),
    dateRange: dateRange.optional(),
    sort: z.enum(["asc", "desc"]).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  });

  const ForecastSpecSchema = z.strictObject({
    target: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("all") }),
      z.strictObject({ kind: z.literal("category"), value: oneOf(meta.categories) }),
      z.strictObject({ kind: z.literal("sku"), value: oneOf(valuesOf("sku")) }),
    ]),
    horizonMonths: z.number().int().min(1).max(12).default(4),
    serviceLevel: z.number().min(0.5).max(0.99).optional(),
  });

  return { QuerySpecSchema, ForecastSpecSchema };
}

export type Schemas = ReturnType<typeof buildSchemas>;

const describeIssues = (err: z.ZodError) =>
  err.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");

export function parseQuery(schemas: Schemas, input: unknown): QuerySpec {
  const r = schemas.QuerySpecSchema.safeParse(input);
  if (!r.success) throw new Error(`Invalid query: ${describeIssues(r.error)}`);
  return r.data as QuerySpec;
}

export function parseForecast(schemas: Schemas, input: unknown): ForecastSpec {
  const r = schemas.ForecastSpecSchema.safeParse(input);
  if (!r.success) throw new Error(`Invalid forecast: ${describeIssues(r.error)}`);
  return r.data as ForecastSpec;
}
