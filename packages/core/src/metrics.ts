import type { Metric, Order, Status } from "./types";

export interface MetricValue {
  value: number;
  base: number | null; // rate denominator, or orders behind an average; null for plain counts/sums
}

export interface MetricDef {
  label: string;
  definition: string;
  isRate: boolean;
  compute: (orders: Order[]) => MetricValue;
}

export const countStatus = (orders: Order[], status: Status) =>
  orders.filter((o) => o.status === status).length;

// Terminal delivery outcomes only: in_transit has no outcome yet, canceled never shipped.
const deliveryBase = (orders: Order[]) =>
  orders.filter((o) => o.status === "delivered" || o.status === "delayed" || o.status === "exception");

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const ratio = (num: number, base: number): MetricValue => ({ value: base ? num / base : 0, base });

export const METRIC_DEFS: Record<Metric, MetricDef> = {
  order_count: {
    label: "Orders",
    definition: "COUNT(*)",
    isRate: false,
    compute: (o) => ({ value: o.length, base: null }),
  },
  delivered_count: {
    label: "Delivered orders",
    definition: "COUNT(*) where status = delivered",
    isRate: false,
    compute: (o) => ({ value: countStatus(o, "delivered"), base: null }),
  },
  delayed_count: {
    label: "Delayed orders",
    definition: "COUNT(*) where status = delayed",
    isRate: false,
    compute: (o) => ({ value: countStatus(o, "delayed"), base: null }),
  },
  on_time_rate: {
    label: "On-time rate",
    definition: "delivered / (delivered + delayed + exception)",
    isRate: true,
    compute: (o) => {
      const base = deliveryBase(o);
      return ratio(countStatus(base, "delivered"), base.length);
    },
  },
  delay_rate: {
    label: "Delay rate (delayed + exception)",
    definition: "(delayed + exception) / (delivered + delayed + exception)",
    isRate: true,
    compute: (o) => {
      const base = deliveryBase(o);
      return ratio(countStatus(base, "delayed") + countStatus(base, "exception"), base.length);
    },
  },
  avg_delivery_days: {
    label: "Average delivery time",
    definition: "AVG(delivery_date - order_date) over delivered + delayed + exception",
    isRate: false,
    compute: (o) => {
      const days = deliveryBase(o).flatMap((x) => x.lead_time_days ?? []);
      return { value: mean(days), base: days.length };
    },
  },
  units: {
    label: "Units",
    definition: "SUM(quantity)",
    isRate: false,
    compute: (o) => ({ value: sum(o.map((x) => x.quantity)), base: null }),
  },
  revenue: {
    label: "Revenue (gross)",
    definition: "SUM(order_value_usd); promo discounts not applied",
    isRate: false,
    compute: (o) => ({ value: sum(o.map((x) => x.order_value_usd)), base: null }),
  },
  avg_order_value: {
    label: "Avg order value",
    definition: "AVG(order_value_usd)",
    isRate: false,
    compute: (o) => ({ value: mean(o.map((x) => x.order_value_usd)), base: o.length }),
  },
};
