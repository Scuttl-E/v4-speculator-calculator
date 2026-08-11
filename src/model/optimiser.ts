import {
  dollarValue,
  findDownsideBreakeven,
  findUpsideBreakeven,
  findWorstComponentDrawdown,
  MAX_V4_LTV,
  portfolioValue,
} from "./v4Math";
import { debtPositionValue } from "./debtPosition";
import { perpPositionValue } from "./perpPosition";
import {
  createBenchmarkDominanceEvaluator,
  type BenchmarkDominanceResult,
} from "./benchmarkDominance";
import type { CashbackFrontierCandidate } from "./cashbackCrossover";
import {
  runExhaustiveReferenceSearch,
  runExhaustiveSearch,
  type SearchAssessment,
} from "./optimiserSearch";
import type {
  AdverseDirection,
  Config,
  LongV4Mode,
  OptimiseOptions,
  OptimiseOutcome,
  ParityOutcome,
  SupportedV4Ltv,
  Trough,
} from "./types";

const EPSILON = 1e-9;

export function targetPercentToPrice(targetPercent: number): number {
  const p = 1 + targetPercent / 100;
  if (!Number.isFinite(p) || p <= 0)
    throw new RangeError("Target must be greater than -100%");
  return p;
}

const adverseDirectionFor = (
  objective: OptimiseOptions["objective"],
): AdverseDirection => objective === "bearish" ? "upside" : "downside";

/** This is deliberately a portfolio recovery constraint. Individual V4-leg
 * safety is handled separately by findWorstComponentDrawdown. */
function assessPortfolioBreakeven(
  config: Config,
  direction: AdverseDirection,
  downsideBreakevenPercent: number,
  upsideBreakevenPercent: number,
) {
  let closestDistance = Infinity;
  const end = direction === "downside"
    ? targetPercentToPrice(downsideBreakevenPercent)
    : targetPercentToPrice(upsideBreakevenPercent);
  let last = 0;
  let hasDrawnDown = false;
  for (let i = 1; i <= 240; i++) {
    const p = 1 + ((end - 1) * i) / 240;
    const value = portfolioValue(p, config) - 1;
    if (value < -1e-8) hasDrawnDown = true;
    if (hasDrawnDown) closestDistance = Math.min(closestDistance, Math.abs(value));
    if (hasDrawnDown && last <= 0 && value >= 0)
      return { satisfied: true, distance: 0 };
    last = value;
  }
  return { satisfied: false, distance: closestDistance };
}

const wholePercentDrawdownLimit = (drawdown: number) =>
  Math.ceil(Math.max(0, -drawdown * 100)) / 100;

export const supportedOptimiserMaxLtv = (requestedMaxLtv: number) =>
  Math.min(requestedMaxLtv, MAX_V4_LTV);

interface CandidateEvaluation {
  config: Config;
  trough: Trough;
  rank: readonly number[];
  parity: ParityOutcome | null;
}

const compareRank = (candidate: readonly number[], current: readonly number[]) => {
  for (let index = 0; index < Math.max(candidate.length, current.length); index++) {
    const delta = (candidate[index] ?? 0) - (current[index] ?? 0);
    if (Math.abs(delta) > 1e-12) return delta > 0;
  }
  return false;
};

const leverageRank = (config: Config) =>
  -((config.longMode === "2x" ? 0.5 : 0.75) + config.shortLtv);

function validateOptions(options: OptimiseOptions) {
  if (options.downsideBreakevenPercent <= -100 || options.downsideBreakevenPercent >= 0)
    throw new RangeError("Downside breakeven limit must be between -100% and 0%");
  if (options.upsideBreakevenPercent <= 0)
    throw new RangeError("Upside breakeven limit must be greater than 0%");
  if (options.spotParityPercent <= 0)
    throw new RangeError("Spot parity target must be greater than 0%");
  if (options.debtParityPercent <= -100)
    throw new RangeError("Lending parity target must be greater than -100%");
  if (options.perpParityPercent <= -100)
    throw new RangeError("Perp parity target must be greater than -100%");
  if ((options.bearishTargetPercent ?? -75) <= -100)
    throw new RangeError("Bearish target must be greater than -100%");
  if ((options.searchStepPercent ?? 1) <= 0 || (options.searchStepPercent ?? 1) > 100)
    throw new RangeError("Search step must be between 0% and 100%");
}

function permittedProducts(options: OptimiseOptions) {
  const longLimit = options.longMaxLtv ?? options.maxLtv;
  const shortLimit = options.shortMaxLtv ?? options.maxLtv;
  let longModes: readonly LongV4Mode[] = longLimit < 0.75
    ? ["2x"]
    : ["2x", "2.5x-cashback", "2.5x-looped"];
  if (options.cashbackMode === "cash")
    longModes = longModes.filter((mode) => mode === "2.5x-cashback");
  if (options.cashbackMode === "spot")
    longModes = longModes.filter((mode) => mode === "2.5x-looped");
  const shortLtvs: readonly SupportedV4Ltv[] = shortLimit < 0.75 ? [0.5] : [0.5, 0.75];
  return { longModes, shortLtvs };
}

function optimisePortfolioInternal(
  options: OptimiseOptions,
  _frontierCandidates?: CashbackFrontierCandidate[],
  reference = false,
): OptimiseOutcome {
  validateOptions(options);
  const adverseDirection = adverseDirectionFor(options.objective);
  const bearishPrice = targetPercentToPrice(options.bearishTargetPercent ?? -75);
  const bullishPrice = targetPercentToPrice(options.bullishTargetPercent ?? 200);
  const spotPrice = targetPercentToPrice(options.spotParityPercent);
  const debtPrice = targetPercentToPrice(options.debtParityPercent);
  const perpPrice = targetPercentToPrice(options.perpParityPercent);
  const debtTarget = debtPositionValue(debtPrice, options.debtPosition);
  const perpTarget = perpPositionValue(perpPrice, options.perpPosition);
  const dominanceEvaluator = options.objective === "benchmarkDominance"
    ? createBenchmarkDominanceEvaluator({
        comparisonMode: options.comparisonMode ?? "base",
        analysisRange: options.analysisRange,
        debtPosition: options.debtPosition,
        perpPosition: options.perpPosition,
      })
    : null;
  if (options.objective === "benchmarkDominance" && !dominanceEvaluator)
    throw new RangeError("Benchmark dominance range is unavailable for the active comparison");

  const { longModes, shortLtvs } = permittedProducts(options);
  let best: CandidateEvaluation | null = null;
  let bestRelaxed: CandidateEvaluation | null = null;
  let smallestRelaxedLimit = Infinity;

  const parityFor = (config: Config): ParityOutcome | null => {
    if (options.objective === "spotParity") {
      const achievedValue = portfolioValue(spotPrice, config);
      return {
        kind: "spot",
        targetPercent: options.spotParityPercent,
        targetValue: spotPrice,
        achievedValue,
        shortfall: Math.max(0, spotPrice - achievedValue),
        reached: achievedValue + EPSILON >= spotPrice,
      };
    }
    if (options.objective === "debtParity") {
      const achievedValue = dollarValue(debtPrice, config);
      return {
        kind: "lending",
        targetPercent: options.debtParityPercent,
        targetValue: debtTarget,
        achievedValue,
        shortfall: Math.max(0, debtTarget - achievedValue),
        reached: achievedValue + EPSILON >= debtTarget,
      };
    }
    if (options.objective === "perpParity") {
      const achievedValue = dollarValue(perpPrice, config);
      return {
        kind: "perp",
        targetPercent: options.perpParityPercent,
        targetValue: perpTarget,
        achievedValue,
        shortfall: Math.max(0, perpTarget - achievedValue),
        reached: achievedValue + EPSILON >= perpTarget,
      };
    }
    return null;
  };

  const rankFor = (
    config: Config,
    trough: Trough,
    parity: ParityOutcome | null,
    dominance: BenchmarkDominanceResult | null,
  ): readonly number[] => {
    const stable = [leverageRank(config), -Math.abs(config.longAllocation - 0.5), -config.longAllocation];
    if (parity) {
      const excess = Math.max(0, parity.achievedValue - parity.targetValue);
      return parity.reached
        ? [1, trough.drawdown, -excess, ...stable]
        : [0, -parity.shortfall, trough.drawdown, ...stable];
    }
    if (dominance)
      return [dominance.worstEdgePts, dominance.averageEdgePts, dominance.maxDrawdown, ...stable];
    const targetValue = options.objective === "bearish"
      ? portfolioValue(bearishPrice, config)
      : portfolioValue(bullishPrice, config);
    return [targetValue, trough.drawdown, ...stable];
  };

  const evaluate = (candidate: {
    longAllocation: number;
    longMode: LongV4Mode;
    shortLtv: SupportedV4Ltv;
  }): SearchAssessment => {
    // A forced Cashback or Looped policy describes a real Long product, not a
    // label that may be attached to a zero-Long portfolio.
    if (options.cashbackMode !== undefined && options.cashbackMode !== "optimise" && candidate.longAllocation <= EPSILON)
      return { eligible: false, quality: [], boundaryDistances: [] };

    const config: Config = {
      deposit: options.deposit,
      longAllocation: candidate.longAllocation,
      longMode: candidate.longMode,
      shortLtv: candidate.shortLtv,
      longLtv: candidate.longMode === "2x" ? 0.5 : 0.75,
      cashbackMode: candidate.longMode === "2.5x-looped" ? "spot" : "cash",
      cashOutEnabled: candidate.longMode === "2.5x-cashback",
      degenEnabled: false,
      degenMode: "x1",
      customRecyclePct: 0,
    };
    const trough = findWorstComponentDrawdown(config, options.analysisRange);
    const breakeven = options.requireBreakeven
      ? assessPortfolioBreakeven(
          config,
          adverseDirection,
          options.downsideBreakevenPercent,
          options.upsideBreakevenPercent,
        )
      : { satisfied: true, distance: Infinity };
    if (!breakeven.satisfied)
      return { eligible: false, quality: [], boundaryDistances: [breakeven.distance] };

    const parity = parityFor(config);
    const dominance = dominanceEvaluator?.analyse(config, trough.drawdown) ?? null;
    const rank = rankFor(config, trough, parity, dominance);
    const evaluation = { config, trough, rank, parity };
    const withinRisk = trough.drawdown + EPSILON >= -options.maxDrawdown;
    if (withinRisk) {
      if (!best || compareRank(rank, best.rank)) best = evaluation;
      return {
        eligible: true,
        quality: rank,
        boundaryDistances: [Math.abs(trough.drawdown + options.maxDrawdown)],
      };
    }

    // The explicit recovery option may relax risk, but every objective uses
    // the same rule and the smallest required relaxation is chosen first.
    if (options.requireBreakeven) {
      const requiredLimit = wholePercentDrawdownLimit(trough.drawdown);
      if (
        requiredLimit < smallestRelaxedLimit - EPSILON ||
        (Math.abs(requiredLimit - smallestRelaxedLimit) <= EPSILON &&
          (!bestRelaxed || compareRank(rank, bestRelaxed.rank)))
      ) {
        smallestRelaxedLimit = requiredLimit;
        bestRelaxed = evaluation;
      }
    }
    return {
      eligible: false,
      quality: rank,
      boundaryDistances: [Math.abs(trough.drawdown + options.maxDrawdown)],
    };
  };

  const search = reference ? runExhaustiveReferenceSearch : runExhaustiveSearch;
  const diagnostics = search({
    finalResolutionPercent: options.searchStepPercent ?? 1,
    longModes,
    shortLtvs,
    assess: evaluate,
  });
  // Search invokes evaluate synchronously, but TypeScript does not infer
  // assignments made through that callback when narrowing this value.
  const selected = (best ?? bestRelaxed) as CandidateEvaluation | null;
  if (!selected) {
    const forcedProduct = options.cashbackMode === "cash"
      ? "Cashback"
      : options.cashbackMode === "spot"
        ? "Looped"
        : null;
    return {
      status: "no-valid-configuration",
      config: null,
      requestedMaxDrawdown: options.maxDrawdown,
      effectiveMaxDrawdown: null,
      drawdownRelaxed: false,
      adverseDirection,
      downsideBreakeven: null,
      upsideBreakeven: null,
      debtParity: null,
      perpParity: null,
      parity: null,
      failure: forcedProduct
        ? `No valid configuration can include a positive ${forcedProduct} Long within the active leverage, risk and recovery constraints.`
        : "No valid configuration satisfies the active product, risk and recovery constraints.",
      diagnostics,
    };
  }

  const config = selected.config;
  const parity = selected.parity;
  const drawdownRelaxed = !best && Boolean(bestRelaxed);
  const downsideBreakeven = options.requireBreakeven && adverseDirection === "downside"
    ? findDownsideBreakeven(config)
    : null;
  const upsideBreakeven = options.requireBreakeven && adverseDirection === "upside"
    ? findUpsideBreakeven(config, targetPercentToPrice(options.upsideBreakevenPercent))
    : null;
  return {
    status: parity && !parity.reached ? "best-effort" : "optimal",
    config,
    requestedMaxDrawdown: options.maxDrawdown,
    effectiveMaxDrawdown: drawdownRelaxed ? smallestRelaxedLimit : options.maxDrawdown,
    drawdownRelaxed,
    adverseDirection,
    downsideBreakeven,
    upsideBreakeven,
    debtParity: parity?.kind === "lending"
      ? {
          targetPercent: parity.targetPercent,
          debtValue: parity.targetValue,
          v4Value: parity.achievedValue,
          secured: parity.reached,
        }
      : null,
    perpParity: parity?.kind === "perp"
      ? {
          targetPercent: parity.targetPercent,
          perpValue: parity.targetValue,
          v4Value: parity.achievedValue,
          secured: parity.reached,
        }
      : null,
    parity,
    failure: null,
    diagnostics,
  };
}

export function optimisePortfolioWithOutcome(options: OptimiseOptions): OptimiseOutcome {
  return optimisePortfolioInternal(options);
}

/** Production is exhaustive too; this separate entry point protects the
 * validation contract from future search changes. */
export function optimisePortfolioExhaustiveReference(options: OptimiseOptions): OptimiseOutcome {
  return optimisePortfolioInternal(options, undefined, true);
}

export function optimisePortfolioWithCashbackFrontier(options: OptimiseOptions) {
  return {
    outcome: optimisePortfolioInternal(options),
    candidates: [] as CashbackFrontierCandidate[],
  };
}

export function optimisePortfolio(options: OptimiseOptions): Config {
  const outcome = optimisePortfolioWithOutcome(options);
  if (!outcome.config) throw new Error(outcome.failure ?? "Optimisation failed");
  return outcome.config;
}
