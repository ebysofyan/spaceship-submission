import { useId } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { QueryResult } from "@app/core";
import { formatInt, formatKey, formatMetric } from "../format";
import { AXIS_TICK, CHART, TOOLTIP_ITEM_STYLE, TOOLTIP_STYLE } from "./chartTheme";
import { ResultTable } from "./DataTables";
import { EmptyState } from "./ui/States";

// Bars: vertical up to 8 groups, horizontal beyond that (long category names read better).
const VERTICAL_MAX = 8;

export function DynamicChart({ result, height = 260 }: { result: QueryResult; height?: number }) {
  const gradientId = `grad-${useId().replace(/:/g, "")}`;
  const { chart, rows, spec, isRate, metricLabel, base } = result;
  const fmt = (v: number) => formatMetric(v, spec.metric, isRate);
  // Rate axes use whole-percent ticks up to the data (0%, 10%, 20%), not 9.5% / 19.0%.
  const rateTop = isRate && rows.length > 0 ? Math.max(0.1, Math.ceil(Math.max(...rows.map((r) => r.value)) * 10) / 10) : null;
  const rateTicks = rateTop === null ? undefined : Array.from({ length: Math.round(rateTop * 10) + 1 }, (_, i) => i / 10);
  const axisFmt = isRate ? (v: number) => `${Math.round(v * 100)}%` : fmt;

  if (chart.type === "kpi") {
    return (
      <div className="py-2">
        <p className="text-5xl font-bold tracking-display tabular-nums text-ink">{result.value == null ? "—" : fmt(result.value)}</p>
        <p className="mt-2 text-sm text-muted">
          {metricLabel}
          {base != null && ` · base ${formatInt(base)} orders`}
        </p>
      </div>
    );
  }
  if (chart.type === "table") return <ResultTable result={result} />;
  if (rows.length === 0) return <EmptyState>No orders match this question.</EmptyState>;

  // Tooltip (and horizontal label) carry the base for rates: "37.5% · base 8 orders".
  const data = rows.map((r) => ({
    ...r,
    label: formatKey(r.key),
    text: isRate && r.base != null ? `${fmt(r.value)} · n=${r.base}` : fmt(r.value),
  }));
  const tipValue = (v: unknown, _name: unknown, item: { payload?: { base?: number | null } }) => {
    const value = fmt(Number(v));
    return isRate && item.payload?.base != null ? `${value} · base ${formatInt(item.payload.base)} orders` : value;
  };
  const axisProps = { tickLine: false, axisLine: false, tick: AXIS_TICK };
  // Counts are whole numbers; without this, small series repeat ticks (1, 1, 2, 2).
  const allowDecimals = !["order_count", "delivered_count", "delayed_count", "units"].includes(result.spec.metric);

  if (chart.type === "line") {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART.bar} stopOpacity={0.35} />
              <stop offset="100%" stopColor={CHART.bar} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={CHART.grid} />
          <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={16} />
          <YAxis {...axisProps} width={56} tickFormatter={axisFmt} allowDecimals={allowDecimals} />
          <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={TOOLTIP_ITEM_STYLE} formatter={tipValue} />
          <Area type="linear" dataKey="value" name={metricLabel} stroke={CHART.line} strokeWidth={2} fill={`url(#${gradientId})`} />
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  if (rows.length <= VERTICAL_MAX) {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={CHART.grid} />
          <XAxis dataKey="label" {...axisProps} interval={0} />
          <YAxis {...axisProps} width={56} tickFormatter={axisFmt} allowDecimals={allowDecimals} />
          <Tooltip cursor={{ fill: CHART.hover }} contentStyle={TOOLTIP_STYLE} itemStyle={TOOLTIP_ITEM_STYLE} formatter={tipValue} />
          <Bar dataKey="value" name={metricLabel} fill={CHART.bar} stroke={CHART.barEdge} radius={[4, 4, 0, 0]} maxBarSize={48} />
        </BarChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(height, data.length * 36)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 96, left: 8, bottom: 0 }}>
        <CartesianGrid horizontal={false} stroke={CHART.grid} />
        <XAxis type="number" {...axisProps} tickFormatter={axisFmt} domain={[0, rateTop ?? "auto"]} ticks={rateTicks} />
        <YAxis type="category" dataKey="label" {...axisProps} width={96} interval={0} />
        <Tooltip cursor={{ fill: CHART.hover }} contentStyle={TOOLTIP_STYLE} itemStyle={TOOLTIP_ITEM_STYLE} formatter={tipValue} />
        <Bar
          dataKey="value"
          name={metricLabel}
          fill={CHART.bar}
          stroke={CHART.barEdge}
          radius={[0, 4, 4, 0]}
          barSize={18}
          // shortcut: Recharts 3.11 leaves layout="vertical" bars unpainted once the entry animation ends (hover repaints them); animation off for this branch only, re-enable when upgrading past 3.11 if fixed
          isAnimationActive={false}
        >
          <LabelList dataKey="text" position="right" fill={CHART.muted} fontSize={12} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
