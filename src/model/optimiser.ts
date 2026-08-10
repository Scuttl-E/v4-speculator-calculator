import {
  findDownsideBreakeven,
  findUpsideBreakeven,
  findWorstDrawdown,
  dollarValue,
  portfolioValue,
  MAX_V4_LTV,
} from "./v4Math";
import { debtPositionValue } from "./debtPosition";
import { perpPositionValue } from "./perpPosition";
import {
  createBenchmarkDominanceEvaluator,
  isBetterBenchmarkDominanceScore,
  type BenchmarkDominanceScore,
} from "./benchmarkDominance";
import type { CashbackFrontierCandidate } from "./cashbackCrossover";
import {
  runCoarseToFineSearch,
  runExhaustiveReferenceSearch,
  type SearchAssessment,
} from "./optimiserSearch";
import type {
  AdverseDirection,
  Config,
  OptimiseOptions,
  OptimiseOutcome,
} from "./types";

export function targetPercentToPrice(targetPercent: number): number {
  const p = 1 + targetPercent / 100;
  if (!Number.isFinite(p) || p <= 0)
    throw new RangeError("Target must be greater than -100%");
  return p;
}

const adverseDirectionFor = (
  objective: OptimiseOptions["objective"],
): AdverseDirection =>
  objective === "bearish" ? "upside" : "downside";

function assessAdverseBreakeven(
  config: Config,
  direction: AdverseDirection,
  downsideBreakevenPercent: number,
  upsideBreakevenPercent: number,
) {
  let closestDistance = Infinity;
  if (direction === "downside") {
    const minP = targetPercentToPrice(downsideBreakevenPercent);
    let last = 0,
      hasDrawnDown = false;
    for (let i = 1; i <= 240; i++) {
      const p = 1 - ((1 - minP) * i) / 240,
        value = portfolioValue(p, config) - 1;
      if (value < -1e-8) hasDrawnDown = true;
      if (hasDrawnDown) closestDistance = Math.min(closestDistance, Math.abs(value));
      if (hasDrawnDown && last <= 0 && value >= 0)
        return { satisfied: true, distance: 0 };
      last = value;
    }
    return { satisfied: false, distance: closestDistance };
  }

  const maxP = targetPercentToPrice(upsideBreakevenPercent);
  let last = 0,
    hasDrawnDown = false;
  for (let i = 1; i <= 240; i++) {
    const p = 1 + ((maxP - 1) * i) / 240,
      value = portfolioValue(p, config) - 1;
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

function optimisePortfolioInternal(
  options: OptimiseOptions,
  frontierCandidates?: CashbackFrontierCandidate[],
  exhaustiveReference = false,
): OptimiseOutcome {
  if (
    options.downsideBreakevenPercent <= -100 ||
    options.downsideBreakevenPercent >= 0
  )
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
  if ((options.searchStepPercent ?? 1) <= 0)
    throw new RangeError("Search step must be greater than 0%");

  const bearishPrice = targetPercentToPrice(options.bearishTargetPercent ?? -75),
    bullishPrice = targetPercentToPrice(options.bullishTargetPercent ?? 200),
    parityPrice = targetPercentToPrice(options.spotParityPercent),
    debtParityPrice = targetPercentToPrice(options.debtParityPercent),
    debtParityValue = debtPositionValue(debtParityPrice, options.debtPosition),
    perpParityPrice = targetPercentToPrice(options.perpParityPercent),
    perpParityValue = perpPositionValue(perpParityPrice, options.perpPosition),
    benchmarkParityPrice = options.objective === "perpParity"
      ? perpParityPrice
      : debtParityPrice,
    benchmarkParityValue = options.objective === "perpParity"
      ? perpParityValue
      : debtParityValue,
    isBenchmarkParity = options.objective === "debtParity" ||
      options.objective === "perpParity",
    adverseDirection = adverseDirectionFor(options.objective);
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
  const cashbackModes =
    frontierCandidates || options.cashbackMode === "optimise"
      ? (["cash", "spot"] as const)
      : ([options.cashbackMode] as const);
  const finalResolutionPercent = options.searchStepPercent ?? 1;
  let bestWithin: Config | undefined,
    bestWithinScore = -Infinity,
    bestWithinSecondaryScore = -Infinity,
    bestRelaxed: Config | undefined,
    bestRelaxedScore = -Infinity,
    bestRelaxedSecondaryScore = -Infinity,
    bestWithinDominanceScore: BenchmarkDominanceScore | null = null,
    bestRelaxedDominanceScore: BenchmarkDominanceScore | null = null,
    smallestRelaxedLimit = Infinity,
    bestBenchmarkParity: Config | undefined,
    bestBenchmarkTrough = -Infinity,
    bestBenchmarkExcess = Infinity,
    bestBenchmarkLeverage = Infinity,
    bestBenchmarkSimplicity = Infinity,
    bestBenchmarkAttempt: { config: Config; value: number } | undefined;

  const scoresFor = (config: Config, troughDrawdown: number) => {
    const bearishValue = portfolioValue(bearishPrice, config),
      bullishValue = portfolioValue(bullishPrice, config);
    if (options.objective === "bullish")
      return { primary: bullishValue, secondary: bullishValue };
    if (options.objective === "bearish")
      return { primary: bearishValue, secondary: bearishValue };
    if (options.objective === "benchmarkDominance") {
      const dominance = dominanceEvaluator!.analyse(config, troughDrawdown);
      return {
        primary: dominance.worstEdgePts,
        secondary: dominance.averageEdgePts,
        dominance,
      };
    }
    return { primary: troughDrawdown, secondary: bearishValue };
  };

  const isBetter = (
    score: number,
    secondaryScore: number,
    bestScore: number,
    bestSecondaryScore: number,
  ) =>
    score > bestScore + 1e-12 ||
    (Math.abs(score - bestScore) <= 1e-12 &&
      secondaryScore > bestSecondaryScore);

  const evaluate = (candidate: Config): SearchAssessment => {
    const config: Config = {
      ...candidate,
      longAllocation: Math.round(candidate.longAllocation * 100) / 100,
      longLtv: candidate.longLtv,
      shortLtv: candidate.shortLtv,
    };
    const trough = findWorstDrawdown(config, options.analysisRange);
    const adverseBreakevenAssessment = !options.requireBreakeven
      ? { satisfied: true, distance: Infinity }
      : assessAdverseBreakeven(
        config,
        adverseDirection,
        options.downsideBreakevenPercent,
        options.upsideBreakevenPercent,
      );
    const adverseBreakevenSatisfied = adverseBreakevenAssessment.satisfied;
    const spotParityValue = options.objective === "spotParity"
      ? portfolioValue(parityPrice, config)
      : 0;
    const benchmarkTargetValue = isBenchmarkParity
      ? dollarValue(benchmarkParityPrice, config)
      : 0;
    const withinRequestedLimit =
      options.objective === "spotParity" || isBenchmarkParity ||
      trough.drawdown >= -options.maxDrawdown - 1e-8;
    const scoreSet = scoresFor(config, trough.drawdown);
    const benchmarkExcess = benchmarkTargetValue - benchmarkParityValue;
    const assessment: SearchAssessment = {
      eligible:
        (options.objective !== "spotParity" || spotParityValue >= parityPrice - 1e-10) &&
        (!options.requireBreakeven || adverseBreakevenSatisfied) &&
        (options.requireBreakeven || withinRequestedLimit) &&
        (!isBenchmarkParity || benchmarkTargetValue + 1e-8 >= benchmarkParityValue),
      quality: isBenchmarkParity
        ? [
            trough.drawdown,
            -Math.max(0, -benchmarkExcess),
            -Math.abs(benchmarkExcess),
            -(config.longLtv + config.shortLtv),
            -Math.abs(config.longAllocation - 0.5),
          ]
        : scoreSet.dominance
          ? [
              scoreSet.dominance.worstEdgePts,
              scoreSet.dominance.averageEdgePts,
              scoreSet.dominance.maxDrawdown,
            ]
          : [scoreSet.primary, scoreSet.secondary],
      boundaryDistances: [
        options.objective === "spotParity" || isBenchmarkParity
          ? Infinity
          : Math.abs(trough.drawdown + options.maxDrawdown),
        options.objective === "spotParity"
          ? Math.abs(spotParityValue - parityPrice)
          : Infinity,
        isBenchmarkParity
          ? Math.abs(benchmarkTargetValue - benchmarkParityValue) /
            Math.max(1, Math.abs(benchmarkParityValue))
          : Infinity,
        options.requireBreakeven ? adverseBreakevenAssessment.distance : Infinity,
      ],
    };
    if (
      frontierCandidates && adverseBreakevenSatisfied &&
      (options.objective === "bullish" || options.objective === "bearish")
    ) {
      frontierCandidates.push({
        cashbackMode: config.cashbackMode,
        requiredDrawdown: Math.max(0, -trough.drawdown),
        targetPayoff:
          (portfolioValue(
            options.objective === "bearish" ? bearishPrice : bullishPrice,
            config,
          ) - 1) * 100,
      });
    }
    if (
      options.cashbackMode !== "optimise" &&
      config.cashbackMode !== options.cashbackMode
    ) return assessment;
    if (
      options.objective === "spotParity" &&
      portfolioValue(parityPrice, config) < parityPrice - 1e-10
    )
      return assessment;
    if (!options.requireBreakeven) {
      if (!withinRequestedLimit) return assessment;
    } else if (!adverseBreakevenSatisfied) {
      return assessment;
    }

    if (isBenchmarkParity) {
      const targetValue = benchmarkTargetValue;
      if (!bestBenchmarkAttempt || targetValue > bestBenchmarkAttempt.value)
        bestBenchmarkAttempt = { config, value: targetValue };
      if (targetValue + 1e-8 < benchmarkParityValue) return assessment;

      const excess = targetValue - benchmarkParityValue;
      const leverage =
        config.longLtv + config.shortLtv;
      const simplicity = Math.abs(config.longAllocation - 0.5);
      const isBetterBenchmarkParity =
        trough.drawdown > bestBenchmarkTrough + 1e-10 ||
        (Math.abs(trough.drawdown - bestBenchmarkTrough) <= 1e-10 &&
          (excess < bestBenchmarkExcess - 1e-8 ||
            (Math.abs(excess - bestBenchmarkExcess) <= 1e-8 &&
              (leverage < bestBenchmarkLeverage - 1e-10 ||
                (Math.abs(leverage - bestBenchmarkLeverage) <= 1e-10 &&
                  simplicity < bestBenchmarkSimplicity - 1e-10)))));
      if (isBetterBenchmarkParity) {
        bestBenchmarkParity = config;
        bestBenchmarkTrough = trough.drawdown;
        bestBenchmarkExcess = excess;
        bestBenchmarkLeverage = leverage;
        bestBenchmarkSimplicity = simplicity;
      }
      return assessment;
    }

    const { primary: score, secondary: secondaryScore, dominance } = scoreSet;
    if (withinRequestedLimit) {
      const better = dominance
        ? isBetterBenchmarkDominanceScore(dominance, bestWithinDominanceScore)
        : isBetter(
          score,
          secondaryScore,
          bestWithinScore,
          bestWithinSecondaryScore,
        );
      if (better) {
        bestWithinScore = score;
        bestWithinSecondaryScore = secondaryScore;
        if (dominance) bestWithinDominanceScore = dominance;
        bestWithin = config;
      }
      return assessment;
    }

    const requiredLimit = wholePercentDrawdownLimit(trough.drawdown);
    if (
      requiredLimit < smallestRelaxedLimit - 1e-9 ||
      (Math.abs(requiredLimit - smallestRelaxedLimit) < 1e-9 &&
        (dominance
          ? isBetterBenchmarkDominanceScore(dominance, bestRelaxedDominanceScore)
          : isBetter(score, secondaryScore, bestRelaxedScore, bestRelaxedSecondaryScore)))
    ) {
      smallestRelaxedLimit = requiredLimit;
      bestRelaxedScore = score;
      bestRelaxedSecondaryScore = secondaryScore;
      if (dominance) bestRelaxedDominanceScore = dominance;
      bestRelaxed = config;
    }
    return assessment;
  };

  const runSearch = exhaustiveReference
    ? runExhaustiveReferenceSearch
    : runCoarseToFineSearch;
  const diagnostics = runSearch({
    longMaxLtv: supportedOptimiserMaxLtv(options.longMaxLtv ?? options.maxLtv),
    shortMaxLtv: supportedOptimiserMaxLtv(options.shortMaxLtv ?? options.maxLtv),
    cashbackModes,
    finalResolutionPercent,
    assess: (candidate) => evaluate({
      ...candidate,
      deposit: options.deposit,
      degenEnabled: options.degenEnabled,
      degenMode: options.degenMode,
      customRecyclePct: options.customRecyclePct,
    }),
  });

  const config = isBenchmarkParity
    ? bestBenchmarkParity ?? null
    : bestWithin ?? bestRelaxed ?? null;
  if (!config) {
    return {
      config: null,
      requestedMaxDrawdown: options.maxDrawdown,
      effectiveMaxDrawdown: null,
      drawdownRelaxed: false,
      adverseDirection,
      downsideBreakeven: null,
      upsideBreakeven: null,
      debtParity:
        options.objective === "debtParity"
          ? {
              targetPercent: options.debtParityPercent,
              debtValue: debtParityValue,
              v4Value: bestBenchmarkAttempt?.value ?? 0,
              secured: false,
            }
          : null,
      perpParity:
        options.objective === "perpParity"
          ? {
              targetPercent: options.perpParityPercent,
              perpValue: perpParityValue,
              v4Value: bestBenchmarkAttempt?.value ?? 0,
              secured: false,
            }
          : null,
      failure:
        options.objective === "debtParity"
          ? `Lending parity not reached at +${options.debtParityPercent}%. Best V4 value ${bestBenchmarkAttempt ? `$${bestBenchmarkAttempt.value.toFixed(0)}` : "is unavailable"}; lending position $${debtParityValue.toFixed(0)}; shortfall ${bestBenchmarkAttempt ? `$${Math.max(0, debtParityValue - bestBenchmarkAttempt.value).toFixed(0)}` : "unavailable"}.`
          : options.objective === "perpParity"
          ? `Perp parity not reached at +${options.perpParityPercent}%. Best V4 value ${bestBenchmarkAttempt ? `$${bestBenchmarkAttempt.value.toFixed(0)}` : "is unavailable"}; perp position $${perpParityValue.toFixed(0)}; shortfall ${bestBenchmarkAttempt ? `$${Math.max(0, perpParityValue - bestBenchmarkAttempt.value).toFixed(0)}` : "unavailable"}.`
          : options.objective === "spotParity"
          ? `No configuration can match held spot at +${options.spotParityPercent}% while satisfying the active breakeven and strategy constraints. Try lowering the parity target, widening the breakeven horizon or changing cashback.`
          : options.requireBreakeven
            ? "No configuration in the allowed allocation, LTV and cashback ranges can recover within the selected breakeven horizon. Try widening the recovery limit, changing the objective or changing cashback."
            : "No configuration satisfies the active optimisation constraints.",
      diagnostics,
    };
  }

  const drawdownRelaxed = !bestWithin && Boolean(bestRelaxed);
  const downsideBreakeven =
      options.requireBreakeven && adverseDirection === "downside"
        ? findDownsideBreakeven(config)
        : null,
    upsideBreakeven =
      options.requireBreakeven && adverseDirection === "upside"
        ? findUpsideBreakeven(
            config,
            targetPercentToPrice(options.upsideBreakevenPercent),
          )
        : null;
  return {
    config,
    requestedMaxDrawdown: options.maxDrawdown,
    effectiveMaxDrawdown: drawdownRelaxed
      ? smallestRelaxedLimit
      : options.maxDrawdown,
    drawdownRelaxed,
    adverseDirection,
    downsideBreakeven,
    upsideBreakeven,
    debtParity:
      options.objective === "debtParity"
        ? {
            targetPercent: options.debtParityPercent,
            debtValue: debtParityValue,
            v4Value: dollarValue(debtParityPrice, config),
            secured: true,
        }
        : null,
    perpParity:
      options.objective === "perpParity"
        ? {
            targetPercent: options.perpParityPercent,
            perpValue: perpParityValue,
            v4Value: dollarValue(perpParityPrice, config),
            secured: true,
          }
        : null,
    failure: null,
    diagnostics,
  };
}

export function optimisePortfolioWithOutcome(
  options: OptimiseOptions,
): OptimiseOutcome {
  return optimisePortfolioInternal(options);
}

/** Exhaustive reference implementation for deterministic validation and benchmarks. */
export function optimisePortfolioExhaustiveReference(
  options: OptimiseOptions,
): OptimiseOutcome {
  return optimisePortfolioInternal(options, undefined, true);
}

export function optimisePortfolioWithCashbackFrontier(
  options: OptimiseOptions,
) {
  const candidates: CashbackFrontierCandidate[] = [];
  const outcome = optimisePortfolioInternal(options, candidates);
  return { outcome, candidates };
}

export function optimisePortfolio(options: OptimiseOptions): Config {
  const outcome = optimisePortfolioWithOutcome(options);
  if (!outcome.config)
    throw new Error(outcome.failure ?? "Optimisation failed");
  return outcome.config;
}
