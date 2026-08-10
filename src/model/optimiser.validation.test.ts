import { describe, expect, it } from "vitest";
import { createBenchmarkDominanceEvaluator } from "./benchmarkDominance";
import {
  optimisePortfolioExhaustiveReference,
  optimisePortfolioWithOutcome,
  targetPercentToPrice,
} from "./optimiser";
import type { Config, OptimiseOptions } from "./types";
import { findWorstDrawdown, portfolioValue } from "./v4Math";

const base: OptimiseOptions = {
  maxDrawdown: 0.15,
  maxLtv: 0.8,
  longMaxLtv: 0.8,
  shortMaxLtv: 0.8,
  bullishTargetPercent: 200,
  bearishTargetPercent: -75,
  analysisMinPercent: -80,
  analysisMaxPercent: 200,
  searchStepPercent: 2,
  objective: "bullish",
  comparisonMode: "base",
  spotParityPercent: 50,
  debtParityPercent: 50,
  perpParityPercent: 50,
  debtPosition: {
    assetPrice: 4000,
    assetAmount: 20,
    usdDebt: 15000,
    liquidationLtv: 0.9,
  },
  perpPosition: {
    assetPrice: 1900,
    averageEntryPrice: 1500,
    positionSize: 20,
    margin: 10000,
    liquidationPrice: 1100,
    side: "long",
  },
  cashbackMode: "optimise",
  degenEnabled: false,
  degenMode: "x1",
  customRecyclePct: 50,
  requireBreakeven: false,
  downsideBreakevenPercent: -80,
  upsideBreakevenPercent: 400,
  deposit: 25000,
};

const score = (options: OptimiseOptions, config: Config) => {
  if (options.objective === "bullish")
    return portfolioValue(targetPercentToPrice(options.bullishTargetPercent ?? 200), config);
  if (options.objective === "bearish")
    return portfolioValue(targetPercentToPrice(options.bearishTargetPercent ?? -75), config);
  if (options.objective === "benchmarkDominance")
    return createBenchmarkDominanceEvaluator({
      comparisonMode: options.comparisonMode ?? "base",
      requestedMinMove: options.analysisMinPercent ?? -80,
      requestedMaxMove: options.analysisMaxPercent ?? 200,
      debtPosition: options.debtPosition,
      perpPosition: options.perpPosition,
    })!.analyse(config).worstEdgePts;
  return findWorstDrawdown(config).drawdown;
};

const cases: Array<[string, Partial<OptimiseOptions>]> = [
  ["bullish / Auto cashback", {}],
  ["bearish", { objective: "bearish", maxDrawdown: 0.3 }],
  ["spot parity", { objective: "spotParity", spotParityPercent: 100 }],
  ["tight drawdown", { maxDrawdown: 0.05, cashbackMode: "cash" }],
  ["downside breakeven", {
    requireBreakeven: true,
    downsideBreakevenPercent: -70,
    cashbackMode: "spot",
  }],
  ["lending parity", {
    objective: "debtParity",
    comparisonMode: "lending",
    deposit: 65000,
  }],
  ["perp parity near liquidation", {
    objective: "perpParity",
    comparisonMode: "perp",
    deposit: 22000,
    perpPosition: { ...base.perpPosition, liquidationPrice: 1875, positionSize: 5 },
  }],
  ["base benchmark dominance", { objective: "benchmarkDominance", maxDrawdown: 0.3 }],
  ["lending benchmark dominance", {
    objective: "benchmarkDominance",
    comparisonMode: "lending",
    maxDrawdown: 0.3,
  }],
  ["perp benchmark dominance", {
    objective: "benchmarkDominance",
    comparisonMode: "perp",
    maxDrawdown: 0.3,
  }],
];

describe("coarse-to-fine validation against exhaustive search", () => {
  it.each(cases)("matches the exhaustive final grid for %s", (_, overrides) => {
    const options = { ...base, ...overrides };
    const adaptive = optimisePortfolioWithOutcome(options);
    const exhaustive = optimisePortfolioExhaustiveReference(options);
    expect(adaptive.config).not.toBeNull();
    expect(exhaustive.config).not.toBeNull();
    expect(adaptive.config).toEqual(exhaustive.config);
    expect(score(options, adaptive.config!)).toBeCloseTo(score(options, exhaustive.config!), 9);
    expect(findWorstDrawdown(adaptive.config!).drawdown).toBeCloseTo(
      findWorstDrawdown(exhaustive.config!).drawdown,
      9,
    );
    expect(adaptive.diagnostics!.candidatesEvaluated).toBeLessThan(
      exhaustive.diagnostics!.candidatesEvaluated,
    );
  });

  it("remains exact at 1% on a bounded validation space", () => {
    const options = {
      ...base,
      searchStepPercent: 1,
      maxLtv: 0.54,
      longMaxLtv: 0.54,
      shortMaxLtv: 0.54,
    };
    const adaptive = optimisePortfolioWithOutcome(options);
    const exhaustive = optimisePortfolioExhaustiveReference(options);
    expect(adaptive.config).toEqual(exhaustive.config);
    expect(adaptive.diagnostics!.candidatesEvaluated).toBeLessThan(
      exhaustive.diagnostics!.candidatesEvaluated,
    );
  });

  it("returns the same financial result on repeated runs", () => {
    const first = optimisePortfolioWithOutcome(base);
    const second = optimisePortfolioWithOutcome(base);
    expect({ ...first, diagnostics: undefined }).toEqual({
      ...second,
      diagnostics: undefined,
    });
  });
});
