import { describe, expect, it } from "vitest";
import { optimisePortfolio, optimisePortfolioWithOutcome, targetPercentToPrice } from "./optimiser";
import { analysisRangeFromPercent, findWorstComponentDrawdown, portfolioValue } from "./v4Math";
import type { OptimiseOptions } from "./types";

const options: OptimiseOptions = {
  maxDrawdown: .15,
  maxLtv: .75,
  analysisRange: analysisRangeFromPercent(-80, 200),
  objective: "bullish",
  spotParityPercent: 50,
  debtParityPercent: 50,
  perpParityPercent: 50,
  debtPosition: { assetPrice: 2000, assetAmount: 20, usdDebt: 15000, liquidationLtv: .85 },
  perpPosition: { assetPrice: 2000, averageEntryPrice: 2500, positionSize: 15, margin: 25000, liquidationPrice: 1200, side: "long" },
  requireBreakeven: false,
  downsideBreakevenPercent: -80,
  upsideBreakevenPercent: 200,
  deposit: 10000,
  degenEnabled: false,
  degenMode: "x1",
  customRecyclePct: 0,
};

describe("discrete V4 optimiser", () => {
  it("considers only protocol products", () => {
    const result = optimisePortfolio(options);
    expect(["2x", "2.5x-cashback", "2.5x-looped"]).toContain(result.longMode);
    expect([.5, .75]).toContain(result.shortLtv);
  });

  it("honours Cashback and Looped product selections when those products are feasible", () => {
    const productOptions = {
      ...options,
      maxDrawdown: .6,
      analysisRange: analysisRangeFromPercent(-20, 200),
    };
    expect(optimisePortfolio({ ...productOptions, cashbackMode: "cash" }).longMode)
      .toBe("2.5x-cashback");
    expect(optimisePortfolio({ ...productOptions, cashbackMode: "spot" }).longMode)
      .toBe("2.5x-looped");
  });

  it("satisfies a forced Long product only with a positive Long allocation", () => {
    const outcome = optimisePortfolioWithOutcome({ ...options, cashbackMode: "cash" });
    expect(outcome.config?.longMode).toBe("2.5x-cashback");
    expect(outcome.config!.longAllocation).toBeGreaterThan(0);
  });

  it("fails clearly when leverage limits make a forced Long product unavailable", () => {
    const outcome = optimisePortfolioWithOutcome({ ...options, cashbackMode: "cash", longMaxLtv: .5 });
    expect(outcome.status).toBe("no-valid-configuration");
    expect(outcome.config).toBeNull();
    expect(outcome.failure).toContain("positive Cashback Long");
  });

  it("returns the best feasible parity result when exact parity is unreachable", () => {
    const outcome = optimisePortfolioWithOutcome({
      ...options,
      objective: "spotParity",
      maxDrawdown: .15,
      analysisRange: analysisRangeFromPercent(-99, 200),
      spotParityPercent: 200,
    });
    expect(outcome.status).toBe("best-effort");
    expect(outcome.config).not.toBeNull();
    expect(outcome.parity?.reached).toBe(false);
    expect(outcome.parity?.shortfall).toBeGreaterThan(0);
    expect(findWorstComponentDrawdown(outcome.config!, options.analysisRange).drawdown)
      .toBeGreaterThanOrEqual(-.15 - 1e-8);
  });

  it("never worsens the bullish objective when the risk limit is loosened", () => {
    const strict = optimisePortfolioWithOutcome({ ...options, maxDrawdown: .15 });
    const loose = optimisePortfolioWithOutcome({ ...options, maxDrawdown: .8 });
    const target = targetPercentToPrice(options.bullishTargetPercent ?? 200);
    expect(portfolioValue(target, loose.config!))
      .toBeGreaterThanOrEqual(portfolioValue(target, strict.config!) - 1e-12);
  });

  it("applies the same scaled leg-risk gate across every strategy", () => {
    const cases: Array<Pick<OptimiseOptions, "objective" | "comparisonMode">> = [
      { objective: "bullish", comparisonMode: "base" },
      { objective: "bearish", comparisonMode: "base" },
      { objective: "spotParity", comparisonMode: "base" },
      { objective: "benchmarkDominance", comparisonMode: "base" },
      { objective: "debtParity", comparisonMode: "lending" },
      { objective: "perpParity", comparisonMode: "perp" },
    ];
    for (const strategy of cases) {
      const outcome = optimisePortfolioWithOutcome({ ...options, ...strategy });
      expect(outcome.config, strategy.objective).not.toBeNull();
      expect(findWorstComponentDrawdown(outcome.config!, options.analysisRange).drawdown, strategy.objective)
        .toBeGreaterThanOrEqual(-options.maxDrawdown - 1e-8);
    }
    expect(optimisePortfolioWithOutcome(options).config!.longAllocation).toBeGreaterThan(0);
  });
});
