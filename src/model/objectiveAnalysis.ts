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
import type { Config, Objective } from "./types";

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

export function createObjectiveAnalysis(input: {
  objective: Objective;
  config: Config;
  spotParityPercent: number;
  debtParityPercent: number;
  perpParityPercent: number;
  debtPosition: DebtPositionInput;
  perpPosition: PerpPositionInput;
}): ObjectiveAnalysis | null {
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
