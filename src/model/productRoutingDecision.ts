import { optimisePortfolioWithOutcome, targetPercentToPrice } from "./optimiser";
import type { CashbackMode, Config, OptimiseOptions, OptimiseOutcome } from "./types";
import { portfolioReturn } from "./v4Math";

export interface ProductRoutingDecisionOption {
  config: Config;
  routing: CashbackMode;
  targetReturn: number;
}

export interface ProductRoutingDecision {
  targetPercent: number;
  selected: ProductRoutingDecisionOption;
  alternative: ProductRoutingDecisionOption;
}

const hasActiveCashback = (config: Config) =>
  (config.longAllocation > 1e-12 && config.longMode === "2.5x-cashback") ||
  (config.longAllocation < 1 - 1e-12 && config.shortMode === "2.5x-cashback");

const optionFor = (
  config: Config,
  targetPercent: number,
): ProductRoutingDecisionOption => ({
  config,
  routing: config.cashbackMode,
  targetReturn: portfolioReturn(targetPercentToPrice(targetPercent), config) * 100,
});

export function createProductRoutingDecision(
  options: OptimiseOptions,
  outcome: OptimiseOutcome,
): ProductRoutingDecision | null {
  if (options.objective !== "bullish" || !outcome.config || !hasActiveCashback(outcome.config))
    return null;

  const targetPercent = options.bullishTargetPercent ?? 200;
  const alternatives = (["native", "cash", "spot"] as const)
    .filter((routing) => routing !== outcome.config!.cashbackMode)
    .flatMap((routing) => {
      const alternative = optimisePortfolioWithOutcome({ ...options, cashbackPolicy: "forced", cashbackRouting: routing });
      return alternative.config && hasActiveCashback(alternative.config)
        ? [optionFor(alternative.config, targetPercent)] : [];
    });
  const alternative = alternatives.sort((a, b) => b.targetReturn - a.targetReturn)[0];
  if (!alternative) return null;

  return {
    targetPercent,
    selected: optionFor(outcome.config, targetPercent),
    alternative,
  };
}
