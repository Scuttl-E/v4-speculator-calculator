import { describe, expect, it } from "vitest";
import { ADVANCED_MAX_LTV, effectiveLeverage, findDownsideBreakeven, findWorstDrawdown, longValue, shortValue } from "./v4Math";
import type { Config } from "./types";
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
    expect(effectiveLeverage(0.833333333)).toBeCloseTo(3, 6);
    expect(effectiveLeverage(ADVANCED_MAX_LTV).toFixed(2)).toBe("3.00");
  });
  it("all selected models start at one", () => {
    for (const ltv of [0.5, 0.6, 0.75, 0.833333333]) {
      expect(longValue(1, ltv, "cash")).toBe(1);
      expect(longValue(1, ltv, "spot")).toBe(1);
      expect(shortValue(1, ltv, "cash")).toBe(1);
      expect(shortValue(1, ltv, "spot")).toBe(1);
    }
  });
  it("finds the lower-price breakeven beyond a downside trough", () => {
    const config: Config = { deposit: 10000, longAllocation: 0.6, longLtv: 0.75, shortLtv: 0.5, cashbackMode: "spot" };
    const trough = findWorstDrawdown(config);
    const breakeven = findDownsideBreakeven(config, trough);
    expect(breakeven).not.toBeNull();
    expect(breakeven!).toBeLessThan(trough.p);
  });
});
