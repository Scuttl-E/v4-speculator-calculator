import {
  debtPositionSummary,
  debtPositionValue,
  isDebtPositionLiquidated,
  type DebtPositionInput,
} from "./debtPosition";
import {
  isPerpPositionLiquidated,
  perpPositionSummary,
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
export const HARVESTER_MOVE_STEP = 5;

export type HarvesterBenchmark = "spot" | "lending" | "perp";
export type HarvesterDragMode = "vertical" | "horizontal" | "both";
export type HarvesterPlanKind = "user" | "equalRate" | "equalCash" | "earliestRecovery";
export const HARVESTER_PLAN_KINDS: readonly HarvesterPlanKind[] = ["user", "equalRate", "equalCash", "earliestRecovery"];
export const DEFAULT_HARVEST_PRESETS = [25, 50, 75, 100, 125, 150, 200, 400] as const;

export interface HarvesterSnapshot {
  config: Config;
  comparisonMode: ComparisonMode;
  debtPosition: DebtPositionInput;
  perpPosition: PerpPositionInput;
  assetName: string;
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
  survivingFraction: number;
  feasibleMin: number;
  feasibleMax: number;
  maximumAdditionalHarvest: number;
  benchmarkValue: number | null;
  surplusBefore: number;
  harvestPercent: number;
}

export interface HarvesterGenerationInputs {
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
  recovered: boolean;
  recoveredAtMovePercent: number | null;
  currentSecured: number;
  harvestedCash: number;
  externalCashbackValue: number;
  externalCashbackKind: "cash" | "spot";
  externalCashbackValuationMovePercent: number;
  countedRecoveredCapital: number;
  excludedCashbackValue: number;
  originalExternalAtLatestCheckpoint: number;
  initialInvestment: number;
}

export interface HarvesterResult {
  points: HarvestPointResult[];
  requiredFinalFraction: number | null;
  feasible: boolean;
  final: HarvesterFinalSummary;
  recovery: HarvesterRecovery;
}

export interface HarvesterChartPoint {
  move: number;
  originalActiveV4: number;
  harvestedActiveV4: number;
  totalWealth: number;
  benchmark: number | null;
  cumulativeHarvested: number;
  phase?: "before" | "after";
}

export interface HarvesterExportPayload {
  importedStrategy: {
    config: Config;
    comparisonMode: ComparisonMode;
    assetName: string;
    importedAt: number;
  };
  originalActiveV4Curve: Array<{ move: number; value: number }>;
  harvestedActiveV4Curve: Array<{ move: number; value: number }>;
  totalWealthCurve: Array<{ move: number; value: number }>;
  selectedBenchmarkCurve: Array<{ move: number; value: number | null }>;
  harvestCheckpoints: HarvestPointResult[];
  finalTarget: number;
  finalBenchmark: HarvesterBenchmark;
  totalHarvested: number;
  originalExternalCapital: number;
  securedCapital: number;
  initialCapitalRecoveryPoint: number | null;
  finalTargetSummary: HarvesterFinalSummary;
}

export const createHarvesterSnapshot = (input: Omit<HarvesterSnapshot, "importedAt">): HarvesterSnapshot => ({
  ...input,
  config: { ...input.config },
  debtPosition: { ...input.debtPosition },
  perpPosition: { ...input.perpPosition },
  importedAt: Date.now(),
});

export const benchmarkForComparisonMode = (mode: ComparisonMode): HarvesterBenchmark =>
  mode === "lending" ? "lending" : mode === "perp" ? "perp" : "spot";

export const availableHarvesterBenchmarks = (snapshot: HarvesterSnapshot): HarvesterBenchmark[] => {
  const available: HarvesterBenchmark[] = ["spot"];
  const debt = debtPositionSummary(snapshot.debtPosition);
  if (
    Number.isFinite(snapshot.debtPosition.assetPrice) && snapshot.debtPosition.assetPrice > 0 &&
    Number.isFinite(snapshot.debtPosition.assetAmount) && snapshot.debtPosition.assetAmount > 0 &&
    Number.isFinite(snapshot.debtPosition.usdDebt) && snapshot.debtPosition.usdDebt >= 0 &&
    debt.netEquity > 0
  ) available.push("lending");
  const perp = perpPositionSummary(snapshot.perpPosition);
  if (
    Number.isFinite(snapshot.perpPosition.assetPrice) && snapshot.perpPosition.assetPrice > 0 &&
    Number.isFinite(snapshot.perpPosition.averageEntryPrice) && snapshot.perpPosition.averageEntryPrice > 0 &&
    Number.isFinite(snapshot.perpPosition.positionSize) && snapshot.perpPosition.positionSize > 0 &&
    Number.isFinite(snapshot.perpPosition.margin) && snapshot.perpPosition.margin >= 0 &&
    Number.isFinite(snapshot.perpPosition.liquidationPrice) && snapshot.perpPosition.liquidationPrice > 0 &&
    perp.currentEquity > 0
  ) available.push("perp");
  return available;
};

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
 * exclude external cashback; both legs are always scaled by the same fraction. */
export const originalActiveV4Value = (snapshot: HarvesterSnapshot, priceRatio: number) => {
  const legs = originalActiveV4LegValues(snapshot, priceRatio);
  return legs.long + legs.short;
};

export const originalExternalValue = (snapshot: HarvesterSnapshot, priceRatio: number) =>
  snapshot.config.deposit * portfolioComponents(priceRatio, snapshot.config).cashbackValue;

export const evaluateHarvesterBenchmark = (
  snapshot: HarvesterSnapshot,
  benchmark: HarvesterBenchmark,
  priceRatio: number,
): HarvesterBenchmarkValue => {
  if (benchmark === "spot") return { value: snapshot.config.deposit * priceRatio, status: "valid" };
  if (!availableHarvesterBenchmarks(snapshot).includes(benchmark)) return { value: null, status: "unavailable" };
  if (benchmark === "lending") {
    return isDebtPositionLiquidated(priceRatio, snapshot.debtPosition)
      ? { value: null, status: "liquidated" }
      : { value: debtPositionValue(priceRatio, snapshot.debtPosition), status: "valid" };
  }
  return isPerpPositionLiquidated(priceRatio, snapshot.perpPosition)
    ? { value: null, status: "liquidated" }
    : { value: perpPositionValue(priceRatio, snapshot.perpPosition), status: "valid" };
};

export const requiredFinalActiveFraction = (
  snapshot: HarvesterSnapshot,
  benchmark: HarvesterBenchmark,
  finalTargetPercent: number,
) => {
  const p = 1 + finalTargetPercent / 100;
  const benchmarkResult = evaluateHarvesterBenchmark(snapshot, benchmark, p);
  if (benchmarkResult.status !== "valid" || benchmarkResult.value === null) return null;
  const active = originalActiveV4Value(snapshot, p);
  if (active <= EPSILON) return benchmarkResult.value <= EPSILON ? 0 : Number.POSITIVE_INFINITY;
  return Math.max(0, benchmarkResult.value / active);
};

const pointId = () => `harvest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const ratioAt = (movePercent: number) => 1 + movePercent / 100;
const clonePoints = (points: HarvestPoint[]) => points.map((point) => ({ ...point }));
const preservePointIds = (points: HarvestPoint[], existingPoints: HarvestPoint[]) =>
  points.map((point, index) => ({ ...point, id: existingPoints[index]?.id ?? point.id }));

export const snapHarvestMove = (movePercent: number) => Math.round(movePercent / HARVESTER_MOVE_STEP) * HARVESTER_MOVE_STEP;

export const horizontalBoundsForPoint = (points: HarvestPoint[], index: number, finalTargetPercent: number) => ({
  min: index === 0 ? HARVESTER_MOVE_STEP : points[index - 1].movePercent + HARVESTER_MOVE_STEP,
  max: index === points.length - 1
    ? finalTargetPercent - HARVESTER_MOVE_STEP
    : points[index + 1].movePercent - HARVESTER_MOVE_STEP,
});

const finalSummary = (
  snapshot: HarvesterSnapshot,
  benchmark: HarvesterBenchmark,
  finalTargetPercent: number,
  survivingFraction: number,
  totalHarvested: number,
): HarvesterFinalSummary => {
  const p = ratioAt(finalTargetPercent);
  const remainingActiveV4 = survivingFraction * originalActiveV4Value(snapshot, p);
  const originalExternalCapital = originalExternalValue(snapshot, p);
  const benchmarkResult = evaluateHarvesterBenchmark(snapshot, benchmark, p);
  const totalWealth = remainingActiveV4 + originalExternalCapital + totalHarvested;
  const finalSurplus = benchmarkResult.value === null
    ? null
    : remainingActiveV4 - benchmarkResult.value;
  return {
    remainingActiveV4,
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
): HarvesterResult => {
  const required = requiredFinalActiveFraction(snapshot, benchmark, finalTargetPercent);
  const feasible = required !== null && Number.isFinite(required) && required <= 1 + EPSILON;
  const minimumFraction = feasible ? Math.min(1, Math.max(0, required!)) : 1;
  const ordered = clonePoints(inputPoints).sort((a, b) => a.movePercent - b.movePercent);
  let priorFraction = 1;
  let cumulativeHarvested = 0;
  const points = ordered.map((point) => {
    const priceRatio = ratioAt(point.movePercent);
    const originalActive = originalActiveV4Value(snapshot, priceRatio);
    const activeBefore = priorFraction * originalActive;
    const feasibleMin = minimumFraction * originalActive;
    const feasibleMax = activeBefore;
    const activeAfter = Math.min(feasibleMax, Math.max(feasibleMin, point.activeAfter));
    const harvested = Math.max(0, activeBefore - activeAfter);
    const benchmarkValue = evaluateHarvesterBenchmark(snapshot, benchmark, priceRatio).value;
    const surplusBefore = benchmarkValue === null ? 0 : activeBefore - benchmarkValue;
    const harvestPercent = surplusBefore > EPSILON ? (harvested / surplusBefore) * 100 : 0;
    cumulativeHarvested += harvested;
    priorFraction = originalActive > EPSILON ? activeAfter / originalActive : priorFraction;
    return {
      ...point,
      activeAfter,
      priceRatio,
      activeBefore,
      harvested,
      cumulativeHarvested,
      survivingFraction: priorFraction,
      feasibleMin,
      feasibleMax,
      maximumAdditionalHarvest: Math.max(0, activeAfter - feasibleMin),
      benchmarkValue,
      surplusBefore,
      harvestPercent,
    };
  });
  const recoveredAtEntry = accountInitialCashback && originalExternalValue(snapshot, 1) >= snapshot.config.deposit - EPSILON;
  const recoveryPoint = recoveredAtEntry ? undefined : points.find((point) =>
    point.cumulativeHarvested + (accountInitialCashback ? originalExternalValue(snapshot, point.priceRatio) : 0) >= snapshot.config.deposit - EPSILON,
  );
  const final = finalSummary(snapshot, benchmark, finalTargetPercent, priorFraction, cumulativeHarvested);
  const latestPoint = points.length > 0 ? points[points.length - 1] : undefined;
  const originalExternalAtLatestCheckpoint = originalExternalValue(snapshot, latestPoint?.priceRatio ?? 1);
  const countedRecoveredCapital = cumulativeHarvested + (accountInitialCashback ? originalExternalAtLatestCheckpoint : 0);
  return {
    points,
    requiredFinalFraction: required,
    feasible,
    final,
    recovery: {
      accountInitialCashback,
      recovered: recoveredAtEntry || Boolean(recoveryPoint),
      recoveredAtMovePercent: recoveredAtEntry ? 0 : recoveryPoint?.movePercent ?? null,
      currentSecured: countedRecoveredCapital,
      harvestedCash: cumulativeHarvested,
      externalCashbackValue: originalExternalAtLatestCheckpoint,
      externalCashbackKind: snapshot.config.cashbackMode === "spot" ? "spot" : "cash",
      externalCashbackValuationMovePercent: latestPoint?.movePercent ?? 0,
      countedRecoveredCapital,
      excludedCashbackValue: accountInitialCashback ? 0 : originalExternalAtLatestCheckpoint,
      originalExternalAtLatestCheckpoint,
      initialInvestment: snapshot.config.deposit,
    },
  };
};

export const constrainHarvestPoints = (
  snapshot: HarvesterSnapshot,
  benchmark: HarvesterBenchmark,
  finalTargetPercent: number,
  points: HarvestPoint[],
) => evaluateHarvestPlan(snapshot, benchmark, finalTargetPercent, points).points.map(({ id, movePercent, activeAfter }) => ({ id, movePercent, activeAfter }));

export const feasibleRangeAt = (
  snapshot: HarvesterSnapshot,
  benchmark: HarvesterBenchmark,
  finalTargetPercent: number,
  points: HarvestPoint[],
  movePercent: number,
) => {
  const before = points.filter((point) => point.movePercent < movePercent);
  const previous = evaluateHarvestPlan(snapshot, benchmark, finalTargetPercent, before);
  const priorFraction = previous.points.length > 0
    ? previous.points[previous.points.length - 1].survivingFraction
    : 1;
  const required = requiredFinalActiveFraction(snapshot, benchmark, finalTargetPercent);
  const active = originalActiveV4Value(snapshot, ratioAt(movePercent));
  if (required === null || !Number.isFinite(required) || required > 1 + EPSILON) return { min: active, max: active, feasible: false };
  return { min: Math.max(0, required) * active, max: priorFraction * active, feasible: true };
};

export const generateHarvestPoints = (
  snapshot: HarvesterSnapshot,
  benchmark: HarvesterBenchmark,
  finalTargetPercent: number,
  intervalPercent: number,
  pointCount: number,
) => {
  const count = Math.min(maximumCheckpointCount(finalTargetPercent, intervalPercent), Math.max(0, Math.floor(pointCount)));
  const interval = Math.max(HARVESTER_MOVE_STEP, snapHarvestMove(intervalPercent));
  const generated: HarvestPoint[] = [];
  for (let index = 1; index <= count; index += 1) {
    const movePercent = interval * index;
    if (movePercent >= finalTargetPercent) break;
    const range = feasibleRangeAt(snapshot, benchmark, finalTargetPercent, generated, movePercent);
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
  return constrainHarvestPoints(snapshot, benchmark, finalTargetPercent, generated);
};

export const editHarvestPoint = (
  snapshot: HarvesterSnapshot,
  benchmark: HarvesterBenchmark,
  finalTargetPercent: number,
  points: HarvestPoint[],
  pointIdToEdit: string,
  edit: { movePercent?: number; activeAfter?: number },
  dragMode: HarvesterDragMode = "both",
) => {
  const ordered = clonePoints(points).sort((a, b) => a.movePercent - b.movePercent);
  const index = ordered.findIndex((point) => point.id === pointIdToEdit);
  if (index < 0) return ordered;
  const oldResult = evaluateHarvestPlan(snapshot, benchmark, finalTargetPercent, ordered).points[index];
  const bounds = horizontalBoundsForPoint(ordered, index, finalTargetPercent);
  const nextMove = dragMode === "vertical" || edit.movePercent === undefined
    ? ordered[index].movePercent
    : Math.min(bounds.max, Math.max(bounds.min, snapHarvestMove(edit.movePercent)));
  const beforePoints = ordered.slice(0, index);
  const range = feasibleRangeAt(snapshot, benchmark, finalTargetPercent, beforePoints, nextMove);
  let nextAfter = ordered[index].activeAfter;
  if (dragMode === "horizontal") {
    nextAfter = range.max - oldResult.harvested;
  } else if (edit.activeAfter !== undefined) {
    nextAfter = edit.activeAfter;
  }
  ordered[index] = { ...ordered[index], movePercent: nextMove, activeAfter: Math.min(range.max, Math.max(range.min, nextAfter)) };
  return constrainHarvestPoints(snapshot, benchmark, finalTargetPercent, ordered);
};

export const insertHarvestPoint = (
  snapshot: HarvesterSnapshot,
  benchmark: HarvesterBenchmark,
  finalTargetPercent: number,
  points: HarvestPoint[],
  clickedMovePercent: number,
) => {
  const occupied = new Set(points.map((point) => point.movePercent));
  let movePercent = Math.min(finalTargetPercent - HARVESTER_MOVE_STEP, Math.max(HARVESTER_MOVE_STEP, snapHarvestMove(clickedMovePercent)));
  if (occupied.has(movePercent)) return clonePoints(points);
  const range = feasibleRangeAt(snapshot, benchmark, finalTargetPercent, points, movePercent);
  const next = [...points, { id: pointId(), movePercent, activeAfter: (range.min + range.max) / 2 }]
    .sort((a, b) => a.movePercent - b.movePercent);
  return constrainHarvestPoints(snapshot, benchmark, finalTargetPercent, next);
};

export const deleteHarvestPoint = (
  snapshot: HarvesterSnapshot,
  benchmark: HarvesterBenchmark,
  finalTargetPercent: number,
  points: HarvestPoint[],
  id: string,
) => constrainHarvestPoints(snapshot, benchmark, finalTargetPercent, points.filter((point) => point.id !== id));

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
) => {
  const evaluated = evaluateHarvestPlan(snapshot, benchmark, finalTargetPercent, points);
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
  const target = Math.max(0, finalTargetPercent);
  const interval = Math.max(HARVESTER_MOVE_STEP, snapHarvestMove(intervalPercent));
  const count = Math.max(0, Math.floor((target - HARVESTER_MOVE_STEP) / interval));
  return Array.from({ length: count }, (_, index) => interval * (index + 1));
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

const buildSchedule = (
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
  requirePositiveSurplusForPositiveWithdrawal = false,
): ScheduleAttempt => {
  const points: HarvestPoint[] = [];
  let exact = true;
  let eligibleCount = 0;
  let cumulativeHarvested = 0;
  moves.forEach((movePercent, index) => {
    const range = feasibleRangeAt(snapshot, benchmark, finalTargetPercent, points, movePercent);
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
  return { points: constrainHarvestPoints(snapshot, benchmark, finalTargetPercent, points), exact, eligibleCount };
};

export const generateUserHarvestPlan = (
  snapshot: HarvesterSnapshot,
  inputs: HarvesterGenerationInputs,
): HarvesterGeneratedPlan => {
  const moves = generateCheckpointMoves(inputs.finalTargetPercent, inputs.intervalPercent, inputs.pointCount, inputs.firstCheckpointPercent);
  const rate = Math.max(0, inputs.defaultHarvestPercent) / 100;
  const attempt = buildSchedule(
    snapshot,
    inputs.benchmark,
    inputs.finalTargetPercent,
    moves,
    ({ surplus }) => surplus > EPSILON ? surplus * rate : 0,
  );
  return { kind: "user", points: attempt.points, summary: "Custom plan", commonHarvestPercent: null, commonWithdrawal: null };
};

export const reapplyUserHarvestRate = (
  snapshot: HarvesterSnapshot,
  inputs: HarvesterGenerationInputs,
  existingPoints: HarvestPoint[],
  harvestRatePercent: number,
) => {
  const attempt = buildSchedule(
    snapshot,
    inputs.benchmark,
    inputs.finalTargetPercent,
    existingPoints.map((point) => point.movePercent),
    ({ surplus }) => surplus > EPSILON ? surplus * Math.max(0, harvestRatePercent) / 100 : 0,
  );
  return preservePointIds(attempt.points, existingPoints);
};

export const generateEqualRateHarvestPlan = (
  snapshot: HarvesterSnapshot,
  inputs: HarvesterGenerationInputs,
): HarvesterGeneratedPlan => {
  const moves = generateCheckpointMoves(inputs.finalTargetPercent, inputs.intervalPercent, inputs.pointCount, inputs.firstCheckpointPercent);
  const baseline = buildSchedule(snapshot, inputs.benchmark, inputs.finalTargetPercent, moves, () => 0);
  const baselineResult = evaluateHarvestPlan(snapshot, inputs.benchmark, inputs.finalTargetPercent, baseline.points);
  const baselineSurpluses = baselineResult.points.map((point) => Math.max(0, point.surplusBefore));
  const participatingIndices = new Set(baselineSurpluses
    .map((surplus, index) => surplus > EPSILON ? index : -1)
    .filter((index) => index >= 0));
  const attemptAt = (ratePercent: number) => buildSchedule(
    snapshot,
    inputs.benchmark,
    inputs.finalTargetPercent,
    moves,
    ({ index }) => baselineSurpluses[index] * ratePercent / 100,
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
  const baseline = buildSchedule(snapshot, inputs.benchmark, inputs.finalTargetPercent, moves, () => 0);
  const baselineResult = evaluateHarvestPlan(snapshot, inputs.benchmark, inputs.finalTargetPercent, baseline.points);
  const baselineSurpluses = baselineResult.points.map((point) => Math.max(0, point.surplusBefore));
  const attempt = buildSchedule(
    snapshot,
    inputs.benchmark,
    inputs.finalTargetPercent,
    moves,
    ({ index }) => baselineSurpluses[index] * Math.max(0, ratePercent) / 100,
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
  const baseline = buildSchedule(snapshot, inputs.benchmark, inputs.finalTargetPercent, moves, () => 0);
  const baselineResult = evaluateHarvestPlan(snapshot, inputs.benchmark, inputs.finalTargetPercent, baseline.points);
  const participatingIndices = new Set(baselineResult.points
    .map((point, index) => point.surplusBefore > EPSILON ? index : -1)
    .filter((index) => index >= 0));
  const attemptAt = (withdrawal: number) => buildSchedule(
    snapshot,
    inputs.benchmark,
    inputs.finalTargetPercent,
    moves,
    ({ index }) => participatingIndices.has(index) ? withdrawal : 0,
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
  const baseline = buildSchedule(snapshot, inputs.benchmark, inputs.finalTargetPercent, moves, () => 0);
  const baselineResult = evaluateHarvestPlan(snapshot, inputs.benchmark, inputs.finalTargetPercent, baseline.points);
  const participatingIndices = baselineResult.points
    .map((point, index) => point.surplusBefore > EPSILON ? index : -1)
    .filter((index) => index >= 0);
  const participating = new Set(participatingIndices);
  return {
    ...buildSchedule(
      snapshot,
      inputs.benchmark,
      inputs.finalTargetPercent,
      moves,
      ({ index }) => participating.has(index) ? Math.max(0, withdrawal) : 0,
    ),
    participatingIndices,
  };
};

export const generateEarliestRecoveryHarvestPlan = (
  snapshot: HarvesterSnapshot,
  inputs: HarvesterGenerationInputs,
): HarvesterGeneratedPlan => {
  const moves = generateCheckpointMoves(inputs.finalTargetPercent, inputs.intervalPercent, inputs.pointCount, inputs.firstCheckpointPercent);
  const policy = buildSchedule(
    snapshot,
    inputs.benchmark,
    inputs.finalTargetPercent,
    moves,
    ({ surplus }) => surplus > EPSILON ? surplus * Math.max(0, inputs.defaultHarvestPercent) / 100 : 0,
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
  const policy = buildSchedule(
    snapshot,
    inputs.benchmark,
    inputs.finalTargetPercent,
    existingPoints.map((point) => point.movePercent),
    ({ surplus }) => surplus > EPSILON ? surplus * Math.max(0, harvestRatePercent) / 100 : 0,
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
  const policyResult = evaluateHarvestPlan(snapshot, inputs.benchmark, inputs.finalTargetPercent, policyPoints);
  const policyWithdrawalById = new Map(policyResult.points.map((point) => [point.id, point.harvested]));
  const resolved: HarvestPoint[] = [];
  let cumulativeHarvested = 0;
  let recovered = accountInitialCashback && originalExternalValue(snapshot, 1) >= snapshot.config.deposit - EPSILON;

  for (const policyPoint of policyPoints) {
    const range = feasibleRangeAt(snapshot, inputs.benchmark, inputs.finalTargetPercent, resolved, policyPoint.movePercent);
    if (recovered) {
      resolved.push({ ...policyPoint, activeAfter: range.max });
      continue;
    }
    const external = accountInitialCashback ? originalExternalValue(snapshot, ratioAt(policyPoint.movePercent)) : 0;
    const remainingForRecovery = Math.max(0, snapshot.config.deposit - external - cumulativeHarvested);
    const policyWithdrawal = policyWithdrawalById.get(policyPoint.id) ?? 0;
    const withdrawal = Math.min(Math.max(0, range.max - range.min), policyWithdrawal, remainingForRecovery);
    resolved.push({ ...policyPoint, activeAfter: range.max - withdrawal });
    cumulativeHarvested += withdrawal;
    recovered = external + cumulativeHarvested >= snapshot.config.deposit - EPSILON;
  }
  return constrainHarvestPoints(snapshot, inputs.benchmark, inputs.finalTargetPercent, resolved);
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
  const customPoints = state.points.filter((point) => !baselineIds.has(point.id) && point.movePercent < inputs.finalTargetPercent);
  const merged = regenerated.points.map((point, index) => overridesByIndex.get(index) ?? point);
  const points = constrainHarvestPoints(snapshot, inputs.benchmark, inputs.finalTargetPercent, [...merged, ...customPoints]);
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
) => {
  const reached = planResult.points.filter((point) => includeEventsAtMove
    ? point.movePercent <= movePercent + EPSILON
    : point.movePercent < movePercent - EPSILON);
  const last = reached.length > 0 ? reached[reached.length - 1] : undefined;
  const survivingFraction = last?.survivingFraction ?? 1;
  const cumulativeHarvested = last?.cumulativeHarvested ?? 0;
  const p = ratioAt(movePercent);
  const activeV4 = survivingFraction * originalActiveV4Value(snapshot, p);
  const external = originalExternalValue(snapshot, p);
  return { survivingFraction, cumulativeHarvested, activeV4, external, totalWealth: activeV4 + external + cumulativeHarvested };
};

export const buildHarvesterChartSeries = (
  snapshot: HarvesterSnapshot,
  benchmark: HarvesterBenchmark,
  finalTargetPercent: number,
  points: HarvestPoint[],
  sampleCount = 180,
): HarvesterChartPoint[] => {
  const result = evaluateHarvestPlan(snapshot, benchmark, finalTargetPercent, points);
  const moves = Array.from({ length: sampleCount }, (_, index) => finalTargetPercent * index / Math.max(1, sampleCount - 1));
  moves.push(...result.points.map((point) => point.movePercent), finalTargetPercent);
  const uniqueMoves = [...new Set(moves)].sort((a, b) => a - b);
  const series: HarvesterChartPoint[] = [];
  for (const move of uniqueMoves) {
    const isCheckpoint = result.points.some((point) => Math.abs(point.movePercent - move) < EPSILON);
    const append = (includeEventsAtMove: boolean, phase?: "before" | "after") => {
      const p = ratioAt(move);
      const state = evaluateHarvestedStateAt(snapshot, result, move, includeEventsAtMove);
      series.push({
        move,
        originalActiveV4: originalActiveV4Value(snapshot, p),
        harvestedActiveV4: state.activeV4,
        totalWealth: state.totalWealth,
        benchmark: evaluateHarvesterBenchmark(snapshot, benchmark, p).value,
        cumulativeHarvested: state.cumulativeHarvested,
        phase,
      });
    };
    if (isCheckpoint) append(false, "before");
    append(true, isCheckpoint ? "after" : undefined);
  }
  return series;
};

export const createHarvesterExportPayload = (
  snapshot: HarvesterSnapshot,
  benchmark: HarvesterBenchmark,
  finalTargetPercent: number,
  points: HarvestPoint[],
  accountInitialCashback = true,
): HarvesterExportPayload => {
  const result = evaluateHarvestPlan(snapshot, benchmark, finalTargetPercent, points, accountInitialCashback);
  const curve = buildHarvesterChartSeries(snapshot, benchmark, finalTargetPercent, points);
  return {
    importedStrategy: {
      config: { ...snapshot.config },
      comparisonMode: snapshot.comparisonMode,
      assetName: snapshot.assetName,
      importedAt: snapshot.importedAt,
    },
    originalActiveV4Curve: curve.map(({ move, originalActiveV4: value }) => ({ move, value })),
    harvestedActiveV4Curve: curve.map(({ move, harvestedActiveV4: value }) => ({ move, value })),
    totalWealthCurve: curve.map(({ move, totalWealth: value }) => ({ move, value })),
    selectedBenchmarkCurve: curve.map(({ move, benchmark: value }) => ({ move, value })),
    harvestCheckpoints: result.points,
    finalTarget: finalTargetPercent,
    finalBenchmark: benchmark,
    totalHarvested: result.final.totalHarvested,
    originalExternalCapital: result.final.originalExternalCapital,
    securedCapital: result.recovery.currentSecured,
    initialCapitalRecoveryPoint: result.recovery.recoveredAtMovePercent,
    finalTargetSummary: result.final,
  };
};
