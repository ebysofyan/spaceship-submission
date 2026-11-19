import { describe, expect, test } from "bun:test";
import { forecastFromParams } from "./Forecast";

const meta = {
  categories: ["Paint", "Tools"],
  skus: [{ sku: "PAINT-0001", orders: 12 }],
};

describe("forecastFromParams", () => {
  test("sets kind, category, SKU and horizon from a valid link", () => {
    expect(forecastFromParams(new URLSearchParams("kind=category&value=paint&h=6"), meta)).toEqual({
      kind: "category",
      category: "Paint",
      horizon: 6,
    });
    expect(forecastFromParams(new URLSearchParams("kind=sku&value=paint-0001&h=12"), meta)).toEqual({
      kind: "sku",
      sku: "PAINT-0001",
      horizon: 12,
    });
    expect(forecastFromParams(new URLSearchParams("kind=all&h=1"), meta)).toEqual({ kind: "all", horizon: 1 });
  });

  test("ignores values that are not in the data, and horizons outside 1-12", () => {
    expect(forecastFromParams(new URLSearchParams("kind=category&value=Garden"), meta)).toEqual({ kind: "category" });
    expect(forecastFromParams(new URLSearchParams("kind=sku&value=PAINT-9999"), meta)).toEqual({ kind: "sku" });
    expect(forecastFromParams(new URLSearchParams("kind=all&h=0"), meta)).toEqual({ kind: "all" });
    expect(forecastFromParams(new URLSearchParams("kind=all&h=13"), meta)).toEqual({ kind: "all" });
    expect(forecastFromParams(new URLSearchParams("kind=all&h=4.5"), meta)).toEqual({ kind: "all" });
    expect(forecastFromParams(new URLSearchParams("kind=all&h=abc"), meta)).toEqual({ kind: "all" });
  });

  test("ignores an unknown kind and missing params without throwing", () => {
    expect(forecastFromParams(new URLSearchParams("kind=warehouse&value=x"), meta)).toEqual({});
    expect(forecastFromParams(new URLSearchParams(""), meta)).toEqual({});
  });
});
