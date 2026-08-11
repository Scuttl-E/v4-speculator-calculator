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

  const selectedRouting = outcome.config.cashbackMode;
  const opposingRouting: CashbackMode = selectedRouting === "cash" ? "spot" : "cash";
  const alternativeOutcome = optimisePortfolioWithOutcome({
    ...options,
    cashbackPolicy: "forced",
    cashbackRouting: opposingRouting,
  });
  if (!alternativeOutcome.config || !hasActiveCashback(alternativeOutcome.config)) return null;

  const targetPercent = options.bullishTargetPercent ?? 200;
  return {
    targetPercent,
    selected: optionFor(outcome.config, targetPercent),
    alternative: optionFor(alternativeOutcome.config, targetPercent),
  };
}
