import { describe, expect, it } from "vitest";
import { analysisRangeFromPercent, findWorstComponentDrawdown, findWorstDrawdown, longModeLabel, longValue, portfolioComponents, portfolioValue, shortModeLabel, shortValue } from "./v4Math";
import type { Config } from "./types";

const config = (longMode: Config["longMode"], longAllocation = 1): Config => ({
  deposit: 10_000, longAllocation, longMode, longLtv: longMode === "2x" ? .5 : .75,
  shortLtv: .5, shortMode: "2x", cashbackMode: "cash", cashOutEnabled: true,
  degenEnabled: false, degenMode: "x1", customRecyclePct: 0,
});

describe("V4 product labels", () => {
  it("uses the user-facing LTV terminology for Long and Short", () => {
    const expected = ["50% LTV", "75% LTV Cashback", "75% LTV"];
    const modes = ["2x", "2.5x-cashback", "2.5x-looped"] as const;
    expect(modes.map(longModeLabel)).toEqual(expected);
    expect(modes.map(shortModeLabel)).toEqual(expected);
  });
});

describe("V4 discrete Short products", () => {
  it("normalises every Short product at entry", () => {
    for (const mode of ["2x", "2.5x-cashback", "2.5x-looped"] as const)
      expect(shortValue(1, mode)).toBeCloseTo(1, 12);
  });
  it("partitions the eligible 75% Short curve once for Cashback", () => {
    const eligible = shortValue(2, "2.5x-looped");
    expect(shortValue(2, "2.5x-cashback", "cash")).toBeCloseTo(.5 + .5 * eligible, 12);
    expect(shortValue(2, "2.5x-cashback", "spot")).toBeCloseTo(1 + .5 * eligible, 12);
  });
  it("counts Cashback from both active legs and never from Looped", () => {
    const bothCashback = { ...config("2.5x-cashback", .4), shortMode: "2.5x-cashback" as const, shortLtv: .75 };
    const bothLooped = { ...config("2.5x-looped", .4), shortMode: "2.5x-looped" as const, shortLtv: .75 };
    expect(portfolioComponents(1, bothCashback).cashOut).toBeCloseTo(.5, 12);
    expect(portfolioComponents(1, bothLooped).cashOut).toBe(0);
  });
  it("separates the routed Cashback value from capital still inside V4", () => {
    const shortCashback = { ...config("2x", .5), shortMode: "2.5x-cashback" as const, shortLtv: .75 };
    const cash = portfolioComponents(3, shortCashback);
    const spot = portfolioComponents(3, { ...shortCashback, cashbackMode: "spot" });
    expect(cash.cashbackValue).toBeCloseTo(.25, 12);
    expect(spot.cashbackValue).toBeCloseTo(.75, 12);
    expect(cash.insideV4 + cash.cashbackValue).toBeCloseTo(cash.total, 12);
    expect(spot.insideV4 + spot.cashbackValue).toBeCloseTo(spot.total, 12);
  });
  it("does not let external Short Cashback cushion isolated Short risk", () => {
    const shortCashback = { ...config("2x", 0), shortMode: "2.5x-cashback" as const, shortLtv: .75 };
    const shortLooped = { ...shortCashback, shortMode: "2.5x-looped" as const };
    const range = analysisRangeFromPercent(-80, 200);
    expect(findWorstComponentDrawdown(shortCashback, range).drawdown)
      .toBeCloseTo(findWorstComponentDrawdown(shortLooped, range).drawdown, 12);
  });
});

describe("V4 discrete Long products", () => {
  it("normalises every product to the original capital at entry", () => {
    for (const mode of ["2x", "2.5x-cashback", "2.5x-looped"] as const)
      expect(portfolioValue(1, config(mode))).toBeCloseTo(1, 12);
  });
  it("pays the 50% option only for Cashback", () => {
    expect(portfolioComponents(1, config("2.5x-cashback")).cashOut).toBe(.5);
    expect(portfolioComponents(1, config("2.5x-looped")).cashOut).toBe(0);
  });
  it("routes the same 50% into rebalanced exposure without fixed debt", () => {
    expect(longValue(2, "2.5x-looped")).toBe(4); // 2²
    expect(longValue(2, "2.5x-cashback")).toBe(2.5); // .5 × 2² + .5
  });
  it("keeps cash-out and retained capital mutually exclusive", () => {
    const cash = portfolioComponents(1, config("2.5x-cashback", .6));
    const looped = portfolioComponents(1, config("2.5x-looped", .6));
    expect(cash.cashOut).toBe(.3);
    expect(looped.cashOut).toBe(0);
    expect(looped.long).toBeCloseTo(.6, 12);
  });
  it("keeps Looped non-negative for every positive underlying price", () => {
    for (let exponent = -6; exponent <= 4; exponent += .05) {
      const p = 10 ** exponent;
      expect(longValue(p, "2.5x-looped")).toBeGreaterThanOrEqual(0);
      expect(longValue(p, "2.5x-looped")).toBeCloseTo(p ** 2, 12);
    }
  });
  it("lets Looped approach zero without an artificial liquidation threshold", () => {
    expect(longValue(.001, "2.5x-looped")).toBeCloseTo(.000001, 12);
    expect(longValue(.5, "2.5x-looped")).toBe(.25);
    expect(longValue(1 / Math.sqrt(3), "2.5x-looped")).toBeCloseTo(1 / 3, 12);
  });
  it("does not allow retired Degen settings to alter an explicit Looped product", () => {
    const plain = config("2.5x-looped");
    const legacyDegen = { ...plain, degenEnabled: true, degenMode: "max" as const, customRecyclePct: 100 };
    for (const p of [.01, .25, 1, 2, 3])
      expect(portfolioValue(p, legacyDegen)).toBeCloseTo(portfolioValue(p, plain), 12);
  });
  it("uses the corrected Looped payoff in isolated-leg drawdown", () => {
    const range = analysisRangeFromPercent(-99, 200);
    expect(findWorstComponentDrawdown(config("2.5x-looped"), range).drawdown)
      .toBeCloseTo(-.9999, 12);
  });
  it("uses the worse isolated leg for risk instead of allowing legs to mask each other", () => {
    const mixed = config("2x", .5);
    const range = analysisRangeFromPercent(-80, 200);
    expect(findWorstComponentDrawdown(mixed, range).drawdown)
      .toBeLessThan(findWorstDrawdown(mixed, range).drawdown);
    expect(findWorstComponentDrawdown(mixed, range).drawdown).toBeCloseTo(-.4, 10);
  });
  it("does not let external Cashback cushion the V4 Long leg risk", () => {
    const range = analysisRangeFromPercent(-80, 200);
    expect(findWorstComponentDrawdown(config("2.5x-cashback"), range).drawdown)
      .toBeCloseTo(-.96, 10);
  });
  it("scales isolated-leg loss by the capital actually allocated to that leg", () => {
    const range = analysisRangeFromPercent(-80, 200);
    expect(findWorstComponentDrawdown(config("2.5x-cashback", .25), range).drawdown)
      .toBeCloseTo(-.24, 10);
  });
});
