import type { ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import type { AskResponse, ForecastResult, QueryResult } from "@app/core";
import { DynamicChart } from "../components/DynamicChart";
import { ForecastChart } from "../components/ForecastChart";
import { ForecastTable, OrdersTable, ResultTable } from "../components/DataTables";
import { Badge } from "../components/ui/Badge";
import { Card } from "../components/ui/Card";
import { Chip } from "../components/ui/Button";
import { Disclosure } from "../components/ui/Disclosure";
import { Notes } from "../components/ui/States";
import { filterLabel, formatDayRange, formatDelta, formatInt, formatMetric, formatTarget, methodLabel, sourceLabel, toolLabel } from "../format";

const WHY = /\bwhy\b/i;

const SOURCE_TITLE: Record<"llm" | "rules", string> = {
  llm: "Interpreted by an LLM",
  rules: "Deterministic keyword interpreter - set AI_API_KEY to enable LLM interpretation",
};

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
  const notes = [...(query?.notes ?? []), ...(forecast?.warnings ?? [])];
  const parts = query ? queryParts(query) : forecast ? forecastParts(forecast) : [toolLabel(interpretation.tool)];

  return (
    <Card className="motion-safe:animate-answer-in space-y-6 p-5 sm:p-6">
      <div>
        <p className="text-sm text-muted">{response.question}</p>
        <p className="mt-2 text-lg leading-relaxed text-ink sm:text-xl">{response.answer}</p>
      </div>

      {query && <DynamicChart result={query} />}
      {query?.baseline?.value != null && query.value != null && query.matchedOrders > 0 && (
        <p className="-mt-3 text-sm text-muted">
          vs {formatMetric(query.baseline.value, query.spec.metric, query.isRate)} overall (
          {formatDelta(query.value, query.baseline.value, query.spec.metric, query.isRate)})
        </p>
      )}
      {query && WHY.test(response.question) && (
        <p className="text-sm text-muted">The data has no cause fields, so this shows the figure and how it compares with the overall one.</p>
      )}
      {forecast && <ForecastChart result={forecast} />}

      <div className="flex flex-wrap gap-2">
        {parts.map((part) => (
          <Badge key={part}>{part}</Badge>
        ))}
        <Badge tone={interpretation.source === "llm" ? "accent" : "neutral"} title={SOURCE_TITLE[interpretation.source]}>
          {sourceLabel(interpretation.source)}
        </Badge>
      </div>

      {notes.length > 0 && <Notes items={notes} />}

      <Disclosure label="Details" bodyClassName="space-y-6">
        <Section title="Reasoning">
          <p className="text-sm leading-relaxed text-body">{interpretation.reasoning}</p>
        </Section>
        {(query || forecast) && (
          <Section title="Metric definition">
            <p className="text-sm leading-relaxed text-body">{query?.metricDefinition ?? forecast?.methodology}</p>
          </Section>
        )}
        <Section title="Structured query (JSON)">
          <pre className="overflow-x-auto rounded-control bg-dark-0 p-4 text-xs leading-relaxed text-white">
            {JSON.stringify(interpretation.args, null, 2)}
          </pre>
        </Section>
        {query && query.rows.length > 0 && (
          <Section title="Result table">
            <ResultTable result={query} />
          </Section>
        )}
        {forecast && (
          <Section title="Forecast table">
            <ForecastTable result={forecast} />
          </Section>
        )}
        {query && (
          <Section title={`Orders in scope (${formatInt(query.matchedOrders)}, showing first ${query.sampleOrders.length})`}>
            <OrdersTable orders={query.sampleOrders} />
          </Section>
        )}
      </Disclosure>
    </Card>
  );
}

// One-line summary, e.g. "Delay rate · by carrier · All dates · Filters: none".
function queryParts(query: QueryResult): string[] {
  const { spec } = query;
  const grouping = spec.groupBy
    ? `by ${spec.groupBy.replace("_", " ")}`
    : spec.timeGrain
      ? `by ${spec.timeGrain}`
      : "Total";
  const range = query.resolvedRange ? formatDayRange(query.resolvedRange.from, query.resolvedRange.to) : "All dates";
  return [query.metricLabel, grouping, range, filterLabel(spec.filters)];
}

function forecastParts(forecast: ForecastResult): string[] {
  const { spec } = forecast;
  const months = `${spec.horizonMonths} month${spec.horizonMonths === 1 ? "" : "s"}`;
  return ["Forecast", formatTarget(spec.target), months, methodLabel(forecast.method)];
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-bold text-ink">{title}</h3>
      {children}
    </div>
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
  const options = (response.supported?.length ? response.supported : examples).slice(0, 3);
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex gap-3">
        <AlertCircle className="mt-0.5 shrink-0 text-amber-600" size={20} aria-hidden="true" />
        <div className="min-w-0 space-y-2">
          <h2 className="text-base font-bold text-ink">I can't answer that</h2>
          <p className="text-sm leading-relaxed text-body">{response.error ?? response.interpretation.reasoning}</p>
          <p className="text-sm leading-relaxed text-muted">
            I can answer counts, rates, delivery time, revenue and units by carrier, region, warehouse, city, category, SKU, status or
            client — over days, weeks or months — and demand forecasts.
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {options.map((q) => (
          <Chip key={q} onClick={() => onAsk(q)}>
            {q}
          </Chip>
        ))}
      </div>
    </Card>
  );
}
