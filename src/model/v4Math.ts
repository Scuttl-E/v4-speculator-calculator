import type { AnalysisRange, CashbackMode, Config, Trough } from "./types";
import { degenRecycleTargetRatio } from "./degen";
export const MAX_V4_LTV = 0.8;
export const effectiveLeverage = (ltv: number) => 0.5 / (1 - ltv);
export const MAX_V4_EFFECTIVE_LEVERAGE = effectiveLeverage(MAX_V4_LTV);
export const validP = (p: number) => Math.max(0.000001, p);
export const longValue = (p: number, ltv: number, mode: CashbackMode) => {
  p = validP(p);
  const m = effectiveLeverage(ltv);
  return mode === "cash" ? 0.5 + 0.5 * p ** m : 0.5 * p + 0.5 * p ** m;
};
export const shortValue = (p: number, ltv: number, mode: CashbackMode) => {
  p = validP(p);
  const m = effectiveLeverage(ltv);
  return mode === "cash"
    ? 0.5 + 0.5 * p + (0.5 * m) / p - 0.5 * m
    : p + (0.5 * m) / p - 0.5 * m;
};
export interface PortfolioComponents {
  long: number;
  short: number;
  residualCashback: number;
  total: number;
}

export const portfolioComponents = (p: number, c: Config): PortfolioComponents => {
  p = validP(p);
  const recycleTargetRatio = degenRecycleTargetRatio(c);
  const grossV4Deposited = 1 + recycleTargetRatio;
  const residualCashbackRatio = 0.5 * (1 - recycleTargetRatio);
  const long = grossV4Deposited * c.longAllocation *
    (longValue(p, c.longLtv, "cash") - 0.5);
  const short = grossV4Deposited * (1 - c.longAllocation) *
    (shortValue(p, c.shortLtv, "cash") - 0.5);
  const residualCashback = residualCashbackRatio *
    (c.cashbackMode === "cash" ? 1 : p);
  return { long, short, residualCashback, total: long + short + residualCashback };
};

export const portfolioValue = (p: number, c: Config) => {
  p = validP(p);
  if (!c.degenEnabled)
    return c.longAllocation * longValue(p, c.longLtv, c.cashbackMode) +
      (1 - c.longAllocation) * shortValue(p, c.shortLtv, c.cashbackMode);
  const recycleTargetRatio = degenRecycleTargetRatio(c);
  const grossV4Deposited = 1 + recycleTargetRatio;
  const residualCashbackRatio = 0.5 * (1 - recycleTargetRatio);
  return grossV4Deposited * (
    c.longAllocation * (longValue(p, c.longLtv, "cash") - 0.5) +
    (1 - c.longAllocation) * (shortValue(p, c.shortLtv, "cash") - 0.5)
  ) + residualCashbackRatio * (c.cashbackMode === "cash" ? 1 : p);
};
export const portfolioReturn = (p: number, c: Config) =>
  portfolioValue(p, c) - 1;
export const dollarValue = (p: number, c: Config) =>
  c.deposit * portfolioValue(p, c);

export const analysisRangeFromPercent = (
  minMovePercent: number,
  maxMovePercent: number,
): AnalysisRange => {
  const range = {
    minPriceRatio: 1 + minMovePercent / 100,
    maxPriceRatio: 1 + maxMovePercent / 100,
  };
  assertAnalysisRange(range);
  return range;
};

export const analysisRangeToPercent = (range: AnalysisRange) => ({
  minMovePercent: (range.minPriceRatio - 1) * 100,
  maxMovePercent: (range.maxPriceRatio - 1) * 100,
});

const assertAnalysisRange = (range: AnalysisRange) => {
  if (!Number.isFinite(range.minPriceRatio) || !Number.isFinite(range.maxPriceRatio))
    throw new RangeError("Analysis range must be finite");
  if (range.minPriceRatio <= 0)
    throw new RangeError("Analysis minimum must be greater than -100%");
  if (range.minPriceRatio >= 1 || range.maxPriceRatio <= 1)
    throw new RangeError("Analysis range must include moves below and above entry");
  if (range.maxPriceRatio <= range.minPriceRatio)
    throw new RangeError("Analysis maximum must be greater than its minimum");
};

function findMinimumOnInterval(c: Config, minP: number, maxP: number): Trough {
  const samples: Array<{ p: number; value: number }> = [];
  const n = 1200;
  for (let i = 0; i <= n; i++) {
    const p = minP + ((maxP - minP) * i) / n;
    samples.push({ p, value: portfolioValue(p, c) });
  }
  if (minP < 1 && maxP > 1 && !samples.some(({ p }) => Math.abs(p - 1) < 1e-12))
    samples.push({ p: 1, value: portfolioValue(1, c) });
  samples.sort((a, b) => a.p - b.p);

  let best = samples[0];
  const consider = (candidate: { p: number; value: number }) => {
    if (candidate.value < best.value) best = candidate;
  };
  consider(samples[samples.length - 1]);
  const entry = samples.find(({ p }) => Math.abs(p - 1) < 1e-12);
  if (entry) consider(entry);

  for (let index = 1; index < samples.length - 1; index++) {
    const sample = samples[index];
    if (sample.value > samples[index - 1].value || sample.value > samples[index + 1].value)
      continue;
    let lo = samples[index - 1].p;
    let hi = samples[index + 1].p;
    for (let iteration = 0; iteration < 45; iteration++) {
      const a = (2 * lo + hi) / 3;
      const b = (lo + 2 * hi) / 3;
      if (portfolioValue(a, c) < portfolioValue(b, c)) hi = b;
      else lo = a;
    }
    const p = (lo + hi) / 2;
    consider({ p, value: portfolioValue(p, c) });
  }
  return { ...best, drawdown: best.value - 1 };
}

export function findWorstDrawdown(c: Config, range: AnalysisRange): Trough {
  assertAnalysisRange(range);
  return findMinimumOnInterval(c, range.minPriceRatio, range.maxPriceRatio);
}

export function findDownsideTrough(c: Config, minP = 0.01): Trough {
  if (!Number.isFinite(minP) || minP <= 0 || minP >= 1)
    throw new RangeError("Downside trough minimum must be between zero and entry");
  return findMinimumOnInterval(c, minP, 1);
}
export function findDownsideBreakeven(
  c: Config,
  trough: Trough = findDownsideTrough(c),
) {
  let lastP = trough.p,
    last = portfolioValue(lastP, c) - 1;
  for (let i = 1; i <= 4000; i++) {
    const p = trough.p - ((trough.p - 0.01) * i) / 4000,
      v = portfolioValue(p, c) - 1;
    if (last <= 0 && v >= 0) {
      let lo = p,
        hi = lastP;
      for (let j = 0; j < 40; j++) {
        const mid = (lo + hi) / 2;
        if (portfolioValue(mid, c) >= 1) lo = mid;
        else hi = mid;
      }
      return (lo + hi) / 2;
    }
    lastP = p;
    last = v;
  }
  return null;
}

export function findUpsideBreakeven(c: Config, maxP = 5) {
  let lastP = 1,
    last = 0,
    hasDrawnDown = false;
  for (let i = 1; i <= 4000; i++) {
    const p = 1 + ((maxP - 1) * i) / 4000,
      value = portfolioValue(p, c) - 1;
    if (value < -1e-8) hasDrawnDown = true;
    if (hasDrawnDown && last <= 0 && value >= 0) {
      let lo = lastP,
        hi = p;
      for (let j = 0; j < 40; j++) {
        const mid = (lo + hi) / 2;
        if (portfolioValue(mid, c) < 1) lo = mid;
        else hi = mid;
      }
      return (lo + hi) / 2;
    }
    lastP = p;
    last = value;
  }
  return null;
}
