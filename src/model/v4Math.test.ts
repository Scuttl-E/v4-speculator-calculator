import { describe, expect, it } from "vitest";
import { effectiveLeverage, findDownsideBreakeven, findWorstDrawdown, longValue, MAX_V4_EFFECTIVE_LEVERAGE, MAX_V4_LTV, portfolioComponents, portfolioValue, shortValue } from "./v4Math";
import type { Config } from "./types";
const config = (overrides: Partial<Config> = {}): Config => ({
  deposit: 10000,
  longAllocation: 0.6,
  longLtv: 0.75,
  shortLtv: 0.5,
  cashbackMode: "spot",
  degenEnabled: false,
  degenMode: "x1",
  customRecyclePct: 50,
  ...overrides,
});
describe("published V4 anchors", () => {
  it("reproduces the 75% long curve", () => {
    expect(longValue(0.2, 0.75, "cash") * 10000).toBe(5200);
    expect(longValue(2.4, 0.75, "cash") * 10000).toBe(33800);
  });
  it("reproduces the 50% short curve", () => {
    expect(shortValue(1, 0.5, "cash") * 10000).toBe(10000);
    expect(shortValue(2, 0.5, "cash") * 10000).toBe(12500);
    const value = shortValue(0.4773, 0.5, "cash") * 10000;
    expect(value).toBeGreaterThan(12860);
    expect(value).toBeLessThan(12865);
  });
  it("calculates leverage", () => {
    expect(effectiveLeverage(0.5)).toBe(1);
    expect(effectiveLeverage(0.75)).toBe(2);
    expect(effectiveLeverage(MAX_V4_LTV)).toBeCloseTo(2.5, 10);
    expect(MAX_V4_EFFECTIVE_LEVERAGE).toBeCloseTo(2.5, 10);
  });
  it("all selected models start at one", () => {
    for (const ltv of [0.5, 0.6, 0.75, MAX_V4_LTV]) {
      expect(longValue(1, ltv, "cash")).toBeCloseTo(1, 12);
      expect(longValue(1, ltv, "spot")).toBeCloseTo(1, 12);
      expect(shortValue(1, ltv, "cash")).toBeCloseTo(1, 12);
      expect(shortValue(1, ltv, "spot")).toBeCloseTo(1, 12);
    }
  });
  it("finds the lower-price breakeven beyond a downside trough", () => {
    const strategy = config();
    const trough = findWorstDrawdown(strategy);
    const breakeven = findDownsideBreakeven(strategy, trough);
    expect(breakeven).not.toBeNull();
    expect(breakeven!).toBeLessThan(trough.p);
  });

  it("matches the locked pre-Degen portfolio formula exactly when disabled", () => {
    for (const cashbackMode of ["cash", "spot"] as const) {
      const strategy = config({ cashbackMode });
      for (const p of [0.25, 0.8, 1, 1.5, 3]) {
        const legacy = strategy.longAllocation * longValue(p, strategy.longLtv, cashbackMode) +
          (1 - strategy.longAllocation) * shortValue(p, strategy.shortLtv, cashbackMode);
        expect(portfolioValue(p, strategy)).toBeCloseTo(legacy, 12);
      }
    }
  });

  it("scales the same candidate strategy and retains original-capital normalisation", () => {
    const strategy = config({ degenEnabled: true, degenMode: "x2", cashbackMode: "cash" });
    const atEntry = portfolioComponents(1, strategy);
    expect(atEntry.total).toBeCloseTo(1, 12);
    expect(atEntry.long / atEntry.short).toBeCloseTo(
      (strategy.longAllocation * 0.5) / ((1 - strategy.longAllocation) * 0.5),
      12,
    );
    expect(atEntry.residualCashback).toBe(0.125);
  });

  it("makes equivalent Custom and preset targets produce identical payoff curves", () => {
    const preset = config({ degenEnabled: true, degenMode: "x2" });
    const custom = config({ degenEnabled: true, degenMode: "custom", customRecyclePct: 75 });
    for (const p of [0.2, 0.75, 1, 2, 5])
      expect(portfolioValue(p, custom)).toBeCloseTo(portfolioValue(p, preset), 12);
  });
});
