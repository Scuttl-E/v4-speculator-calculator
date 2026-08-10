import type { CashbackMode, Config, Trough } from "./types";
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
export function findWorstDrawdown(c: Config): Trough {
  let best = { value: Infinity, p: 0.01, drawdown: 0 };
  const n = 1200;
  for (let i = 0; i <= n; i++) {
    const p = 0.01 + ((1 - 0.01) * i) / n,
      value = portfolioValue(p, c);
    if (value < best.value) best = { value, p, drawdown: value - 1 };
  }
  let lo = Math.max(0.01, best.p - 0.003),
    hi = Math.min(1, best.p + 0.003);
  for (let k = 0; k < 45; k++) {
    const a = (2 * lo + hi) / 3,
      b = (lo + 2 * hi) / 3;
    if (portfolioValue(a, c) < portfolioValue(b, c)) hi = b;
    else lo = a;
  }
  const p = (lo + hi) / 2,
    value = portfolioValue(p, c);
  return { p, value, drawdown: value - 1 };
}
export function findDownsideBreakeven(
  c: Config,
  trough: Trough = findWorstDrawdown(c),
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
