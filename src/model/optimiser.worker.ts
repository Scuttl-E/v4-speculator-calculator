/// <reference lib="webworker" />
import { optimisePortfolioWithOutcome } from "./optimiser";
import type { OptimiseOptions } from "./types";

self.onmessage = (event: MessageEvent<OptimiseOptions>) => {
  try {
    self.postMessage({
      ok: true,
      outcome: optimisePortfolioWithOutcome(event.data),
    });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : "Optimisation failed" });
  }
};
