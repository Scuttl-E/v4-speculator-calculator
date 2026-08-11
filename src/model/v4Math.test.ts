import { describe, expect, it } from "vitest";
import { analysisRangeFromPercent, findWorstComponentDrawdown, findWorstDrawdown, longValue, portfolioComponents, portfolioValue } from "./v4Math";
import type { Config } from "./types";

const config = (longMode: Config["longMode"], longAllocation = 1): Config => ({
  deposit: 10_000, longAllocation, longMode, longLtv: longMode === "2x" ? .5 : .75,
  shortLtv: .5, cashbackMode: "cash", cashOutEnabled: true,
  degenEnabled: false, degenMode: "x1", customRecyclePct: 0,
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
  it("loops that same 50% once, with no recursive multiplier", () => {
    // $10k initial: $15k deployed at p=1; the retained $5k is a fixed liability.
    expect(longValue(2, "2.5x-looped")).toBe(5.5); // 1.5 × 2² − .5
    expect(longValue(2, "2.5x-cashback")).toBe(2.5); // .5 × 2² + .5
  });
  it("keeps cash-out and retained capital mutually exclusive", () => {
    const cash = portfolioComponents(1, config("2.5x-cashback", .6));
    const looped = portfolioComponents(1, config("2.5x-looped", .6));
    expect(cash.cashOut).toBe(.3);
    expect(looped.cashOut).toBe(0);
    expect(looped.long).toBeCloseTo(.6, 12); // gross capital and its fixed liability net to entry equity
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
