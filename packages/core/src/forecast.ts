import type { ForecastResult, ForecastSpec, Order } from "./types";

type Method = ForecastResult["method"];
type Target = ForecastSpec["target"];

// Order matters: on a MAE tie the earlier (simpler) method wins.
const METHODS: Method[] = ["moving_average", "exponential_smoothing", "linear_trend"];
const METHOD_NAMES: Record<Method, string> = {
  moving_average: "moving average (mean of the last 3 months)",
  exponential_smoothing: "exponential smoothing (alpha 0.3)",
  linear_trend: "linear trend (least-squares line)",
};
const ALPHA = 0.3;
const HOLDOUT = 3;
const INTERVAL_Z = 1.96;
const DEFAULT_SERVICE_LEVEL = 0.95;

const FORECASTERS: Record<Method, (y: number[], h: number) => number[]> = {
  moving_average: (y, h) => Array<number>(h).fill(mean(y.slice(-3))),
  exponential_smoothing: (y, h) => {
    let level = y[0];
    for (const v of y.slice(1)) level = ALPHA * v + (1 - ALPHA) * level;
    return Array<number>(h).fill(level);
  },
  linear_trend: (y, h) => {
    const n = y.length;
    const xMean = (n - 1) / 2;
    const yMean = mean(y);
    let sxy = 0;
    let sxx = 0;
    y.forEach((v, i) => {
      sxy += (i - xMean) * (v - yMean);
      sxx += (i - xMean) ** 2;
    });
    const slope = sxx === 0 ? 0 : sxy / sxx; // one point: flat line
    return Array.from({ length: h }, (_, k) => yMean + slope * (n + k - xMean));
  },
};

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => sum(xs) / xs.length;
const stdev = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(sum(xs.map((x) => (x - m) ** 2)) / (xs.length - 1));
};
const round = (x: number, dp = 1) => {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
};

// Forecasts are clamped at 0 and rounded, so backtest MAE scores what is shown.
function predict(method: Method, y: number[], h: number): number[] {
  return FORECASTERS[method](y, h).map((v) => round(Math.max(0, v)));
}

function holdoutMae(method: Method, y: number[]): number {
  const split = y.length - HOLDOUT;
  const predicted = predict(method, y.slice(0, split), HOLDOUT);
  return mean(predicted.map((p, i) => Math.abs(p - y[split + i])));
}

// Sigma of one-step-ahead in-sample errors; history spread when there are too few.
function residualSigma(method: Method, y: number[]): number {
  const residuals = y
    .slice(1)
    .map((actual, i) => actual - predict(method, y.slice(0, i + 1), 1)[0]);
  return residuals.length >= 2 ? stdev(residuals) : stdev(y);
}

// Inverse standard normal CDF, Acklam's rational approximation (abs error ~1e-9).
const ZA = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
const ZB = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
const ZC = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
const ZD = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];

export function zScore(p: number): number {
  if (p < 0.5) return -zScore(1 - p);
  if (p <= 0.97575) {
    const q = p - 0.5;
    const r = q * q;
    const num = (((((ZA[0] * r + ZA[1]) * r + ZA[2]) * r + ZA[3]) * r + ZA[4]) * r + ZA[5]) * q;
    const den = (((((ZB[0] * r + ZB[1]) * r + ZB[2]) * r + ZB[3]) * r + ZB[4]) * r + 1);
    return num / den;
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  const num = (((((ZC[0] * q + ZC[1]) * q + ZC[2]) * q + ZC[3]) * q + ZC[4]) * q + ZC[5]);
  const den = ((((ZD[0] * q + ZD[1]) * q + ZD[2]) * q + ZD[3]) * q + 1);
  return -num / den;
}

function addMonths(ym: string, n: number): string {
  const idx = Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1 + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

// Every month from the first to the last order month in the whole dataset.
function monthSpan(orders: Order[]): string[] {
  const months = orders.map((o) => o.order_date.slice(0, 7));
  const first = months.reduce((a, b) => (b < a ? b : a));
  const last = months.reduce((a, b) => (b > a ? b : a));
  const out: string[] = [];
  for (let m = first; m <= last; m = addMonths(m, 1)) out.push(m);
  return out;
}

function monthlyUnits(orders: Order[], months: string[]): number[] {
  const byMonth = new Map<string, number>();
  for (const o of orders) {
    const m = o.order_date.slice(0, 7);
    byMonth.set(m, (byMonth.get(m) ?? 0) + o.quantity);
  }
  return months.map((m) => byMonth.get(m) ?? 0);
}

function targetOrders(orders: Order[], target: Target): Order[] {
  if (target.kind === "all") return orders;
  const key = target.value.toLowerCase();
  const matching = orders.filter(
    (o) => (target.kind === "sku" ? o.sku : o.product_category).toLowerCase() === key,
  );
  if (matching.length > 0) return matching;
  if (target.kind === "sku") throw new Error(`Unknown SKU "${target.value}".`);
  const known = [...new Set(orders.map((o) => o.product_category))].sort();
  throw new Error(`Unknown category "${target.value}". Known: ${known.join(", ")}`);
}

export function runForecast(orders: Order[], spec: ForecastSpec): ForecastResult {
  const { target } = spec;
  const horizon = spec.horizonMonths;
  const serviceLevel = spec.serviceLevel ?? DEFAULT_SERVICE_LEVEL;
  if (!Number.isInteger(horizon) || horizon < 1 || horizon > 12) {
    throw new Error(`horizonMonths must be an integer from 1 to 12, got ${horizon}`);
  }
  // Written as a positive check so NaN is rejected too.
  if (!(serviceLevel >= 0.5 && serviceLevel <= 0.99)) {
    throw new Error(`serviceLevel must be between 0.5 and 0.99, got ${serviceLevel}`);
  }
  if (orders.length === 0) throw new Error("No orders to forecast from");

  const matching = targetOrders(orders, target);
  const months = monthSpan(orders);
  const y = monthlyUnits(matching, months);
  const lastMonth = months[months.length - 1];
  const total = sum(y);
  const label = target.kind === "all" ? "all products" : `${target.kind} ${target.value}`;

  const scored = METHODS.map((method) => ({ method, mae: holdoutMae(method, y) }));
  const chosen = scored.reduce((best, s) => (s.mae < best.mae ? s : best));
  const sigma = residualSigma(chosen.method, y);
  const point = predict(chosen.method, y, horizon);

  const forecast = point.map((units, i) => ({
    month: addMonths(lastMonth, i + 1),
    units,
    lower: round(Math.max(0, units - INTERVAL_Z * sigma)),
    upper: round(units + INTERVAL_Z * sigma),
  }));

  const forecastUnits = round(sum(point));
  const z = zScore(serviceLevel);
  const safetyStock = round(z * sigma * Math.sqrt(horizon));
  const recommendedInventory = Math.ceil(round(forecastUnits + safetyStock));
  const pct = Math.round(serviceLevel * 100);

  const maeText = scored.map((s) => `${METHOD_NAMES[s.method]}: ${round(s.mae, 2)}`).join("; ");
  const methodology = [
    `Demand is units (SUM of quantity) per order month for ${label}, over ${months.length} months (${months[0]} to ${lastMonth}); months with no orders count as 0.`,
    `Each method was backtested by fitting on the first ${y.length - HOLDOUT} months and forecasting the last ${HOLDOUT}, scored by mean absolute error (MAE) in units. ${maeText}.`,
    `${METHOD_NAMES[chosen.method]} had the lowest MAE, so it was refit on all ${months.length} months (ties go to the simpler method).`,
    `Interval: forecast ± ${INTERVAL_Z} × σ, where σ is the sample standard deviation of the chosen method's one-step-ahead errors on the history; the lower bound is floored at 0.`,
    `Safety stock = z × σ × √(horizon months), with z = ${z.toFixed(3)} for a ${pct}% service level. Recommended inventory = forecast total + safety stock, rounded up.`,
    `Caveat: the data is synthetic and small (${matching.length} orders, ${total} units over ${months.length} months), so treat these numbers as indicative, not a reliable prediction.`,
  ].join(" ");

  const warnings: string[] = [];
  const nonZeroMonths = y.filter((v) => v > 0).length;
  if (target.kind === "sku" && nonZeroMonths < 3) {
    warnings.push(
      `Only ${nonZeroMonths} month(s) of history for SKU ${target.value}; forecast is unreliable — consider category ${matching[0].product_category} instead.`,
    );
  }
  if (total < 30) warnings.push(`Only ${total} units of history; treat this forecast as indicative only.`);

  return {
    spec,
    unit: "units",
    history: months.map((month, i) => ({ month, units: y[i] })),
    forecast,
    method: chosen.method,
    methodsCompared: scored.map((s) => ({ method: s.method, mae: round(s.mae, 2) })),
    methodology,
    recommendation: {
      forecastUnits,
      safetyStock,
      recommendedInventory,
      explanation: `Expect about ${Math.round(forecastUnits)} units of ${label} over the next ${horizon} ${horizon === 1 ? "month" : "months"}. Safety stock of ${Math.round(safetyStock)} units covers demand swings at a ${pct}% service level, so stock ${recommendedInventory} units.`,
    },
    warnings,
  };
}
