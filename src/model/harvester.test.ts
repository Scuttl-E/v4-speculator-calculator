import { describe, expect, it } from "vitest";
import type { Config } from "./types";
import {
  availableHarvesterBenchmarks,
  buildHarvesterChartSeries,
  createHarvesterExportPayload,
  createHarvesterSnapshot,
  deleteHarvestPoint,
  editHarvestPoint,
  evaluateHarvestPlan,
  evaluateHarvesterBenchmark,
  generateHarvestPoints,
  insertHarvestPoint,
  originalActiveV4Value,
  originalActiveV4LegValues,
  originalExternalValue,
  requiredFinalActiveFraction,
  resetHarvestPoints,
  snapHarvestMove,
  type HarvestPoint,
} from "./harvester";
import { portfolioComponents } from "./v4Math";

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
  spotAssetPrice: null,
  debtPosition: { assetPrice: 2_000, assetAmount: 20, usdDebt: 15_000, liquidationLtv: .85 },
  perpPosition: { assetPrice: 2_000, averageEntryPrice: 1_900, positionSize: 10, margin: 12_000, liquidationPrice: 1_200, side: "long" },
  assetName: "ETH",
});

const point = (id: string, movePercent: number, activeAfter: number): HarvestPoint => ({ id, movePercent, activeAfter });

describe("Harvester accounting", () => {
  it("preserves no-harvest identity and includes external cashback exactly once", () => {
    const snap = snapshot({ longMode: "2.5x-cashback", cashbackMode: "cash" });
    const result = evaluateHarvestPlan(snap, "spot", 300, []);
    const p = 2.4;
    const components = portfolioComponents(p, snap.config);
    expect(originalActiveV4Value(snap, p)).toBeCloseTo(snap.config.deposit * components.insideV4, 10);
    expect(originalExternalValue(snap, p)).toBeCloseTo(snap.config.deposit * components.cashbackValue, 10);
    expect(originalActiveV4Value(snap, p) + originalExternalValue(snap, p)).toBeCloseTo(snap.config.deposit * components.total, 10);
    expect(result.final.totalHarvested).toBe(0);
  });

  it("matches portfolioComponents.insideV4 across every Long/Short product pairing", () => {
    const modes = ["2x", "2.5x-cashback", "2.5x-looped"] as const;
    for (const longMode of modes) for (const shortMode of modes) for (const cashbackMode of ["cash", "spot"] as const) {
      const snap = snapshot({ longAllocation: .37, longMode, shortMode, cashbackMode });
      for (const priceRatio of [.4, 1, 2.75, 6]) {
        expect(originalActiveV4Value(snap, priceRatio), `${longMode}/${shortMode}/${cashbackMode}@${priceRatio}`)
          .toBeCloseTo(snap.config.deposit * portfolioComponents(priceRatio, snap.config).insideV4, 8);
      }
    }
  });

  it("keeps cash cashback fixed and spot cashback marked without scaling or regeneration", () => {
    const cash = snapshot({ longMode: "2.5x-cashback", cashbackMode: "cash" });
    const spot = snapshot({ longMode: "2.5x-cashback", cashbackMode: "spot" });
    expect(originalExternalValue(cash, 1)).toBe(12_500);
    expect(originalExternalValue(cash, 4)).toBe(12_500);
    expect(originalExternalValue(spot, 1)).toBe(12_500);
    expect(originalExternalValue(spot, 4)).toBe(50_000);
    const first = originalActiveV4Value(cash, 2) * .8;
    const plan = evaluateHarvestPlan(cash, "spot", 500, [point("a", 100, first), point("b", 200, first)]);
    expect(plan.points[1].cumulativeHarvested).toBeCloseTo(plan.points[0].harvested + plan.points[1].harvested, 10);
    expect(originalExternalValue(cash, 3)).toBe(12_500);
  });

  it("has no external cashback pot for retained 75% products", () => {
    const snap = snapshot({ longMode: "2.5x-looped", shortMode: "2.5x-looped", longAllocation: .4 });
    expect(originalExternalValue(snap, 1)).toBe(0);
    expect(originalExternalValue(snap, 5)).toBe(0);
  });

  it("scales a mixed Long/Short active position by one identical surviving fraction", () => {
    const snap = snapshot({ longAllocation: .45, longMode: "2.5x-cashback", shortMode: "2.5x-looped" });
    const after = originalActiveV4Value(snap, 2) * .7;
    const result = evaluateHarvestPlan(snap, "spot", 500, [point("a", 100, after)]);
    expect(result.points[0].survivingFraction).toBeCloseTo(.7, 10);
    expect(result.final.remainingActiveV4).toBeCloseTo(originalActiveV4Value(snap, 6) * .7, 10);
    const targetLegs = originalActiveV4LegValues(snap, 6);
    expect(targetLegs.long * result.points[0].survivingFraction + targetLegs.short * result.points[0].survivingFraction)
      .toBeCloseTo(result.final.remainingActiveV4, 10);
  });

  it("conserves total wealth at every withdrawal", () => {
    const snap = snapshot();
    const plan = generateHarvestPoints(snap, "spot", 500, 100, 3);
    const series = buildHarvesterChartSeries(snap, "spot", 500, plan);
    for (const harvest of evaluateHarvestPlan(snap, "spot", 500, plan).points) {
      const atMove = series.filter((entry) => entry.move === harvest.movePercent);
      expect(atMove).toHaveLength(2);
      expect(atMove[0].harvestedActiveV4 - atMove[1].harvestedActiveV4).toBeCloseTo(harvest.harvested, 8);
      expect(atMove[0].totalWealth).toBeCloseTo(atMove[1].totalWealth, 8);
    }
  });

  it("applies sequential withdrawals to later active capital", () => {
    const snap = snapshot();
    const aAfter = originalActiveV4Value(snap, 2) * .8;
    const bAfter = originalActiveV4Value(snap, 3) * .6;
    const result = evaluateHarvestPlan(snap, "spot", 500, [point("a", 100, aAfter), point("b", 200, bAfter)]);
    expect(result.points[1].activeBefore).toBeCloseTo(originalActiveV4Value(snap, 3) * .8, 8);
    expect(result.points[1].harvested).toBeCloseTo(originalActiveV4Value(snap, 3) * .2, 8);
  });
});

describe("Harvester constraints and editing", () => {
  it("satisfies final parity and excludes harvested cash from the constraint", () => {
    const snap = snapshot();
    const required = requiredFinalActiveFraction(snap, "spot", 500)!;
    const targetActive = originalActiveV4Value(snap, 2) * required;
    const result = evaluateHarvestPlan(snap, "spot", 500, [point("a", 100, targetActive)]);
    expect(result.final.paritySatisfied).toBe(true);
    expect(result.final.remainingActiveV4).toBeGreaterThanOrEqual(result.final.benchmarkValue! - 1e-7);
    expect(result.final.totalHarvested).toBeGreaterThan(0);
    expect(result.final.remainingActiveV4 + result.final.originalExternalCapital + result.final.totalHarvested).toBeGreaterThan(result.final.benchmarkValue!);
  });

  it("clamps point values to their dynamic feasible range", () => {
    const snap = snapshot();
    const result = evaluateHarvestPlan(snap, "spot", 500, [point("low", 100, -1), point("high", 200, 1e12)]);
    expect(result.points[0].activeAfter).toBeCloseTo(result.points[0].feasibleMin, 8);
    expect(result.points[1].activeAfter).toBeCloseTo(result.points[1].feasibleMax, 8);
    expect(result.final.paritySatisfied).toBe(true);
  });

  it("propagates an aggressive edit and raises later points only as required by final parity", () => {
    const snap = snapshot();
    const generated = generateHarvestPoints(snap, "spot", 500, 100, 3);
    const edited = editHarvestPoint(snap, "spot", 500, generated, generated[0].id, { activeAfter: 0 }, "vertical");
    const evaluated = evaluateHarvestPlan(snap, "spot", 500, edited);
    expect(evaluated.points.every((entry) => entry.activeAfter >= entry.feasibleMin - 1e-7)).toBe(true);
    expect(evaluated.final.paritySatisfied).toBe(true);
  });

  it("snaps horizontal edits, preserves ordering and cannot reach the target", () => {
    const snap = snapshot();
    const generated = generateHarvestPoints(snap, "spot", 500, 100, 3);
    expect(snapHarvestMove(127)).toBe(127);
    const moved = editHarvestPoint(snap, "spot", 500, generated, generated[1].id, { movePercent: 499 }, "horizontal");
    expect(moved[1].movePercent).toBe(299);
    expect(moved[0].movePercent).toBeLessThan(moved[1].movePercent);
    expect(moved[1].movePercent).toBeLessThan(moved[2].movePercent);
    expect(moved[2].movePercent).toBeLessThan(500);
  });

  it("inserts at clicked X, ignores Y, and uses the feasible midpoint", () => {
    const snap = snapshot();
    const inserted = insertHarvestPoint(snap, "spot", 500, [], 123);
    const evaluated = evaluateHarvestPlan(snap, "spot", 500, inserted);
    expect(inserted[0].movePercent).toBe(123);
    expect(inserted[0].activeAfter).toBeCloseTo((evaluated.points[0].feasibleMin + evaluated.points[0].feasibleMax) / 2, 8);
  });

  it("deletes and recalculates later segments", () => {
    const snap = snapshot();
    const generated = generateHarvestPoints(snap, "spot", 500, 100, 3);
    const before = evaluateHarvestPlan(snap, "spot", 500, generated);
    const deleted = deleteHarvestPoint(snap, "spot", 500, generated, generated[0].id);
    const after = evaluateHarvestPlan(snap, "spot", 500, deleted);
    expect(deleted).toHaveLength(2);
    expect(after.points[0].activeBefore).not.toBeCloseTo(before.points[1].activeBefore, 5);
  });

  it("resets the exact generated X/Y point set", () => {
    const snap = snapshot();
    const generated = generateHarvestPoints(snap, "spot", 500, 100, 4);
    const changed = generated.map((entry, index) => ({ ...entry, movePercent: entry.movePercent + index * 5, activeAfter: entry.activeAfter + 123 }));
    expect(changed).not.toEqual(generated);
    expect(resetHarvestPoints(generated)).toEqual(generated);
    expect(resetHarvestPoints(generated)).not.toBe(generated);
  });

  it("uses the target and interval as the only generated-checkpoint limit", () => {
    const snap = snapshot();
    const generated = generateHarvestPoints(snap, "spot", 1000, 50, 99);
    const added = insertHarvestPoint(snap, "spot", 1000, generated, 25);
    expect(generated).toHaveLength(19);
    expect(added).toHaveLength(20);
  });
});

describe("Harvester recovery and benchmarks", () => {
  it("counts marked external spot and harvested cash at the first recovery checkpoint", () => {
    const snap = snapshot({ longMode: "2.5x-cashback", cashbackMode: "spot" });
    const first = originalActiveV4Value(snap, 1.5) * .8;
    const second = originalActiveV4Value(snap, 2) * .6;
    const result = evaluateHarvestPlan(snap, "spot", 500, [point("a", 50, first), point("b", 100, second)]);
    expect(result.recovery.recovered).toBe(true);
    expect(result.recovery.recoveredAtMovePercent).toBe(100);
  });

  it("reports secured-capital progress at the latest checkpoint rather than borrowing future spot appreciation", () => {
    const snap = snapshot({ longMode: "2.5x-cashback", cashbackMode: "spot" });
    const noPoints = evaluateHarvestPlan(snap, "spot", 500, []);
    expect(noPoints.recovery.currentSecured).toBe(12_500);
    expect(noPoints.final.originalExternalCapital).toBe(75_000);
  });

  it("scopes benchmark availability and imported positions to the source chart", () => {
    const base = snapshot();
    const lending = createHarvesterSnapshot({ ...snapshot(), comparisonMode: "lending", debtPosition: { assetPrice: 2_000, assetAmount: 20, usdDebt: 15_000, liquidationLtv: .85 }, spotAssetPrice: 2_000 });
    const perp = createHarvesterSnapshot({ ...snapshot(), comparisonMode: "perp", perpPosition: { assetPrice: 2_000, averageEntryPrice: 1_900, positionSize: 10, margin: 12_000, liquidationPrice: 1_200, side: "long" }, spotAssetPrice: 2_000 });

    expect(availableHarvesterBenchmarks(base)).toEqual(["spot"]);
    expect(base.debtPosition).toBeUndefined();
    expect(base.perpPosition).toBeUndefined();
    expect(availableHarvesterBenchmarks(lending)).toEqual(["spot", "lending"]);
    expect(lending.perpPosition).toBeUndefined();
    expect(availableHarvesterBenchmarks(perp)).toEqual(["spot", "perp"]);
    expect(perp.debtPosition).toBeUndefined();
    expect(evaluateHarvesterBenchmark(lending, "lending", 2).value).toBe(65_000);
    expect(evaluateHarvesterBenchmark(perp, "perp", 2).value).toBe(33_000);
    expect(evaluateHarvesterBenchmark(base, "lending", 2).status).toBe("unavailable");
  });

  it("reports invalid/liquidated final benchmarks defensively", () => {
    const shortPerp = createHarvesterSnapshot({
      ...snapshot(),
      comparisonMode: "perp",
      perpPosition: { assetPrice: 2_000, averageEntryPrice: 2_100, positionSize: 10, margin: 12_000, liquidationPrice: 3_000, side: "short" },
    });
    const result = evaluateHarvestPlan(shortPerp, "perp", 100, []);
    expect(result.feasible).toBe(false);
    expect(result.final.benchmarkStatus).toBe("liquidated");
    expect(result.final.benchmarkValue).toBeNull();
    expect(result.final.paritySatisfied).toBe(false);
  });

  it("builds a renderer-independent export payload", () => {
    const snap = snapshot();
    const points = generateHarvestPoints(snap, "spot", 500, 100, 3);
    const payload = createHarvesterExportPayload(snap, "spot", 500, points);
    expect(payload.harvestCheckpoints).toHaveLength(3);
    expect(payload.originalActiveV4Curve.length).toBeGreaterThan(100);
    expect(payload.harvestedActiveV4Curve).toHaveLength(payload.originalActiveV4Curve.length);
    expect(payload.totalWealthCurve).toHaveLength(payload.originalActiveV4Curve.length);
    expect(payload.selectedBenchmarkCurve).toHaveLength(payload.originalActiveV4Curve.length);
    expect(payload.finalTargetSummary.paritySatisfied).toBe(true);
    expect(payload.totalHarvested).toBeGreaterThan(0);
  });
});
