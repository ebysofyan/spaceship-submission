import { resolve } from "node:path";
import {
  DIMENSIONS,
  METRICS,
  METRIC_DEFS,
  datasetMeta,
  getDashboard,
  loadOrders,
  type DashboardResponse,
  type MetaResponse,
  type Order,
} from "@app/core";

export const DEFAULT_DATA_PATH = resolve(import.meta.dir, "../../../data/mock_logistics_data.csv");

export interface Dataset {
  orders: Order[];
  meta: MetaResponse;
  dashboard: DashboardResponse;
}

// Read-only data and a fixed dashboard, so both are computed once at boot.
export async function loadDataset(path = process.env.DATA_PATH || DEFAULT_DATA_PATH): Promise<Dataset> {
  const orders = await loadOrders(path);
  return { orders, meta: buildMeta(orders), dashboard: getDashboard(orders) };
}

export function buildMeta(orders: Order[]): MetaResponse {
  const data = datasetMeta(orders);
  const topSku = data.skus[0]?.sku ?? "";
  return {
    anchorDate: data.anchorDate,
    dateRange: data.dateRange,
    metrics: METRICS.map((id) => ({ id, label: METRIC_DEFS[id].label, definition: METRIC_DEFS[id].definition })),
    dimensions: [...DIMENSIONS],
    values: data.values,
    categories: data.categories,
    skus: data.skus,
    examples: [
      "Show delayed orders by week for the last 3 months",
      "Which carrier has the highest delay rate?",
      "How many orders were delivered late last month?",
      "What is the on-time rate by region?",
      "Predict demand for PAINT for the next 4 months",
      `How much inventory should I plan for SKU ${topSku}?`,
    ],
  };
}
