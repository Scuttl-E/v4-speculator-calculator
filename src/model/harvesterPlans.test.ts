import { describe, expect, it } from "vitest";
import type { Config } from "./types";
import {
  DEFAULT_HARVEST_PRESETS,
  applyLiveHarvestRate,
  createHarvesterPlanState,
  createHarvesterSnapshot,
  editHarvestPoint,
  editHarvestPointPercent,
  evaluateEqualRateCandidate,
  evaluateHarvestPlan,
  generateAllHarvesterPlans,
  generateCurrentHarvesterPlan,
  generateEarliestRecoveryHarvestPlan,
  generateEqualCashHarvestPlan,
  generateEqualRateHarvestPlan,
  generateUserHarvestPlan,
  harvestPercentToActiveAfter,
  otherPlansContainCustomEdits,
  originalExternalValue,
  resolveEarliestRecoveryPoints,
  resetHarvesterPlanState,
  updateHarvesterPlanPoints,
  type HarvesterGenerationInputs,
} from "./harvester";

const config = (patch: Partial<Config> = {}): Config => ({
  deposit: 25_000,
  longAllocation: 1,
  longLtv: .75,
  longMode: "2.5x-looped",
  shortMode: "2x",
  shortLtv: .5,
  cashbackMode: "cash",
  cashOutEnabled: true,
  degenEnabled: false,
  degenMode: "x1",
  customRecyclePct: 0,
  ...patch,
});

const snapshot = (patch: Partial<Config> = {}) => createHarvesterSnapshot({
  config: config(patch),
  comparisonMode: "base",
  debtPosition: { assetPrice: 2_000, assetAmount: 20, usdDebt: 15_000, liquidationLtv: .85 },
  perpPosition: { assetPrice: 2_000, averageEntryPrice: 1_900, positionSize: 10, margin: 12_000, liquidationPrice: 1_200, side: "long" },
  assetName: "ETH",
});

const inputs = (patch: Partial<HarvesterGenerationInputs> = {}): HarvesterGenerationInputs => ({
  benchmark: "spot",
  finalTargetPercent: 500,
  intervalPercent: 100,
  pointCount: 4,
  defaultHarvestPercent: 100,
  ...patch,
});

describe("Harvester four-plan state", () => {
  it("Generate All creates four independent datasets and clean baselines", () => {
    const plans = generateAllHarvesterPlans(snapshot(), inputs());
    expect(Object.values(plans).every(Boolean)).toBe(true);
    expect(plans.user!.points).not.toBe(plans.equalRate!.points);
    expect(plans.user!.baseline).not.toBe(plans.user!.points);
    expect(Object.values(plans).every((plan) => plan?.modified === false)).toBe(true);
  });

  it("editing one plan leaves every other plan and its baseline unchanged", () => {
    const snap = snapshot();
    const plans = generateAllHarvesterPlans(snap, inputs());
    const equalRateBefore = structuredClone(plans.equalRate);
    const edited = editHarvestPointPercent(snap, "spot", 500, plans.user!.points, plans.user!.points[0].id, 50);
    const user = updateHarvesterPlanPoints(plans.user!, edited);
    expect(user.modified).toBe(true);
    expect(plans.equalRate).toEqual(equalRateBefore);
    expect(user.baseline).toEqual(plans.user!.baseline);
  });

  it("Reset restores only the active plan and clears its modified state", () => {
    const snap = snapshot();
    const plans = generateAllHarvesterPlans(snap, inputs());
    const changedUser = updateHarvesterPlanPoints(
      plans.user!,
      editHarvestPointPercent(snap, "spot", 500, plans.user!.points, plans.user!.points[0].id, 50),
    );
    const changedRate = updateHarvesterPlanPoints(
      plans.equalRate!,
      editHarvestPointPercent(snap, "spot", 500, plans.equalRate!.points, plans.equalRate!.points[0].id, 25),
    );
    const resetUser = resetHarvesterPlanState(changedUser);
    expect(resetUser.points).toEqual(resetUser.baseline);
    expect(resetUser.modified).toBe(false);
    expect(changedRate.modified).toBe(true);
  });

  it("Generate Current replaces only the active dataset and baseline", () => {
    const snap = snapshot();
    const plans = generateAllHarvesterPlans(snap, inputs());
    const untouched = structuredClone(plans.equalCash);
    const next = generateCurrentHarvesterPlan(plans, snap, inputs({ defaultHarvestPercent: 50 }), "user");
    expect(next.user).not.toEqual(plans.user);
    expect(next.user!.points).toEqual(next.user!.baseline);
    expect(next.equalCash).toEqual(untouched);
  });

  it("detects Generate All overwrite warnings only for modified other plans", () => {
    const plans = generateAllHarvesterPlans(snapshot(), inputs());
    expect(otherPlansContainCustomEdits(plans, "user")).toBe(false);
    plans.equalCash = { ...plans.equalCash!, modified: true };
    expect(otherPlansContainCustomEdits(plans, "user")).toBe(true);
    expect(otherPlansContainCustomEdits(plans, "equalCash")).toBe(false);
  });

  it("applies Harvest Rate live only to User while preserving topology and its reset baseline", () => {
    const snap = snapshot();
    const plans = generateAllHarvesterPlans(snap, inputs());
    const otherPlans = structuredClone({ equalRate: plans.equalRate, equalCash: plans.equalCash, earliestRecovery: plans.earliestRecovery });
    const beforeMoves = plans.user!.points.map((point) => point.movePercent);
    const updated = applyLiveHarvestRate(plans.user!, snap, 50);

    expect(updated.points.map((point) => point.movePercent)).toEqual(beforeMoves);
    expect(updated.points.map((point) => point.activeAfter)).not.toEqual(plans.user!.points.map((point) => point.activeAfter));
    expect(updated.harvestRatePercent).toBe(50);
    expect(updated.modified).toBe(true);
    expect({ equalRate: plans.equalRate, equalCash: plans.equalCash, earliestRecovery: plans.earliestRecovery }).toEqual(otherPlans);
    expect(resetHarvesterPlanState(updated).points).toEqual(plans.user!.baseline);
    expect(resetHarvesterPlanState(updated).harvestRatePercent).toBe(plans.user!.baselineHarvestRatePercent);
  });

  it("reapplies Earliest Recovery policy live and ignores Harvest Rate on equal optimizers", () => {
    const snap = snapshot({ longMode: "2.5x-cashback", cashbackMode: "cash" });
    const plans = generateAllHarvesterPlans(snap, inputs({ defaultHarvestPercent: 100 }));
    const beforeMoves = plans.earliestRecovery!.points.map((point) => point.movePercent);
    const updated = applyLiveHarvestRate(plans.earliestRecovery!, snap, 50);
    const resolved = resolveEarliestRecoveryPoints(snap, updated.generationInputs, updated.points, false);
    const result = evaluateHarvestPlan(snap, "spot", 500, resolved, false);

    expect(updated.points.map((point) => point.movePercent)).toEqual(beforeMoves);
    expect(updated.points).not.toEqual(plans.earliestRecovery!.points);
    expect(updated.modified).toBe(true);
    expect(result.points.slice((result.recovery.recoveredAtMovePercent === null ? result.points.length : result.points.findIndex((point) => point.movePercent === result.recovery.recoveredAtMovePercent)) + 1).every((point) => point.harvested < 1e-7)).toBe(true);
    expect(applyLiveHarvestRate(plans.equalRate!, snap, 50)).toBe(plans.equalRate);
    expect(applyLiveHarvestRate(plans.equalCash!, snap, 50)).toBe(plans.equalCash);
  });
});

describe("parity-relative Default Harvest", () => {
  it("exposes only the required preset values", () => {
    expect(DEFAULT_HARVEST_PRESETS).toEqual([25, 50, 75, 100, 125, 150, 200, 400]);
  });

  it("applies 50%, 100%, and >100% against positive checkpoint surplus", () => {
    const snap = snapshot();
    const half = evaluateHarvestPlan(snap, "spot", 500, generateUserHarvestPlan(snap, inputs({ defaultHarvestPercent: 50 })).points);
    const full = evaluateHarvestPlan(snap, "spot", 500, generateUserHarvestPlan(snap, inputs({ defaultHarvestPercent: 100 })).points);
    const over = evaluateHarvestPlan(snap, "spot", 500, generateUserHarvestPlan(snap, inputs({ defaultHarvestPercent: 150 })).points);
    expect(half.points[0].harvestPercent).toBeCloseTo(50, 8);
    expect(full.points[0].activeAfter).toBeCloseTo(full.points[0].benchmarkValue!, 8);
    expect(over.points[0].harvestPercent).toBeGreaterThan(100);
    expect(over.points[0].activeAfter).toBeLessThan(over.points[0].benchmarkValue!);
  });

  it("produces 0% and $0 when generated checkpoint surplus is non-positive", () => {
    const snap = snapshot({ longMode: "2x" });
    const result = evaluateHarvestPlan(snap, "spot", 500, generateUserHarvestPlan(snap, inputs()).points);
    expect(result.points.every((point) => point.harvestPercent === 0 && point.harvested === 0)).toBe(true);
  });

  it("converts typed percentage into the same constrained active-after state", () => {
    const snap = snapshot();
    const plan = generateUserHarvestPlan(snap, inputs({ defaultHarvestPercent: 50 }));
    const before = evaluateHarvestPlan(snap, "spot", 500, plan.points).points[0];
    const edited = editHarvestPointPercent(snap, "spot", 500, plan.points, plan.points[0].id, 175);
    const after = evaluateHarvestPlan(snap, "spot", 500, edited).points[0];
    expect(after.activeAfter).toBeCloseTo(harvestPercentToActiveAfter(before, 175), 7);
    expect(after.harvestPercent).toBeGreaterThan(100);
    const clamped = evaluateHarvestPlan(snap, "spot", 500, editHarvestPointPercent(snap, "spot", 500, plan.points, plan.points[0].id, 1e9));
    expect(clamped.final.paritySatisfied).toBe(true);
  });
});

describe("Harvester schedule optimizers", () => {
  it("Equal Rate keeps X fixed, applies one maximal common rate, and preserves parity", () => {
    const snap = snapshot();
    const stateInputs = inputs();
    const plan = generateEqualRateHarvestPlan(snap, stateInputs);
    const result = evaluateHarvestPlan(snap, "spot", 500, plan.points);
    const candidate = evaluateEqualRateCandidate(snap, stateInputs, plan.commonHarvestPercent!);
    expect(plan.points.map((point) => point.movePercent)).toEqual([100, 200, 300, 400]);
    candidate.participatingIndices.forEach((index) => {
      expect(result.points[index].harvested / candidate.baselineSurpluses[index] * 100).toBeCloseTo(plan.commonHarvestPercent!, 5);
    });
    expect(candidate.exact).toBe(true);
    expect(result.final.paritySatisfied).toBe(true);
    expect(result.final.remainingActiveV4).toBeGreaterThanOrEqual(result.final.benchmarkValue! - 1e-7);
    expect(result.final.remainingActiveV4 - result.final.benchmarkValue!).toBeLessThan(snap.config.deposit * .01);
    expect(evaluateEqualRateCandidate(snap, stateInputs, plan.commonHarvestPercent! + .01).exact).toBe(false);
  });

  it("does not let earlier Equal Rate withdrawals turn a baseline participant into a zero-rate checkpoint", () => {
    const snap = snapshot();
    const stateInputs = inputs();
    const unharvested = evaluateHarvestPlan(snap, "spot", 500, generateUserHarvestPlan(snap, inputs({ defaultHarvestPercent: 0 })).points);
    expect(unharvested.points.every((point) => point.surplusBefore > 1e-7)).toBe(true);

    const plan = generateEqualRateHarvestPlan(snap, stateInputs);
    const result = evaluateHarvestPlan(snap, "spot", 500, plan.points);
    const candidate = evaluateEqualRateCandidate(snap, stateInputs, plan.commonHarvestPercent!);
    expect(result.points.map((point) => point.movePercent)).toEqual([100, 200, 300, 400]);
    candidate.participatingIndices.forEach((index) => {
      expect(result.points[index].harvested).toBeGreaterThan(1);
      expect(result.points[index].harvested / candidate.baselineSurpluses[index] * 100).toBeCloseTo(plan.commonHarvestPercent!, 5);
    });
    expect(plan.summary).toBe(`${Number(plan.commonHarvestPercent!.toFixed(2))}% each checkpoint`);
    expect(result.final.paritySatisfied).toBe(true);
  });

  it("Equal Cash keeps X fixed, maximizes an identical withdrawal, and derives differing rates", () => {
    const snap = snapshot();
    const plan = generateEqualCashHarvestPlan(snap, inputs());
    const result = evaluateHarvestPlan(snap, "spot", 500, plan.points);
    expect(plan.points.map((point) => point.movePercent)).toEqual([100, 200, 300, 400]);
    result.points.forEach((point) => expect(point.harvested).toBeCloseTo(plan.commonWithdrawal!, 5));
    expect(new Set(result.points.map((point) => Math.round(point.harvestPercent))).size).toBeGreaterThan(1);
    expect(result.final.paritySatisfied).toBe(true);
  });

  it("optimizer zero-surplus cases remain finite and all-zero", () => {
    const snap = snapshot({ longMode: "2x" });
    const rate = generateEqualRateHarvestPlan(snap, inputs());
    const cash = generateEqualCashHarvestPlan(snap, inputs());
    expect(rate.commonHarvestPercent).toBe(0);
    expect(cash.commonWithdrawal).toBeCloseTo(0, 8);
    expect([...rate.points, ...cash.points].every((point) => Number.isFinite(point.activeAfter))).toBe(true);
  });
});

describe("Earliest Recovery", () => {
  it("includes external cash, trims the recovery withdrawal exactly, then stops", () => {
    const snap = snapshot({ longMode: "2.5x-cashback", cashbackMode: "cash" });
    const plan = generateEarliestRecoveryHarvestPlan(snap, inputs());
    const resolved = resolveEarliestRecoveryPoints(snap, inputs(), plan.points, true);
    const result = evaluateHarvestPlan(snap, "spot", 500, resolved, true);
    expect(result.recovery.recoveredAtMovePercent).toBe(200);
    expect(result.points[1].cumulativeHarvested + result.recovery.originalExternalAtLatestCheckpoint).toBeCloseTo(snap.config.deposit, 7);
    expect(result.points.slice(2).every((point) => point.harvested < 1e-7)).toBe(true);
    expect(result.final.paritySatisfied).toBe(true);
  });

  it("external spot marked value can complete recovery without an extra withdrawal", () => {
    const snap = snapshot({ longMode: "2.5x-cashback", cashbackMode: "spot" });
    const plan = generateEarliestRecoveryHarvestPlan(snap, inputs());
    const resolved = resolveEarliestRecoveryPoints(snap, inputs(), plan.points, true);
    const result = evaluateHarvestPlan(snap, "spot", 500, resolved, true);
    expect(result.recovery.recoveredAtMovePercent).toBe(100);
    expect(result.points.every((point) => point.harvested < 1e-7)).toBe(true);
  });

  it("defensively handles capital already recovered at entry", () => {
    const snap = snapshot();
    const originalDeposit = snap.config.deposit;
    snap.config.deposit = 0;
    const plan = generateEarliestRecoveryHarvestPlan(snap, inputs());
    const resolved = resolveEarliestRecoveryPoints(snap, inputs(), plan.points, true);
    expect(originalDeposit).toBeGreaterThan(0);
    expect(evaluateHarvestPlan(snap, "spot", 500, resolved, true).recovery.recoveredAtMovePercent).toBe(0);
    expect(resolved.every((point) => point.activeAfter === 0)).toBe(true);
  });

  it("horizontal and vertical edits remain one shared point model", () => {
    const snap = snapshot();
    const stateInputs = inputs({ defaultHarvestPercent: 50 });
    const state = createHarvesterPlanState(generateUserHarvestPlan(snap, stateInputs), stateInputs);
    const moved = editHarvestPoint(snap, "spot", 500, state.points, state.points[1].id, { movePercent: 227 }, "horizontal");
    const movedResult = evaluateHarvestPlan(snap, "spot", 500, moved);
    expect(movedResult.points[1].movePercent).toBe(225);
    const vertical = editHarvestPointPercent(snap, "spot", 500, moved, moved[1].id, 75);
    const verticalResult = evaluateHarvestPlan(snap, "spot", 500, vertical);
    expect(verticalResult.points[1].harvestPercent).toBeCloseTo(75, 5);
    expect(verticalResult.points[1].cumulativeHarvested).toBeCloseTo(verticalResult.points[0].harvested + verticalResult.points[1].harvested, 8);
  });

  it("live cash cashback accounting changes recovery interpretation without changing the plan", () => {
    const snap = snapshot({ longMode: "2.5x-cashback", cashbackMode: "cash" });
    const plan = generateEarliestRecoveryHarvestPlan(snap, inputs());
    const originalPoints = structuredClone(plan.points);
    const withPoints = resolveEarliestRecoveryPoints(snap, inputs(), plan.points, true);
    const withoutPoints = resolveEarliestRecoveryPoints(snap, inputs(), plan.points, false);
    const withCashback = evaluateHarvestPlan(snap, "spot", 500, withPoints, true);
    const withoutCashback = evaluateHarvestPlan(snap, "spot", 500, withoutPoints, false);

    expect(plan.points).toEqual(originalPoints);
    expect(withCashback.recovery.externalCashbackKind).toBe("cash");
    expect(withCashback.recovery.countedRecoveredCapital).toBeCloseTo(withCashback.recovery.harvestedCash + withCashback.recovery.externalCashbackValue, 8);
    expect(withoutCashback.recovery.countedRecoveredCapital).toBeCloseTo(withoutCashback.recovery.harvestedCash, 8);
    expect(withoutCashback.recovery.excludedCashbackValue).toBeCloseTo(withCashback.recovery.externalCashbackValue, 8);
    expect(withCashback.recovery.recovered).toBe(true);
    expect(withoutCashback.final.totalHarvested).toBeGreaterThan(withCashback.final.totalHarvested);
    expect(withoutCashback.final.originalExternalCapital).toBeCloseTo(withCashback.final.originalExternalCapital, 8);
  });

  it("continues the 100% policy with cashback excluded until harvested cash alone recovers principal", () => {
    const snap = snapshot({ cashbackMode: "cash" });
    const stateInputs = inputs({ defaultHarvestPercent: 100, intervalPercent: 50, pointCount: 6 });
    const policy = generateEarliestRecoveryHarvestPlan(snap, stateInputs);
    const resolved = resolveEarliestRecoveryPoints(snap, stateInputs, policy.points, false);
    const result = evaluateHarvestPlan(snap, "spot", 500, resolved, false);
    const recoveryIndex = result.points.findIndex((point) => point.cumulativeHarvested >= snap.config.deposit - 1e-7);

    expect(result.points[0].harvested).toBeGreaterThan(0);
    expect(result.points[0].cumulativeHarvested).toBeLessThan(snap.config.deposit);
    expect(result.points[1].harvested).toBeGreaterThan(0);
    expect(recoveryIndex).toBeGreaterThan(0);
    expect(result.points[recoveryIndex].cumulativeHarvested).toBeCloseTo(snap.config.deposit, 7);
    expect(result.points.slice(recoveryIndex + 1).every((point) => point.harvested < 1e-7)).toBe(true);
    expect(result.final.paritySatisfied).toBe(true);
  });

  it("keeps spot cashback marked live while excluding it from the recovery milestone", () => {
    const snap = snapshot({ longMode: "2.5x-cashback", cashbackMode: "spot" });
    const plan = generateEarliestRecoveryHarvestPlan(snap, inputs());
    const withCashback = evaluateHarvestPlan(snap, "spot", 500, resolveEarliestRecoveryPoints(snap, inputs(), plan.points, true), true);
    const withoutCashback = evaluateHarvestPlan(snap, "spot", 500, resolveEarliestRecoveryPoints(snap, inputs(), plan.points, false), false);

    expect(withCashback.recovery.externalCashbackKind).toBe("spot");
    expect(withCashback.recovery.externalCashbackValue).toBeGreaterThan(0);
    expect(withCashback.recovery.externalCashbackValue).not.toBeCloseTo(5_000, 2);
    expect(withCashback.recovery.recoveredAtMovePercent).not.toBe(withoutCashback.recovery.recoveredAtMovePercent);
    expect(withoutCashback.recovery.excludedCashbackValue).toBeCloseTo(withCashback.recovery.externalCashbackValue, 8);
    expect(withoutCashback.recovery.countedRecoveredCapital).toBeCloseTo(withoutCashback.recovery.harvestedCash, 8);
    expect(withoutCashback.final.originalExternalCapital).toBeCloseTo(withCashback.final.originalExternalCapital, 8);
  });

  it("exposes distinct spot-cashback valuation contexts for recovery and the final target", () => {
    const snap = snapshot({ longMode: "2.5x-cashback", cashbackMode: "spot" });
    const stateInputs = inputs();
    const policy = generateEarliestRecoveryHarvestPlan(snap, stateInputs);
    const resolved = resolveEarliestRecoveryPoints(snap, stateInputs, policy.points, true);
    const result = evaluateHarvestPlan(snap, "spot", 500, resolved, true);

    expect(originalExternalValue(snap, 1)).toBeGreaterThan(0);
    expect(originalExternalValue(snap, 2)).toBeGreaterThan(originalExternalValue(snap, 1));
    expect(result.recovery.externalCashbackValuationMovePercent).toBe(400);
    expect(result.recovery.externalCashbackValue).toBeCloseTo(originalExternalValue(snap, 5), 8);
    expect(result.final.originalExternalCapital).toBeCloseTo(originalExternalValue(snap, 6), 8);
    expect(result.final.originalExternalCapital).toBeGreaterThan(result.recovery.externalCashbackValue);
  });
});
