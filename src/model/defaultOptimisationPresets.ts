import type { CashbackCrossoverResult } from "./cashbackCrossover";
import type { ComparisonMode, Objective, OptimiseOutcome } from "./types";

export interface DefaultOptimisationPreset {
  comparisonMode: ComparisonMode;
  objective: Objective;
  outcome: OptimiseOutcome;
  crossover: CashbackCrossoverResult | null;
}

export const DEFAULT_OPTIMISATION_PRESET_MODEL_VERSION: string =
  "v4-price-model-2026-08-coarse-to-fine-1";

const outcome = (
  deposit: number,
  longAllocation: number,
  longLtv: number,
  shortLtv: number,
  cashbackMode: "cash" | "spot",
  adverseDirection: "downside" | "upside" = "downside",
): OptimiseOutcome => ({
  config: { deposit, longAllocation, longLtv, shortLtv, cashbackMode },
  requestedMaxDrawdown: 0.15,
  effectiveMaxDrawdown: 0.15,
  drawdownRelaxed: false,
  adverseDirection,
  downsideBreakeven: null,
  upsideBreakeven: null,
  debtParity: null,
  perpParity: null,
  failure: null,
});

const bullishCrossover: CashbackCrossoverResult = {
  becomesOptimal: "spot",
  currentDrawdown: 0.15,
  crossoverDrawdown: 0.5475000000000001,
  currentPayoff: 572.6165001233429,
  switchPayoff: 758.1472437320624,
  changePts: 39.75000000000001,
  payoffDeltaPts: 185.5307436087195,
  efficiency: 4.667440090785395,
};

const baseBullish = outcome(10000, 0.78, 0.8, 0.8, "cash");
const baseBearish = outcome(10000, 0, 0.5, 0.8, "cash", "upside");
const baseSpotParity = outcome(10000, 0.4, 0.8, 0.8, "spot");
const baseDominance = outcome(10000, 0.56, 0.8, 0.8, "spot");

const lendingBullish = outcome(25000, 0.78, 0.8, 0.8, "cash");
const lendingBearish = outcome(25000, 0, 0.5, 0.8, "cash", "upside");
const lendingSpotParity = outcome(25000, 0.4, 0.8, 0.8, "spot");
const lendingParity = outcome(25000, 0.69, 0.8, 0.8, "spot");
lendingParity.debtParity = {
  targetPercent: 50,
  debtValue: 45000,
  v4Value: 45101.03849377637,
  secured: true,
};
const lendingDominance = outcome(25000, 0.56, 0.8, 0.8, "spot");

const perpBullish = outcome(17500, 0.78, 0.8, 0.8, "cash");
const perpBearish = outcome(17500, 0, 0.5, 0.8, "cash", "upside");
const perpSpotParity = outcome(17500, 0.4, 0.8, 0.8, "spot");
const perpParity = outcome(17500, 0.75, 0.8, 0.8, "spot");
perpParity.perpParity = {
  targetPercent: 50,
  perpValue: 32500,
  v4Value: 32667.456824974768,
  secured: true,
};
const perpDominance = outcome(17500, 0.56, 0.8, 0.8, "spot");

export const DEFAULT_OPTIMISATION_PRESETS: DefaultOptimisationPreset[] = [
  { comparisonMode: "base", objective: "bullish", outcome: baseBullish, crossover: bullishCrossover },
  { comparisonMode: "base", objective: "bearish", outcome: baseBearish, crossover: null },
  { comparisonMode: "base", objective: "spotParity", outcome: baseSpotParity, crossover: null },
  { comparisonMode: "base", objective: "benchmarkDominance", outcome: baseDominance, crossover: null },
  { comparisonMode: "lending", objective: "bullish", outcome: lendingBullish, crossover: bullishCrossover },
  { comparisonMode: "lending", objective: "bearish", outcome: lendingBearish, crossover: null },
  { comparisonMode: "lending", objective: "spotParity", outcome: lendingSpotParity, crossover: null },
  { comparisonMode: "lending", objective: "debtParity", outcome: lendingParity, crossover: null },
  { comparisonMode: "lending", objective: "benchmarkDominance", outcome: lendingDominance, crossover: null },
  { comparisonMode: "perp", objective: "bullish", outcome: perpBullish, crossover: bullishCrossover },
  { comparisonMode: "perp", objective: "bearish", outcome: perpBearish, crossover: null },
  { comparisonMode: "perp", objective: "spotParity", outcome: perpSpotParity, crossover: null },
  { comparisonMode: "perp", objective: "perpParity", outcome: perpParity, crossover: null },
  { comparisonMode: "perp", objective: "benchmarkDominance", outcome: perpDominance, crossover: null },
];
