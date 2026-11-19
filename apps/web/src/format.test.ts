import { describe, expect, test } from "bun:test";
import { filterLabel, scopeLine } from "./format";

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

describe("filterLabel", () => {
  test("skips empty filter lists", () => {
    expect(filterLabel({ carrier: [] })).toBe("Filters: none");
    expect(filterLabel(undefined)).toBe("Filters: none");
  });
});
