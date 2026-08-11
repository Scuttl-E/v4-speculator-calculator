/// <reference lib="webworker" />
import { optimisePortfolioWithOutcome } from "./optimiser";
import { createProductRoutingDecision } from "./productRoutingDecision";
import type { OptimiseOptions } from "./types";

self.onmessage = (event: MessageEvent<OptimiseOptions>) => {
  try {
    const options = event.data;
    const outcome = optimisePortfolioWithOutcome(options);
    self.postMessage({
      ok: true,
      outcome,
      productRoutingDecision: createProductRoutingDecision(options, outcome),
    });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : "Optimisation failed" });
  }
};
