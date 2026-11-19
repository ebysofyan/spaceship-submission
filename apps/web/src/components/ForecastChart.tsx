import { Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ForecastResult } from "@app/core";
import { formatInt, formatKey } from "../format";
import { AXIS_TICK, CHART, LEGEND_LABEL, TOOLTIP_ITEM_STYLE, TOOLTIP_STYLE } from "./chartTheme";

// History solid, forecast dashed, shaded lower–upper band, divider at the last actual month.
export function ForecastChart({ result, height = 300 }: { result: ForecastResult; height?: number }) {
  const lastActual = result.history.at(-1)?.month;
  const data = [
    ...result.history.map((h) => ({
      label: formatKey(h.month),
      actual: h.units,
      // The last actual point also starts the dashed line and the band (zero-width there), so the band meets the divider.
      forecast: h.month === lastActual ? h.units : null,
      band: h.month === lastActual ? [h.units, h.units] : null,
    })),
    ...result.forecast.map((f) => ({
      label: formatKey(f.month),
      actual: null,
      forecast: f.units,
      band: [f.lower, f.upper],
    })),
  ];
  const axisProps = { tickLine: false, axisLine: false, tick: AXIS_TICK };

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={CHART.grid} />
        <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={16} />
        <YAxis {...axisProps} width={44} tickFormatter={(v: number) => formatInt(v)} allowDecimals={false} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          itemStyle={TOOLTIP_ITEM_STYLE}
          formatter={(v: unknown) => (Array.isArray(v) ? `${formatInt(v[0])}–${formatInt(v[1])} units` : `${formatInt(Number(v))} units`)}
        />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} labelStyle={LEGEND_LABEL} />
        {lastActual && <ReferenceLine x={formatKey(lastActual)} stroke={CHART.muted} strokeDasharray="3 3" />}
        <Area dataKey="band" name="Forecast range" stroke="none" fill={CHART.band} fillOpacity={0.25} legendType="rect" />
        <Line dataKey="actual" name="History" stroke={CHART.history} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
        <Line dataKey="forecast" name="Forecast" stroke={CHART.forecast} strokeWidth={2} strokeDasharray="6 4" dot={{ r: 3 }} connectNulls={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
