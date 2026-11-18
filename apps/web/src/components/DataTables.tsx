import type { ReactNode } from "react";
import type { ForecastResult, Order, QueryResult } from "@app/core";
import { formatInt, formatKey, formatMetric, formatStatus } from "../format";
import { EmptyState } from "./ui/States";

const TH = "whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-zinc-500";
const THR = `${TH} text-right`;
const TD = "whitespace-nowrap px-3 py-2 text-zinc-700 tabular-nums";
const TDR = `${TD} text-right`;

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200">
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

export function ResultTable({ result }: { result: QueryResult }) {
  const { rows, spec, isRate, metricLabel, chart } = result;
  if (rows.length === 0) return <EmptyState>No rows match this question.</EmptyState>;
  return (
    <Shell>
      <thead className="bg-zinc-50">
        <tr>
          <th className={TH}>{chart.xLabel ?? "Group"}</th>
          <th className={THR}>{metricLabel}</th>
          <th className={THR}>Orders</th>
          <th className={THR}>Base</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-zinc-100">
        {rows.map((r) => (
          <tr key={r.key}>
            <td className={TD}>{formatKey(r.key)}</td>
            <td className={TDR}>{formatMetric(r.value, spec.metric, isRate)}</td>
            <td className={TDR}>{formatInt(r.orders)}</td>
            <td className={TDR}>{r.base == null ? "—" : formatInt(r.base)}</td>
          </tr>
        ))}
      </tbody>
    </Shell>
  );
}

export function OrdersTable({ orders }: { orders: Order[] }) {
  return (
    <Shell>
      <thead className="bg-zinc-50">
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
      <tbody className="divide-y divide-zinc-100">
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
  );
}

export function ForecastTable({ result }: { result: ForecastResult }) {
  return (
    <Shell>
      <thead className="bg-zinc-50">
        <tr>
          <th className={TH}>Month</th>
          <th className={THR}>Forecast units</th>
          <th className={THR}>Range (low–high)</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-zinc-100">
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
