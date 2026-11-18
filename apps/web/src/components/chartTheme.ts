import type { CSSProperties } from "react";

export const CHART = {
  accent: "#4f46e5", // indigo-600, the one UI accent
  band: "#c7d2fe", // indigo-200
  ink: "#18181b", // zinc-900
  muted: "#71717a", // zinc-500
  grid: "#e4e4e7", // zinc-200
  hover: "#f4f4f5", // zinc-100
  delayed: "#f59e0b", // amber-500
  exception: "#f43f5e", // rose-500
};

export const AXIS_TICK = { fill: CHART.muted, fontSize: 12 };

export const TOOLTIP_STYLE: CSSProperties = {
  borderRadius: 8,
  borderColor: CHART.grid,
  fontSize: 12,
  boxShadow: "0 4px 12px rgb(0 0 0 / 0.08)",
};
