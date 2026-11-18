import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DashboardResponse, Kpis, MetaResponse, Metric } from "@app/core";
import { getDashboard } from "../api";
import { useAsync } from "../hooks";
import { AXIS_TICK, CHART, LEGEND_LABEL, TOOLTIP_STYLE } from "../components/chartTheme";
import { DynamicChart } from "../components/DynamicChart";
import { Card, CardHeader } from "../components/ui/Card";
import { InfoHint } from "../components/ui/InfoHint";
import { ErrorState, Notes, Skeleton } from "../components/ui/States";
import { formatDays, formatInt, formatKey, formatPercent } from "../format";

export function Dashboard({ meta }: { meta: MetaResponse }) {
  const state = useAsync(getDashboard, []);
  if (state.error) return <ErrorState message={state.error} onRetry={state.retry} />;
  if (!state.data) return <DashboardSkeleton />;
  const d = state.data;

  return (
    <div className="space-y-6">
      <KpiGrid kpis={d.kpis} meta={meta} />
      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="Orders by month" description="Orders per calendar month, by order date" notes={d.ordersByMonth.notes}>
          <DynamicChart result={d.ordersByMonth} />
        </ChartCard>
        <ChartCard title="Delivery performance by month" description="Delivery outcome per order month">
          <DeliveryChart rows={d.deliveryPerformanceByMonth} />
        </ChartCard>
        <ChartCard
          title="Delay rate by carrier"
          description="(delayed + exception) ÷ delivery base. Hover a bar for its base size."
          notes={d.delayRateByCarrier.notes}
        >
          <DynamicChart result={d.delayRateByCarrier} />
        </ChartCard>
        <ChartCard title="Orders by region" description="Orders per fulfilment region" notes={d.ordersByRegion.notes}>
          <DynamicChart result={d.ordersByRegion} />
        </ChartCard>
      </div>
    </div>
  );
}

function KpiGrid({ kpis, meta }: { kpis: Kpis; meta: MetaResponse }) {
  const definition = (metric: Metric) => meta.metrics.find((m) => m.id === metric)?.definition ?? "";
  const items: Array<{ label: string; metric: Metric; value: string; sub: string }> = [
    { label: "Total orders", metric: "order_count", value: formatInt(kpis.totalOrders), sub: `Delivery base ${formatInt(kpis.deliveryBase)}` },
    { label: "Delivered", metric: "delivered_count", value: formatInt(kpis.deliveredOrders), sub: "Status = delivered" },
    { label: "Delayed", metric: "delayed_count", value: formatInt(kpis.delayedOrders), sub: "Status = delayed" },
    {
      label: "On-time rate",
      metric: "on_time_rate",
      value: formatPercent(kpis.onTimeRate),
      sub: `${formatInt(kpis.deliveredOrders)} of ${formatInt(kpis.deliveryBase)} delivered`,
    },
    { label: "Avg delivery time", metric: "avg_delivery_days", value: formatDays(kpis.avgDeliveryDays), sub: `Over ${formatInt(kpis.deliveryBase)} orders` },
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
  children,
}: {
  title: string;
  description: string;
  notes?: string[];
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <div className="p-5">
        {children}
        <Notes items={notes} />
      </div>
    </Card>
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
        <Tooltip cursor={{ fill: CHART.hover }} contentStyle={TOOLTIP_STYLE} />
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
