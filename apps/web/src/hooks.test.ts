import { describe, expect, test } from "bun:test";
import type { ForecastSpec } from "@app/core";
import { askHref, askQuestion, forecastHref, parseRoute, tabOnlyHash } from "./hooks";

describe("parseRoute", () => {
  test("reads the tab and its query", () => {
    const route = parseRoute("#ask?q=Which%20carrier%3F");
    expect(route.tab).toBe("ask");
    expect(route.params.get("q")).toBe("Which carrier?");
  });

  test("falls back to the dashboard for empty or unknown tabs", () => {
    expect(parseRoute("").tab).toBe("dashboard");
    expect(parseRoute("#").tab).toBe("dashboard");
    expect(parseRoute("#nope?q=x").tab).toBe("dashboard");
  });

  test("keeps a raw ? inside the query, since only the first ? splits the tab", () => {
    expect(parseRoute("#ask?q=why?").params.get("q")).toBe("why?");
  });
});

describe("askQuestion", () => {
  test("trims, and ignores empty, missing or over-long questions", () => {
    expect(askQuestion(new URLSearchParams("q=++late+orders++"))).toBe("late orders");
    expect(askQuestion(new URLSearchParams("q=%20%20"))).toBeUndefined();
    expect(askQuestion(new URLSearchParams(""))).toBeUndefined();
    expect(askQuestion(new URLSearchParams(`q=${"a".repeat(501)}`))).toBeUndefined();
    expect(askQuestion(new URLSearchParams(`q=${"a".repeat(500)}`))).toHaveLength(500);
  });
});

describe("tabOnlyHash", () => {
  test("drops the query so a consumed deep link does not ask again on reload", () => {
    expect(tabOnlyHash(askHref("Which carrier?"))).toBe("#ask");
    expect(tabOnlyHash("#forecast?kind=all&h=4")).toBe("#forecast");
    expect(tabOnlyHash("#")).toBe("#dashboard");
  });
});

describe("link builders", () => {
  test("askHref round-trips through parseRoute", () => {
    const q = "What is the on-time rate by month? 100% & more";
    expect(askQuestion(parseRoute(askHref(q)).params)).toBe(q);
  });

  test("forecastHref names the target, value and horizon", () => {
    const sku: ForecastSpec = { target: { kind: "sku", value: "PAINT-0001" }, horizonMonths: 6 };
    expect(forecastHref(sku)).toBe("#forecast?kind=sku&h=6&value=PAINT-0001");
    const all: ForecastSpec = { target: { kind: "all" }, horizonMonths: 4 };
    expect(forecastHref(all)).toBe("#forecast?kind=all&h=4");
  });
});
