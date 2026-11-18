import { useState, type ReactNode } from "react";
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

// null until the SKU text matches a known SKU: no request for half-typed input.
function buildSpec(kind: Kind, category: string, sku: string | undefined, horizonMonths: number, serviceLevel: number): ForecastSpec | null {
  const base = { horizonMonths, serviceLevel };
  if (kind === "all") return { ...base, target: { kind: "all" } };
  if (kind === "category") return { ...base, target: { kind: "category", value: category } };
  return sku ? { ...base, target: { kind: "sku", value: sku } } : null;
}

export function Forecast({ meta }: { meta: MetaResponse }) {
  const [kind, setKind] = useState<Kind>("all");
  const [category, setCategory] = useState(meta.categories[0] ?? "");
  const [skuText, setSkuText] = useState("");
  const [horizon, setHorizon] = useState(4);
  const [serviceLevel, setServiceLevel] = useState(0.95);

  const sku = meta.skus.find((s) => s.sku.toLowerCase() === skuText.trim().toLowerCase())?.sku;
  const spec = buildSpec(kind, category, sku, horizon, serviceLevel);
  // Auto-run: every control change re-requests; only the latest response is kept.
  const result = useAsync(spec ? () => forecast(spec) : null, [JSON.stringify(spec)]);

  return (
    <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)] lg:items-start">
      <Card className="p-5 lg:sticky lg:top-6">
        <div className="space-y-5">
          <div>
            <p className="mb-2 text-xs font-medium text-zinc-600">Target</p>
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
              className="w-full accent-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
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
          <Skeleton className="h-96 w-full rounded-xl" />
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
      <label htmlFor={id} className="mb-2 flex items-baseline justify-between gap-2 text-xs font-medium text-zinc-600">
        {label}
        {hint && <span className="font-normal text-zinc-500">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

function ForecastResults({ result, busy }: { result: ForecastResult; busy: boolean }) {
  const { recommendation: rec, spec } = result;
  return (
    <div className={`space-y-6 transition-opacity ${busy ? "opacity-60" : ""}`} aria-busy={busy}>
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

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader
            title="Recommended inventory"
            description={`Horizon ${spec.horizonMonths} months · ${Math.round((spec.serviceLevel ?? 0.95) * 100)}% service level`}
          />
          <div className="p-5">
            <p className="text-4xl font-semibold tracking-tight tabular-nums">
              {formatInt(rec.recommendedInventory)}
              <span className="ml-2 text-base font-normal text-zinc-500">units</span>
            </p>
            <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-zinc-500">Forecast demand</dt>
                <dd className="mt-0.5 font-medium tabular-nums">{formatInt(rec.forecastUnits)} units</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Safety stock</dt>
                <dd className="mt-0.5 font-medium tabular-nums">{formatInt(rec.safetyStock)} units</dd>
              </div>
            </dl>
            <p className="mt-5 text-sm leading-relaxed text-zinc-600">{rec.explanation}</p>
          </div>
        </Card>

        <Card>
          <CardHeader title="Method comparison" description="Holdout MAE over the last 3 months; lowest error wins" />
          <ul className="divide-y divide-zinc-100">
            {result.methodsCompared.map((m) => {
              const chosen = m.method === result.method;
              return (
                <li key={m.method} className={`flex items-center justify-between gap-3 px-5 py-3 text-sm ${chosen ? "bg-indigo-50/60" : ""}`}>
                  <span className="flex flex-wrap items-center gap-2 text-zinc-800">
                    {methodLabel(m.method)}
                    {chosen && <Badge tone="accent">Selected</Badge>}
                  </span>
                  <span className="whitespace-nowrap tabular-nums text-zinc-600">MAE {m.mae.toFixed(1)}</span>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <Card>
        <CardHeader title="Forecast" description="Units per month, with the lower–upper interval" />
        <div className="p-5 pt-4">
          <ForecastTable result={result} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Methodology" />
        <p className="p-5 text-sm leading-relaxed text-zinc-600">{result.methodology}</p>
      </Card>
    </div>
  );
}
