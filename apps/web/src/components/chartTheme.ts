import type { CSSProperties } from "react";

// Categorical order for any future multi-series chart: brand green, sky, mint, cyan, deep green, muted grey, light grey.
// Brand green #17F082 is 1.5:1 on white, so bars keep a mid-green edge at 3:1 (WCAG 1.4.11), not a near-black one.
export const CHART = {
  body: "#454545",
  bar: "#17f082", // brand green: on-time, single-series bars
  barEdge: "#4fa37a",
  line: "#07713b", // single-series line/area stroke: 6:1 on white
  history: "#1a1a1a",
  forecast: "#07713b", // dashed
  band: "#3ae8f6", // forecast range, drawn at low opacity
  delayed: "#e5484d",
  // Blue, not amber: red and amber both read as olive-brown under red-green colour blindness; blue stays distinct.
  exception: "#0273d3",
  grid: "#dbdbdb",
  muted: "#6d737f", // axis labels
  hover: "#f6f6f7",
};

export const AXIS_TICK = { fill: CHART.muted, fontSize: 12 };

// Legend text takes its series colour by default; green/cyan text on white is unreadable.
export const LEGEND_LABEL: CSSProperties = { color: CHART.body };

export const TOOLTIP_STYLE: CSSProperties = {
  borderRadius: 12,
  borderColor: CHART.grid,
  fontSize: 12,
  boxShadow: "var(--shadow-float)",
};

// Tooltip rows default to the series colour (neon green on white is unreadable); ink overrides it.
export const TOOLTIP_ITEM_STYLE: CSSProperties = { color: "var(--color-ink)" };
