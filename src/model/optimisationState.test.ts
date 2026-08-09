import { describe, expect, it } from "vitest";
import {
  completeOptimisation,
  createOptimisationSignature,
  optimisationStatusFor,
  restoreCachedResult,
  type SuccessfulOptimisationResult,
} from "./optimisationState";
import type { ObjectiveAnalysis } from "./objectiveAnalysis";
import type { Objective, OptimiseOptions } from "./types";

const options = (overrides: Partial<OptimiseOptions> = {}): OptimiseOptions => ({
  maxDrawdown: 0.15,
  maxLtv: 0.8,
  longMaxLtv: 0.8,
  shortMaxLtv: 0.8,
  bullishTargetPercent: 200,
  bearishTargetPercent: -75,
  analysisMinPercent: -80,
  analysisMaxPercent: 200,
  searchStepPercent: 1,
  objective: "bullish",
  comparisonMode: "base",
  spotParityPercent: 100,
  debtParityPercent: 50,
  perpParityPercent: 50,
  debtPosition: { assetPrice: 4000, assetAmount: 20, usdDebt: 15000, liquidationLtv: 0.9 },
  perpPosition: {
    assetPrice: 1900,
    averageEntryPrice: 1500,
    positionSize: 20,
    margin: 10000,
    liquidationPrice: 1100,
    side: "long",
  },
  cashbackMode: "optimise",
  requireBreakeven: false,
  downsideBreakevenPercent: -80,
  upsideBreakevenPercent: 400,
  deposit: 10000,
  ...overrides,
});

const snapshot = (
  input: OptimiseOptions,
  objectiveAnalysis: ObjectiveAnalysis | null = null,
): SuccessfulOptimisationResult => ({
  signature: createOptimisationSignature(input),
  options: input,
  inputs: { objective: input.objective },
  result: {
    deposit: input.deposit,
    longAllocation: 0.6,
    longLtv: 0.75,
    shortLtv: 0.7,
    cashbackMode: "spot",
  },
  outcome: {
    config: {
      deposit: input.deposit,
      longAllocation: 0.6,
      longLtv: 0.75,
      shortLtv: 0.7,
      cashbackMode: "spot",
    },
    requestedMaxDrawdown: input.maxDrawdown,
    effectiveMaxDrawdown: input.maxDrawdown,
    drawdownRelaxed: false,
    adverseDirection: "downside",
    downsideBreakeven: null,
    upsideBreakeven: null,
    debtParity: null,
    perpParity: null,
    failure: null,
  },
  crossover: null,
  objectiveAnalysis,
  baseAssetValue: 0,
});

describe("optimiser result state", () => {
  it("keeps Bullish displayed and becomes stale when uncached Benchmark Dominance is selected", () => {
    const bullish = snapshot(options());
    const dominanceSignature = createOptimisationSignature(options({ objective: "benchmarkDominance" }));
    expect(restoreCachedResult(bullish, new Map(), dominanceSignature)).toBe(bullish);
    expect(optimisationStatusFor(bullish, dominanceSignature, { kind: "idle" })).toBe("stale");
  });

  it("caches and displays a completed Benchmark Dominance result atomically", () => {
    const bullish = snapshot(options());
    const dominance = snapshot(options({ objective: "benchmarkDominance" }), {
      kind: "dominance",
      result: {
        benchmark: "spot", requestedMinMove: -80, requestedMaxMove: 200,
        effectiveMinMove: -80, effectiveMaxMove: 200, worstEdgePts: -1,
        worstMove: 20, aheadPercent: 90, averageEdgePts: 15, maxDrawdown: -0.1,
      },
    });
    const cache = new Map<string, SuccessfulOptimisationResult>();
    expect(completeOptimisation(bullish, cache, dominance, dominance.signature)).toBe(dominance);
    expect(cache.get(dominance.signature)).toBe(dominance);
    expect(cache.get(dominance.signature)?.objectiveAnalysis?.kind).toBe("dominance");
  });

  it("restores cached Bullish immediately when its exact signature returns", () => {
    const bullish = snapshot(options());
    const dominance = snapshot(options({ objective: "benchmarkDominance" }));
    const cache = new Map([[bullish.signature, bullish], [dominance.signature, dominance]]);
    const restored = restoreCachedResult(dominance, cache, bullish.signature);
    expect(restored).toBe(bullish);
    expect(optimisationStatusFor(restored, bullish.signature, { kind: "idle" })).toBe("current");
  });

  it("does not cache-hit for changed Bullish target, but restores when the exact target returns", () => {
    const bullish = snapshot(options());
    const cache = new Map([[bullish.signature, bullish]]);
    const changed = createOptimisationSignature(options({ bullishTargetPercent: 400 }));
    expect(changed).not.toBe(bullish.signature);
    expect(restoreCachedResult(bullish, cache, changed)).toBe(bullish);
    expect(optimisationStatusFor(bullish, changed, { kind: "idle" })).toBe("stale");
    expect(restoreCachedResult(bullish, cache, createOptimisationSignature(options()))).toBe(bullish);
  });

  it("separates cache entries by deposit and comparison mode", () => {
    const original = createOptimisationSignature(options());
    expect(createOptimisationSignature(options({ deposit: 12000 }))).not.toBe(original);
    expect(createOptimisationSignature(options({ comparisonMode: "lending" }))).not.toBe(original);
    expect(createOptimisationSignature(options({ baseAssetValue: 2000 }))).not.toBe(original);
  });

  it("invalidates Lending and Perp signatures for their material comparator changes", () => {
    const lending = options({ comparisonMode: "lending" });
    expect(createOptimisationSignature({ ...lending, debtPosition: { ...lending.debtPosition, usdDebt: 16000 } }))
      .not.toBe(createOptimisationSignature(lending));
    const perp = options({ comparisonMode: "perp" });
    expect(createOptimisationSignature({ ...perp, perpPosition: { ...perp.perpPosition, liquidationPrice: 1200 } }))
      .not.toBe(createOptimisationSignature(perp));
  });

  it("preserves the previous success on failure or cancellation", () => {
    const bullish = snapshot(options());
    const pending = createOptimisationSignature(options({ objective: "bearish" }));
    expect(optimisationStatusFor(bullish, pending, { kind: "failed", signature: pending, message: "failed" })).toBe("failed");
    expect(optimisationStatusFor(bullish, pending, { kind: "cancelled", signature: pending })).toBe("stale");
  });

  it("associates a running completion with its job signature and does not replace newer intent", () => {
    const bullish = snapshot(options());
    const running = snapshot(options({ objective: "benchmarkDominance" }));
    const newerPending = createOptimisationSignature(options({ objective: "bearish" }));
    const cache = new Map<string, SuccessfulOptimisationResult>();
    expect(completeOptimisation(bullish, cache, running, newerPending)).toBe(bullish);
    expect(cache.get(running.signature)).toBe(running);
  });

  it.each([
    ["benchmarkDominance" as Objective, "dominance"],
    ["bearish" as Objective, "bearish"],
  ])("restores %s with its own analysis snapshot", (objective, analysisKind) => {
    const analysis = analysisKind === "dominance"
      ? { kind: "dominance", result: { benchmark: "spot", requestedMinMove: -80, requestedMaxMove: 200, effectiveMinMove: -80, effectiveMaxMove: 200, worstEdgePts: 0, worstMove: 0, aheadPercent: 50, averageEdgePts: 10, maxDrawdown: -0.1 } } as ObjectiveAnalysis
      : { kind: "bearish", troughMove: -40, targetMove: -75, troughReturn: -20, targetReturn: 80, recoveryPts: 100 } as ObjectiveAnalysis;
    const result = snapshot(options({ objective }), analysis);
    const restored = restoreCachedResult(null, new Map([[result.signature, result]]), result.signature);
    expect(restored?.options.objective).toBe(objective);
    expect(restored?.objectiveAnalysis?.kind).toBe(analysisKind);
  });

  it("normalises numerically equivalent inputs without object-identity dependence", () => {
    const a = options({ maxDrawdown: 0.1, debtPosition: { ...options().debtPosition } });
    const b = options({ maxDrawdown: 0.10000000000000002, debtPosition: { ...options().debtPosition } });
    expect(createOptimisationSignature(a)).toBe(createOptimisationSignature(b));
  });
});
