import { describe, expect, it } from "vitest";
import {
  DEFAULT_OPTIMISATION_PRESETS,
  DEFAULT_OPTIMISATION_PRESET_MODEL_VERSION,
} from "./defaultOptimisationPresets";
import { OPTIMISER_STATE_MODEL_VERSION } from "./optimisationState";

describe("default optimisation presets", () => {
  it("ships every objective valid for each comparison mode", () => {
    const keys = DEFAULT_OPTIMISATION_PRESETS.map(
      ({ comparisonMode, objective }) => `${comparisonMode}:${objective}`,
    );
    expect(keys).toHaveLength(14);
    expect(new Set(keys).size).toBe(14);
    expect(keys).toEqual(expect.arrayContaining([
      "base:bullish",
      "base:bearish",
      "base:spotParity",
      "base:benchmarkDominance",
      "lending:debtParity",
      "perp:perpParity",
    ]));
  });

  it("keeps each mode tied to its own default starting capital", () => {
    const deposits = Object.fromEntries(
      DEFAULT_OPTIMISATION_PRESETS.map(({ comparisonMode, outcome }) => [
        comparisonMode,
        outcome.config?.deposit,
      ]),
    );
    expect(deposits).toEqual({ base: 10000, lending: 25000, perp: 17500 });
  });

  it("is invalidated when the optimiser state model changes", () => {
    expect(DEFAULT_OPTIMISATION_PRESET_MODEL_VERSION).toBe(
      OPTIMISER_STATE_MODEL_VERSION,
    );
  });
});
