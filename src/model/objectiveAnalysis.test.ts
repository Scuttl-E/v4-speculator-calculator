import { describe, expect, it } from "vitest";
import { createObjectiveAnalysis } from "./objectiveAnalysis";
import type { Config } from "./types";

const config: Config = {
  deposit: 18000,
  longAllocation: 0.5,
  longLtv: 0.5,
  shortLtv: 0.5,
  cashbackMode: "cash",
};
const common = {
  config,
  comparisonMode: "base" as const,
  bearishTargetPercent: -80,
  analysisMinPercent: -80,
  analysisMaxPercent: 200,
  spotParityPercent: 100,
  debtParityPercent: 50,
  perpParityPercent: 25,
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
    side: "long" as const,
  },
};

describe("objective-specific analysis", () => {
  it("compares V4 with spot and derives downside protection", () => {
    const result = createObjectiveAnalysis({
      ...common,
      objective: "spotParity",
    });
    expect(result?.kind).toBe("spot");
    if (!result || result.kind !== "spot") return;
    expect(result.target.benchmarkReturn).toBe(100);
    expect(result.target.parityMargin).toBeCloseTo(
      result.target.v4Return - 100,
      10,
    );
    expect(result.spotMaxDrawdown).toBe(-100);
    expect(result.protectionGained).toBeCloseTo(
      100 - Math.abs(result.v4MaxDrawdown),
      10,
    );
  });

  it("uses the canonical lending benchmark and liquidation point", () => {
    const result = createObjectiveAnalysis({
      ...common,
      objective: "debtParity",
    });
    expect(result?.kind).toBe("lending");
    if (!result || result.kind !== "lending") return;
    expect(result.target.parityMargin).toBeCloseTo(
      result.target.v4Return - result.target.benchmarkReturn,
      10,
    );
    expect(result.liquidation?.assetPrice).toBeCloseTo(833.333333, 5);
    expect(result.liquidation?.assetMove).toBeCloseTo(-79.166667, 5);
  });

  it("uses the canonical perp benchmark and entered liquidation point", () => {
    const result = createObjectiveAnalysis({
      ...common,
      objective: "perpParity",
    });
    expect(result?.kind).toBe("perp");
    if (!result || result.kind !== "perp") return;
    expect(result.target.parityMargin).toBeCloseTo(
      result.target.v4Return - result.target.benchmarkReturn,
      10,
    );
    expect(result.liquidation?.assetPrice).toBe(1100);
    expect(result.liquidation?.assetMove).toBeCloseTo(-42.105263, 5);
  });

  it("returns no parity analysis for manual objectives", () => {
    expect(createObjectiveAnalysis({ ...common, objective: "bullish" }))
      .toBeNull();
  });

  it("reports a downside trough and percentage-point recovery before the bearish target", () => {
    const result = createObjectiveAnalysis({ ...common, objective: "bearish" });
    expect(result?.kind).toBe("bearish");
    if (!result || result.kind !== "bearish") return;
    expect(result.troughMove).toBeGreaterThan(result.targetMove);
    expect(result.recoveryPts).toBeCloseTo(result.targetReturn - result.troughReturn, 10);
  });

  it("reports benchmark dominance using the active comparison mode", () => {
    const result = createObjectiveAnalysis({ ...common, objective: "benchmarkDominance" });
    expect(result?.kind).toBe("dominance");
    if (!result || result.kind !== "dominance") return;
    expect(result.result.benchmark).toBe("spot");
    expect(result.result.effectiveMinMove).toBeCloseTo(-80, 10);
    expect(result.result.effectiveMaxMove).toBeCloseTo(200, 10);
  });
});
