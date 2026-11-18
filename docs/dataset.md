# Dataset — `mock_logistics_data.csv`

Measured profile of the provided dataset. Every number below was computed from the file
itself, so it doubles as a correctness baseline: if the app disagrees with these, the app is
wrong (or is using a different documented definition).

## Shape

- 400 rows × 17 columns, comma-separated, header present, UTF-8.
- **Grain: one row = one order.** `order_id` is unique across all 400 rows, so each order
  contains exactly one SKU line. There is no line-item fan-out to worry about, and no
  aggregation is needed before counting orders.
- No duplicate rows, no fully empty fields.

## Schema

| Column | Type | Domain / notes |
|---|---|---|
| `client_id` | string | `CL-1001` … `CL-1030`, 30 distinct. 4–46 orders each. |
| `order_id` | string | `ORD-2026-<6 digits>-<seq>`. Unique. **The embedded year is 2026 but dates are 2025 — ignore the ID year.** |
| `order_date` | date | `YYYY-MM-DD`. Range 2025-01-01 → 2025-12-30. |
| `delivery_date` | date | `YYYY-MM-DD`, **nullable (30 nulls)**. Range 2025-01-07 → 2025-12-31. Never before `order_date`. |
| `carrier` | string | 9 values: FedEx 89, UPS 88, DHL 63, USPS 49, OnTrac 29, LaserShip 27, Royal Mail 26, DPD 20, GLS 9. |
| `origin_city` | string | 9 values, `"City, CC"`. Exactly one per warehouse. |
| `destination_city` | string | 47 values, same format. |
| `status` | enum | `delivered` 304, `delayed` 55, `in_transit` 27, `exception` 11, `canceled` 3. |
| `sku` | string | 355 distinct, format `<CATEGORY>-NNNN`. Prefix always equals `product_category`. |
| `product_category` | enum | CRAYON 69, STICKER 52, MARKER 51, BRUSH 49, PAINT 49, PENCIL 45, PAPER 43, BOOK 42. |
| `quantity` | int | 1–18, median 2. Total 1310 units. |
| `unit_price_usd` | float | 2.05–29.97. |
| `order_value_usd` | float | Equals `quantity × unit_price_usd`, rounded to cents, **in 100% of rows**. |
| `is_promo` | 0/1 | 22 rows are `1`. |
| `promo_discount_pct` | int | 0 for non-promo; 5–34 for promo rows. |
| `region` | enum | US-E 95, US-W 92, EU 81, US-C 78, UK 54. |
| `warehouse` | string | 9 values. 1:1 with `origin_city` and with `region`. |

Warehouse map (warehouse → origin city → region), stable for every row:

| Warehouse | Origin city | Region |
|---|---|---|
| LON-FC1 | London, UK | UK |
| BER-FC1 | Berlin, DE | EU |
| AMS-FC1 | Amsterdam, NL | EU |
| EWR-DC1 | Newark, NJ | US-E |
| ATL-DC1 | Atlanta, GA | US-E |
| CHI-DC1 | Chicago, IL | US-C |
| DFW-DC1 | Dallas, TX | US-C |
| LAX-DC1 | Los Angeles, CA | US-W |
| SFO-DC2 | San Francisco, CA | US-W |

## Data-quality and modelling traps

1. **No promised / SLA delivery date.** `delivery_date` is the *actual* date. Nothing in the
   data says when an order *should* have arrived, so lateness cannot be derived from the
   calendar alone. The `status` column is the only direct statement about lateness.
2. **`delivery_date` nulls are structural, not missing-at-random.** All 27 `in_transit` rows
   and all 3 `canceled` rows are null; `delivered`, `delayed`, and `exception` rows are never
   null. Any per-date metric must either exclude these statuses or show them separately —
   never coerce them to `order_date`.
3. **`status = delayed` is inconsistent with raw lead time.** Lead time
   (`delivery_date − order_date`) is 1–8 days for `delivered` (median 3, mean 3.25) and 2–11
   for `delayed` (median 6). There is overlap: 62 delivered orders have lead times over 4
   days. Status and elapsed days are correlated but not derivable from each other. Pick one
   definition and label it.
4. **`promo_discount_pct` is not applied to `order_value_usd`.** Revenue in the data is
   gross. Do not subtract the discount a second time when reporting revenue.
5. **No price per SKU.** 42 of 355 SKUs appear at more than one `unit_price_usd`. Any
   SKU-level price or value figure must be aggregated, never taken from "the" row.
6. **Few observations per SKU.** 313 of 355 SKUs appear exactly once; 400 orders spread
   across 12 months. Per-SKU monthly series are mostly empty. Forecasting must support
   category-level (or SKU-rollup) demand to be meaningful. Say so explicitly.
7. **`carrier` is not regional.** Carriers are spread across all regions (e.g. FedEx appears
   in US-C, US-E, UK). Do not assume a carrier belongs to a region; carrier-vs-region
   analysis on this data is noisy rather than insightful.
8. **Dataset is synthetic.** Order patterns are uniform-ish, and several month counts are
   low (Sep 18, Jun 21). Treat any "trend" with the sample size in mind, and do not build
   narratives the data cannot support.

## Derived field

```sql
lead_time_days = delivery_date - order_date      -- valid only when delivery_date IS NOT NULL
```

Distribution across the 370 dated rows: min 1, median 4, mean 3.83, max 12.
Buckets: 1–2 days 98, 3–4 days 158, 5+ days 114 (sums to 370).

| Lead time | Rows |
|---|---|
| 1 | 43 |
| 2 | 55 |
| 3 | 77 |
| 4 | 81 |
| 5 | 56 |
| 6 | 24 |
| 7 | 13 |
| 8 | 8 |
| 9–12 | 13 |

## Canonical metric definitions (use these, document them in the README)

Adopt these unless you have a reason to differ; if you differ, change all three surfaces
(dashboard, query tool, forecast) together and state it in Assumptions.

| Metric | Definition | Reference value |
|---|---|---|
| Total orders | `COUNT(*)` | **400** |
| Delivered orders | `COUNT(*) WHERE status = 'delivered'` | **304** |
| Delayed orders | `COUNT(*) WHERE status = 'delayed'` | **55** |
| Delivery base | orders with a terminal delivery outcome: `status IN ('delivered','delayed','exception')` — excludes `in_transit` (no outcome yet) and `canceled` (never shipped) | **370** |
| On-time delivery rate | `delivered / delivery base` | **82.2%** (304/370) |
| Average delivery time | `AVG(delivery_date − order_date)` over the delivery base | **3.83 days** |
| Average delivery time, delivered only | same, `status = 'delivered'` | **3.25 days** |
| Average order value | `AVG(order_value_usd)` | **34.24** |
| Units shipped | `SUM(quantity)` | **1310** |

If you prefer an elapsed-time definition of lateness, the defensible one is
`lead_time_days > 4` (≈ the 80th percentile); it yields a 30.8% late rate, versus 17.8% by
status. **The two definitions disagree — do not mix them.** Status-based is recommended
because it comes from the data rather than from an arbitrary cutoff.

Carrier delay rate, status-based (`(delayed + exception) / delivery base`), for sanity
checking the "which carrier has the highest delay rate?" question:

| Carrier | Delay rate | Base |
|---|---|---|
| GLS | 37.5% | 8 |
| USPS | 25.5% | 47 |
| UPS | 24.4% | 78 |
| Royal Mail | 24.0% | 25 |
| OnTrac | 22.2% | 27 |
| FedEx | 14.1% | 85 |
| DPD | 11.1% | 18 |
| LaserShip | 8.3% | 24 |
| DHL | 6.9% | 58 |

GLS at 8 orders is the top by rate but is far too small a base to be actionable — a good
product surfaces the base size next to the rate, and a good answer says so.

## Time semantics — the trap that breaks the demo

All data is in 2025, max `order_date` is 2025-12-30, max `delivery_date` is 2025-12-31.
"Last 3 months" and "last month" resolved against the wall clock return **empty results**.

Two acceptable resolutions, pick one and state it:

1. **Anchor to data:** resolve relative dates against `MAX(order_date)` in the dataset.
   A reviewer asking "last month" in 2026 sees November 2025.
2. **Anchor to wall clock, fall back:** try the wall-clock window, and if it is empty, retry
   anchored to the data and say so in the answer.

Option 1 is simpler and recommended.

Monthly order counts, for verifying grouping, bucketing, and date-range filters:

| Month | Orders | Month | Orders |
|---|---|---|---|
| 2025-01 | 75 | 2025-07 | 42 |
| 2025-02 | 36 | 2025-08 | 34 |
| 2025-03 | 46 | 2025-09 | 18 |
| 2025-04 | 25 | 2025-10 | 26 |
| 2025-05 | 29 | 2025-11 | 24 |
| 2025-06 | 21 | 2025-12 | 24 |

Delayed orders per month (for "delayed orders by week/month"): 2025-01 12, 02 4, 03 5, 04 0,
05 7, 06 4, 07 7, 08 4, 09 2, 10 3, 11 4, 12 3. Note 2025-04 is genuinely zero — an empty
bucket must render as zero, not be dropped from the axis.

## Loading notes

- `delivery_date` and `status` must be parsed as nullable/enum, not stringly compared.
- Dates are ISO, no timezone; treat as plain dates (no local-time shifting).
- Money is USD, 2 decimals; sums are safe in float64 at this scale but currency formatting
  belongs in the presentation layer.
- `is_promo` / `promo_discount_pct` are integers, not booleans/floats.
