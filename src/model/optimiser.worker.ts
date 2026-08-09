/// <reference lib="webworker" />
import {
  optimisePortfolioWithCashbackFrontier,
  optimisePortfolioWithOutcome,
} from "./optimiser";
import { analyseCashbackCrossover } from "./cashbackCrossover";
import type { OptimiseOptions } from "./types";

self.onmessage = (event: MessageEvent<OptimiseOptions>) => {
  try {
    const options = event.data;
    if (options.objective === "bullish") {
      const { outcome, candidates } =
        optimisePortfolioWithCashbackFrontier(options);
      const crossover = outcome.config
        ? analyseCashbackCrossover(candidates, {
            objective: options.objective,
            bullishTargetPercent: options.bullishTargetPercent ?? 200,
            bearishTargetPercent: options.bearishTargetPercent ?? -75,
            currentDrawdown: options.maxDrawdown,
            currentConfig: outcome.config,
          })
        : null;
      self.postMessage({ ok: true, outcome, crossover });
      return;
    }
    self.postMessage({
      ok: true,
      outcome: optimisePortfolioWithOutcome(options),
      crossover: null,
    });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : "Optimisation failed" });
  }
};
