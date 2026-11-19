import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DashboardResponse, Kpis, MetaResponse, Metric, QueryResult } from "@app/core";
import { MessageSquareText } from "lucide-react";
import { getDashboard } from "../api";
import { askHref, useAsync } from "../hooks";
import { AXIS_TICK, CHART, LEGEND_LABEL, TOOLTIP_ITEM_STYLE, TOOLTIP_STYLE } from "../components/chartTheme";
import { DeliveryTable, ResultTable } from "../components/DataTables";
import { DynamicChart } from "../components/DynamicChart";
import { Card, CardHeader } from "../components/ui/Card";
import { Disclosure } from "../components/ui/Disclosure";
import { InfoHint } from "../components/ui/InfoHint";
import { ErrorState, Notes, Skeleton } from "../components/ui/States";
import { formatDays, formatInt, formatKey, formatPercent, scopeLine } from "../format";

export function Dashboard({ meta }: { meta: MetaResponse }) {
  const state = useAsync(getDashboard, []);
  if (state.error) return <ErrorState message={state.error} onRetry={state.retry} />;
  if (!state.data) return <DashboardSkeleton />;
  const d = state.data;

  return (
    <div className="space-y-6">
      <KpiGrid kpis={d.kpis} meta={meta} />
      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard
          title="Orders by month"
          description="Orders per calendar month, by order date"
          notes={d.ordersByMonth.notes}
          followUp="Show orders by week for the last 3 months"
          explain={<QueryData result={d.ordersByMonth} meta={meta} />}
        >
          <DynamicChart result={d.ordersByMonth} />
        </ChartCard>
        <ChartCard
          title="Delivery performance by month"
          description="Delivery outcome per order month"
          followUp="What is the on-time rate by month?"
          explain={
            <>
              <p className="text-sm text-body">{scopeLine("Delivery outcomes", "by month", meta.dateRange)}</p>
              <p className="text-sm leading-relaxed text-body">Counts of status delivered / delayed / exception per order month</p>
              <DeliveryTable rows={d.deliveryPerformanceByMonth} />
            </>
          }
        >
          <DeliveryChart rows={d.deliveryPerformanceByMonth} />
        </ChartCard>
        <ChartCard
          title="Delay rate by carrier"
          description="(delayed + exception) ÷ delivery base. Hover a bar for its base size."
          notes={d.delayRateByCarrier.notes}
          followUp="Which carrier has the highest delay rate?"
          explain={<QueryData result={d.delayRateByCarrier} meta={meta} />}
        >
          <DynamicChart result={d.delayRateByCarrier} />
        </ChartCard>
        <ChartCard
          title="Orders by region"
          description="Orders per fulfilment region"
          notes={d.ordersByRegion.notes}
          followUp="What is the on-time rate by region?"
          explain={<QueryData result={d.ordersByRegion} meta={meta} />}
        >
          <DynamicChart result={d.ordersByRegion} />
        </ChartCard>
      </div>
    </div>
  );
}

function KpiGrid({ kpis, meta }: { kpis: Kpis; meta: MetaResponse }) {
  const definition = (metric: Metric) => meta.metrics.find((m) => m.id === metric)?.definition ?? "";
  const items: Array<{ label: string; metric: Metric; value: string; sub: string }> = [
    { label: "Total orders", metric: "order_count", value: formatInt(kpis.totalOrders), sub: `Completed deliveries: ${formatInt(kpis.deliveryBase)}` },
    { label: "Delivered", metric: "delivered_count", value: formatInt(kpis.deliveredOrders), sub: "Delivered without delay" },
    { label: "Delayed", metric: "delayed_count", value: formatInt(kpis.delayedOrders), sub: "Late deliveries" },
    {
      label: "On-time rate",
      metric: "on_time_rate",
      value: formatPercent(kpis.onTimeRate),
      sub: `${formatInt(kpis.deliveredOrders)} of ${formatInt(kpis.deliveryBase)} completed deliveries`,
    },
    {
      label: "Avg delivery time",
      metric: "avg_delivery_days",
      value: formatDays(kpis.avgDeliveryDays),
      sub: `Across ${formatInt(kpis.deliveryBase)} completed deliveries`,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
      {items.map((k, i) => (
        <Card key={k.label} className={`p-4 sm:p-5 ${i === items.length - 1 ? "col-span-2 lg:col-span-1" : ""}`}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-muted">{k.label}</p>
            <InfoHint label={k.label} text={definition(k.metric)} />
          </div>
          <p className="mt-2 text-2xl font-bold tracking-display tabular-nums text-ink sm:text-3xl">{k.value}</p>
          <p className="mt-1 text-xs text-muted">{k.sub}</p>
        </Card>
      ))}
    </div>
  );
}

function ChartCard({
  title,
  description,
  notes = [],
  followUp,
  explain,
  children,
}: {
  title: string;
  description: string;
  notes?: string[];
  followUp: string;
  explain: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader
        title={title}
        description={description}
        action={
          <a
            href={askHref(followUp)}
            title={followUp}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full no-underline border border-line bg-surface px-3 py-1.5 text-xs font-medium text-body transition-colors hover:bg-subtle hover:text-ink"
          >
            <MessageSquareText size={14} aria-hidden="true" />
            Ask a follow-up
          </a>
        }
      />
      <div className="p-5">
        {children}
        <Notes items={notes} />
        <div className="mt-5">
          <Disclosure label="View data" bodyClassName="space-y-4">
            {explain}
          </Disclosure>
        </div>
      </div>
    </Card>
  );
}

// What a query chart is built from: scope line, metric definition, and the rows behind it.
function QueryData({ result, meta }: { result: QueryResult; meta: MetaResponse }) {
  const grouping = `by ${result.spec.timeGrain ?? result.spec.groupBy}`;
  return (
    <>
      <p className="text-sm text-body">{scopeLine(result.metricLabel, grouping, meta.dateRange, result.spec.filters)}</p>
      <p className="text-sm leading-relaxed text-body">{result.metricDefinition}</p>
      <ResultTable result={result} />
    </>
  );
}

function DeliveryChart({ rows }: { rows: DashboardResponse["deliveryPerformanceByMonth"] }) {
  const data = rows.map((r) => ({ ...r, label: formatKey(r.month) }));
  const axisProps = { tickLine: false, axisLine: false, tick: AXIS_TICK };
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={CHART.grid} />
        <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={16} />
        <YAxis {...axisProps} width={40} allowDecimals={false} />
        <Tooltip cursor={{ fill: CHART.hover }} contentStyle={TOOLTIP_STYLE} itemStyle={TOOLTIP_ITEM_STYLE} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} labelStyle={LEGEND_LABEL} />
        <Bar dataKey="onTime" name="On time" stackId="delivery" fill={CHART.bar} stroke={CHART.barEdge} maxBarSize={36} />
        <Bar dataKey="delayed" name="Delayed" stackId="delivery" fill={CHART.delayed} maxBarSize={36} />
        <Bar dataKey="exception" name="Exception" stackId="delivery" fill={CHART.exception} radius={[4, 4, 0, 0]} maxBarSize={36} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <span className="sr-only">Loading dashboard…</span>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-card" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-80 rounded-card" />
        ))}
      </div>
    </div>
  );
}
