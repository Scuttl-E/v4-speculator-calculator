import {
  findDownsideBreakeven,
  findUpsideBreakeven,
  findWorstDrawdown,
  portfolioValue,
  MAX_V4_LTV,
} from "./v4Math";
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

function hasAdverseBreakeven(
  config: Config,
  direction: AdverseDirection,
  downsideBreakevenPercent: number,
  upsideBreakevenPercent: number,
) {
  if (direction === "downside") {
    const minP = targetPercentToPrice(downsideBreakevenPercent);
    let last = 0,
      hasDrawnDown = false;
    for (let i = 1; i <= 240; i++) {
      const p = 1 - ((1 - minP) * i) / 240,
        value = portfolioValue(p, config) - 1;
      if (value < -1e-8) hasDrawnDown = true;
      if (hasDrawnDown && last <= 0 && value >= 0) return true;
      last = value;
    }
    return false;
  }

  const maxP = targetPercentToPrice(upsideBreakevenPercent);
  let last = 0,
    hasDrawnDown = false;
  for (let i = 1; i <= 240; i++) {
    const p = 1 + ((maxP - 1) * i) / 240,
      value = portfolioValue(p, config) - 1;
    if (value < -1e-8) hasDrawnDown = true;
    if (hasDrawnDown && last <= 0 && value >= 0) return true;
    last = value;
  }
  return false;
}

const wholePercentDrawdownLimit = (drawdown: number) =>
  Math.ceil(Math.max(0, -drawdown * 100)) / 100;

const steppedValues = (min: number, max: number, step: number) => {
  const values = Array.from(
    { length: Math.floor((max - min) / step + 1e-9) + 1 },
    (_, index) => +(min + index * step).toFixed(10),
  );
  if (Math.abs(values[values.length - 1] - max) > 1e-9) values.push(max);
  return values;
};

export function optimisePortfolioWithOutcome(
  options: OptimiseOptions,
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

  const bearishPrice = targetPercentToPrice(-75),
    bullishPrice = targetPercentToPrice(200),
    parityPrice = targetPercentToPrice(options.spotParityPercent),
    adverseDirection = adverseDirectionFor(options.objective);
  const cashbackModes =
    options.cashbackMode === "optimise"
      ? (["cash", "spot"] as const)
      : ([options.cashbackMode] as const);
  const step = 0.01;
  const ltvValues = steppedValues(0.5, Math.min(options.maxLtv, MAX_V4_LTV), step);
  let bestWithin: Config | undefined,
    bestWithinScore = -Infinity,
    bestWithinSecondaryScore = -Infinity,
    bestRelaxed: Config | undefined,
    bestRelaxedScore = -Infinity,
    bestRelaxedSecondaryScore = -Infinity,
    smallestRelaxedLimit = Infinity;

  const scoresFor = (config: Config, troughDrawdown: number) => {
    const bearishValue = portfolioValue(bearishPrice, config),
      bullishValue = portfolioValue(bullishPrice, config);
    if (options.objective === "bullish")
      return { primary: bullishValue, secondary: bullishValue };
    if (options.objective === "bearish")
      return { primary: bearishValue, secondary: bearishValue };
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

  const evaluate = (candidate: Config) => {
    const config: Config = {
      ...candidate,
      longAllocation: Math.round(candidate.longAllocation * 100) / 100,
      longLtv: candidate.longLtv,
      shortLtv: candidate.shortLtv,
    };
    const trough = findWorstDrawdown(config);
    if (
      options.objective === "spotParity" &&
      portfolioValue(parityPrice, config) < parityPrice - 1e-10
    )
      return;
    const withinRequestedLimit =
      options.objective === "spotParity" ||
      trough.drawdown >= -options.maxDrawdown - 1e-8;
    if (!options.requireBreakeven) {
      if (!withinRequestedLimit) return;
    } else if (
      !hasAdverseBreakeven(
        config,
        adverseDirection,
        options.downsideBreakevenPercent,
        options.upsideBreakevenPercent,
      )
    ) {
      return;
    }

    const { primary: score, secondary: secondaryScore } = scoresFor(
      config,
      trough.drawdown,
    );
    if (withinRequestedLimit) {
      if (
        isBetter(
          score,
          secondaryScore,
          bestWithinScore,
          bestWithinSecondaryScore,
        )
      ) {
        bestWithinScore = score;
        bestWithinSecondaryScore = secondaryScore;
        bestWithin = config;
      }
      return;
    }

    const requiredLimit = wholePercentDrawdownLimit(trough.drawdown);
    if (
      requiredLimit < smallestRelaxedLimit - 1e-9 ||
      (Math.abs(requiredLimit - smallestRelaxedLimit) < 1e-9 &&
        isBetter(
          score,
          secondaryScore,
          bestRelaxedScore,
          bestRelaxedSecondaryScore,
        ))
    ) {
      smallestRelaxedLimit = requiredLimit;
      bestRelaxedScore = score;
      bestRelaxedSecondaryScore = secondaryScore;
      bestRelaxed = config;
    }
  };

  for (const cashbackMode of cashbackModes)
    for (let allocation = 0; allocation <= 1; allocation += step)
      for (const longLtv of ltvValues)
        for (const shortLtv of ltvValues)
          evaluate({
            deposit: options.deposit,
            longAllocation: allocation,
            longLtv,
            shortLtv,
            cashbackMode,
          });

  const config = bestWithin ?? bestRelaxed ?? null;
  if (!config) {
    return {
      config: null,
      requestedMaxDrawdown: options.maxDrawdown,
      effectiveMaxDrawdown: null,
      drawdownRelaxed: false,
      adverseDirection,
      downsideBreakeven: null,
      upsideBreakeven: null,
      failure:
        options.objective === "spotParity"
          ? `No configuration can match held spot at +${options.spotParityPercent}% while satisfying the active breakeven and strategy constraints. Try lowering the parity target, widening the breakeven horizon or changing cashback.`
          : options.requireBreakeven
            ? "No configuration in the allowed allocation, LTV and cashback ranges can recover within the selected breakeven horizon. Try widening the recovery limit, changing the objective or changing cashback."
            : "No configuration satisfies the active optimisation constraints.",
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
    failure: null,
  };
}

export function optimisePortfolio(options: OptimiseOptions): Config {
  const outcome = optimisePortfolioWithOutcome(options);
  if (!outcome.config)
    throw new Error(outcome.failure ?? "Optimisation failed");
  return outcome.config;
}
