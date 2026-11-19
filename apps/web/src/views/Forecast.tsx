import { useEffect, useState, type ReactNode } from "react";
import type { ForecastResult, ForecastSpec, MetaResponse } from "@app/core";
import { forecast } from "../api";
import { useAsync } from "../hooks";
import { ForecastChart } from "../components/ForecastChart";
import { ForecastTable } from "../components/DataTables";
import { Badge } from "../components/ui/Badge";
import { Card, CardHeader } from "../components/ui/Card";
import { Input, fieldClass } from "../components/ui/Input";
import { Tabs } from "../components/ui/Tabs";
import { EmptyState, ErrorState, Notes, Skeleton } from "../components/ui/States";
import { formatInt, formatTarget, methodLabel } from "../format";

type Kind = "all" | "category" | "sku";

const KINDS: Array<{ value: Kind; label: string }> = [
  { value: "all", label: "All" },
  { value: "category", label: "Category" },
  { value: "sku", label: "SKU" },
];
const SERVICE_LEVELS = [0.9, 0.95, 0.99];

export interface ForecastLink {
  kind?: Kind;
  category?: string;
  sku?: string;
  horizon?: number;
}

// Controls from a `#forecast?kind=&value=&h=` link. Values that do not match the data are dropped.
export function forecastFromParams(params: URLSearchParams, meta: Pick<MetaResponse, "categories" | "skus">): ForecastLink {
  const kind = params.get("kind");
  const value = params.get("value")?.trim().toLowerCase() ?? "";
  const h = Number(params.get("h"));
  const link: ForecastLink = {};
  if (kind === "all" || kind === "category" || kind === "sku") link.kind = kind;
  if (kind === "category") link.category = meta.categories.find((c) => c.toLowerCase() === value);
  if (kind === "sku") link.sku = meta.skus.find((s) => s.sku.toLowerCase() === value)?.sku;
  if (Number.isInteger(h) && h >= 1 && h <= 12) link.horizon = h;
  return link;
}

// The core methodology is one paragraph; the page shows one sentence per list item.
export const methodologySteps = (text: string): string[] => text.split(/(?<=[.!?])\s+/).filter(Boolean);

// null until the SKU text matches a known SKU: no request for half-typed input.
function buildSpec(kind: Kind, category: string, sku: string | undefined, horizonMonths: number, serviceLevel: number): ForecastSpec | null {
  const base = { horizonMonths, serviceLevel };
  if (kind === "all") return { ...base, target: { kind: "all" } };
  if (kind === "category") return { ...base, target: { kind: "category", value: category } };
  return sku ? { ...base, target: { kind: "sku", value: sku } } : null;
}

export function Forecast({ meta, link }: { meta: MetaResponse; link: URLSearchParams | null }) {
  const [kind, setKind] = useState<Kind>("all");
  const [category, setCategory] = useState(meta.categories[0] ?? "");
  const [skuText, setSkuText] = useState("");
  const [horizon, setHorizon] = useState(4);
  const [serviceLevel, setServiceLevel] = useState(0.95);

  // Keyed on the query string, so a link applies when it arrives and not on every render.
  const linkKey = link?.toString() ?? "";
  useEffect(() => {
    if (!linkKey) return;
    const next = forecastFromParams(new URLSearchParams(linkKey), meta);
    if (next.kind) setKind(next.kind);
    if (next.category) setCategory(next.category);
    if (next.sku) setSkuText(next.sku);
    if (next.horizon) setHorizon(next.horizon);
  }, [linkKey, meta]);

  const sku = meta.skus.find((s) => s.sku.toLowerCase() === skuText.trim().toLowerCase())?.sku;
  const spec = buildSpec(kind, category, sku, horizon, serviceLevel);
  // Auto-run: every control change re-requests; only the latest response is kept.
  const result = useAsync(spec ? () => forecast(spec) : null, [JSON.stringify(spec)]);

  return (
    <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)] lg:items-start">
      <Card className="p-5 lg:sticky lg:top-24">
        <div className="space-y-5">
          <div>
            <p className="mb-2 text-xs font-medium text-body">Target</p>
            <Tabs label="Forecast target" value={kind} options={KINDS} onChange={setKind} />
          </div>

          {kind === "category" && (
            <Field id="fc-category" label="Category">
              <select id="fc-category" className={fieldClass} value={category} onChange={(e) => setCategory(e.target.value)}>
                {meta.categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {kind === "sku" && (
            <Field id="fc-sku" label="SKU" hint={sku ? `${meta.skus.find((s) => s.sku === sku)?.orders} orders` : "Type or pick a SKU from the list"}>
              <Input
                id="fc-sku"
                list="fc-sku-options"
                autoComplete="off"
                placeholder="e.g. PAINT-0001"
                value={skuText}
                onChange={(e) => setSkuText(e.target.value)}
                aria-invalid={skuText.trim() !== "" && !sku}
              />
              <datalist id="fc-sku-options">
                {meta.skus.map((s) => (
                  <option key={s.sku} value={s.sku} label={`${s.orders} orders`} />
                ))}
              </datalist>
            </Field>
          )}

          <Field id="fc-horizon" label="Horizon" hint={`${horizon} month${horizon === 1 ? "" : "s"}`}>
            <input
              id="fc-horizon"
              type="range"
              min={1}
              max={12}
              step={1}
              value={horizon}
              onChange={(e) => setHorizon(Number(e.target.value))}
              className="w-full accent-brand-700"
            />
          </Field>

          <Field id="fc-service" label="Service level" hint="Drives safety stock">
            <select id="fc-service" className={fieldClass} value={serviceLevel} onChange={(e) => setServiceLevel(Number(e.target.value))}>
              {SERVICE_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {Math.round(level * 100)}%
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Card>

      <div className="min-w-0 space-y-6">
        {!spec ? (
          <EmptyState>Pick a SKU from the list to see its forecast.</EmptyState>
        ) : result.error ? (
          <ErrorState message={result.error} onRetry={result.retry} />
        ) : !result.data ? (
          <Skeleton className="h-96 w-full rounded-card" />
        ) : (
          <ForecastResults result={result.data} busy={result.loading} />
        )}
      </div>
    </div>
  );
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 flex items-baseline justify-between gap-2 text-xs font-medium text-body">
        {label}
        {hint && <span className="font-normal text-muted">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

function ForecastResults({ result, busy }: { result: ForecastResult; busy: boolean }) {
  const { recommendation: rec, spec } = result;
  const months = `${spec.horizonMonths} ${spec.horizonMonths === 1 ? "month" : "months"}`;
  return (
    <div className={`space-y-6 transition-opacity ${busy ? "opacity-60" : ""}`} aria-busy={busy}>
      <Card className="p-5 sm:p-6">
        <p className="text-sm text-muted">
          {formatTarget(spec.target)} · {Math.round((spec.serviceLevel ?? 0.95) * 100)}% service level
        </p>
        <h2 className="mt-1 text-balance text-2xl font-bold tracking-display text-ink sm:text-3xl">
          Stock {formatInt(rec.recommendedInventory)} units for the next {months}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-body">{rec.explanation}</p>
        <dl className="mt-5 grid max-w-md grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-muted">Forecast demand</dt>
            <dd className="mt-0.5 font-medium tabular-nums text-ink">{formatInt(rec.forecastUnits)} units</dd>
          </div>
          <div>
            <dt className="text-muted">Safety stock</dt>
            <dd className="mt-0.5 font-medium tabular-nums text-ink">{formatInt(rec.safetyStock)} units</dd>
          </div>
        </dl>
      </Card>

      <Notes items={result.warnings} />

      <Card>
        <CardHeader
          title="Demand history and forecast"
          description={`${formatTarget(spec.target)} · units per month by order date · ${methodLabel(result.method)}`}
        />
        <div className="p-5">
          <ForecastChart result={result} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Forecast" description="Units per month, with the lower–upper interval" />
        <div className="p-5 pt-4">
          <ForecastTable result={result} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Method comparison" description="Holdout MAE over the last 3 months; lowest error wins" />
        <ul className="divide-y divide-line">
          {result.methodsCompared.map((m) => {
            const chosen = m.method === result.method;
            return (
              <li key={m.method} className={`flex items-center justify-between gap-3 px-5 py-3 text-sm ${chosen ? "bg-brand-50" : ""}`}>
                <span className="flex flex-wrap items-center gap-2 text-ink">
                  {methodLabel(m.method)}
                  {chosen && <Badge tone="accent">Selected</Badge>}
                </span>
                <span className="whitespace-nowrap tabular-nums text-body">MAE {m.mae.toFixed(1)}</span>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card>
        <CardHeader title="Methodology" />
        <ul className="list-disc space-y-2 p-5 pl-9 text-sm leading-relaxed text-body">
          {methodologySteps(result.methodology).map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
