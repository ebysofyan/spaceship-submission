import type { ReactNode } from "react";
import type { DashboardResponse, ForecastResult, Order, QueryResult } from "@app/core";
import { formatInt, formatKey, formatMetric, formatStatus } from "../format";
import { EmptyState } from "./ui/States";

// Header: deep brand green with white bold text (6:1). Headers may wrap so narrow phones fit without scrolling.
const TH = "bg-brand-700 px-3 py-2.5 text-left text-sm font-bold text-white";
const THR = `${TH} text-right`;
const TD = "whitespace-nowrap px-3 py-2.5 text-sm text-body tabular-nums";
const TDR = `${TD} text-right`;

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-control border border-line">
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

export function ResultTable({ result }: { result: QueryResult }) {
  const { rows, spec, isRate, metricLabel, chart } = result;
  if (rows.length === 0) return <EmptyState>No rows match this question.</EmptyState>;
  // Order count is already the value column, and a null base means no denominator: skip those columns.
  const showOrders = spec.metric !== "order_count";
  const showBase = rows.some((r) => r.base != null);
  return (
    <Shell>
      <thead>
        <tr>
          <th className={TH}>{chart.xLabel ?? "Group"}</th>
          <th className={THR}>{metricLabel}</th>
          {showOrders && <th className={THR}>Orders</th>}
          {showBase && <th className={THR}>Base</th>}
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {rows.map((r) => (
          <tr key={r.key}>
            <td className={TD}>{formatKey(r.key)}</td>
            <td className={TDR}>{formatMetric(r.value, spec.metric, isRate)}</td>
            {showOrders && <td className={TDR}>{formatInt(r.orders)}</td>}
            {showBase && <td className={TDR}>{r.base == null ? "—" : formatInt(r.base)}</td>}
          </tr>
        ))}
      </tbody>
    </Shell>
  );
}

export function OrdersTable({ orders }: { orders: Order[] }) {
  return (
    <div className="max-h-96 overflow-y-auto">
    <Shell>
      <thead>
        <tr>
          <th className={TH}>Order</th>
          <th className={TH}>Order date</th>
          <th className={TH}>Carrier</th>
          <th className={TH}>Status</th>
          <th className={TH}>SKU</th>
          <th className={THR}>Qty</th>
          <th className={TH}>Region</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {orders.map((o) => (
          <tr key={o.order_id}>
            <td className={TD}>{o.order_id}</td>
            <td className={TD}>{o.order_date}</td>
            <td className={TD}>{o.carrier}</td>
            <td className={TD}>{formatStatus(o.status)}</td>
            <td className={TD}>{o.sku}</td>
            <td className={TDR}>{o.quantity}</td>
            <td className={TD}>{o.region}</td>
          </tr>
        ))}
      </tbody>
    </Shell>
    </div>
  );
}

export function DeliveryTable({ rows }: { rows: DashboardResponse["deliveryPerformanceByMonth"] }) {
  return (
    <Shell>
      <thead>
        <tr>
          <th className={TH}>Month</th>
          <th className={THR}>On time</th>
          <th className={THR}>Delayed</th>
          <th className={THR}>Exception</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {rows.map((r) => (
          <tr key={r.month}>
            <td className={TD}>{formatKey(r.month)}</td>
            <td className={TDR}>{formatInt(r.onTime)}</td>
            <td className={TDR}>{formatInt(r.delayed)}</td>
            <td className={TDR}>{formatInt(r.exception)}</td>
          </tr>
        ))}
      </tbody>
    </Shell>
  );
}

export function ForecastTable({ result }: { result: ForecastResult }) {
  return (
    <Shell>
      <thead>
        <tr>
          <th className={TH}>Month</th>
          <th className={THR}>Forecast units</th>
          <th className={THR}>Range (low–high)</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {result.forecast.map((f) => (
          <tr key={f.month}>
            <td className={TD}>{formatKey(f.month)}</td>
            <td className={TDR}>{formatInt(f.units)}</td>
            <td className={TDR}>
              {formatInt(f.lower)}–{formatInt(f.upper)}
            </td>
          </tr>
        ))}
      </tbody>
    </Shell>
  );
}
