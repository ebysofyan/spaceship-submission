import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { QueryResult } from "@app/core";
import { ResultTable } from "./DataTables";

// Only the fields ResultTable reads.
function result(metric: QueryResult["spec"]["metric"], base: number | null): QueryResult {
  return {
    spec: { metric, groupBy: "carrier" },
    metricLabel: metric === "order_count" ? "Orders" : "Delay rate",
    isRate: metric !== "order_count",
    chart: { type: "bar", xLabel: "carrier", yLabel: "x" },
    rows: [{ key: "GLS", value: 0.5, base, orders: 8 }],
  } as unknown as QueryResult;
}

const headers = (html: string) => (html.match(/<th\b[^>]*>(.*?)<\/th>/g) ?? []).map((th) => th.replace(/<[^>]+>/g, ""));

describe("ResultTable columns", () => {
  test("count metric hides the repeated Orders column", () => {
    const html = renderToStaticMarkup(<ResultTable result={result("order_count", null)} />);
    expect(headers(html)).toEqual(["carrier", "Orders"]);
  });

  test("hides Base when every row has no base", () => {
    const html = renderToStaticMarkup(<ResultTable result={result("delay_rate", null)} />);
    expect(headers(html)).toEqual(["carrier", "Delay rate", "Orders"]);
  });

  test("shows all columns for a rate with a base", () => {
    const html = renderToStaticMarkup(<ResultTable result={result("delay_rate", 8)} />);
    expect(headers(html)).toEqual(["carrier", "Delay rate", "Orders", "Base"]);
  });
});
