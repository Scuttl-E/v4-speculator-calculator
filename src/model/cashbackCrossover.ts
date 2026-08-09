import { portfolioReturn } from "./v4Math";
import { targetPercentToPrice } from "./optimiser";
import type { CashbackMode, Config, Objective } from "./types";

export const CASHBACK_CROSSOVER_PAYOFF_TOLERANCE = 0.05;
const DRAW_DOWN_STEP = 0.01;
const DRAW_DOWN_PRECISION = 0.001;

export interface CashbackFrontierCandidate {
  cashbackMode: CashbackMode;
  requiredDrawdown: number;
  targetPayoff: number;
}

export interface CashbackFrontierValue {
  cashPayoff: number;
  spotPayoff: number;
}

export interface CashbackCrossoverResult {
  becomesOptimal: CashbackMode;
  currentDrawdown: number;
  crossoverDrawdown: number;
  changePts: number;
  currentPayoff: number;
  switchPayoff: number;
  payoffDeltaPts: number;
  efficiency: number | null;
}

interface Crossing {
  drawdown: number;
  value: CashbackFrontierValue;
  leftSign: -1 | 1;
  rightSign: -1 | 1;
}

type FrontierEvaluator = (drawdown: number) => CashbackFrontierValue | null;

const difference = (value: CashbackFrontierValue) =>
  value.spotPayoff - value.cashPayoff;

const differenceSign = (
  value: CashbackFrontierValue,
  tolerance = CASHBACK_CROSSOVER_PAYOFF_TOLERANCE,
): -1 | 0 | 1 => {
  const delta = difference(value);
  return Math.abs(delta) <= tolerance ? 0 : delta > 0 ? 1 : -1;
};

const validFrontierValue = (
  value: CashbackFrontierValue | null,
): value is CashbackFrontierValue =>
  Boolean(value) && Number.isFinite(value!.cashPayoff) &&
  Number.isFinite(value!.spotPayoff);

function refineCrossing(
  evaluate: FrontierEvaluator,
  leftDrawdown: number,
  rightDrawdown: number,
  leftSign: -1 | 1,
  rightSign: -1 | 1,
  tolerance: number,
): Crossing | null {
  let lo = leftDrawdown;
  let hi = rightDrawdown;
  let loSign = leftSign;
  let equalPoint: { drawdown: number; value: CashbackFrontierValue } | null = null;

  for (let iteration = 0; iteration < 20 && hi - lo > DRAW_DOWN_PRECISION; iteration++) {
    const mid = (lo + hi) / 2;
    const value = evaluate(mid);
    if (!validFrontierValue(value)) return null;
    const sign = differenceSign(value, tolerance);
    if (sign === 0) {
      equalPoint = { drawdown: mid, value };
      break;
    }
    if (sign === loSign) lo = mid;
    else hi = mid;
  }

  const finalDrawdown = equalPoint?.drawdown ?? hi;
  const finalValue = equalPoint?.value ?? evaluate(finalDrawdown);
  if (!validFrontierValue(finalValue)) return null;
  return {
    drawdown: finalDrawdown,
    value: finalValue,
    leftSign,
    rightSign,
  };
}

export function findNearestCashbackCrossover(
  evaluate: FrontierEvaluator,
  currentDrawdown: number,
  tolerance = CASHBACK_CROSSOVER_PAYOFF_TOLERANCE,
): Crossing | null {
  const crossings: Crossing[] = [];
  let previous: { drawdown: number; sign: -1 | 1 } | null = null;

  for (let index = 0; index <= Math.round(1 / DRAW_DOWN_STEP); index++) {
    const drawdown = Math.min(1, index * DRAW_DOWN_STEP);
    const value = evaluate(drawdown);
    if (!validFrontierValue(value)) {
      previous = null;
      continue;
    }
    const sign = differenceSign(value, tolerance);
    if (sign === 0) continue;
    if (previous && previous.sign !== sign) {
      const crossing = refineCrossing(
        evaluate,
        previous.drawdown,
        drawdown,
        previous.sign,
        sign,
        tolerance,
      );
      if (crossing) crossings.push(crossing);
    }
    previous = { drawdown, sign };
  }

  return crossings.reduce<Crossing | null>(
    (nearest, crossing) =>
      !nearest ||
        Math.abs(crossing.drawdown - currentDrawdown) <
          Math.abs(nearest.drawdown - currentDrawdown)
        ? crossing
        : nearest,
    null,
  );
}

function buildFrontier(
  candidates: CashbackFrontierCandidate[],
  cashbackMode: CashbackMode,
) {
  const sorted = candidates
    .filter((candidate) =>
      candidate.cashbackMode === cashbackMode &&
      Number.isFinite(candidate.requiredDrawdown) &&
      candidate.requiredDrawdown >= 0 && candidate.requiredDrawdown <= 1 &&
      Number.isFinite(candidate.targetPayoff)
    )
    .sort((a, b) => a.requiredDrawdown - b.requiredDrawdown);
  const drawdowns: number[] = [];
  const bestPayoffs: number[] = [];
  let best = -Infinity;
  for (const candidate of sorted) {
    best = Math.max(best, candidate.targetPayoff);
    drawdowns.push(candidate.requiredDrawdown);
    bestPayoffs.push(best);
  }
  return (drawdown: number): number | null => {
    let lo = 0;
    let hi = drawdowns.length - 1;
    let match = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (drawdowns[mid] <= drawdown + 1e-10) {
        match = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return match < 0 ? null : bestPayoffs[match];
  };
}

export function deriveCashbackCrossoverMetrics(
  currentDrawdown: number,
  crossoverDrawdown: number,
  currentPayoff: number,
  switchPayoff: number,
) {
  const changePts = (crossoverDrawdown - currentDrawdown) * 100;
  const payoffDeltaPts = switchPayoff - currentPayoff;
  return {
    changePts,
    payoffDeltaPts,
    efficiency: Math.abs(changePts) <= 1e-9
      ? null
      : Math.abs(payoffDeltaPts) / Math.abs(changePts),
  };
}

export function analyseCashbackCrossover(
  candidates: CashbackFrontierCandidate[],
  options: {
    objective: Objective;
    bullishTargetPercent: number;
    bearishTargetPercent: number;
    currentDrawdown: number;
    currentConfig: Config;
  },
): CashbackCrossoverResult | null {
  if (options.objective !== "bullish") return null;
  const cashFrontier = buildFrontier(candidates, "cash");
  const spotFrontier = buildFrontier(candidates, "spot");
  const evaluate: FrontierEvaluator = (drawdown) => {
    const cashPayoff = cashFrontier(drawdown);
    const spotPayoff = spotFrontier(drawdown);
    return cashPayoff === null || spotPayoff === null
      ? null
      : { cashPayoff, spotPayoff };
  };
  const crossing = findNearestCashbackCrossover(
    evaluate,
    options.currentDrawdown,
  );
  if (!crossing) return null;

  const targetPercent = options.bullishTargetPercent;
  const currentPayoff = portfolioReturn(
    targetPercentToPrice(targetPercent),
    options.currentConfig,
  ) * 100;
  const crossoverDifference = Math.abs(difference(crossing.value));
  const switchPayoff = crossoverDifference <= CASHBACK_CROSSOVER_PAYOFF_TOLERANCE
    ? (crossing.value.cashPayoff + crossing.value.spotPayoff) / 2
    : Math.max(crossing.value.cashPayoff, crossing.value.spotPayoff);
  const metrics = deriveCashbackCrossoverMetrics(
    options.currentDrawdown,
    crossing.drawdown,
    currentPayoff,
    switchPayoff,
  );
  const otherSideSign = options.currentDrawdown <= crossing.drawdown
    ? crossing.rightSign
    : crossing.leftSign;
  return {
    becomesOptimal: otherSideSign > 0 ? "spot" : "cash",
    currentDrawdown: options.currentDrawdown,
    crossoverDrawdown: crossing.drawdown,
    currentPayoff,
    switchPayoff,
    ...metrics,
  };
}

export function supportsCashbackCrossover(input: {
  mode: "manual" | "optimise";
  optimisationStatus: "not-run" | "calculating" | "current" | "stale";
  objective: Objective;
  result: CashbackCrossoverResult | null | undefined;
}) {
  return input.mode === "optimise" && input.optimisationStatus === "current" &&
    input.objective === "bullish" &&
    Boolean(input.result);
}
