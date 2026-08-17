import {
  debtPositionValue,
  isDebtPositionLiquidated,
  type DebtPositionInput,
} from "./debtPosition";
import {
  isPerpPositionLiquidated,
  perpPositionValue,
  type PerpPositionInput,
} from "./perpPosition";
import type { ComparisonMode, Config } from "./types";
import {
  longPositionValue,
  normaliseLongMode,
  normaliseShortMode,
  portfolioComponents,
  productCashOutRate,
  shortPositionValue,
} from "./v4Math";

const EPSILON = 1e-8;
export const HARVESTER_MOVE_STEP = 1;

export type HarvesterBenchmark = "spot" | "lending" | "perp";
export type HarvesterDragMode = "vertical" | "horizontal" | "both";
export type HarvesterPlanKind = "user" | "equalRate" | "equalCash" | "earliestRecovery";
export type HarvestDirection = "long" | "short";
export type HarvestWithdrawalSource = "proportional" | "longFirst" | "shortFirst";
export type HarvesterChartView = "long" | "complete" | "short";
export type HarvesterPreviewThrough = "before" | "all" | `checkpoint:${number}`;
export const HARVESTER_PLAN_KINDS: readonly HarvesterPlanKind[] = ["user", "equalRate", "equalCash", "earliestRecovery"];
export const DEFAULT_HARVEST_PRESETS = [25, 50, 75, 100, 125, 150, 200, 400] as const;

export interface HarvesterSnapshot {
  config: Config;
  comparisonMode: ComparisonMode;
  debtPosition?: DebtPositionInput;
  perpPosition?: PerpPositionInput;
  /** Price of the selected source asset at import time, if known. */
  spotAssetPrice: number | null;
  assetName: string;
  defaultHarvestDirection: HarvestDirection;
  importedAt: number;
}

export interface HarvestPoint {
  id: string;
  movePercent: number;
  activeAfter: number;
}

export interface HarvestPointResult extends HarvestPoint {
  priceRatio: number;
  activeBefore: number;
  harvested: number;
  cumulativeHarvested: number;
  longBefore: number;
  shortBefore: number;
  longAfter: number;
  shortAfter: number;
  longFractionAfter: number;
  shortFractionAfter: number;
  feasibleMin: number;
  feasibleMax: number;
  maximumAdditionalHarvest: number;
  benchmarkValue: number | null;
  surplusBefore: number;
  harvestPercent: number;
}

export interface HarvesterGenerationInputs {
  direction: HarvestDirection;
  withdrawalSource: HarvestWithdrawalSource;
  benchmark: HarvesterBenchmark;
  finalTargetPercent: number;
  intervalPercent: number;
  firstCheckpointPercent: number | null;
  pointCount: number;
  defaultHarvestPercent: number;
}

export interface HarvesterGeneratedPlan {
  kind: HarvesterPlanKind;
  points: HarvestPoint[];
  summary: string;
  commonHarvestPercent: number | null;
  commonWithdrawal: number | null;
}

export interface HarvesterPlanState extends HarvesterGeneratedPlan {
  generationInputs: HarvesterGenerationInputs;
  baseline: HarvestPoint[];
  harvestRatePercent: number;
  baselineHarvestRatePercent: number;
  selectedPointId: string | null;
  modified: boolean;
}

export type HarvesterPlans = Record<HarvesterPlanKind, HarvesterPlanState | null>;

export interface HarvesterBenchmarkValue {
  value: number | null;
  status: "valid" | "liquidated" | "unavailable";
}

export interface HarvesterFinalSummary {
  remainingActiveV4: number;
  remainingLong: number;
  remainingShort: number;
  longFraction: number;
  shortFraction: number;
  benchmarkValue: number | null;
  benchmarkStatus: HarvesterBenchmarkValue["status"];
  originalExternalCapital: number;
  totalHarvested: number;
  totalWealth: number;
  finalSurplus: number | null;
  paritySatisfied: boolean;
}

export interface HarvesterRecovery {
  accountInitialCashback: boolean;
  coveredAtTarget: boolean;
  coverageAtTarget: number;
  coverageGapAtTarget: number;
  firstReachedAtMovePercent: number | null;
  durablyCoveredAtMovePercent: number | null;
  harvestedCash: number;
  cashbackValueAtTarget: number;
  countedCashbackValueAtTarget: number;
  excludedCashbackValueAtTarget: number;
  externalCashbackKind: "cash" | "spot";
  initialRecoveryTarget: number;
}

export interface HarvesterResult {
  points: HarvestPointResult[];
  feasible: boolean;
  final: HarvesterFinalSummary;
  recovery: HarvesterRecovery;
}

export interface HarvesterChartPoint {
  move: number;
  originalActiveV4: number;
  harvestedActiveV4: number;
  historicalActiveV4: number | null;
  previewedActiveV4: number;
  previewedRemainingLong: number;
  previewedRemainingShort: number;
  previewedCumulativeHarvested: number;
  remainingLong: number;
  remainingShort: number;
  initialCashback: number;
  totalWealth: number;
  previewedTotalWealth: number;
  benchmark: number | null;
  comparisonReference: number | null;
  cumulativeHarvested: number;
  phase?: "before" | "after";
  projection?: boolean;
}

export const createHarvesterSnapshot = (input: Omit<HarvesterSnapshot, "importedAt">): HarvesterSnapshot => ({
  config: { ...input.config },
  comparisonMode: input.comparisonMode,
  assetName: input.assetName,
  defaultHarvestDirection: input.defaultHarvestDirection,
  spotAssetPrice: Number.isFinite(input.spotAssetPrice) && (input.spotAssetPrice ?? 0) > 0 ? input.spotAssetPrice : null,
  ...(input.comparisonMode === "lending" && input.debtPosition ? { debtPosition: { ...input.debtPosition } } : {}),
  ...(input.comparisonMode === "perp" && input.perpPosition ? { perpPosition: { ...input.perpPosition } } : {}),
  importedAt: Date.now(),
});

export const benchmarkForComparisonMode = (mode: ComparisonMode): HarvesterBenchmark =>
  mode === "lending" ? "lending" : mode === "perp" ? "perp" : "spot";

export const availableHarvesterBenchmarks = (snapshot: HarvesterSnapshot): HarvesterBenchmark[] =>
  snapshot.comparisonMode === "lending" ? ["spot", "lending"]
    : snapshot.comparisonMode === "perp" ? ["spot", "perp"]
      : ["spot"];

export const originalActiveV4LegValues = (snapshot: HarvesterSnapshot, priceRatio: number) => {
  const config = snapshot.config;
  const longMode = normaliseLongMode(config);
  const shortMode = normaliseShortMode(config);
  return {
    long: config.deposit * config.longAllocation * (1 - productCashOutRate(longMode)) * longPositionValue(priceRatio, longMode),
    short: config.deposit * (1 - config.longAllocation) * (1 - productCashOutRate(shortMode)) * shortPositionValue(priceRatio, shortMode),
  };
};

/** Imported active protocol value. The canonical active Long/Short primitives
 * exclude external cashback; withdrawal routing applies the surviving leg fractions. */
export const originalActiveV4Value = (snapshot: HarvesterSnapshot, priceRatio: number) => {
  const legs = originalActiveV4LegValues(snapshot, priceRatio);
  return legs.long + legs.short;
};

export const originalExternalValue = (snapshot: HarvesterSnapshot, priceRatio: number) =>
  snapshot.config.deposit * portfolioComponents(priceRatio, snapshot.config).cashbackValue;

export const initialRecoveryTarget = (snapshot: HarvesterSnapshot) =>
  snapshot.comparisonMode === "perp" && snapshot.perpPosition
    ? snapshot.perpPosition.margin
    : snapshot.config.deposit;

export const evaluateHarvesterBenchmark = (
  snapshot: HarvesterSnapshot,
  benchmark: HarvesterBenchmark,
  priceRatio: number,
): HarvesterBenchmarkValue => {
  if (benchmark === "spot") return { value: snapshot.config.deposit * priceRatio, status: "valid" };
  if (!availableHarvesterBenchmarks(snapshot).includes(benchmark)) return { value: null, status: "unavailable" };
  if (benchmark === "lending") {
    if (!snapshot.debtPosition) return { value: null, status: "unavailable" };
    return isDebtPositionLiquidated(priceRatio, snapshot.debtPosition)
      ? { value: null, status: "liquidated" }
      : { value: debtPositionValue(priceRatio, snapshot.debtPosition), status: "valid" };
  }
  if (!snapshot.perpPosition) return { value: null, status: "unavailable" };
  return isPerpPositionLiquidated(priceRatio, snapshot.perpPosition)
    ? { value: null, status: "liquidated" }
    : { value: perpPositionValue(priceRatio, snapshot.perpPosition), status: "valid" };
};

const pointId = () => `harvest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const ratioAt = (movePercent: number) => 1 + movePercent / 100;
const clonePoints = (points: HarvestPoint[]) => points.map((point) => ({ ...point }));
const preservePointIds = (points: HarvestPoint[], existingPoints: HarvestPoint[]) =>
  points.map((point, index) => ({ ...point, id: existingPoints[index]?.id ?? point.id }));

export interface HarvesterEvaluationOptions {
  direction: HarvestDirection;
  withdrawalSource: HarvestWithdrawalSource;
}

interface HarvesterLegFractions {
  long: number;
  short: number;
}

const evaluationOptionsFor = (
  finalTargetPercent: number,
  options?: Partial<HarvesterEvaluationOptions>,
): HarvesterEvaluationOptions => ({
  direction: options?.direction ?? (finalTargetPercent < 0 ? "short" : "long"),
  withdrawalSource: options?.withdrawalSource ?? "proportional",
});

const evaluationOptionsFromInputs = (inputs: HarvesterGenerationInputs): HarvesterEvaluationOptions => ({
  direction: inputs.direction,
  withdrawalSource: inputs.withdrawalSource,
});

const directionSign = (direction: HarvestDirection) => direction === "long" ? 1 : -1;
const progressAt = (movePercent: number, direction: HarvestDirection) => movePercent * directionSign(direction);
const moveAtProgress = (progress: number, direction: HarvestDirection) => progress * directionSign(direction);
const orderHarvestPoints = (points: HarvestPoint[], direction: HarvestDirection) =>
  clonePoints(points).sort((left, right) => progressAt(left.movePercent, direction) - progressAt(right.movePercent, direction));

const activeLegValuesAt = (
  snapshot: HarvesterSnapshot,
  movePercent: number,
  fractions: HarvesterLegFractions,
) => {
  const original = originalActiveV4LegValues(snapshot, ratioAt(movePercent));
  const long = original.long * fractions.long;
  const short = original.short * fractions.short;
  return { original, long, short, total: long + short };
};

const maximumWithdrawalAt = (
  snapshot: HarvesterSnapshot,
  benchmark: HarvesterBenchmark,
  finalTargetPercent: number,
  movePercent: number,
  fractions: HarvesterLegFractions,
  withdrawalSource: HarvestWithdrawalSource,
) => {
  const targetBenchmark = evaluateHarvesterBenchmark(snapshot, benchmark, ratioAt(finalTargetPercent));
  if (targetBenchmark.status !== "valid" || targetBenchmark.value === null) return { amount: 0, feasible: false };
  const checkpoint = activeLegValuesAt(snapshot, movePercent, fractions);
  const target = activeLegValuesAt(snapshot, finalTargetPercent, fractions);
  let remainingHeadroom = target.total - targetBenchmark.value;
  if (remainingHeadroom < -EPSILON) return { amount: 0, feasible: false };
  remainingHeadroom = Math.max(0, remainingHeadroom);
  if (withdrawalSource === "proportional") {
    if (checkpoint.total <= EPSILON) return { amount: 0, feasible: true };
    if (target.total <= EPSILON) return { amount: checkpoint.total, feasible: true };
    return {
      amount: Math.min(checkpoint.total, remainingHeadroom * checkpoint.total / target.total),
      feasible: true,
    };
  }
  const preferred = withdrawalSource === "longFirst" ? "long" : "short";
  const fallback = preferred === "long" ? "short" : "long";
  let amount = 0;
  for (const leg of [preferred, fallback] as const) {
    const available = checkpoint[leg];
    if (available <= EPSILON) continue;
    const originalCheckpoint = checkpoint.original[leg];
    const originalTarget = originalActiveV4LegValues(snapshot, ratioAt(finalTargetPercent))[leg];
    const finalCostPerDollar = originalCheckpoint <= EPSILON ? Number.POSITIVE_INFINITY : originalTarget / originalCheckpoint;
    if (finalCostPerDollar <= EPSILON) {
      amount += available;
      continue;
    }
    const permitted = Math.min(available, remainingHeadroom / finalCostPerDollar);
    amount += permitted;
    remainingHeadroom = Math.max(0, remainingHeadroom - permitted * finalCostPerDollar);
    if (permitted < available - EPSILON) break;
  }
  return { amount, feasible: true };
};

const applyWithdrawalAt = (
  snapshot: HarvesterSnapshot,
  movePercent: number,
  fractions: HarvesterLegFractions,
  withdrawalSource: HarvestWithdrawalSource,
  requestedAmount: number,
) => {
  const checkpoint = activeLegValuesAt(snapshot, movePercent, fractions);
  const amount = Math.min(checkpoint.total, Math.max(0, requestedAmount));
  if (amount <= EPSILON || checkpoint.total <= EPSILON) return { fractions: { ...fractions }, amount: 0 };
  if (withdrawalSource === "proportional") {
    const surviving = Math.max(0, 1 - amount / checkpoint.total);
    return {
      fractions: { long: fractions.long * surviving, short: fractions.short * surviving },
      amount,
    };
  }
  const next = { ...fractions };
  let remaining = amount;
  const preferred = withdrawalSource === "longFirst" ? "long" : "short";
  const fallback = preferred === "long" ? "short" : "long";
  for (const leg of [preferred, fallback] as const) {
    const available = checkpoint[leg];
    const originalAtCheckpoint = checkpoint.original[leg];
    if (remaining <= EPSILON || available <= EPSILON || originalAtCheckpoint <= EPSILON) continue;
    const taken = Math.min(available, remaining);
    next[leg] = Math.max(0, next[leg] - taken / originalAtCheckpoint);
    remaining -= taken;
  }
  return { fractions: next, amount: amount - remaining };
};

export const snapHarvestMove = (movePercent: number) => Math.round(movePercent / HARVESTER_MOVE_STEP) * HARVESTER_MOVE_STEP;

export const horizontalBoundsForPoint = (points: HarvestPoint[], index: number, finalTargetPercent: number) => {
  const direction = finalTargetPercent < 0 ? "short" : "long";
  const ordered = orderHarvestPoints(points, direction);
  const lowerProgress = index === 0
    ? HARVESTER_MOVE_STEP
    : progressAt(ordered[index - 1].movePercent, direction) + HARVESTER_MOVE_STEP;
  const upperProgress = index === ordered.length - 1
    ? progressAt(finalTargetPercent, direction) - HARVESTER_MOVE_STEP
    : progressAt(ordered[index + 1].movePercent, direction) - HARVESTER_MOVE_STEP;
  const first = moveAtProgress(lowerProgress, direction);
  const second = moveAtProgress(upperProgress, direction);
  return { min: Math.min(first, second), max: Math.max(first, second) };
};

const finalSummary = (
  snapshot: HarvesterSnapshot,
  benchmark: HarvesterBenchmark,
  finalTargetPercent: number,
  fractions: HarvesterLegFractions,
  totalHarvested: number,
): HarvesterFinalSummary => {
  const p = ratioAt(finalTargetPercent);
  const legs = originalActiveV4LegValues(snapshot, p);
  const remainingLong = fractions.long * legs.long;
  const remainingShort = fractions.short * legs.short;
  const remainingActiveV4 = remainingLong + remainingShort;
  const originalExternalCapital = originalExternalValue(snapshot, p);
  const benchmarkResult = evaluateHarvesterBenchmark(snapshot, benchmark, p);
  const totalWealth = remainingActiveV4 + originalExternalCapital + totalHarvested;
  const finalSurplus = benchmarkResult.value === null
    ? null
    : remainingActiveV4 - benchmarkResult.value;
  return {
    remainingActiveV4,
    remainingLong,
    remainingShort,
    longFraction: fractions.long,
    shortFraction: fractions.short,
    benchmarkValue: benchmarkResult.value,
    benchmarkStatus: benchmarkResult.status,
    originalExternalCapital,
    totalHarvested,
    totalWealth,
    finalSurplus,
    paritySatisfied: finalSurplus !== null && finalSurplus >= -EPSILON,
  };
};

export const evaluateHarvestPlan = (
  snapshot: HarvesterSnapshot,
  benchmark: HarvesterBenchmark,
  finalTargetPercent: number,
  inputPoints: HarvestPoint[],
  accountInitialCashback = true,
  evaluationOptions?: Partial<HarvesterEvaluationOptions>,
): HarvesterResult => {
  const options = evaluationOptionsFor(finalTargetPercent, evaluationOptions);
  const recoveryTarget = initialRecoveryTarget(snapshot);
  const ordered = orderHarvestPoints(inputPoints, options.direction);
  let fractions: HarvesterLegFractions = { long: 1, short: 1 };
  let cumulativeHarvested = 0;
  const targetBenchmark = evaluateHarvesterBenchmark(snapshot, benchmark, ratioAt(finalTargetPercent));
  const originalTargetActive = originalActiveV4Value(snapshot, ratioAt(finalTargetPercent));
  let feasible = targetBenchmark.status === "valid" && targetBenchmark.value !== null && originalTargetActive >= targetBenchmark.value - EPSILON;
  const points = ordered.map((point) => {
    const priceRatio = ratioAt(point.movePercent);
    const before = activeLegValuesAt(snapshot, point.movePercent, fractions);
    const activeBefore = before.total;
    const maximum = maximumWithdrawalAt(
      snapshot,
      benchmark,
      finalTargetPercent,
      point.movePercent,
      fractions,
      options.withdrawalSource,
    );
    feasible = feasible && maximum.feasible;
    const feasibleMin = activeBefore - maximum.amount;
    const feasibleMax = activeBefore;
    const activeAfter = Math.min(feasibleMax, Math.max(feasibleMin, point.activeAfter));
    const applied = applyWithdrawalAt(
      snapshot,
      point.movePercent,
      fractions,
      options.withdrawalSource,
      activeBefore - activeAfter,
    );
    fractions = applied.fractions;
    const after = activeLegValuesAt(snapshot, point.movePercent, fractions);
    const harvested = applied.amount;
    const benchmarkValue = evaluateHarvesterBenchmark(snapshot, benchmark, priceRatio).value;
    const surplusBefore = benchmarkValue === null ? 0 : activeBefore - benchmarkValue;
    const harvestPercent = surplusBefore > EPSILON ? (harvested / surplusBefore) * 100 : 0;
    cumulativeHarvested += harvested;
    return {
      ...point,
      activeAfter: after.total,
      priceRatio,
      activeBefore,
      harvested,
      cumulativeHarvested,
      longBefore: before.long,
      shortBefore: before.short,
      longAfter: after.long,
      shortAfter: after.short,
      longFractionAfter: fractions.long,
      shortFractionAfter: fractions.short,
      feasibleMin,
      feasibleMax,
      maximumAdditionalHarvest: Math.max(0, activeAfter - feasibleMin),
      benchmarkValue,
      surplusBefore,
      harvestPercent,
    };
  });
  const final = finalSummary(snapshot, benchmark, finalTargetPercent, fractions, cumulativeHarvested);
  const coverageAt = (harvestedCash: number, movePercent: number) => harvestedCash
    + (accountInitialCashback ? originalExternalValue(snapshot, ratioAt(movePercent)) : 0);
  const coverageTimeline: Array<{ movePercent: number; coverage: number; milestone: boolean }> = [{
    movePercent: 0,
    coverage: coverageAt(0, 0),
    milestone: true,
  }];
  let priorHarvested = 0;
  points.forEach((point) => {
    coverageTimeline.push({ movePercent: point.movePercent, coverage: coverageAt(priorHarvested, point.movePercent), milestone: false });
    coverageTimeline.push({ movePercent: point.movePercent, coverage: coverageAt(point.cumulativeHarvested, point.movePercent), milestone: true });
    priorHarvested = point.cumulativeHarvested;
  });
  const coverageAtTarget = coverageAt(cumulativeHarvested, finalTargetPercent);
  coverageTimeline.push({ movePercent: finalTargetPercent, coverage: coverageAtTarget, milestone: true });
  const firstReachedAtMovePercent = coverageTimeline.find((entry) => entry.milestone && entry.coverage >= recoveryTarget - EPSILON)?.movePercent ?? null;
  const durableCoverageIndex = coverageTimeline.findIndex((entry, index) =>
    entry.milestone
    && entry.coverage >= recoveryTarget - EPSILON
    && coverageTimeline.slice(index).every((candidate) => candidate.coverage >= recoveryTarget - EPSILON));
  const durablyCoveredAtMovePercent = durableCoverageIndex < 0 ? null : coverageTimeline[durableCoverageIndex].movePercent;
  const countedCashbackValueAtTarget = accountInitialCashback ? final.originalExternalCapital : 0;
  return {
    points,
    feasible,
    final,
    recovery: {
      accountInitialCashback,
      coveredAtTarget: coverageAtTarget >= recoveryTarget - EPSILON,
      coverageAtTarget,
      coverageGapAtTarget: coverageAtTarget - recoveryTarget,
      firstReachedAtMovePercent,
      durablyCoveredAtMovePercent,
      harvestedCash: cumulativeHarvested,
      cashbackValueAtTarget: final.originalExternalCapital,
      countedCashbackValueAtTarget,
      excludedCashbackValueAtTarget: accountInitialCashback ? 0 : final.originalExternalCapital,
      externalCashbackKind: snapshot.config.cashbackMode === "spot" ? "spot" : "cash",
      initialRecoveryTarget: recoveryTarget,
    },
  };
};

export const constrainHarvestPoints = (
  snapshot: HarvesterSnapshot,
  benchmark: HarvesterBenchmark,
  finalTargetPercent: number,
  points: HarvestPoint[],
  evaluationOptions?: Partial<HarvesterEvaluationOptions>,
) => evaluateHarvestPlan(snapshot, benchmark, finalTargetPercent, points, true, evaluationOptions).points.map(({ id, movePercent, activeAfter }) => ({ id, movePercent, activeAfter }));

export const feasibleRangeAt = (
  snapshot: HarvesterSnapshot,
  benchmark: HarvesterBenchmark,
  finalTargetPercent: number,
  points: HarvestPoint[],
  movePercent: number,
  evaluationOptions?: Partial<HarvesterEvaluationOptions>,
) => {
  const options = evaluationOptionsFor(finalTargetPercent, evaluationOptions);
  const targetProgress = progressAt(movePercent, options.direction);
  const before = points.filter((point) => progressAt(point.movePercent, options.direction) < targetProgress);
  const previous = evaluateHarvestPlan(snapshot, benchmark, finalTargetPercent, before, true, options);
  const fractions = previous.points.length > 0
    ? {
      long: previous.points[previous.points.length - 1].longFractionAfter,
      short: previous.points[previous.points.length - 1].shortFractionAfter,
    }
    : { long: 1, short: 1 };
  const active = activeLegValuesAt(snapshot, movePercent, fractions).total;
  const maximum = maximumWithdrawalAt(snapshot, benchmark, finalTargetPercent, movePercent, fractions, options.withdrawalSource);
  return { min: active - maximum.amount, max: active, feasible: maximum.feasible };
};

export const generateHarvestPoints = (
  snapshot: HarvesterSnapshot,
  benchmark: HarvesterBenchmark,
  finalTargetPercent: number,
  intervalPercent: number,
  pointCount: number,
  evaluationOptions?: Partial<HarvesterEvaluationOptions>,
) => {
  const options = evaluationOptionsFor(finalTargetPercent, evaluationOptions);
  const count = Math.min(maximumCheckpointCount(finalTargetPercent, intervalPercent), Math.max(0, Math.floor(pointCount)));
  const interval = Math.max(HARVESTER_MOVE_STEP, snapHarvestMove(intervalPercent));
  const generated: HarvestPoint[] = [];
  for (let index = 1; index <= count; index += 1) {
    const movePercent = moveAtProgress(interval * index, options.direction);
    if (progressAt(movePercent, options.direction) >= progressAt(finalTargetPercent, options.direction)) break;
    const range = feasibleRangeAt(snapshot, benchmark, finalTargetPercent, generated, movePercent, options);
    const benchmarkResult = evaluateHarvesterBenchmark(snapshot, benchmark, ratioAt(movePercent));
    const benchmarkActive = benchmarkResult.value === null
      ? range.max
      : benchmarkResult.value;
    generated.push({
      id: pointId(),
      movePercent,
      activeAfter: Math.min(range.max, Math.max(range.min, benchmarkActive)),
    });
  }
  return constrainHarvestPoints(snapshot, benchmark, finalTargetPercent, generated, options);
};

export const editHarvestPoint = (
  snapshot: HarvesterSnapshot,
  benchmark: HarvesterBenchmark,
  finalTargetPercent: number,
  points: HarvestPoint[],
  pointIdToEdit: string,
  edit: { movePercent?: number; activeAfter?: number },
  dragMode: HarvesterDragMode = "both",
  evaluationOptions?: Partial<HarvesterEvaluationOptions>,
) => {
  const options = evaluationOptionsFor(finalTargetPercent, evaluationOptions);
  const ordered = orderHarvestPoints(points, options.direction);
  const index = ordered.findIndex((point) => point.id === pointIdToEdit);
  if (index < 0) return ordered;
  const oldResult = evaluateHarvestPlan(snapshot, benchmark, finalTargetPercent, ordered, true, options).points[index];
  const bounds = horizontalBoundsForPoint(ordered, index, finalTargetPercent);
  const nextMove = dragMode === "vertical" || edit.movePercent === undefined
    ? ordered[index].movePercent
    : Math.min(bounds.max, Math.max(bounds.min, snapHarvestMove(edit.movePercent)));
  const beforePoints = ordered.slice(0, index);
  const range = feasibleRangeAt(snapshot, benchmark, finalTargetPercent, beforePoints, nextMove, options);
  let nextAfter = ordered[index].activeAfter;
  if (dragMode === "horizontal") {
    nextAfter = range.max - oldResult.harvested;
  } else if (edit.activeAfter !== undefined) {
    nextAfter = edit.activeAfter;
  }
  ordered[index] = { ...ordered[index], movePercent: nextMove, activeAfter: Math.min(range.max, Math.max(range.min, nextAfter)) };
  return constrainHarvestPoints(snapshot, benchmark, finalTargetPercent, ordered, options);
};

export const insertHarvestPoint = (
  snapshot: HarvesterSnapshot,
  benchmark: HarvesterBenchmark,
  finalTargetPercent: number,
  points: HarvestPoint[],
  clickedMovePercent: number,
  evaluationOptions?: Partial<HarvesterEvaluationOptions>,
) => {
  const options = evaluationOptionsFor(finalTargetPercent, evaluationOptions);
  const occupied = new Set(points.map((point) => point.movePercent));
  const clickedProgress = progressAt(snapHarvestMove(clickedMovePercent), options.direction);
  const clampedProgress = Math.min(
    progressAt(finalTargetPercent, options.direction) - HARVESTER_MOVE_STEP,
    Math.max(HARVESTER_MOVE_STEP, clickedProgress),
  );
  const movePercent = moveAtProgress(clampedProgress, options.direction);
  if (occupied.has(movePercent)) return clonePoints(points);
  const range = feasibleRangeAt(snapshot, benchmark, finalTargetPercent, points, movePercent, options);
  const next = [...points, { id: pointId(), movePercent, activeAfter: (range.min + range.max) / 2 }]
    .sort((a, b) => progressAt(a.movePercent, options.direction) - progressAt(b.movePercent, options.direction));
  return constrainHarvestPoints(snapshot, benchmark, finalTargetPercent, next, options);
};

export const deleteHarvestPoint = (
  snapshot: HarvesterSnapshot,
  benchmark: HarvesterBenchmark,
  finalTargetPercent: number,
  points: HarvestPoint[],
  id: string,
  evaluationOptions?: Partial<HarvesterEvaluationOptions>,
) => constrainHarvestPoints(snapshot, benchmark, finalTargetPercent, points.filter((point) => point.id !== id), evaluationOptions);

export const resetHarvestPoints = (generatedPoints: HarvestPoint[]) => clonePoints(generatedPoints);

export const harvestPercentToActiveAfter = (
  point: Pick<HarvestPointResult, "activeBefore" | "benchmarkValue" | "feasibleMin" | "feasibleMax">,
  harvestPercent: number,
) => {
  const surplus = point.benchmarkValue === null ? 0 : Math.max(0, point.activeBefore - point.benchmarkValue);
  const desiredWithdrawal = surplus * Math.max(0, harvestPercent) / 100;
  return Math.min(point.feasibleMax, Math.max(point.feasibleMin, point.activeBefore - desiredWithdrawal));
};

export const activeAfterToHarvestPercent = (
  point: Pick<HarvestPointResult, "activeBefore" | "activeAfter" | "benchmarkValue">,
) => {
  const surplus = point.benchmarkValue === null ? 0 : point.activeBefore - point.benchmarkValue;
  return surplus > EPSILON ? Math.max(0, point.activeBefore - point.activeAfter) / surplus * 100 : 0;
};

export const editHarvestPointPercent = (
  snapshot: HarvesterSnapshot,
  benchmark: HarvesterBenchmark,
  finalTargetPercent: number,
  points: HarvestPoint[],
  pointIdToEdit: string,
  harvestPercent: number,
  evaluationOptions?: Partial<HarvesterEvaluationOptions>,
) => {
  const options = evaluationOptionsFor(finalTargetPercent, evaluationOptions);
  const evaluated = evaluateHarvestPlan(snapshot, benchmark, finalTargetPercent, points, true, options);
  const point = evaluated.points.find((candidate) => candidate.id === pointIdToEdit);
  if (!point) return clonePoints(points);
  return editHarvestPoint(
    snapshot,
    benchmark,
    finalTargetPercent,
    points,
    pointIdToEdit,
    { activeAfter: harvestPercentToActiveAfter(point, harvestPercent) },
    "vertical",
    options,
  );
};

export const generateCheckpointMoves = (
  finalTargetPercent: number,
  intervalPercent: number,
  pointCount: number,
  firstCheckpointPercent: number | null = null,
) => {
  const available = availableCheckpointMoves(finalTargetPercent, intervalPercent);
  const firstIndex = firstCheckpointPercent === null ? 0 : available.indexOf(firstCheckpointPercent);
  if (firstIndex < 0) return [];
  return available.slice(firstIndex, firstIndex + Math.max(0, Math.floor(pointCount)));
};

export const availableCheckpointMoves = (
  finalTargetPercent: number,
  intervalPercent: number,
) => {
  const direction: HarvestDirection = finalTargetPercent < 0 ? "short" : "long";
  const target = Math.abs(finalTargetPercent);
  const interval = Math.max(HARVESTER_MOVE_STEP, snapHarvestMove(intervalPercent));
  const count = Math.max(0, Math.floor((target - HARVESTER_MOVE_STEP) / interval));
  return Array.from({ length: count }, (_, index) => moveAtProgress(interval * (index + 1), direction));
};

export const maximumCheckpointCount = (
  finalTargetPercent: number,
  intervalPercent: number,
  firstCheckpointPercent: number | null = null,
) => {
  const available = availableCheckpointMoves(finalTargetPercent, intervalPercent);
  const firstIndex = firstCheckpointPercent === null ? 0 : available.indexOf(firstCheckpointPercent);
  return firstIndex < 0 ? 0 : available.length - firstIndex;
};

interface ScheduleAttempt {
  points: HarvestPoint[];
  exact: boolean;
  eligibleCount: number;
}

const buildScheduleWithOptions = (
  snapshot: HarvesterSnapshot,
  benchmark: HarvesterBenchmark,
  finalTargetPercent: number,
  moves: number[],
  desiredWithdrawal: (context: {
    index: number;
    movePercent: number;
    activeBefore: number;
    benchmarkValue: number | null;
    surplus: number;
    maximumWithdrawal: number;
    cumulativeHarvested: number;
  }) => number,
  requirePositiveSurplusForPositiveWithdrawal: boolean,
  options: HarvesterEvaluationOptions,
): ScheduleAttempt => {
  const points: HarvestPoint[] = [];
  let exact = true;
  let eligibleCount = 0;
  let cumulativeHarvested = 0;
  moves.forEach((movePercent, index) => {
    const range = feasibleRangeAt(snapshot, benchmark, finalTargetPercent, points, movePercent, options);
    const benchmarkValue = evaluateHarvesterBenchmark(snapshot, benchmark, ratioAt(movePercent)).value;
    const surplus = benchmarkValue === null ? 0 : Math.max(0, range.max - benchmarkValue);
    if (surplus > EPSILON) eligibleCount += 1;
    const maximumWithdrawal = Math.max(0, range.max - range.min);
    const requested = Math.max(0, desiredWithdrawal({
      index,
      movePercent,
      activeBefore: range.max,
      benchmarkValue,
      surplus,
      maximumWithdrawal,
      cumulativeHarvested,
    }));
    if (requested > maximumWithdrawal + EPSILON) exact = false;
    if (requirePositiveSurplusForPositiveWithdrawal && requested > EPSILON && surplus <= EPSILON) exact = false;
    const withdrawn = Math.min(maximumWithdrawal, requested);
    points.push({ id: pointId(), movePercent, activeAfter: range.max - withdrawn });
    cumulativeHarvested += withdrawn;
  });
  return { points: constrainHarvestPoints(snapshot, benchmark, finalTargetPercent, points, options), exact, eligibleCount };
};

export const generateUserHarvestPlan = (
  snapshot: HarvesterSnapshot,
  inputs: HarvesterGenerationInputs,
): HarvesterGeneratedPlan => {
  const moves = generateCheckpointMoves(inputs.finalTargetPercent, inputs.intervalPercent, inputs.pointCount, inputs.firstCheckpointPercent);
  const rate = Math.max(0, inputs.defaultHarvestPercent) / 100;
  const attempt = buildScheduleWithOptions(
    snapshot,
    inputs.benchmark,
    inputs.finalTargetPercent,
    moves,
    ({ surplus }) => surplus > EPSILON ? surplus * rate : 0,
    false,
    evaluationOptionsFromInputs(inputs),
  );
  return { kind: "user", points: attempt.points, summary: "Custom plan", commonHarvestPercent: null, commonWithdrawal: null };
};

export const reapplyUserHarvestRate = (
  snapshot: HarvesterSnapshot,
  inputs: HarvesterGenerationInputs,
  existingPoints: HarvestPoint[],
  harvestRatePercent: number,
) => {
  const attempt = buildScheduleWithOptions(
    snapshot,
    inputs.benchmark,
    inputs.finalTargetPercent,
    existingPoints.map((point) => point.movePercent),
    ({ surplus }) => surplus > EPSILON ? surplus * Math.max(0, harvestRatePercent) / 100 : 0,
    false,
    evaluationOptionsFromInputs(inputs),
  );
  return preservePointIds(attempt.points, existingPoints);
};

export const generateEqualRateHarvestPlan = (
  snapshot: HarvesterSnapshot,
  inputs: HarvesterGenerationInputs,
): HarvesterGeneratedPlan => {
  const moves = generateCheckpointMoves(inputs.finalTargetPercent, inputs.intervalPercent, inputs.pointCount, inputs.firstCheckpointPercent);
  const options = evaluationOptionsFromInputs(inputs);
  const baseline = buildScheduleWithOptions(snapshot, inputs.benchmark, inputs.finalTargetPercent, moves, () => 0, false, options);
  const baselineResult = evaluateHarvestPlan(snapshot, inputs.benchmark, inputs.finalTargetPercent, baseline.points, true, options);
  const baselineSurpluses = baselineResult.points.map((point) => Math.max(0, point.surplusBefore));
  const participatingIndices = new Set(baselineSurpluses
    .map((surplus, index) => surplus > EPSILON ? index : -1)
    .filter((index) => index >= 0));
  const attemptAt = (ratePercent: number) => buildScheduleWithOptions(
    snapshot,
    inputs.benchmark,
    inputs.finalTargetPercent,
    moves,
    ({ index }) => baselineSurpluses[index] * ratePercent / 100,
    false,
    options,
  );
  if (participatingIndices.size === 0) return { kind: "equalRate", points: baseline.points, summary: "0% each checkpoint", commonHarvestPercent: 0, commonWithdrawal: null };
  let low = 0;
  let high = 100;
  while (high < 1_000_000 && attemptAt(high).exact) {
    low = high;
    high *= 2;
  }
  high = Math.min(high, 1_000_000);
  for (let iteration = 0; iteration < 70; iteration += 1) {
    const middle = (low + high) / 2;
    if (attemptAt(middle).exact) low = middle;
    else high = middle;
  }
  if (low <= EPSILON) low = 0;
  const displayedRate = Math.floor((low + EPSILON) * 100) / 100;
  const solved = attemptAt(displayedRate);
  return {
    kind: "equalRate",
    points: solved.points,
    summary: `${displayedRate}% each checkpoint`,
    commonHarvestPercent: displayedRate,
    commonWithdrawal: null,
  };
};

export const evaluateEqualRateCandidate = (
  snapshot: HarvesterSnapshot,
  inputs: HarvesterGenerationInputs,
  ratePercent: number,
) => {
  const moves = generateCheckpointMoves(inputs.finalTargetPercent, inputs.intervalPercent, inputs.pointCount, inputs.firstCheckpointPercent);
  const options = evaluationOptionsFromInputs(inputs);
  const baseline = buildScheduleWithOptions(snapshot, inputs.benchmark, inputs.finalTargetPercent, moves, () => 0, false, options);
  const baselineResult = evaluateHarvestPlan(snapshot, inputs.benchmark, inputs.finalTargetPercent, baseline.points, true, options);
  const baselineSurpluses = baselineResult.points.map((point) => Math.max(0, point.surplusBefore));
  const attempt = buildScheduleWithOptions(
    snapshot,
    inputs.benchmark,
    inputs.finalTargetPercent,
    moves,
    ({ index }) => baselineSurpluses[index] * Math.max(0, ratePercent) / 100,
    false,
    options,
  );
  return {
    ...attempt,
    baselineSurpluses,
    participatingIndices: baselineSurpluses
      .map((surplus, index) => surplus > EPSILON ? index : -1)
      .filter((index) => index >= 0),
  };
};

export const generateEqualCashHarvestPlan = (
  snapshot: HarvesterSnapshot,
  inputs: HarvesterGenerationInputs,
): HarvesterGeneratedPlan => {
  const moves = generateCheckpointMoves(inputs.finalTargetPercent, inputs.intervalPercent, inputs.pointCount, inputs.firstCheckpointPercent);
  const options = evaluationOptionsFromInputs(inputs);
  const baseline = buildScheduleWithOptions(snapshot, inputs.benchmark, inputs.finalTargetPercent, moves, () => 0, false, options);
  const baselineResult = evaluateHarvestPlan(snapshot, inputs.benchmark, inputs.finalTargetPercent, baseline.points, true, options);
  const participatingIndices = new Set(baselineResult.points
    .map((point, index) => point.surplusBefore > EPSILON ? index : -1)
    .filter((index) => index >= 0));
  const attemptAt = (withdrawal: number) => buildScheduleWithOptions(
    snapshot,
    inputs.benchmark,
    inputs.finalTargetPercent,
    moves,
    ({ index }) => participatingIndices.has(index) ? withdrawal : 0,
    false,
    options,
  );
  if (moves.length === 0) return { kind: "equalCash", points: [], summary: "$0 each checkpoint", commonHarvestPercent: null, commonWithdrawal: 0 };
  if (participatingIndices.size === 0) return { kind: "equalCash", points: baseline.points, summary: "$0 each checkpoint", commonHarvestPercent: null, commonWithdrawal: 0 };
  let low = 0;
  let high = Math.max(snapshot.config.deposit, ...moves.map((move) => originalActiveV4Value(snapshot, ratioAt(move))));
  for (let iteration = 0; iteration < 70; iteration += 1) {
    const middle = (low + high) / 2;
    if (attemptAt(middle).exact) low = middle;
    else high = middle;
  }
  if (low <= EPSILON) low = 0;
  const solved = attemptAt(low);
  return {
    kind: "equalCash",
    points: solved.points,
    summary: `${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(low)} each checkpoint`,
    commonHarvestPercent: null,
    commonWithdrawal: low,
  };
};

export const evaluateEqualCashCandidate = (
  snapshot: HarvesterSnapshot,
  inputs: HarvesterGenerationInputs,
  withdrawal: number,
) => {
  const moves = generateCheckpointMoves(inputs.finalTargetPercent, inputs.intervalPercent, inputs.pointCount, inputs.firstCheckpointPercent);
  const options = evaluationOptionsFromInputs(inputs);
  const baseline = buildScheduleWithOptions(snapshot, inputs.benchmark, inputs.finalTargetPercent, moves, () => 0, false, options);
  const baselineResult = evaluateHarvestPlan(snapshot, inputs.benchmark, inputs.finalTargetPercent, baseline.points, true, options);
  const participatingIndices = baselineResult.points
    .map((point, index) => point.surplusBefore > EPSILON ? index : -1)
    .filter((index) => index >= 0);
  const participating = new Set(participatingIndices);
  return {
    ...buildScheduleWithOptions(
      snapshot,
      inputs.benchmark,
      inputs.finalTargetPercent,
      moves,
      ({ index }) => participating.has(index) ? Math.max(0, withdrawal) : 0,
      false,
      options,
    ),
    participatingIndices,
  };
};

export const generateEarliestRecoveryHarvestPlan = (
  snapshot: HarvesterSnapshot,
  inputs: HarvesterGenerationInputs,
): HarvesterGeneratedPlan => {
  const moves = generateCheckpointMoves(inputs.finalTargetPercent, inputs.intervalPercent, inputs.pointCount, inputs.firstCheckpointPercent);
  const policy = buildScheduleWithOptions(
    snapshot,
    inputs.benchmark,
    inputs.finalTargetPercent,
    moves,
    ({ surplus }) => surplus > EPSILON ? surplus * Math.max(0, inputs.defaultHarvestPercent) / 100 : 0,
    false,
    evaluationOptionsFromInputs(inputs),
  );
  return {
    kind: "earliestRecovery",
    points: policy.points,
    summary: "Recovery policy",
    commonHarvestPercent: null,
    commonWithdrawal: null,
  };
};

export const reapplyEarliestRecoveryHarvestRate = (
  snapshot: HarvesterSnapshot,
  inputs: HarvesterGenerationInputs,
  existingPoints: HarvestPoint[],
  harvestRatePercent: number,
) => {
  const policy = buildScheduleWithOptions(
    snapshot,
    inputs.benchmark,
    inputs.finalTargetPercent,
    existingPoints.map((point) => point.movePercent),
    ({ surplus }) => surplus > EPSILON ? surplus * Math.max(0, harvestRatePercent) / 100 : 0,
    false,
    evaluationOptionsFromInputs(inputs),
  );
  return preservePointIds(policy.points, existingPoints);
};

/** Applies the live recovery-accounting rule to a stored Earliest Recovery
 * policy schedule. The policy points remain unchanged, so toggling cashback
 * accounting never regenerates or mutates a plan or its reset baseline. */
export const resolveEarliestRecoveryPoints = (
  snapshot: HarvesterSnapshot,
  inputs: HarvesterGenerationInputs,
  policyPoints: HarvestPoint[],
  accountInitialCashback: boolean,
) => {
  const recoveryTarget = initialRecoveryTarget(snapshot);
  const options = evaluationOptionsFromInputs(inputs);
  const policyResult = evaluateHarvestPlan(snapshot, inputs.benchmark, inputs.finalTargetPercent, policyPoints, true, options);
  const policyWithdrawalById = new Map(policyResult.points.map((point) => [point.id, point.harvested]));
  const resolved: HarvestPoint[] = [];
  let cumulativeHarvested = 0;
  const minimumFutureExternal = (fromIndex: number) => {
    if (!accountInitialCashback) return 0;
    const futureMoves = [
      ...(fromIndex < 0 ? [0] : []),
      ...policyPoints.slice(Math.max(0, fromIndex)).map((point) => point.movePercent),
      inputs.finalTargetPercent,
    ];
    return Math.min(...futureMoves.map((movePercent) => originalExternalValue(snapshot, ratioAt(movePercent))));
  };
  let recovered = minimumFutureExternal(-1) >= recoveryTarget - EPSILON;

  for (const [index, policyPoint] of policyPoints.entries()) {
    const range = feasibleRangeAt(snapshot, inputs.benchmark, inputs.finalTargetPercent, resolved, policyPoint.movePercent, options);
    if (recovered) {
      resolved.push({ ...policyPoint, activeAfter: range.max });
      continue;
    }
    const durableExternal = minimumFutureExternal(index);
    const remainingForRecovery = Math.max(0, recoveryTarget - durableExternal - cumulativeHarvested);
    const policyWithdrawal = policyWithdrawalById.get(policyPoint.id) ?? 0;
    const withdrawal = Math.min(Math.max(0, range.max - range.min), policyWithdrawal, remainingForRecovery);
    resolved.push({ ...policyPoint, activeAfter: range.max - withdrawal });
    cumulativeHarvested += withdrawal;
    recovered = durableExternal + cumulativeHarvested >= recoveryTarget - EPSILON;
  }
  return constrainHarvestPoints(snapshot, inputs.benchmark, inputs.finalTargetPercent, resolved, options);
};

export const generateHarvesterPlan = (
  snapshot: HarvesterSnapshot,
  inputs: HarvesterGenerationInputs,
  kind: HarvesterPlanKind,
): HarvesterGeneratedPlan => {
  if (kind === "equalRate") return generateEqualRateHarvestPlan(snapshot, inputs);
  if (kind === "equalCash") return generateEqualCashHarvestPlan(snapshot, inputs);
  if (kind === "earliestRecovery") return generateEarliestRecoveryHarvestPlan(snapshot, inputs);
  return generateUserHarvestPlan(snapshot, inputs);
};

export const createHarvesterPlanState = (generated: HarvesterGeneratedPlan, generationInputs: HarvesterGenerationInputs): HarvesterPlanState => ({
  ...generated,
  generationInputs: { ...generationInputs },
  points: clonePoints(generated.points),
  baseline: clonePoints(generated.points),
  harvestRatePercent: generationInputs.defaultHarvestPercent,
  baselineHarvestRatePercent: generationInputs.defaultHarvestPercent,
  selectedPointId: generated.points[0]?.id ?? null,
  modified: false,
});

export const createEmptyHarvesterPlans = (): HarvesterPlans => ({ user: null, equalRate: null, equalCash: null, earliestRecovery: null });

export const generateAllHarvesterPlans = (
  snapshot: HarvesterSnapshot,
  inputs: HarvesterGenerationInputs,
): HarvesterPlans => Object.fromEntries(HARVESTER_PLAN_KINDS.map((kind) => [kind, createHarvesterPlanState(generateHarvesterPlan(snapshot, inputs, kind), inputs)])) as unknown as HarvesterPlans;

export const generateCurrentHarvesterPlan = (
  plans: HarvesterPlans,
  snapshot: HarvesterSnapshot,
  inputs: HarvesterGenerationInputs,
  kind: HarvesterPlanKind,
): HarvesterPlans => ({ ...plans, [kind]: createHarvesterPlanState(generateHarvesterPlan(snapshot, inputs, kind), inputs) });

const hasPointOverride = (point: HarvestPoint, baseline: HarvestPoint) =>
  Math.abs(point.movePercent - baseline.movePercent) > EPSILON ||
  Math.abs(point.activeAfter - baseline.activeAfter) > EPSILON;

export const regenerateHarvesterPlanPreservingEdits = (
  state: HarvesterPlanState | null,
  snapshot: HarvesterSnapshot,
  inputs: HarvesterGenerationInputs,
  kind: HarvesterPlanKind,
): HarvesterPlanState => {
  const regenerated = createHarvesterPlanState(generateHarvesterPlan(snapshot, inputs, kind), inputs);
  if (!state?.modified) return regenerated;

  const currentById = new Map(state.points.map((point) => [point.id, point]));
  const overridesByIndex = new Map(state.baseline.flatMap((baselinePoint, index) => {
    const currentPoint = currentById.get(baselinePoint.id);
    const targetPoint = regenerated.points[index];
    return currentPoint && targetPoint && hasPointOverride(currentPoint, baselinePoint)
      ? [[index, { ...targetPoint, movePercent: currentPoint.movePercent, activeAfter: currentPoint.activeAfter }] as const]
      : [];
  }));
  const baselineIds = new Set(state.baseline.map((point) => point.id));
  const customPoints = state.points.filter((point) =>
    !baselineIds.has(point.id) &&
    progressAt(point.movePercent, inputs.direction) < progressAt(inputs.finalTargetPercent, inputs.direction));
  const merged = regenerated.points.map((point, index) => overridesByIndex.get(index) ?? point);
  const points = constrainHarvestPoints(snapshot, inputs.benchmark, inputs.finalTargetPercent, [...merged, ...customPoints], evaluationOptionsFromInputs(inputs));
  const selectedPointId = points.some((point) => point.id === state.selectedPointId)
    ? state.selectedPointId
    : points[0]?.id ?? null;
  return {
    ...regenerated,
    points,
    harvestRatePercent: state.harvestRatePercent,
    selectedPointId,
    modified: !harvestPointsEqual(points, regenerated.baseline) || Math.abs(state.harvestRatePercent - regenerated.baselineHarvestRatePercent) > EPSILON,
  };
};

export const regenerateHarvesterPlansPreservingEdits = (
  plans: HarvesterPlans,
  snapshot: HarvesterSnapshot,
  inputs: HarvesterGenerationInputs,
): HarvesterPlans => Object.fromEntries(HARVESTER_PLAN_KINDS.map((kind) => [
  kind,
  regenerateHarvesterPlanPreservingEdits(plans[kind], snapshot, inputs, kind),
])) as HarvesterPlans;

export const harvestPointsEqual = (left: HarvestPoint[], right: HarvestPoint[], tolerance = 1e-7) =>
  left.length === right.length && left.every((point, index) =>
    point.id === right[index].id &&
    Math.abs(point.movePercent - right[index].movePercent) <= tolerance &&
    Math.abs(point.activeAfter - right[index].activeAfter) <= tolerance,
  );

export const updateHarvesterPlanPoints = (
  state: HarvesterPlanState,
  points: HarvestPoint[],
  selectedPointId: string | null = state.selectedPointId,
): HarvesterPlanState => ({
  ...state,
  points: clonePoints(points),
  selectedPointId,
  modified: !harvestPointsEqual(points, state.baseline) || Math.abs(state.harvestRatePercent - state.baselineHarvestRatePercent) > EPSILON,
});

export const applyLiveHarvestRate = (
  state: HarvesterPlanState,
  snapshot: HarvesterSnapshot,
  harvestRatePercent: number,
): HarvesterPlanState => {
  if (state.kind !== "user" && state.kind !== "earliestRecovery") return state;
  const points = state.kind === "user"
    ? reapplyUserHarvestRate(snapshot, state.generationInputs, state.points, harvestRatePercent)
    : reapplyEarliestRecoveryHarvestRate(snapshot, state.generationInputs, state.points, harvestRatePercent);
  return {
    ...state,
    points,
    harvestRatePercent,
    modified: !harvestPointsEqual(points, state.baseline) || Math.abs(harvestRatePercent - state.baselineHarvestRatePercent) > EPSILON,
  };
};

export const resetHarvesterPlanState = (state: HarvesterPlanState): HarvesterPlanState => ({
  ...state,
  points: clonePoints(state.baseline),
  harvestRatePercent: state.baselineHarvestRatePercent,
  selectedPointId: state.baseline.some((point) => point.id === state.selectedPointId) ? state.selectedPointId : state.baseline[0]?.id ?? null,
  modified: false,
});

export const otherPlansContainCustomEdits = (plans: HarvesterPlans, activeKind: HarvesterPlanKind) =>
  HARVESTER_PLAN_KINDS.some((kind) => kind !== activeKind && plans[kind]?.modified === true);

export const evaluateHarvestedStateAt = (
  snapshot: HarvesterSnapshot,
  planResult: HarvesterResult,
  movePercent: number,
  includeEventsAtMove = true,
  direction: HarvestDirection = "long",
) => {
  const reached = planResult.points.filter((point) => includeEventsAtMove
    ? progressAt(point.movePercent, direction) <= progressAt(movePercent, direction) + EPSILON
    : progressAt(point.movePercent, direction) < progressAt(movePercent, direction) - EPSILON);
  const last = reached.length > 0 ? reached[reached.length - 1] : undefined;
  const fractions = {
    long: last?.longFractionAfter ?? 1,
    short: last?.shortFractionAfter ?? 1,
  };
  const cumulativeHarvested = last?.cumulativeHarvested ?? 0;
  const legs = activeLegValuesAt(snapshot, movePercent, fractions);
  const external = originalExternalValue(snapshot, ratioAt(movePercent));
  return {
    longFraction: fractions.long,
    shortFraction: fractions.short,
    cumulativeHarvested,
    remainingLong: legs.long,
    remainingShort: legs.short,
    activeV4: legs.total,
    external,
    totalWealth: legs.total + external + cumulativeHarvested,
  };
};

export const evaluateProjectedStateAt = (
  snapshot: HarvesterSnapshot,
  planResult: HarvesterResult,
  movePercent: number,
) => {
  const last = planResult.points.length > 0 ? planResult.points[planResult.points.length - 1] : undefined;
  const fractions = {
    long: last?.longFractionAfter ?? 1,
    short: last?.shortFractionAfter ?? 1,
  };
  const cumulativeHarvested = last?.cumulativeHarvested ?? 0;
  const legs = activeLegValuesAt(snapshot, movePercent, fractions);
  const external = originalExternalValue(snapshot, ratioAt(movePercent));
  return {
    longFraction: fractions.long,
    shortFraction: fractions.short,
    cumulativeHarvested,
    remainingLong: legs.long,
    remainingShort: legs.short,
    activeV4: legs.total,
    external,
    totalWealth: legs.total + external + cumulativeHarvested,
  };
};

export const buildHarvesterChartSeries = (
  snapshot: HarvesterSnapshot,
  benchmark: HarvesterBenchmark,
  finalTargetPercent: number,
  points: HarvestPoint[],
  sampleCount = 180,
  comparisonReference: HarvesterBenchmark | null = null,
  evaluationOptions?: Partial<HarvesterEvaluationOptions>,
  chartRange?: { minMove: number; maxMove: number },
): HarvesterChartPoint[] => {
  const options = evaluationOptionsFor(finalTargetPercent, evaluationOptions);
  const result = evaluateHarvestPlan(snapshot, benchmark, finalTargetPercent, points, true, options);
  const minMove = chartRange?.minMove ?? Math.min(0, finalTargetPercent);
  const maxMove = chartRange?.maxMove ?? Math.max(0, finalTargetPercent);
  const moves = Array.from({ length: sampleCount }, (_, index) => minMove + (maxMove - minMove) * index / Math.max(1, sampleCount - 1));
  moves.push(...result.points.map((point) => point.movePercent), finalTargetPercent, 0, minMove, maxMove);
  const uniqueMoves = [...new Set(moves)].sort((a, b) => a - b);
  const series: HarvesterChartPoint[] = [];
  const isCompleteRange = minMove < -EPSILON && maxMove > EPSILON;
  const oppositeOnly = options.direction === "long"
    ? maxMove <= EPSILON && minMove < -EPSILON
    : minMove >= -EPSILON && maxMove > EPSILON;
  for (const move of uniqueMoves) {
    const isCheckpoint = result.points.some((point) => Math.abs(point.movePercent - move) < EPSILON);
    const isActiveSide = !oppositeOnly && (options.direction === "long" ? move >= -EPSILON : move <= EPSILON);
    const append = (includeEventsAtMove: boolean, phase?: "before" | "after", projection = !isActiveSide) => {
      const p = ratioAt(move);
      const state = projection
        ? evaluateProjectedStateAt(snapshot, result, move)
        : evaluateHarvestedStateAt(snapshot, result, move, includeEventsAtMove, options.direction);
      const previewedState = evaluateProjectedStateAt(snapshot, result, move);
      series.push({
        move,
        originalActiveV4: originalActiveV4Value(snapshot, p),
        harvestedActiveV4: state.activeV4,
        historicalActiveV4: isCompleteRange && !projection ? state.activeV4 : null,
        previewedActiveV4: previewedState.activeV4,
        previewedRemainingLong: previewedState.remainingLong,
        previewedRemainingShort: previewedState.remainingShort,
        previewedCumulativeHarvested: previewedState.cumulativeHarvested,
        remainingLong: state.remainingLong,
        remainingShort: state.remainingShort,
        initialCashback: state.external,
        totalWealth: state.totalWealth,
        previewedTotalWealth: previewedState.totalWealth,
        benchmark: evaluateHarvesterBenchmark(snapshot, benchmark, p).value,
        comparisonReference: comparisonReference === null || comparisonReference === benchmark
          ? null
          : evaluateHarvesterBenchmark(snapshot, comparisonReference, p).value,
        cumulativeHarvested: state.cumulativeHarvested,
        phase,
        projection,
      });
    };
    const isCompleteBoundary = Math.abs(move) < EPSILON && minMove < 0 && maxMove > 0;
    if (isCompleteBoundary && options.direction === "long") append(true, undefined, true);
    if (isCheckpoint && options.direction === "short") {
      append(true, "after", false);
      append(false, "before", false);
    } else {
      if (isCheckpoint) append(false, "before", false);
      append(true, isCheckpoint ? "after" : undefined, isCompleteBoundary ? false : !isActiveSide);
    }
    if (isCompleteBoundary && options.direction === "short") append(true, undefined, true);
  }
  return series;
};
