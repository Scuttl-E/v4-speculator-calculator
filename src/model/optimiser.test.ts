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
    expect(["2x", "2.5x-cashback", "2.5x-looped"]).toContain(result.shortMode);
  });

  it("excludes Cashback products when Cashback is off", () => {
    const result = optimisePortfolio({ ...options, cashbackPolicy: "off" });
    if (result.longAllocation > 0) expect(result.longMode).not.toBe("2.5x-cashback");
    if (result.longAllocation < 1) expect(result.shortMode).not.toBe("2.5x-cashback");
  });

  it("forces an active Cashback product on either eligible side", () => {
    const outcome = optimisePortfolioWithOutcome({ ...options, cashbackPolicy: "forced" });
    const config = outcome.config!;
    expect((config.longAllocation > 0 && config.longMode === "2.5x-cashback") ||
      (config.longAllocation < 1 && config.shortMode === "2.5x-cashback")).toBe(true);
  });

  it("can force Short Cashback when Long is limited to 2x", () => {
    const config = optimisePortfolio({ ...options, cashbackPolicy: "forced", longMaxLtv: .5 });
    expect(config.shortMode).toBe("2.5x-cashback");
    expect(config.longAllocation).toBeLessThan(1);
  });

  it("fails clearly when neither side permits a forced Cashback product", () => {
    const outcome = optimisePortfolioWithOutcome({ ...options, cashbackPolicy: "forced", longMaxLtv: .5, shortMaxLtv: .5 });
    expect(outcome.status).toBe("no-valid-configuration");
    expect(outcome.config).toBeNull();
    expect(outcome.failure).toContain("Cashback Long or Short");
  });

  it("honours fixed Cashback routing and searches both routes in Auto", () => {
    expect(optimisePortfolio({ ...options, cashbackPolicy: "forced", cashbackRouting: "cash" }).cashbackMode).toBe("cash");
    expect(optimisePortfolio({ ...options, cashbackPolicy: "forced", cashbackRouting: "spot" }).cashbackMode).toBe("spot");
    expect(["cash", "spot"]).toContain(optimisePortfolio({ ...options, cashbackPolicy: "forced", cashbackRouting: "auto" }).cashbackMode);
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
