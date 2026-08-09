import type { CashbackCrossoverResult } from "./cashbackCrossover";
import type { ComparisonMode, Objective, OptimiseOutcome } from "./types";

export interface DefaultOptimisationPreset {
  comparisonMode: ComparisonMode;
  objective: Objective;
  outcome: OptimiseOutcome;
  crossover: CashbackCrossoverResult | null;
}

export const DEFAULT_OPTIMISATION_PRESET_MODEL_VERSION =
  "v4-price-model-2026-08-dominance-1";

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
  crossoverDrawdown: 0.46562500000000007,
  currentPayoff: 572.6165001233429,
  switchPayoff: 723.1046719903339,
  changePts: 31.562500000000004,
  payoffDeltaPts: 150.48817186699102,
  efficiency: 4.767942078954171,
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
