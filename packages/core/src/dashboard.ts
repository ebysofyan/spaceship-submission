import { dateSpan, groupOrders } from "./data";
import { allBuckets, bucketKey } from "./dates";
import { METRIC_DEFS, countStatus } from "./metrics";
import { runQuery } from "./query";
import { METRICS, type DashboardResponse, type Metric, type Order } from "./types";

export function getDashboard(orders: Order[]): DashboardResponse {
  const value = (m: Metric) => METRIC_DEFS[m].compute(orders).value;
  const onTime = METRIC_DEFS.on_time_rate.compute(orders);
  const span = dateSpan(orders);
  const byMonth = groupOrders(orders, (o) => bucketKey(o.order_date, "month"));

  return {
    kpis: {
      totalOrders: value("order_count"),
      deliveredOrders: value("delivered_count"),
      delayedOrders: value("delayed_count"),
      onTimeRate: onTime.value,
      avgDeliveryDays: value("avg_delivery_days"),
      deliveryBase: onTime.base ?? 0,
    },
    ordersByMonth: runQuery(orders, { metric: "order_count", timeGrain: "month" }),
    deliveryPerformanceByMonth: allBuckets(span.from, span.to, "month").map((month) => {
      const xs = byMonth.get(month) ?? [];
      return {
        month,
        onTime: countStatus(xs, "delivered"),
        delayed: countStatus(xs, "delayed"),
        exception: countStatus(xs, "exception"),
      };
    }),
    delayRateByCarrier: runQuery(orders, { metric: "delay_rate", groupBy: "carrier", sort: "desc" }),
    ordersByRegion: runQuery(orders, { metric: "order_count", groupBy: "region" }),
    definitions: Object.fromEntries(METRICS.map((m) => [m, METRIC_DEFS[m].definition])),
  };
}
