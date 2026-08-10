import { describe, expect, it } from "vitest";
import {
  analyseCashbackCrossover,
  deriveCashbackCrossoverMetrics,
  findNearestCashbackCrossover,
  supportsCashbackCrossover,
  type CashbackFrontierCandidate,
  type CashbackFrontierValue,
} from "./cashbackCrossover";
import type { Config } from "./types";

const currentConfig: Config = {
  deposit: 10000,
  longAllocation: 0.5,
  longLtv: 0.5,
  shortLtv: 0.5,
  cashbackMode: "cash",
  degenEnabled: false,
  degenMode: "x1",
  customRecyclePct: 50,
};

const crossingCandidates: CashbackFrontierCandidate[] = [
  { cashbackMode: "cash", requiredDrawdown: 0, targetPayoff: 100 },
  { cashbackMode: "spot", requiredDrawdown: 0, targetPayoff: 90 },
  { cashbackMode: "spot", requiredDrawdown: 0.35, targetPayoff: 130 },
];

const analyse = (currentDrawdown: number) =>
  analyseCashbackCrossover(crossingCandidates, {
    objective: "bullish",
    bullishTargetPercent: 200,
    bearishTargetPercent: -75,
    currentDrawdown,
    currentConfig,
  });

describe("cashback crossover", () => {
  it("finds where spot becomes optimal as permitted drawdown increases", () => {
    const result = analyse(0.26);
    expect(result).not.toBeNull();
    expect(result!.crossoverDrawdown).toBeCloseTo(0.35, 2);
    expect(result!.becomesOptimal).toBe("spot");
    expect(result!.changePts).toBeGreaterThan(0);
  });

  it("reports cash becoming optimal when risk is tightened from above the crossing", () => {
    const result = analyse(0.42);
    expect(result).not.toBeNull();
    expect(result!.becomesOptimal).toBe("cash");
    expect(result!.changePts).toBeLessThan(0);
  });

  it("returns no crossover when spot dominates the entire domain", () => {
    expect(findNearestCashbackCrossover(
      () => ({ cashPayoff: 100, spotPayoff: 110 }),
      0.2,
    )).toBeNull();
  });

  it("returns no crossover when cash dominates the entire domain", () => {
    expect(findNearestCashbackCrossover(
      () => ({ cashPayoff: 110, spotPayoff: 100 }),
      0.2,
    )).toBeNull();
  });

  it("ignores differences inside the payoff noise tolerance", () => {
    expect(findNearestCashbackCrossover(
      (drawdown) => ({
        cashPayoff: 100,
        spotPayoff: 100 + Math.sin(drawdown * 100) * 0.02,
      }),
      0.5,
    )).toBeNull();
  });

  it("selects the genuine crossing nearest the current limit", () => {
    const crossing = findNearestCashbackCrossover(
      (drawdown) => ({
        cashPayoff: 100,
        spotPayoff: 100 + (drawdown - 0.2) * (drawdown - 0.7) * 100,
      }),
      0.65,
    );
    expect(crossing).not.toBeNull();
    expect(crossing!.drawdown).toBeCloseTo(0.7, 2);
  });

  it("does not bridge an infeasible frontier region", () => {
    const evaluate = (drawdown: number): CashbackFrontierValue | null => {
      if (drawdown >= 0.4 && drawdown <= 0.6) return null;
      return drawdown < 0.4
        ? { cashPayoff: 110, spotPayoff: 100 }
        : { cashPayoff: 100, spotPayoff: 110 };
    };
    expect(findNearestCashbackCrossover(evaluate, 0.5)).toBeNull();
  });

  it("derives drawdown change, payoff delta and efficiency in percentage points", () => {
    const relaxed = deriveCashbackCrossoverMetrics(0.26, 0.346, 150.7, 172.4);
    expect(relaxed.changePts).toBeCloseTo(8.6, 10);
    expect(relaxed.payoffDeltaPts).toBeCloseTo(21.7, 10);
    expect(relaxed.efficiency).toBeCloseTo(2.52, 2);

    const tightened = deriveCashbackCrossoverMetrics(0.42, 0.346, 172.4, 150.7);
    expect(tightened.changePts).toBeCloseTo(-7.4, 10);
    expect(tightened.payoffDeltaPts).toBeCloseTo(-21.7, 10);
  });

  it("hides the section unless optimise mode has a current supported result", () => {
    const result = analyse(0.26);
    expect(supportsCashbackCrossover({
      mode: "optimise",
      optimisationStatus: "current",
      objective: "bullish",
      result,
    })).toBe(true);
    for (const optimisationStatus of ["not-run", "stale", "calculating"] as const)
      expect(supportsCashbackCrossover({
        mode: "optimise",
        optimisationStatus,
        objective: "bullish",
        result,
      })).toBe(false);
    expect(supportsCashbackCrossover({
      mode: "manual",
      optimisationStatus: "current",
      objective: "bullish",
      result,
    })).toBe(false);
    expect(supportsCashbackCrossover({
      mode: "optimise",
      optimisationStatus: "current",
      objective: "bearish",
      result,
    })).toBe(false);
    expect(supportsCashbackCrossover({
      mode: "optimise",
      optimisationStatus: "current",
      objective: "spotParity",
      result,
    })).toBe(false);
    expect(supportsCashbackCrossover({
      mode: "optimise",
      optimisationStatus: "current",
      objective: "bullish",
      result: null,
    })).toBe(false);
  });
});
