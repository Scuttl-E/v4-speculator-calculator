import { describe, expect, it } from "vitest";
import {
  createDefaultOptimisationOptions,
  DEFAULT_OPTIMISATION_PRESET_KEYS,
  DEFAULT_OPTIMISATION_PRESETS,
  DEFAULT_OPTIMISATION_PRESET_MODEL_VERSION,
  DEFAULT_OPTIMISER_ANALYSIS_MIN_PERCENT,
  DEFAULT_OPTIMISER_MAX_DRAWDOWN_PERCENT,
  MAX_OPTIMISER_DRAWDOWN_PERCENT,
} from "./defaultOptimisationPresets";
import { OPTIMISER_STATE_MODEL_VERSION } from "./optimisationState";
import { GENERATED_DEFAULT_OPTIMISATION_PRESETS } from "./generatedDefaultOptimisationPresets";
import { findWorstComponentDrawdown } from "./v4Math";

describe("fresh-install optimiser presets", () => {
  it("excludes cached results when their payoff model is out of date", () => {
    if (DEFAULT_OPTIMISATION_PRESET_MODEL_VERSION !== OPTIMISER_STATE_MODEL_VERSION) {
      expect(DEFAULT_OPTIMISATION_PRESETS).toEqual([]);
    } else {
      expect(DEFAULT_OPTIMISATION_PRESETS).toEqual(GENERATED_DEFAULT_OPTIMISATION_PRESETS);
    }
  });
  it("keeps the configured hard bounds", () => {
    expect(DEFAULT_OPTIMISER_ANALYSIS_MIN_PERCENT).toBe(-99);
    expect(DEFAULT_OPTIMISER_MAX_DRAWDOWN_PERCENT).toBe(50);
    expect(MAX_OPTIMISER_DRAWDOWN_PERCENT).toBe(99);
  });

  it("retains every bundled mode and objective key", () => {
    expect(GENERATED_DEFAULT_OPTIMISATION_PRESETS).toHaveLength(14);
    const generatedKeys = GENERATED_DEFAULT_OPTIMISATION_PRESETS
      .map(({ comparisonMode, objective }) => `${comparisonMode}:${objective}`);
    expect(new Set(generatedKeys).size).toBe(14);
    expect(generatedKeys).toEqual(DEFAULT_OPTIMISATION_PRESET_KEYS);
  });

  it("keeps mode defaults and validates the risk of any current presets", () => {
    const expectedDeposits = { base: 10000, lending: 25000, perp: 17500 } as const;
    for (const preset of GENERATED_DEFAULT_OPTIMISATION_PRESETS) {
      const options = createDefaultOptimisationOptions(preset.comparisonMode, preset.objective);
      expect(options.deposit, `${preset.comparisonMode}:${preset.objective}`)
        .toBe(expectedDeposits[preset.comparisonMode]);
      expect(options.analysisRange.minPriceRatio, `${preset.comparisonMode}:${preset.objective}`).toBeCloseTo(.01, 12);
    }
    for (const preset of DEFAULT_OPTIMISATION_PRESETS) {
      const options = createDefaultOptimisationOptions(preset.comparisonMode, preset.objective);
      expect(preset.outcome.config, `${preset.comparisonMode}:${preset.objective}`).not.toBeNull();
      expect(findWorstComponentDrawdown(preset.outcome.config!, options.analysisRange).drawdown, `${preset.comparisonMode}:${preset.objective}`)
        .toBeGreaterThanOrEqual(-options.maxDrawdown - 1e-8);
    }
  });
});
