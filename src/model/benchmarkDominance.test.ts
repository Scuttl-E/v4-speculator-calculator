import { describe, expect, it } from "vitest";
import {
  createBenchmarkDominanceEvaluator,
  isBetterBenchmarkDominanceScore,
} from "./benchmarkDominance";
import { analyseDownsideRecoveryPath } from "./objectiveAnalysis";
import type { Config } from "./types";

const config: Config = {
  deposit: 18000,
  longAllocation: 0.5,
  longLtv: 0.5,
  shortLtv: 0.5,
  cashbackMode: "cash",
  degenEnabled: false,
  degenMode: "x1",
  customRecyclePct: 50,
};
const common = {
  requestedMinMove: -80,
  requestedMaxMove: 200,
  debtPosition: {
    assetPrice: 4000,
    assetAmount: 20,
    usdDebt: 15000,
    liquidationLtv: 0.9,
  },
  perpPosition: {
    assetPrice: 2000,
    averageEntryPrice: 1500,
    positionSize: 5,
    margin: 10000,
    liquidationPrice: 1100,
    side: "long" as const,
  },
};

describe("benchmark dominance", () => {
  it("uses spot in Base mode", () => {
    const evaluator = createBenchmarkDominanceEvaluator({ ...common, comparisonMode: "base" });
    expect(evaluator).not.toBeNull();
    expect(evaluator!.analyse(config).benchmark).toBe("spot");
  });

  it("uses lending and clips the downside exactly at lending liquidation", () => {
    const evaluator = createBenchmarkDominanceEvaluator({ ...common, comparisonMode: "lending" });
    expect(evaluator).not.toBeNull();
    const result = evaluator!.analyse(config);
    const liquidationMove = (15000 / (0.9 * 20) / 4000 - 1) * 100;
    expect(result.benchmark).toBe("lending");
    expect(result.effectiveMinMove).toBeCloseTo(liquidationMove, 10);
    expect(Math.min(...evaluator!.moves)).toBeCloseTo(liquidationMove, 10);
    expect(evaluator!.moves.every((move) => move >= liquidationMove - 1e-10)).toBe(true);
  });

  it("uses perp and clips a short position at its upside liquidation", () => {
    const shortPerp = { ...common.perpPosition, side: "short" as const, liquidationPrice: 3000 };
    const evaluator = createBenchmarkDominanceEvaluator({ ...common, comparisonMode: "perp", perpPosition: shortPerp });
    expect(evaluator).not.toBeNull();
    const result = evaluator!.analyse(config);
    expect(result.benchmark).toBe("perp");
    expect(result.effectiveMaxMove).toBeCloseTo(50, 10);
    expect(Math.max(...evaluator!.moves)).toBeCloseTo(50, 10);
    expect(evaluator!.moves.every((move) => move <= 50 + 1e-10)).toBe(true);
  });

  it("ranks worst edge, then average edge, then lower drawdown lexicographically", () => {
    const current = { worstEdgePts: -8, averageEdgePts: 10, maxDrawdown: -0.2 };
    expect(isBetterBenchmarkDominanceScore({ worstEdgePts: -2, averageEdgePts: 0, maxDrawdown: -0.5 }, current)).toBe(true);
    expect(isBetterBenchmarkDominanceScore({ worstEdgePts: -8, averageEdgePts: 11, maxDrawdown: -0.5 }, current)).toBe(true);
    expect(isBetterBenchmarkDominanceScore({ worstEdgePts: -8, averageEdgePts: 10, maxDrawdown: -0.1 }, current)).toBe(true);
    expect(isBetterBenchmarkDominanceScore({ worstEdgePts: -9, averageEdgePts: 100, maxDrawdown: 0 }, current)).toBe(false);
  });

  it("reports the sampled worst-edge location and excludes post-liquidation points from V4 Ahead", () => {
    const evaluator = createBenchmarkDominanceEvaluator({ ...common, comparisonMode: "lending" })!;
    const result = evaluator.analyse(config);
    expect(result.worstMove).toBeGreaterThanOrEqual(result.effectiveMinMove - 1e-8);
    expect(result.worstMove).toBeLessThanOrEqual(result.effectiveMaxMove + 1e-8);
    expect(result.aheadPercent).toBeGreaterThanOrEqual(0);
    expect(result.aheadPercent).toBeLessThanOrEqual(100);
  });
});

describe("downside recovery", () => {
  it("calculates an exact percentage-point recovery from a pre-target trough", () => {
    const result = analyseDownsideRecoveryPath(-80, (move) => -31.4 + 0.12225 * (move + 40) ** 2);
    expect(result).not.toBeNull();
    expect(result!.troughMove).toBeCloseTo(-40, 4);
    expect(result!.troughReturn).toBeCloseTo(-31.4, 4);
    expect(result!.targetReturn).toBeCloseTo(164.2, 4);
    expect(result!.recoveryPts).toBeCloseTo(195.6, 4);
  });

  it("hides a continuously declining path and ignores a trough beyond the target", () => {
    expect(analyseDownsideRecoveryPath(-80, (move) => move)).toBeNull();
    expect(analyseDownsideRecoveryPath(-40, (move) => (move + 60) ** 2)).toBeNull();
    expect(analyseDownsideRecoveryPath(-80, (move) => -move)).toBeNull();
  });
});
