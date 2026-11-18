import type { ReactNode } from "react";
import { AlertCircle, ChevronDown } from "lucide-react";
import type { AskResponse, ForecastResult, Interpretation, QuerySpec } from "@app/core";
import { DynamicChart } from "../components/DynamicChart";
import { ForecastChart } from "../components/ForecastChart";
import { ForecastTable, OrdersTable, ResultTable } from "../components/DataTables";
import { Badge } from "../components/ui/Badge";
import { Card } from "../components/ui/Card";
import { Chip } from "../components/ui/Button";
import { Notes } from "../components/ui/States";
import { formatDayRange, formatInt, formatTarget, methodLabel, sourceLabel, toolLabel } from "../format";

export function AnswerCard({
  response,
  examples,
  onAsk,
}: {
  response: AskResponse;
  examples: string[];
  onAsk: (question: string) => void;
}) {
  const { interpretation, query, forecast } = response;
  if (interpretation.tool === "unsupported" || response.error) {
    return <Refusal response={response} examples={examples} onAsk={onAsk} />;
  }

  return (
    <Card className="p-5 sm:p-6">
      <div className="space-y-6">
        <div>
          <p className="text-sm text-zinc-500">{response.question}</p>
          <p className="mt-2 text-lg leading-relaxed text-zinc-900 sm:text-xl">{response.answer}</p>
        </div>

        {query && <DynamicChart result={query} />}
        {forecast && <ForecastChart result={forecast} />}

        <Computation
          reasoning={interpretation.reasoning}
          tool={interpretation.tool}
          source={interpretation.source}
          query={query}
          forecast={forecast}
        />

        <div className="space-y-3">
          <Disclosure title="Structured query (JSON)">
            <pre className="overflow-x-auto rounded-lg bg-zinc-950 p-4 text-xs leading-relaxed text-zinc-100">
              {JSON.stringify(interpretation.args, null, 2)}
            </pre>
          </Disclosure>
          {query && query.rows.length > 0 && (
            <Disclosure title="Result table">
              <ResultTable result={query} />
            </Disclosure>
          )}
          {forecast && (
            <Disclosure title="Forecast table">
              <ForecastTable result={forecast} />
            </Disclosure>
          )}
          {query && (
            <Disclosure title={`Orders in scope (${formatInt(query.matchedOrders)} after filters and date range, showing first ${query.sampleOrders.length})`}>
              <OrdersTable orders={query.sampleOrders} />
            </Disclosure>
          )}
        </div>
      </div>
    </Card>
  );
}

const SOURCE_TITLE: Record<"llm" | "rules", string> = {
  llm: "Interpreted by an LLM",
  rules: "Deterministic keyword interpreter - set AI_API_KEY to enable LLM interpretation",
};

function Computation({
  reasoning,
  tool,
  source,
  query,
  forecast,
}: {
  reasoning: string;
  tool: Interpretation["tool"];
  source: "llm" | "rules";
  query?: AskResponse["query"];
  forecast?: ForecastResult;
}) {
  const notes = [...(query?.notes ?? []), ...(forecast?.warnings ?? [])];
  return (
    <section aria-labelledby="how-computed" className="rounded-xl bg-zinc-50 p-4 sm:p-5">
      <h3 id="how-computed" className="text-sm font-semibold text-zinc-900">
        How this was computed
      </h3>
      <dl className="mt-4 grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
        <Field label="Tool">
          <Badge>{toolLabel(tool)}</Badge>
        </Field>
        <Field label="Source">
          <Badge tone={source === "llm" ? "accent" : "neutral"} title={SOURCE_TITLE[source]}>
            {sourceLabel(source)}
          </Badge>
        </Field>
        <Field label="Reasoning">{reasoning}</Field>

        {query && (
          <Field label="Metric">
            {query.metricLabel}
            <span className="mt-0.5 block text-xs text-zinc-500">{query.metricDefinition}</span>
          </Field>
        )}
        {query && (
          <Field label="Grouping">
            {query.spec.groupBy ? `By ${query.spec.groupBy.replace("_", " ")}` : query.spec.timeGrain ? `By ${query.spec.timeGrain}` : "Total"}
          </Field>
        )}
        {forecast && (
          <>
            <Field label="Target">{formatTarget(forecast.spec.target)}</Field>
            <Field label="Model">
              {methodLabel(forecast.method)}
              <span className="mt-0.5 block text-xs text-zinc-500">
                {forecast.spec.horizonMonths} months ahead · demand in units per month
              </span>
            </Field>
          </>
        )}
        {query && (
          <Field label="Filters">
            <FilterList filters={query.spec.filters} />
          </Field>
        )}
        {query && (
          <Field label="Date range">{query.resolvedRange ? formatDayRange(query.resolvedRange.from, query.resolvedRange.to) : "All dates"}</Field>
        )}
        {notes.length > 0 && (
          <div className="sm:col-span-2">
            <Notes items={notes} />
          </div>
        )}
      </dl>
    </section>
  );
}

function FilterList({ filters }: { filters: QuerySpec["filters"] }) {
  const entries = Object.entries(filters ?? {}).filter(([, values]) => values && values.length > 0);
  if (entries.length === 0) return <>None</>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {entries.map(([dim, values]) => (
        <Badge key={dim}>
          {dim.replace("_", " ")}: {values?.join(", ")}
        </Badge>
      ))}
    </span>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-zinc-500">{label}</dt>
      <dd className="mt-1 text-zinc-800">{children}</dd>
    </div>
  );
}

function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group rounded-lg border border-zinc-200">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-4 py-3 text-sm font-medium text-zinc-700 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown className="shrink-0 text-zinc-400 transition-transform group-open:rotate-180" size={16} aria-hidden="true" />
      </summary>
      <div className="border-t border-zinc-200 p-4">{children}</div>
    </details>
  );
}

function Refusal({
  response,
  examples,
  onAsk,
}: {
  response: AskResponse;
  examples: string[];
  onAsk: (question: string) => void;
}) {
  const options = response.supported?.length ? response.supported : examples;
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex gap-3">
        <AlertCircle className="mt-0.5 shrink-0 text-amber-600" size={20} aria-hidden="true" />
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-zinc-900">I can't answer that yet</h2>
          <p className="mt-1 text-sm leading-relaxed text-zinc-600">{response.error ?? response.interpretation.reasoning}</p>
        </div>
      </div>
      <p className="mt-6 text-sm font-medium text-zinc-900">Try one of these</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((q) => (
          <Chip key={q} onClick={() => onAsk(q)}>
            {q}
          </Chip>
        ))}
      </div>
    </Card>
  );
}
