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
export const HARVESTER_MAX_POINTS = 10;
export const HARVESTER_MOVE_STEP = 5;

export type HarvesterBenchmark = "spot" | "lending" | "perp";
export type HarvesterDragMode = "vertical" | "horizontal" | "both";

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
}

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
  recovered: boolean;
  recoveredAtMovePercent: number | null;
  currentSecured: number;
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
  if (active <= EPSILON) return benchmarkResult.value <= originalExternalValue(snapshot, p) + EPSILON ? 0 : Number.POSITIVE_INFINITY;
  return Math.max(0, (benchmarkResult.value - originalExternalValue(snapshot, p)) / active);
};

const pointId = () => `harvest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const ratioAt = (movePercent: number) => 1 + movePercent / 100;
const clonePoints = (points: HarvestPoint[]) => points.map((point) => ({ ...point }));

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
    : remainingActiveV4 + originalExternalCapital - benchmarkResult.value;
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
    };
  });
  const recoveryPoint = points.find((point) =>
    originalExternalValue(snapshot, point.priceRatio) + point.cumulativeHarvested >= snapshot.config.deposit - EPSILON,
  );
  const final = finalSummary(snapshot, benchmark, finalTargetPercent, priorFraction, cumulativeHarvested);
  const latestPoint = points.length > 0 ? points[points.length - 1] : undefined;
  const originalExternalAtLatestCheckpoint = originalExternalValue(snapshot, latestPoint?.priceRatio ?? 1);
  const securedAtLatestCheckpoint = originalExternalAtLatestCheckpoint + cumulativeHarvested;
  return {
    points,
    requiredFinalFraction: required,
    feasible,
    final,
    recovery: {
      recovered: Boolean(recoveryPoint),
      recoveredAtMovePercent: recoveryPoint?.movePercent ?? null,
      currentSecured: securedAtLatestCheckpoint,
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
  const count = Math.min(HARVESTER_MAX_POINTS, Math.max(0, Math.floor(pointCount)));
  const interval = Math.max(HARVESTER_MOVE_STEP, snapHarvestMove(intervalPercent));
  const generated: HarvestPoint[] = [];
  for (let index = 1; index <= count; index += 1) {
    const movePercent = interval * index;
    if (movePercent >= finalTargetPercent) break;
    const range = feasibleRangeAt(snapshot, benchmark, finalTargetPercent, generated, movePercent);
    const benchmarkResult = evaluateHarvesterBenchmark(snapshot, benchmark, ratioAt(movePercent));
    const benchmarkActive = benchmarkResult.value === null
      ? range.max
      : benchmarkResult.value - originalExternalValue(snapshot, ratioAt(movePercent));
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
  if (points.length >= HARVESTER_MAX_POINTS) return clonePoints(points);
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
): HarvesterExportPayload => {
  const result = evaluateHarvestPlan(snapshot, benchmark, finalTargetPercent, points);
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
