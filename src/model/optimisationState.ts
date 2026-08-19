import type { ObjectiveAnalysis } from "./objectiveAnalysis";
import type { ProductRoutingDecision } from "./productRoutingDecision";
import type { ComparisonMode, Config, OptimiseOptions, OptimiseOutcome } from "./types";

export const OPTIMISER_STATE_MODEL_VERSION = "v4-discrete-products-exhaustive-2026-08-19-short-cashback-inverse-square-1";

const canonicalise = (value: unknown): unknown => {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new RangeError("Optimisation inputs must be finite");
    const normalised = Math.round(value * 1e12) / 1e12;
    return Object.is(normalised, -0) ? 0 : normalised;
  }
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonicalise(entry)]),
    );
  return value;
};

export function createOptimisationSignature(options: OptimiseOptions) {
  const materialInputs = {
    comparisonMode: options.comparisonMode ?? "base",
    baseAssetValue: (options.comparisonMode ?? "base") === "base"
      ? options.baseAssetValue ?? 0
      : null,
    objective: options.objective,
    deposit: options.deposit,
    maxDrawdown: options.maxDrawdown,
    maxLtv: options.maxLtv,
    longMaxLtv: options.longMaxLtv ?? options.maxLtv,
    shortMaxLtv: options.shortMaxLtv ?? options.maxLtv,
    cashbackPolicy: options.cashbackPolicy ?? "auto",
    cashbackRouting: (options.cashbackPolicy ?? "auto") === "off"
      ? null
      : options.cashbackRouting ?? "auto",
    requireBreakeven: options.requireBreakeven,
    adverseBreakevenPercent: !options.requireBreakeven
      ? null
      : options.objective === "bearish"
        ? options.upsideBreakevenPercent
        : options.downsideBreakevenPercent,
    searchStepPercent: options.searchStepPercent ?? 1,
    bullishTargetPercent: options.objective === "bullish" || options.objective === "benchmarkDominance"
      ? options.bullishTargetPercent ?? 200
      : null,
    bearishTargetPercent: options.objective === "bearish"
      ? options.bearishTargetPercent ?? -75
      : null,
    spotParityPercent: options.objective === "spotParity" ? options.spotParityPercent : null,
    debtParityPercent: options.objective === "debtParity" ? options.debtParityPercent : null,
    perpParityPercent: options.objective === "perpParity" ? options.perpParityPercent : null,
    analysisRange: options.analysisRange,
    debtPosition: options.comparisonMode === "lending" ? options.debtPosition : null,
    perpPosition: options.comparisonMode === "perp" ? options.perpPosition : null,
  };
  return JSON.stringify(canonicalise({
    modelVersion: OPTIMISER_STATE_MODEL_VERSION,
    inputs: materialInputs,
  }));
}

export interface SuccessfulOptimisationResult {
  signature: string;
  options: OptimiseOptions;
  inputs: Record<string, unknown>;
  result: Config;
  outcome: OptimiseOutcome;
  productRoutingDecision: ProductRoutingDecision | null;
  objectiveAnalysis: ObjectiveAnalysis | null;
  baseAssetValue: number;
}

export type OptimiserRunState =
  | { kind: "idle" }
  | { kind: "running"; signature: string }
  | { kind: "failed"; signature: string; message: string }
  | { kind: "cancelled"; signature: string };

export type OptimisationStatus = "not-run" | "current" | "stale" | "calculating" | "failed";

export function restoreCachedResult(
  displayed: SuccessfulOptimisationResult | null,
  cache: ReadonlyMap<string, SuccessfulOptimisationResult>,
  pendingSignature: string,
  comparisonMode: ComparisonMode,
) {
  const cached = cache.get(pendingSignature);
  if (cached) return cached;
  return displayed && (displayed.options.comparisonMode ?? "base") === comparisonMode
    ? displayed
    : null;
}

export function restorePassivePresetResult(
  displayed: SuccessfulOptimisationResult | null,
  cache: ReadonlyMap<string, SuccessfulOptimisationResult>,
  presetSignatures: ReadonlySet<string>,
  pendingSignature: string,
  comparisonMode: ComparisonMode,
) {
  if (
    displayed?.signature === pendingSignature &&
    (displayed.options.comparisonMode ?? "base") === comparisonMode
  ) return displayed;
  if (!presetSignatures.has(pendingSignature))
    return displayed && (displayed.options.comparisonMode ?? "base") === comparisonMode
      ? displayed
      : null;
  return restoreCachedResult(displayed, cache, pendingSignature, comparisonMode);
}

export function optimisationStatusFor(
  displayed: SuccessfulOptimisationResult | null,
  pendingSignature: string,
  runState: OptimiserRunState,
): OptimisationStatus {
  if (runState.kind === "running" && runState.signature === pendingSignature) return "calculating";
  if (runState.kind === "failed" && runState.signature === pendingSignature) return "failed";
  if (!displayed) return "not-run";
  return displayed.signature === pendingSignature ? "current" : "stale";
}

export function completeOptimisation(
  displayed: SuccessfulOptimisationResult | null,
  cache: Map<string, SuccessfulOptimisationResult>,
  completed: SuccessfulOptimisationResult,
  pendingSignature: string,
) {
  cache.set(completed.signature, completed);
  return completed.signature === pendingSignature ? completed : displayed;
}
