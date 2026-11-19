import { describe, expect, test } from "bun:test";
import { filterLabel, formatOverall, scopeLine } from "./format";

const RANGE = { from: "2025-01-01", to: "2025-12-30" };

describe("scopeLine", () => {
  test("dashboard chart with no filters", () => {
    expect(scopeLine("Delay rate", "by carrier", RANGE)).toBe("Delay rate · by carrier · All dates (Jan–Dec 2025) · Filters: none");
  });

  test("lists active filters", () => {
    expect(scopeLine("Orders", "by month", RANGE, { carrier: ["GLS", "DHL"] })).toBe(
      "Orders · by month · All dates (Jan–Dec 2025) · Filters: carrier GLS, DHL",
    );
  });
});

describe("formatOverall", () => {
  test("counts and sums show their share of the overall figure", () => {
    expect(formatOverall(4, 55, "delayed_count", false)).toBe("4 of 55 overall (7%)");
  });

  test("rates show the signed gap in points", () => {
    expect(formatOverall(0.041, 0.178, "delay_rate", true)).toBe("vs 17.8% overall (-13.7 pts)");
  });

  test("averages show the signed gap in their own unit", () => {
    expect(formatOverall(4.15, 3.83, "avg_delivery_days", false)).toBe("vs 3.83 days overall (+0.32 days)");
  });
});

describe("filterLabel", () => {
  test("skips empty filter lists", () => {
    expect(filterLabel({ carrier: [] })).toBe("Filters: none");
    expect(filterLabel(undefined)).toBe("Filters: none");
  });
});
