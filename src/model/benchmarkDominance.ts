import {
  debtPositionReturn,
  debtPositionSummary,
  isDebtPositionLiquidated,
  type DebtPositionInput,
} from "./debtPosition";
import {
  isPerpPositionLiquidated,
  perpPositionReturn,
  perpPositionSummary,
  type PerpPositionInput,
} from "./perpPosition";
import { findWorstDrawdown, portfolioReturn } from "./v4Math";
import type { AnalysisRange, ComparisonMode, Config } from "./types";

export const DOMINANCE_EDGE_TOLERANCE_PTS = 1e-7;
const DOMAIN_STEP_PERCENT = 1;

export interface BenchmarkDominanceResult {
  benchmark: "spot" | "lending" | "perp";
  requestedMinMove: number;
  requestedMaxMove: number;
  effectiveMinMove: number;
  effectiveMaxMove: number;
  worstEdgePts: number;
  worstMove: number;
  aheadPercent: number;
  averageEdgePts: number;
  maxDrawdown: number;
}

export interface BenchmarkDominanceScore {
  worstEdgePts: number;
  averageEdgePts: number;
  maxDrawdown: number;
}

interface DominanceInput {
  comparisonMode: ComparisonMode;
  analysisRange: AnalysisRange;
  debtPosition: DebtPositionInput;
  perpPosition: PerpPositionInput;
}

const benchmarkName = (mode: ComparisonMode) =>
  mode === "lending" ? "lending" as const : mode === "perp" ? "perp" as const : "spot" as const;

const liquidationRatioFor = (input: DominanceInput) =>
  input.comparisonMode === "lending"
    ? debtPositionSummary(input.debtPosition).liquidationPriceRatio
    : input.comparisonMode === "perp"
      ? perpPositionSummary(input.perpPosition).liquidationPriceRatio
      : null;

const isLiquidated = (p: number, input: DominanceInput) =>
  input.comparisonMode === "lending"
    ? isDebtPositionLiquidated(p, input.debtPosition)
    : input.comparisonMode === "perp"
      ? isPerpPositionLiquidated(p, input.perpPosition)
      : false;

const benchmarkReturnAt = (p: number, input: DominanceInput) =>
  input.comparisonMode === "lending"
    ? debtPositionReturn(p, input.debtPosition)
    : input.comparisonMode === "perp"
      ? perpPositionReturn(p, input.perpPosition)
      : p - 1;

export function createBenchmarkDominanceEvaluator(input: DominanceInput) {
  const requestedMinMove = (input.analysisRange.minPriceRatio - 1) * 100;
  const requestedMaxMove = (input.analysisRange.maxPriceRatio - 1) * 100;
  if (
    !Number.isFinite(requestedMinMove) || !Number.isFinite(requestedMaxMove) ||
    input.analysisRange.minPriceRatio <= 0 ||
    input.analysisRange.minPriceRatio >= 1 ||
    input.analysisRange.maxPriceRatio <= 1
  )
    return null;

  let minP = input.analysisRange.minPriceRatio;
  let maxP = input.analysisRange.maxPriceRatio;
  const liquidationP = liquidationRatioFor(input);
  if (liquidationP !== null && liquidationP >= minP && liquidationP <= maxP) {
    const epsilon = Math.max(1e-8, (maxP - minP) * 1e-8);
    const validBelow = !isLiquidated(Math.max(minP, liquidationP - epsilon), input);
    const validAbove = !isLiquidated(Math.min(maxP, liquidationP + epsilon), input);
    if (validBelow && !validAbove) maxP = liquidationP;
    else if (!validBelow && validAbove) minP = liquidationP;
    else return null;
  }
  if (minP > 1 || maxP < 1 || isLiquidated(1, input)) return null;

  const effectiveMinMove = (minP - 1) * 100;
  const effectiveMaxMove = (maxP - 1) * 100;
  const moves: number[] = [];
  for (let move = effectiveMinMove; move <= effectiveMaxMove + 1e-10; move += DOMAIN_STEP_PERCENT)
    moves.push(Math.min(effectiveMaxMove, move));
  if (moves.length === 0 || Math.abs(moves[moves.length - 1] - effectiveMaxMove) > 1e-9)
    moves.push(effectiveMaxMove);
  if (!moves.some((move) => Math.abs(move) <= 1e-9)) moves.push(0);
  moves.sort((a, b) => a - b);

  const benchmarkReturns = moves.map((move) => benchmarkReturnAt(1 + move / 100, input));
  if (benchmarkReturns.some((value) => value === null || !Number.isFinite(value))) return null;

  const edgeAt = (move: number, config: Config) => {
    const p = 1 + move / 100;
    const benchmark = benchmarkReturnAt(p, input);
    return benchmark === null ? null : (portfolioReturn(p, config) - benchmark) * 100;
  };

  return {
    moves: [...moves],
    analyse(config: Config, knownMaxDrawdown?: number): BenchmarkDominanceResult {
      let worstEdgePts = Infinity;
      let worstIndex = 0;
      let edgeSum = 0;
      let aheadCount = 0;
      for (let index = 0; index < moves.length; index++) {
        const edge = (portfolioReturn(1 + moves[index] / 100, config) - benchmarkReturns[index]!) * 100;
        edgeSum += edge;
        if (edge > DOMINANCE_EDGE_TOLERANCE_PTS) aheadCount++;
        if (edge < worstEdgePts) {
          worstEdgePts = edge;
          worstIndex = index;
        }
      }

      let worstMove = moves[worstIndex];
      if (worstIndex > 0 && worstIndex < moves.length - 1) {
        let lo = moves[worstIndex - 1];
        let hi = moves[worstIndex + 1];
        for (let iteration = 0; iteration < 35; iteration++) {
          const a = (2 * lo + hi) / 3;
          const b = (lo + 2 * hi) / 3;
          if ((edgeAt(a, config) ?? Infinity) < (edgeAt(b, config) ?? Infinity)) hi = b;
          else lo = a;
        }
        const refinedMove = (lo + hi) / 2;
        const refinedEdge = edgeAt(refinedMove, config);
        if (refinedEdge !== null && refinedEdge < worstEdgePts) {
          worstMove = refinedMove;
          worstEdgePts = refinedEdge;
        }
      }

      return {
        benchmark: benchmarkName(input.comparisonMode),
        requestedMinMove,
        requestedMaxMove,
        effectiveMinMove,
        effectiveMaxMove,
        worstEdgePts,
        worstMove,
        aheadPercent: (aheadCount / moves.length) * 100,
        averageEdgePts: edgeSum / moves.length,
        maxDrawdown: knownMaxDrawdown ?? findWorstDrawdown(config, input.analysisRange).drawdown,
      };
    },
  };
}

export function isBetterBenchmarkDominanceScore(
  candidate: BenchmarkDominanceScore,
  current: BenchmarkDominanceScore | null,
  tolerance = 1e-9,
) {
  if (!current) return true;
  if (candidate.worstEdgePts > current.worstEdgePts + tolerance) return true;
  if (Math.abs(candidate.worstEdgePts - current.worstEdgePts) > tolerance) return false;
  if (candidate.averageEdgePts > current.averageEdgePts + tolerance) return true;
  if (Math.abs(candidate.averageEdgePts - current.averageEdgePts) > tolerance) return false;
  return candidate.maxDrawdown > current.maxDrawdown + tolerance;
}
