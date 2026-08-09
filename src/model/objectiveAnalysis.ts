import {
  debtPositionReturn,
  debtPositionSummary,
  type DebtPositionInput,
} from "./debtPosition";
import {
  perpPositionReturn,
  perpPositionSummary,
  type PerpPositionInput,
} from "./perpPosition";
import {
  dollarValue,
  findWorstDrawdown,
  portfolioReturn,
} from "./v4Math";
import { targetPercentToPrice } from "./optimiser";
import { createBenchmarkDominanceEvaluator, type BenchmarkDominanceResult } from "./benchmarkDominance";
import type { ComparisonMode, Config, Objective } from "./types";

export interface TargetPayoffAnalysis {
  v4Return: number;
  benchmarkReturn: number;
  parityMargin: number;
}

export interface LiquidationAnalysis {
  assetMove: number;
  assetPrice: number | null;
  v4Return: number;
  v4Value: number;
}

export type ObjectiveAnalysis =
  | {
      kind: "bearish";
      troughMove: number;
      targetMove: number;
      troughReturn: number;
      targetReturn: number;
      recoveryPts: number;
    }
  | {
      kind: "dominance";
      result: BenchmarkDominanceResult;
    }
  | {
      kind: "spot";
      target: TargetPayoffAnalysis;
      v4MaxDrawdown: number;
      spotMaxDrawdown: number;
      protectionGained: number;
    }
  | {
      kind: "lending" | "perp";
      target: TargetPayoffAnalysis;
      liquidation: LiquidationAnalysis | null;
    };

const targetAnalysis = (
  config: Config,
  priceRatio: number,
  benchmarkReturn: number,
): TargetPayoffAnalysis => {
  const v4Return = portfolioReturn(priceRatio, config) * 100;
  return {
    v4Return,
    benchmarkReturn,
    parityMargin: v4Return - benchmarkReturn,
  };
};

export function analyseDownsideRecoveryPath(
  targetMove: number,
  returnAtMove: (move: number) => number,
) {
  if (targetMove >= 0 || targetMove <= -100) return null;
  const sampleCount = 800;
  let troughMove = 0;
  let troughReturn = returnAtMove(0);
  let troughIndex = 0;
  for (let index = 1; index <= sampleCount; index++) {
    const move = (targetMove * index) / sampleCount;
    const value = returnAtMove(move);
    if (value < troughReturn) {
      troughMove = move;
      troughReturn = value;
      troughIndex = index;
    }
  }
  if (troughIndex > 0 && troughIndex < sampleCount) {
    let lo = (targetMove * (troughIndex + 1)) / sampleCount;
    let hi = (targetMove * (troughIndex - 1)) / sampleCount;
    for (let iteration = 0; iteration < 40; iteration++) {
      const a = (2 * lo + hi) / 3;
      const b = (lo + 2 * hi) / 3;
      if (returnAtMove(a) < returnAtMove(b)) hi = b;
      else lo = a;
    }
    troughMove = (lo + hi) / 2;
    troughReturn = returnAtMove(troughMove);
  }
  const targetReturn = returnAtMove(targetMove);
  const recoveryPts = targetReturn - troughReturn;
  const initialReturn = returnAtMove(0);
  if (
    troughMove >= -1e-6 ||
    troughMove <= targetMove + 1e-6 ||
    troughReturn >= initialReturn - 0.05 ||
    recoveryPts <= 0.05
  ) return null;
  return { troughMove, targetMove, troughReturn, targetReturn, recoveryPts };
}

export function createObjectiveAnalysis(input: {
  objective: Objective;
  config: Config;
  spotParityPercent: number;
  debtParityPercent: number;
  perpParityPercent: number;
  bearishTargetPercent: number;
  analysisMinPercent: number;
  analysisMaxPercent: number;
  comparisonMode: ComparisonMode;
  debtPosition: DebtPositionInput;
  perpPosition: PerpPositionInput;
}): ObjectiveAnalysis | null {
  if (input.objective === "bearish") {
    const recovery = analyseDownsideRecoveryPath(
      input.bearishTargetPercent,
      (move) => portfolioReturn(1 + move / 100, input.config) * 100,
    );
    return recovery ? { kind: "bearish", ...recovery } : null;
  }

  if (input.objective === "benchmarkDominance") {
    const evaluator = createBenchmarkDominanceEvaluator({
      comparisonMode: input.comparisonMode,
      requestedMinMove: input.analysisMinPercent,
      requestedMaxMove: input.analysisMaxPercent,
      debtPosition: input.debtPosition,
      perpPosition: input.perpPosition,
    });
    return evaluator ? { kind: "dominance", result: evaluator.analyse(input.config) } : null;
  }
  if (input.objective === "spotParity") {
    const priceRatio = targetPercentToPrice(input.spotParityPercent);
    const target = targetAnalysis(
      input.config,
      priceRatio,
      (priceRatio - 1) * 100,
    );
    const v4MaxDrawdown = findWorstDrawdown(input.config).drawdown * 100;
    const spotMaxDrawdown = -100;
    return {
      kind: "spot",
      target,
      v4MaxDrawdown,
      spotMaxDrawdown,
      protectionGained:
        Math.abs(spotMaxDrawdown) - Math.abs(v4MaxDrawdown),
    };
  }

  if (input.objective === "debtParity") {
    const priceRatio = targetPercentToPrice(input.debtParityPercent);
    const benchmarkReturn = debtPositionReturn(
      priceRatio,
      input.debtPosition,
    );
    if (benchmarkReturn === null) return null;
    const summary = debtPositionSummary(input.debtPosition);
    const liquidation =
      summary.liquidationPriceRatio === null ||
        summary.liquidationAssetMove === null
        ? null
        : {
            assetMove: summary.liquidationAssetMove,
            assetPrice: summary.liquidationPrice,
            v4Return:
              portfolioReturn(summary.liquidationPriceRatio, input.config) * 100,
            v4Value: dollarValue(summary.liquidationPriceRatio, input.config),
          };
    return {
      kind: "lending",
      target: targetAnalysis(input.config, priceRatio, benchmarkReturn * 100),
      liquidation,
    };
  }

  if (input.objective === "perpParity") {
    const priceRatio = targetPercentToPrice(input.perpParityPercent);
    const benchmarkReturn = perpPositionReturn(priceRatio, input.perpPosition);
    if (benchmarkReturn === null) return null;
    const summary = perpPositionSummary(input.perpPosition);
    const liquidation =
      summary.liquidationPriceRatio === null ||
        summary.liquidationAssetMove === null
        ? null
        : {
            assetMove: summary.liquidationAssetMove,
            assetPrice: input.perpPosition.liquidationPrice > 0
              ? input.perpPosition.liquidationPrice
              : null,
            v4Return:
              portfolioReturn(summary.liquidationPriceRatio, input.config) * 100,
            v4Value: dollarValue(summary.liquidationPriceRatio, input.config),
          };
    return {
      kind: "perp",
      target: targetAnalysis(input.config, priceRatio, benchmarkReturn * 100),
      liquidation,
    };
  }

  return null;
}
