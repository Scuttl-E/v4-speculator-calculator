import { describe, expect, it } from "vitest";
import {
  DEFAULT_OPTIMISATION_PRESETS,
  DEFAULT_OPTIMISATION_PRESET_MODEL_VERSION,
} from "./defaultOptimisationPresets";
import { OPTIMISER_STATE_MODEL_VERSION } from "./optimisationState";
import { analyseCashbackCrossover } from "./cashbackCrossover";
import {
  optimisePortfolioWithCashbackFrontier,
  optimisePortfolioWithOutcome,
} from "./optimiser";
import { createObjectiveAnalysis } from "./objectiveAnalysis";
import type { ComparisonMode, Objective, OptimiseOptions } from "./types";

const debtPosition = {
  assetPrice: 2000,
  assetAmount: 20,
  usdDebt: 15000,
  liquidationLtv: 0.85,
};
const perpPosition = {
  assetPrice: 2000,
  averageEntryPrice: 2500,
  positionSize: 15,
  margin: 25000,
  liquidationPrice: 1200,
  side: "long" as const,
};
const defaultOptions = (
  comparisonMode: ComparisonMode,
  objective: Objective,
): OptimiseOptions => ({
  maxDrawdown: 0.15,
  maxLtv: 0.8,
  longMaxLtv: 0.8,
  shortMaxLtv: 0.8,
  bullishTargetPercent: 200,
  bearishTargetPercent: -75,
  analysisRange: { minPriceRatio: 0.2, maxPriceRatio: 3 },
  searchStepPercent: 1,
  objective,
  comparisonMode,
  baseAssetValue: 0,
  spotParityPercent: 50,
  debtParityPercent: 50,
  perpParityPercent: 50,
  debtPosition,
  perpPosition,
  cashbackMode: "optimise",
  degenEnabled: false,
  degenMode: "x1",
  customRecyclePct: 50,
  requireBreakeven: false,
  downsideBreakevenPercent: -80,
  upsideBreakevenPercent: 200,
  deposit: comparisonMode === "base" ? 10000
    : comparisonMode === "lending" ? 25000 : 17500,
});

const analysisFor = (options: OptimiseOptions, config: NonNullable<ReturnType<
  typeof optimisePortfolioWithOutcome
>["config"]>) => createObjectiveAnalysis({
  objective: options.objective,
  config,
  spotParityPercent: options.spotParityPercent,
  debtParityPercent: options.debtParityPercent,
  perpParityPercent: options.perpParityPercent,
  debtPosition: options.debtPosition,
  perpPosition: options.perpPosition,
  bearishTargetPercent: options.bearishTargetPercent ?? -75,
  analysisRange: options.analysisRange,
  comparisonMode: options.comparisonMode ?? "base",
});

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

  it("matches the active optimiser state model", () => {
    expect(DEFAULT_OPTIMISATION_PRESET_MODEL_VERSION).toBe(
      OPTIMISER_STATE_MODEL_VERSION,
    );
  });

  it("reproduces complete live-run outcomes and panel analysis", () => {
    for (const preset of DEFAULT_OPTIMISATION_PRESETS) {
      const options = defaultOptions(preset.comparisonMode, preset.objective);
      const live = preset.objective === "bullish"
        ? optimisePortfolioWithCashbackFrontier(options)
        : { outcome: optimisePortfolioWithOutcome(options), candidates: [] };
      const liveOutcome = { ...live.outcome, diagnostics: undefined };
      expect(preset.outcome, `${preset.comparisonMode}:${preset.objective} outcome`)
        .toEqual(liveOutcome);
      expect(preset.outcome.config).not.toBeNull();

      const liveCrossover = preset.objective === "bullish" && live.outcome.config
        ? analyseCashbackCrossover(live.candidates, {
            objective: preset.objective,
            bullishTargetPercent: options.bullishTargetPercent ?? 200,
            bearishTargetPercent: options.bearishTargetPercent ?? -75,
            currentDrawdown: options.maxDrawdown,
            currentConfig: live.outcome.config,
          })
        : null;
      expect(preset.crossover, `${preset.comparisonMode}:${preset.objective} crossover`)
        .toEqual(liveCrossover);
      const presetAnalysis = analysisFor(options, preset.outcome.config!);
      const expectedAnalysisKind = preset.objective === "bullish" ||
          preset.objective === "bearish" ? null
        : preset.objective === "spotParity" ? "spot"
        : preset.objective === "debtParity" ? "lending"
        : preset.objective === "perpParity" ? "perp"
        : "dominance";
      expect(presetAnalysis?.kind ?? null).toBe(expectedAnalysisKind);
      expect(
        presetAnalysis,
        `${preset.comparisonMode}:${preset.objective} analysis`,
      ).toEqual(analysisFor(options, live.outcome.config!));
    }
  }, 30000);
});
