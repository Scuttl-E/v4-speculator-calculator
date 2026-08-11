import { describe, expect, it } from "vitest";
import { optimisePortfolioWithOutcome } from "./optimiser";
import { createProductRoutingDecision } from "./productRoutingDecision";
import { analysisRangeFromPercent } from "./v4Math";
import type { OptimiseOptions } from "./types";

const options: OptimiseOptions = {
  maxDrawdown: .5, maxLtv: .75, longMaxLtv: .75, shortMaxLtv: .75,
  bullishTargetPercent: 200, bearishTargetPercent: -75,
  analysisRange: analysisRangeFromPercent(-99, 200), searchStepPercent: 1,
  objective: "bullish", comparisonMode: "base", baseAssetValue: 0,
  spotParityPercent: 50, debtParityPercent: 50, perpParityPercent: 50,
  debtPosition: { assetPrice: 2000, assetAmount: 20, usdDebt: 15000, liquidationLtv: .85 },
  perpPosition: { assetPrice: 2000, averageEntryPrice: 2500, positionSize: 15, margin: 25000, liquidationPrice: 1200, side: "long" },
  cashbackPolicy: "forced", cashbackRouting: "auto",
  degenEnabled: false, degenMode: "x1", customRecyclePct: 0,
  requireBreakeven: false, downsideBreakevenPercent: -80, upsideBreakevenPercent: 200,
  deposit: 10000,
};

describe("product and routing decision", () => {
  it("compares the selected result with the best forced opposing route", () => {
    const outcome = optimisePortfolioWithOutcome(options);
    const decision = createProductRoutingDecision(options, outcome);
    expect(decision).not.toBeNull();
    expect(decision!.alternative.routing).not.toBe(decision!.selected.routing);
    expect(decision!.selected.config.cashOutEnabled).toBe(true);
    expect(decision!.alternative.config.cashOutEnabled).toBe(true);
  });

  it("is absent when Cashback is excluded", () => {
    const off = { ...options, cashbackPolicy: "off" as const };
    expect(createProductRoutingDecision(off, optimisePortfolioWithOutcome(off))).toBeNull();
  });
});
