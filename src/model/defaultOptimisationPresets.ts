import {
  GENERATED_DEFAULT_OPTIMISATION_PRESET_MODEL_VERSION,
  GENERATED_DEFAULT_OPTIMISATION_PRESETS,
} from "./generatedDefaultOptimisationPresets";
import type { ObjectiveAnalysis } from "./objectiveAnalysis";
import type { ProductRoutingDecision } from "./productRoutingDecision";
import type { ComparisonMode, Objective, OptimiseOptions, OptimiseOutcome } from "./types";
import { analysisRangeFromPercent, MAX_V4_LTV } from "./v4Math";

export interface DefaultOptimisationPreset {
  comparisonMode: ComparisonMode;
  objective: Objective;
  outcome: OptimiseOutcome;
  productRoutingDecision: ProductRoutingDecision | null;
  objectiveAnalysis: ObjectiveAnalysis | null;
}

export const DEFAULT_OPTIMISATION_PRESET_MODEL_VERSION =
  GENERATED_DEFAULT_OPTIMISATION_PRESET_MODEL_VERSION;
export const DEFAULT_OPTIMISER_MAX_DRAWDOWN_PERCENT = 50;
export const MAX_OPTIMISER_DRAWDOWN_PERCENT = 99;
export const DEFAULT_OPTIMISER_ANALYSIS_MIN_PERCENT = -99;
export const DEFAULT_OPTIMISER_ANALYSIS_MAX_PERCENT = 200;

const DEFAULT_DEBT_POSITION = {
  assetPrice: 2000,
  assetAmount: 20,
  usdDebt: 15000,
  liquidationLtv: .85,
};

const DEFAULT_PERP_POSITION = {
  assetPrice: 2000,
  averageEntryPrice: 2500,
  positionSize: 15,
  margin: 25000,
  liquidationPrice: 1200,
  side: "long" as const,
};

export function createDefaultOptimisationOptions(
  comparisonMode: ComparisonMode,
  objective: Objective,
): OptimiseOptions {
  const deposit = comparisonMode === "base"
    ? 10000
    : comparisonMode === "lending"
      ? DEFAULT_DEBT_POSITION.assetPrice * DEFAULT_DEBT_POSITION.assetAmount - DEFAULT_DEBT_POSITION.usdDebt
      : DEFAULT_PERP_POSITION.margin + DEFAULT_PERP_POSITION.positionSize *
        (DEFAULT_PERP_POSITION.assetPrice - DEFAULT_PERP_POSITION.averageEntryPrice);
  return {
    maxDrawdown: DEFAULT_OPTIMISER_MAX_DRAWDOWN_PERCENT / 100,
    maxLtv: MAX_V4_LTV,
    longMaxLtv: MAX_V4_LTV,
    shortMaxLtv: MAX_V4_LTV,
    bullishTargetPercent: 200,
    bearishTargetPercent: -75,
    analysisRange: analysisRangeFromPercent(
      DEFAULT_OPTIMISER_ANALYSIS_MIN_PERCENT,
      DEFAULT_OPTIMISER_ANALYSIS_MAX_PERCENT,
    ),
    searchStepPercent: 1,
    objective,
    comparisonMode,
    baseAssetValue: 0,
    spotParityPercent: 50,
    debtParityPercent: 50,
    perpParityPercent: 50,
    debtPosition: { ...DEFAULT_DEBT_POSITION },
    perpPosition: { ...DEFAULT_PERP_POSITION },
    cashbackPolicy: "auto",
    cashbackRouting: "auto",
    degenEnabled: false,
    degenMode: "x1",
    customRecyclePct: 50,
    requireBreakeven: false,
    downsideBreakevenPercent: -80,
    upsideBreakevenPercent: 200,
    deposit,
  };
}

const objectivesByMode: Record<ComparisonMode, readonly Objective[]> = {
  base: ["bullish", "bearish", "spotParity", "benchmarkDominance"],
  lending: ["bullish", "bearish", "spotParity", "debtParity", "benchmarkDominance"],
  perp: ["bullish", "bearish", "spotParity", "perpParity", "benchmarkDominance"],
};

export const DEFAULT_OPTIMISATION_PRESETS: DefaultOptimisationPreset[] =
  GENERATED_DEFAULT_OPTIMISATION_PRESETS;

export const DEFAULT_OPTIMISATION_PRESET_KEYS =
  (Object.entries(objectivesByMode) as Array<[ComparisonMode, readonly Objective[]]>)
    .flatMap(([comparisonMode, objectives]) => objectives.map((objective) =>
      `${comparisonMode}:${objective}`,
    ));
