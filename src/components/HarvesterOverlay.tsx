import { useEffect, useMemo, useRef, useState, type FocusEvent as ReactFocusEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { isDesktopShell } from "../persistence";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  DEFAULT_HARVEST_PRESETS,
  HARVESTER_PLAN_KINDS,
  availableHarvesterBenchmarks,
  availableCheckpointMoves,
  applyLiveHarvestRate,
  benchmarkForComparisonMode,
  buildHarvesterChartSeries,
  createEmptyHarvesterPlans,
  deleteHarvestPoint,
  editHarvestPoint,
  editHarvestPointPercent,
  evaluateHarvestedStateAt,
  evaluateHarvesterBenchmark,
  evaluateHarvestPlan,
  horizontalBoundsForPoint,
  insertHarvestPoint,
  initialRecoveryTarget,
  maximumCheckpointCount,
  originalExternalValue,
  resetHarvesterPlanState,
  regenerateHarvesterPlansPreservingEdits,
  resolveEarliestRecoveryPoints,
  updateHarvesterPlanPoints,
  type HarvestPoint,
  type HarvestPointResult,
  type HarvesterBenchmark,
  type HarvesterDragMode,
  type HarvestDirection,
  type HarvestWithdrawalSource,
  type HarvesterChartView,
  type HarvesterGenerationInputs,
  type HarvesterPlanKind,
  type HarvesterPlans,
  type HarvesterPreviewThrough,
  type HarvesterSnapshot,
} from "../model/harvester";
import {
  CalculationUnderReviewWarning,
  isShortCashbackUnderReview,
} from "./CalculationUnderReviewWarning";

const money = (value: number) => new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
}).format(value);
const assetPriceMoney = (value: number) => new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
}).format(value);
const signedMove = (value: number) => `${value >= 0 ? "+" : ""}${Math.round(value)}%`;
const benchmarkLabels: Record<HarvesterBenchmark, string> = { spot: "Spot Hold", lending: "Lending", perp: "Perp" };
const planLabels: Record<HarvesterPlanKind, string> = {
  user: "User",
  equalRate: "Max Harvest Rate",
  equalCash: "Max Equal Harvest",
  earliestRecovery: "Fastest Capital Recovery",
};
const planDescriptions: Record<HarvesterPlanKind, string> = {
  user: "Build and fine-tune your own harvest plan.",
  equalRate: "Maximise one harvest rate across eligible checkpoints while preserving final benchmark parity.",
  equalCash: "Maximise the same cash withdrawal across eligible checkpoints while preserving final benchmark parity.",
  earliestRecovery: "Recover initial capital as early as possible while preserving final benchmark parity.",
};
const coverageSummary = (coveredAtTarget: boolean, movePercent: number | null, targetPercent: number) => {
  if (!coveredAtTarget || movePercent === null) return "Short at target";
  if (movePercent === 0) return "Covered from entry";
  if (movePercent === targetPercent) return "Covered at target";
  return `Covered from ${signedMove(movePercent)}`;
};
const intervalOptions = Array.from({ length: 10 }, (_, index) => (index + 1) * 10);
type NumericAdjustmentControl = {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  steps: readonly [number, number, number];
  onChange: (value: number) => void;
};
const finalSurplusLabel = (value: number | null) => {
  if (value === null) return "Unavailable";
  if (value === 0) return "Parity achieved";
  return `${value > 0 ? "Surplus" : "Shortfall"} ${money(Math.abs(value))}`;
};

interface HarvesterOverlayProps {
  snapshot: HarvesterSnapshot;
  onClose: () => void;
}

const HARVESTER_UNDO_LIMIT = 50;

const parseNumericDraft = (
  draft: string,
  { min, max, integer = false }: { min: number; max?: number; integer?: boolean },
) => {
  const trimmed = draft.trim();
  if (!/^-?(?:\d+|\d*\.\d+)$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < min || (max !== undefined && value > max)) return null;
  if (integer && !Number.isInteger(value)) return null;
  return value;
};

interface HarvesterUndoState {
  plans: HarvesterPlans;
  sharedInputs: HarvesterGenerationInputs;
  accountInitialCashback: boolean;
}

type ByDirection<T> = Record<HarvestDirection, T>;
const byDirection = <T,>(long: T, short: T): ByDirection<T> => ({ long, short });
const resolveStateAction = <T,>(action: SetStateAction<T>, current: T) =>
  typeof action === "function" ? (action as (value: T) => T)(current) : action;
type HarvesterChartSeriesKey = "original" | "active" | "wealth" | "history" | "benchmark" | "comparisonReference";
type HarvesterChartSeriesVisibility = Record<HarvesterChartSeriesKey, boolean>;
const DEFAULT_HARVESTER_CHART_SERIES_VISIBILITY: HarvesterChartSeriesVisibility = {
  original: true,
  active: true,
  wealth: true,
  history: true,
  benchmark: true,
  comparisonReference: true,
};

const cloneUndoState = (state: HarvesterUndoState): HarvesterUndoState => structuredClone(state);

function HarvesterTooltip({
  active,
  payload,
  label,
  benchmarkLabel,
  comparisonReferenceLabel,
  detailed,
  previewLabel,
  showTotalWealth,
  completeView,
  seriesVisibility,
}: {
  active?: boolean;
  payload?: any[];
  label?: number;
  benchmarkLabel: string;
  comparisonReferenceLabel: string | null;
  detailed: boolean;
  previewLabel: string;
  showTotalWealth: boolean;
  completeView: boolean;
  seriesVisibility: HarvesterChartSeriesVisibility;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  const activeV4 = completeView ? row.previewedActiveV4 : row.harvestedActiveV4;
  const remainingLong = completeView ? row.previewedRemainingLong : row.remainingLong;
  const remainingShort = completeView ? row.previewedRemainingShort : row.remainingShort;
  const cumulativeHarvested = completeView ? row.previewedCumulativeHarvested : row.cumulativeHarvested;
  const totalWealth = completeView ? row.previewedTotalWealth : row.totalWealth;
  return <div className="harvester-chart-tooltip">
    <b>{signedMove(label ?? row.move)}</b>
    {completeView
      ? <small className="projection-label">Position after · {previewLabel}</small>
      : row.projection && <small className="projection-label">Projected · {previewLabel}</small>}
    {seriesVisibility.benchmark && <span className="benchmark">Benchmark · {benchmarkLabel} <strong>{row.benchmark === null ? (completeView ? "Liquidated" : "Unavailable") : money(row.benchmark)}</strong></span>}
    {seriesVisibility.comparisonReference && comparisonReferenceLabel && <span className="comparison-reference">Reference · {comparisonReferenceLabel} <strong>{row.comparisonReference === null ? "Liquidated" : money(row.comparisonReference)}</strong></span>}
    {seriesVisibility.original && <span className="original">Original V4 <strong>{money(row.originalActiveV4)}</strong></span>}
    {seriesVisibility.active && <span className="active">{completeView ? "Previewed Active V4" : "Active V4"} <strong>{money(activeV4)}</strong></span>}
    {seriesVisibility.active && detailed && <span className="active-breakdown"><i aria-hidden="true" /><span>Long component <strong>{money(remainingLong)}</strong></span><span>Short component <strong>{money(remainingShort)}</strong></span></span>}
    {seriesVisibility.history && completeView && row.historicalActiveV4 !== null && <span className="history">Harvest path <strong>{money(row.historicalActiveV4)}</strong></span>}
    <span className="harvested">Harvested Cash <strong>{money(cumulativeHarvested)}</strong></span>
    {row.initialCashback !== 0 && <span className="cashback">Cashback value <strong>{money(row.initialCashback)}</strong></span>}
    {showTotalWealth && seriesVisibility.wealth && <span className="wealth">{completeView ? "Previewed Total Wealth" : "Total wealth"} <strong>{money(totalWealth)}</strong></span>}
  </div>;
}

function HarvesterLegendToggle({ label, seriesClass, visible, onToggle }: {
  label: string;
  seriesClass: string;
  visible: boolean;
  onToggle: () => void;
}) {
  return <button type="button" className={`harvester-legend-item${visible ? " on" : ""}`} aria-pressed={visible} aria-label={`${visible ? "Hide" : "Show"} ${label}`} onClick={onToggle}>
    <span className={seriesClass}>{label}</span>
    <svg viewBox="0 0 24 16" aria-hidden="true"><path d="M2 8s3.8-5.2 10-5.2S22 8 22 8s-3.8 5.2-10 5.2S2 8 2 8Z" /><circle cx="12" cy="8" r="2.4" />{!visible && <path className="slash" d="M4 2l16 12" />}</svg>
  </button>;
}

function HarvestedTooltipAnchor({
  cx,
  cy,
  onPosition,
}: {
  cx?: number;
  cy?: number;
  onPosition: (position: { x: number; y: number }) => void;
}) {
  useEffect(() => {
    if (typeof cx === "number" && typeof cy === "number") onPosition({ x: cx, y: cy });
  }, [cx, cy, onPosition]);
  return <circle cx={cx} cy={cy} r={0} fill="transparent" />;
}

function CheckpointDot({
  cx,
  cy,
  selected,
  muted,
  onPointerDown,
  onClick,
}: {
  cx?: number;
  cy?: number;
  selected: boolean;
  muted: boolean;
  onPointerDown: (event: ReactPointerEvent<SVGCircleElement>) => void;
  onClick: (event: ReactMouseEvent<SVGCircleElement>) => void;
}) {
  if (typeof cx !== "number" || typeof cy !== "number") return null;
  return <g className={`harvester-checkpoint-dot${muted ? " muted" : ""}`}>
    <circle cx={cx} cy={cy} r={selected ? 7 : 5.5} fill={selected ? "#f5b57f" : "#e18a4a"} stroke="#151616" strokeWidth={2} pointerEvents="none" />
    <circle cx={cx} cy={cy} r={16} fill="transparent" stroke="transparent" style={{ touchAction: "none" }} onPointerDown={onPointerDown} onClick={onClick} />
  </g>;
}

export function HarvesterOverlay({ snapshot, onClose }: HarvesterOverlayProps) {
  const isBrowserHarvester = !isDesktopShell();
  const isPhoneBrowser = isBrowserHarvester && document.body.classList.contains("phone-web");
  const isAndroidBrowser = /Android/i.test(navigator.userAgent);
  const androidBackdropStyle = isAndroidBrowser ? {
    position: "fixed" as const, top: 0, right: 0, bottom: 0, left: 0,
    width: "100vw", height: "100vh", minWidth: 0, minHeight: 0, maxWidth: "none", maxHeight: "none",
  } : undefined;
  const androidWorkspaceStyle = isAndroidBrowser ? {
    width: "100%", height: "100%", minWidth: 0, minHeight: 0, maxWidth: "none", maxHeight: "none", margin: 0, borderRadius: 0,
  } : undefined;
  const availableBenchmarks = useMemo(() => availableHarvesterBenchmarks(snapshot), [snapshot]);
  const launchedBenchmark = benchmarkForComparisonMode(snapshot.comparisonMode);
  const initialBenchmark = availableBenchmarks.includes(launchedBenchmark) ? launchedBenchmark : "spot";
  const initialInputs = useMemo<ByDirection<HarvesterGenerationInputs>>(() => byDirection({
    direction: "long",
    withdrawalSource: "proportional",
    benchmark: initialBenchmark,
    finalTargetPercent: 500,
    intervalPercent: 100,
    firstCheckpointPercent: null,
    pointCount: 4,
    defaultHarvestPercent: 50,
  }, {
    direction: "short",
    withdrawalSource: "proportional",
    benchmark: initialBenchmark,
    finalTargetPercent: -80,
    intervalPercent: 20,
    firstCheckpointPercent: null,
    pointCount: 3,
    defaultHarvestPercent: 50,
  }), [initialBenchmark]);
  const [activeDirection, setActiveDirection] = useState<HarvestDirection>(snapshot.defaultHarvestDirection);
  const [sharedInputsByDirection, setSharedInputsByDirection] = useState(initialInputs);
  const [plansByDirection, setPlansByDirection] = useState<ByDirection<HarvesterPlans>>(() => byDirection(createEmptyHarvesterPlans(), createEmptyHarvesterPlans()));
  const [activeKindByDirection, setActiveKindByDirection] = useState<ByDirection<HarvesterPlanKind>>(() => byDirection("user", "user"));
  const [accountInitialCashbackByDirection, setAccountInitialCashbackByDirection] = useState<ByDirection<boolean>>(() => byDirection(false, false));
  const [dragModeByDirection, setDragModeByDirection] = useState<ByDirection<HarvesterDragMode>>(() => byDirection("vertical", "vertical"));
  const [previewThroughByDirection, setPreviewThroughByDirection] = useState<ByDirection<HarvesterPreviewThrough>>(() => byDirection("all", "all"));
  const [chartView, setChartView] = useState<HarvesterChartView>(snapshot.defaultHarvestDirection);
  const [completeMinMove, setCompleteMinMove] = useState(-80);
  const [completeMaxMove, setCompleteMaxMove] = useState(500);
  const [showDetailedTooltip, setShowDetailedTooltip] = useState(false);
  const [activeNumericAdjustmentId, setActiveNumericAdjustmentId] = useState<string | null>(null);
  const [addPointArmed, setAddPointArmed] = useState(false);
  const [harvestedTooltipAnchor, setHarvestedTooltipAnchor] = useState<{ x: number; y: number } | null>(null);
  const [showLegendCard, setShowLegendCard] = useState(true);
  const [chartSeriesVisibility, setChartSeriesVisibility] = useState<HarvesterChartSeriesVisibility>(() => ({ ...DEFAULT_HARVESTER_CHART_SERIES_VISIBILITY }));
  const [finalTargetDraft, setFinalTargetDraft] = useState("500");
  const [intervalDraft, setIntervalDraft] = useState("100");
  const [checkpointCountDraft, setCheckpointCountDraft] = useState("4");
  const [harvestRateDraft, setHarvestRateDraft] = useState("50");
  const [analysisMoveByDirection, setAnalysisMoveByDirection] = useState<ByDirection<number>>(() => byDirection(500, -80));
  const [analysisMoveDraft, setAnalysisMoveDraft] = useState("500");
  const [pointFieldDrafts, setPointFieldDrafts] = useState<Record<string, string>>({});
  const [openSelector, setOpenSelector] = useState<"interval" | "checkpoints" | "harvestRate" | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const undoHistoryRef = useRef<ByDirection<HarvesterUndoState[]>>(byDirection([], []));
  const undoCoalesceKeyRef = useRef<string | null>(null);
  const undoCoalesceTimerRef = useRef<number | null>(null);
  const [undoCountByDirection, setUndoCountByDirection] = useState<ByDirection<number>>(() => byDirection(0, 0));

  const sharedInputs = sharedInputsByDirection[activeDirection];
  const plans = plansByDirection[activeDirection];
  const activeKind = activeKindByDirection[activeDirection];
  const accountInitialCashback = accountInitialCashbackByDirection[activeDirection];
  const dragMode = dragModeByDirection[activeDirection];
  const previewThrough = previewThroughByDirection[activeDirection];
  const analysisMove = analysisMoveByDirection[activeDirection];
  const undoCount = undoCountByDirection[activeDirection];
  const setSharedInputs = (action: SetStateAction<HarvesterGenerationInputs>) => setSharedInputsByDirection((current) => ({
    ...current,
    [activeDirection]: resolveStateAction(action, current[activeDirection]),
  }));
  const setPlans = (action: SetStateAction<HarvesterPlans>) => setPlansByDirection((current) => ({
    ...current,
    [activeDirection]: resolveStateAction(action, current[activeDirection]),
  }));
  const setActiveKind = (kind: HarvesterPlanKind) => setActiveKindByDirection((current) => ({ ...current, [activeDirection]: kind }));
  const setAccountInitialCashback = (value: boolean) => setAccountInitialCashbackByDirection((current) => ({ ...current, [activeDirection]: value }));
  const setDragMode = (mode: HarvesterDragMode) => setDragModeByDirection((current) => ({ ...current, [activeDirection]: mode }));
  const setPreviewThrough = (value: HarvesterPreviewThrough) => setPreviewThroughByDirection((current) => ({ ...current, [activeDirection]: value }));
  const setUndoCount = (value: number) => setUndoCountByDirection((current) => ({ ...current, [activeDirection]: value }));
  const toggleChartSeriesVisibility = (series: HarvesterChartSeriesKey) => setChartSeriesVisibility((current) => ({ ...current, [series]: !current[series] }));

  const activePlan = plans[activeKind];
  const hasGeneratedPlans = HARVESTER_PLAN_KINDS.every((kind) => plans[kind] !== null);
  const availableFirstCheckpoints = useMemo(
    () => availableCheckpointMoves(sharedInputs.finalTargetPercent, sharedInputs.intervalPercent),
    [sharedInputs.finalTargetPercent, sharedInputs.intervalPercent],
  );
  const availableCheckpointCounts = useMemo(() => {
    const maximum = maximumCheckpointCount(
      sharedInputs.finalTargetPercent,
      sharedInputs.intervalPercent,
      sharedInputs.firstCheckpointPercent,
    );
    return Array.from({ length: maximum }, (_, index) => index + 1);
  }, [sharedInputs.finalTargetPercent, sharedInputs.intervalPercent, sharedInputs.firstCheckpointPercent]);
  const evaluationInputs = activePlan?.generationInputs ?? sharedInputs;
  const evaluationOptions = useMemo(() => ({
    direction: evaluationInputs.direction,
    withdrawalSource: evaluationInputs.withdrawalSource,
  }), [evaluationInputs.direction, evaluationInputs.withdrawalSource]);
  const storedPoints = activePlan?.points ?? [];
  const points = useMemo(() => activePlan && activeKind === "earliestRecovery"
    ? resolveEarliestRecoveryPoints(snapshot, activePlan.generationInputs, storedPoints, accountInitialCashback)
    : storedPoints,
  [snapshot, activePlan, activeKind, storedPoints, accountInitialCashback]);
  const result = useMemo(
    () => evaluateHarvestPlan(snapshot, evaluationInputs.benchmark, evaluationInputs.finalTargetPercent, points, accountInitialCashback, evaluationOptions),
    [snapshot, evaluationInputs, points, accountInitialCashback, evaluationOptions],
  );
  const analysisState = useMemo(
    () => evaluateHarvestedStateAt(snapshot, result, analysisMove, true, evaluationInputs.direction),
    [snapshot, result, analysisMove, evaluationInputs.direction],
  );
  const analysisBenchmark = useMemo(
    () => evaluateHarvesterBenchmark(snapshot, evaluationInputs.benchmark, 1 + analysisMove / 100),
    [snapshot, evaluationInputs.benchmark, analysisMove],
  );
  const analysisSurplus = analysisBenchmark.value === null
    ? null
    : analysisState.activeV4 - analysisBenchmark.value;
  const analysisRecoveryTarget = initialRecoveryTarget(snapshot);
  const analysisCoverage = analysisState.cumulativeHarvested + (accountInitialCashback ? analysisState.external : 0);
  const analysisCoverageGap = analysisCoverage - analysisRecoveryTarget;
  const analysisCovered = analysisCoverageGap >= -1e-7;
  const durableRecoveryReached = result.recovery.durablyCoveredAtMovePercent !== null
    && Math.abs(result.recovery.durablyCoveredAtMovePercent) <= Math.abs(analysisMove) + 1e-7;
  const previewCheckpointIndex = previewThrough.startsWith("checkpoint:")
    ? Number(previewThrough.slice("checkpoint:".length))
    : null;
  const previewPoints = useMemo(() => {
    if (previewThrough === "before") return [];
    if (previewThrough === "all") return points;
    return previewCheckpointIndex === null || !Number.isInteger(previewCheckpointIndex)
      ? points
      : points.slice(0, previewCheckpointIndex + 1);
  }, [points, previewThrough, previewCheckpointIndex]);
  const previewIncludedIds = useMemo(() => new Set(previewPoints.map((point) => point.id)), [previewPoints]);
  const previewLabel = previewThrough === "before"
    ? "Before cashouts"
    : previewThrough === "all"
      ? "All cashouts"
      : previewCheckpointIndex === null || previewCheckpointIndex >= result.points.length
        ? "All cashouts"
        : `Checkpoint ${previewCheckpointIndex + 1}`;
  const recoveryTargetLabel = snapshot.comparisonMode === "perp" ? "Initial Margin" : "Initial Capital";
  const hasKnownAssetPrice = snapshot.spotAssetPrice !== null
    && Number.isFinite(snapshot.spotAssetPrice)
    && snapshot.spotAssetPrice > 0;
  const analysisCashbackLabel = useMemo(() => {
    const targetLabel = signedMove(analysisMove);
    if (snapshot.config.cashbackMode !== "spot") return `Cashback value at ${targetLabel} (Cash)`;
    const assetName = snapshot.assetName.trim();
    const assetPrice = snapshot.spotAssetPrice;
    const initialCashbackValue = originalExternalValue(snapshot, 1);
    const spotAmount = assetPrice !== null && Number.isFinite(assetPrice) && assetPrice > 0
      ? initialCashbackValue / assetPrice
      : null;
    const spotDescription = spotAmount !== null && assetName
      ? `${spotAmount.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${assetName}`
      : "Spot";
    return `Cashback value at ${targetLabel} (${spotDescription})`;
  }, [snapshot, analysisMove]);
  const earliestRecoverySummary = useMemo(() => {
    const plan = plans.earliestRecovery;
    if (!plan) return "Generate a plan";
    const resolved = resolveEarliestRecoveryPoints(snapshot, plan.generationInputs, plan.points, accountInitialCashback);
    const recovery = evaluateHarvestPlan(snapshot, plan.generationInputs.benchmark, plan.generationInputs.finalTargetPercent, resolved, accountInitialCashback, {
      direction: plan.generationInputs.direction,
      withdrawalSource: plan.generationInputs.withdrawalSource,
    }).recovery;
    return coverageSummary(recovery.coveredAtTarget, recovery.durablyCoveredAtMovePercent, plan.generationInputs.finalTargetPercent);
  }, [snapshot, plans.earliestRecovery, accountInitialCashback]);
  const activeTarget = evaluationInputs.finalTargetPercent;
  const chartMinMove = chartView === "long"
    ? 0
    : Math.min(completeMinMove, evaluationInputs.direction === "short" ? activeTarget : 0);
  const chartMaxMove = chartView === "short"
    ? 0
    : Math.max(completeMaxMove, evaluationInputs.direction === "long" ? activeTarget : 0);
  const chartSupportsEditing = chartView === "complete" || chartView === activeDirection;
  const chartSeries = useMemo(
    () => buildHarvesterChartSeries(
      snapshot,
      evaluationInputs.benchmark,
      evaluationInputs.finalTargetPercent,
      previewPoints,
      180,
      evaluationInputs.benchmark === "spot" && snapshot.comparisonMode !== "base"
        ? benchmarkForComparisonMode(snapshot.comparisonMode)
        : null,
      evaluationOptions,
      { minMove: chartMinMove, maxMove: chartMaxMove },
    ),
    [snapshot, evaluationInputs, previewPoints, evaluationOptions, chartMinMove, chartMaxMove],
  );
  const chartComparisonReference = evaluationInputs.benchmark === "spot" && snapshot.comparisonMode !== "base"
    ? benchmarkForComparisonMode(snapshot.comparisonMode)
    : null;
  const selectedPoint = result.points.find((point) => point.id === activePlan?.selectedPointId) ?? null;
  const yValues = chartSeries.flatMap((entry) => [
    ...(chartSeriesVisibility.original ? [entry.originalActiveV4] : []),
    ...(chartView === "complete"
      ? [
          ...(chartSeriesVisibility.active ? [entry.previewedActiveV4] : []),
          ...(chartSeriesVisibility.wealth ? [entry.previewedTotalWealth] : []),
          ...(chartSeriesVisibility.history ? [entry.historicalActiveV4 ?? 0] : []),
        ]
      : [
          ...(chartSeriesVisibility.active ? [entry.harvestedActiveV4] : []),
          ...(chartSeriesVisibility.wealth ? [entry.totalWealth] : []),
        ]),
    ...(chartSeriesVisibility.benchmark ? [entry.benchmark ?? 0] : []),
    ...(chartSeriesVisibility.comparisonReference ? [entry.comparisonReference ?? 0] : []),
  ]);
  const rawYMax = Math.max(snapshot.config.deposit, ...yValues);
  const yStep = rawYMax <= 100_000 ? 25_000 : rawYMax <= 500_000 ? 100_000 : 250_000;
  const yMax = Math.max(yStep, Math.ceil(rawYMax / yStep) * yStep);
  const yMin = Math.min(0, ...yValues);
  const harvestedTooltipPosition = useMemo(() => {
    if (!harvestedTooltipAnchor) return undefined;
    const tooltipWidth = 190;
    const tooltipHeight = showDetailedTooltip
      ? chartView === "complete" ? 176 : 154
      : chartView === "complete" ? 142 : 118;
    const chartWidth = chartRef.current?.clientWidth ?? 0;
    if (isPhoneBrowser && chartWidth) {
      return { x: Math.max(0, (chartWidth - tooltipWidth) / 2), y: 12 };
    }
    const rightX = harvestedTooltipAnchor.x + 18;
    const x = chartWidth && rightX + tooltipWidth > chartWidth
      ? Math.max(0, harvestedTooltipAnchor.x - tooltipWidth - 18)
      : rightX;
    const aboveY = harvestedTooltipAnchor.y - 150 - tooltipHeight;
    const preferredY = aboveY >= 58 ? aboveY : harvestedTooltipAnchor.y + 150;
    return { x, y: Math.max(58, preferredY) };
  }, [harvestedTooltipAnchor, isPhoneBrowser, showDetailedTooltip, chartView]);
  const activeHarvestRate = activePlan?.harvestRatePercent ?? sharedInputs.defaultHarvestPercent;

  useEffect(() => {
    setFinalTargetDraft(String(sharedInputs.finalTargetPercent));
  }, [sharedInputs.finalTargetPercent]);

  useEffect(() => {
    setIntervalDraft(String(sharedInputs.intervalPercent));
  }, [sharedInputs.intervalPercent]);

  useEffect(() => {
    setCheckpointCountDraft(String(sharedInputs.pointCount));
  }, [sharedInputs.pointCount]);

  useEffect(() => {
    setHarvestRateDraft(String(activeHarvestRate));
  }, [activeHarvestRate]);

  useEffect(() => {
    setAnalysisMoveDraft(String(analysisMove));
  }, [analysisMove]);

  useEffect(() => {
    const minimum = Math.min(0, evaluationInputs.finalTargetPercent);
    const maximum = Math.max(0, evaluationInputs.finalTargetPercent);
    setAnalysisMoveByDirection((current) => {
      const nextValue = Math.min(maximum, Math.max(minimum, current[activeDirection]));
      return nextValue === current[activeDirection]
        ? current
        : { ...current, [activeDirection]: nextValue };
    });
  }, [activeDirection, evaluationInputs.finalTargetPercent]);

  useEffect(() => {
    setPlans((current) => regenerateHarvesterPlansPreservingEdits(current, snapshot, sharedInputs));
  }, [snapshot, activeDirection, sharedInputs.direction, sharedInputs.withdrawalSource, sharedInputs.benchmark, sharedInputs.finalTargetPercent, sharedInputs.intervalPercent, sharedInputs.firstCheckpointPercent, sharedInputs.pointCount]);

  useEffect(() => {
    if (sharedInputs.direction === "long") setCompleteMaxMove((current) => Math.max(current, sharedInputs.finalTargetPercent));
    else setCompleteMinMove((current) => Math.min(current, sharedInputs.finalTargetPercent));
  }, [sharedInputs.direction, sharedInputs.finalTargetPercent]);

  useEffect(() => {
    if (previewCheckpointIndex !== null && (!Number.isInteger(previewCheckpointIndex) || previewCheckpointIndex < 0 || previewCheckpointIndex >= points.length)) {
      setPreviewThrough("all");
    }
  }, [points, previewCheckpointIndex]);

  useEffect(() => {
    setAddPointArmed(false);
    setActiveNumericAdjustmentId(null);
    setPointFieldDrafts({});
    setOpenSelector(null);
    undoCoalesceKeyRef.current = null;
  }, [activeDirection]);

  useEffect(() => () => {
    if (undoCoalesceTimerRef.current !== null) window.clearTimeout(undoCoalesceTimerRef.current);
  }, []);

  useEffect(() => {
    if (!activeNumericAdjustmentId) return;
    const closeNumericAdjustment = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".harvester-touch-number-editor")) return;
      setActiveNumericAdjustmentId(null);
    };
    document.addEventListener("pointerdown", closeNumericAdjustment, true);
    return () => document.removeEventListener("pointerdown", closeNumericAdjustment, true);
  }, [activeNumericAdjustmentId]);

  useEffect(() => {
    const priorFocus = document.activeElement as HTMLElement | null;
    const priorHtmlOverflow = document.documentElement.style.overflow;
    const priorBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
      )];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.documentElement.style.overflow = priorHtmlOverflow;
      document.body.style.overflow = priorBodyOverflow;
      priorFocus?.focus();
    };
  }, [onClose]);

  const recordUndoState = (coalesceKey?: string) => {
    const scopedKey = coalesceKey ? `${activeDirection}:${coalesceKey}` : undefined;
    if (scopedKey && undoCoalesceKeyRef.current === scopedKey) return;
    const history = undoHistoryRef.current[activeDirection];
    history.unshift(cloneUndoState({ plans, sharedInputs, accountInitialCashback }));
    history.length = Math.min(history.length, HARVESTER_UNDO_LIMIT);
    setUndoCount(history.length);
    if (!coalesceKey) return;
    undoCoalesceKeyRef.current = scopedKey ?? null;
    if (undoCoalesceTimerRef.current !== null) window.clearTimeout(undoCoalesceTimerRef.current);
    undoCoalesceTimerRef.current = window.setTimeout(() => {
      undoCoalesceKeyRef.current = null;
      undoCoalesceTimerRef.current = null;
    }, 700);
  };

  const undoLastAction = () => {
    const history = undoHistoryRef.current[activeDirection];
    const previous = history.shift();
    if (!previous) return;
    if (undoCoalesceTimerRef.current !== null) window.clearTimeout(undoCoalesceTimerRef.current);
    undoCoalesceKeyRef.current = null;
    undoCoalesceTimerRef.current = null;
    setPlans(previous.plans);
    setSharedInputs(previous.sharedInputs);
    setAccountInitialCashback(previous.accountInitialCashback);
    setAddPointArmed(false);
    setUndoCount(history.length);
  };

  const setShared = <K extends keyof HarvesterGenerationInputs>(key: K, value: HarvesterGenerationInputs[K]) => {
    if (sharedInputs[key] === value) return;
    recordUndoState();
    setSharedInputs((current) => {
      const next = { ...current, [key]: value };
      if (key === "intervalPercent") {
        next.firstCheckpointPercent = null;
        next.pointCount = maximumCheckpointCount(next.finalTargetPercent, next.intervalPercent, null);
      } else if (key === "finalTargetPercent") {
        if (next.firstCheckpointPercent !== null && !availableCheckpointMoves(next.finalTargetPercent, next.intervalPercent).includes(next.firstCheckpointPercent)) {
          next.firstCheckpointPercent = null;
        }
        next.pointCount = Math.min(next.pointCount, maximumCheckpointCount(next.finalTargetPercent, next.intervalPercent, next.firstCheckpointPercent));
      } else if (key === "firstCheckpointPercent") {
        next.pointCount = maximumCheckpointCount(next.finalTargetPercent, next.intervalPercent, next.firstCheckpointPercent);
      }
      return next;
    });
    setAddPointArmed(false);
  };

  const setLiveHarvestRate = (harvestRatePercent: number) => {
    if (activeHarvestRate === harvestRatePercent && sharedInputs.defaultHarvestPercent === harvestRatePercent) return;
    recordUndoState();
    setSharedInputs((current) => ({ ...current, defaultHarvestPercent: harvestRatePercent }));
    if (activeKind === "equalRate" || activeKind === "equalCash") return;
    setPlans((current) => {
      const plan = current[activeKind];
      return plan ? { ...current, [activeKind]: applyLiveHarvestRate(plan, snapshot, harvestRatePercent) } : current;
    });
  };

  const setLiveFirstCheckpoint = (firstCheckpointPercent: number | null) => {
    if (sharedInputs.firstCheckpointPercent === firstCheckpointPercent) return;
    recordUndoState();
    const nextInputs = {
      ...sharedInputs,
      firstCheckpointPercent,
      pointCount: maximumCheckpointCount(
        sharedInputs.finalTargetPercent,
        sharedInputs.intervalPercent,
        firstCheckpointPercent,
      ),
    };
    setSharedInputs(nextInputs);
    setAddPointArmed(false);
  };

  const updateFinalTargetDraft = (draft: string) => {
    setFinalTargetDraft(draft);
    const entered = parseNumericDraft(draft, sharedInputs.direction === "long" ? { min: 10, max: 2000 } : { min: -99, max: -1 });
    if (entered !== null) setShared("finalTargetPercent", entered);
  };

  const updateIntervalDraft = (draft: string) => {
    setIntervalDraft(draft);
    const entered = parseNumericDraft(draft, { min: 10, max: 100, integer: true });
    if (entered !== null) setShared("intervalPercent", entered);
  };

  const updateCheckpointCountDraft = (draft: string) => {
    setCheckpointCountDraft(draft);
    const entered = parseNumericDraft(draft, { min: 1, integer: true });
    if (entered !== null && availableCheckpointCounts.includes(entered)) setShared("pointCount", entered);
  };

  const updateHarvestRateDraft = (draft: string) => {
    setHarvestRateDraft(draft);
    const entered = parseNumericDraft(draft, { min: 0 });
    if (entered !== null) setLiveHarvestRate(entered);
  };

  const commitFinalTarget = () => {
    if (parseNumericDraft(finalTargetDraft, sharedInputs.direction === "long" ? { min: 10, max: 2000 } : { min: -99, max: -1 }) === null) {
      setFinalTargetDraft(String(sharedInputs.finalTargetPercent));
    }
  };

  const commitInterval = () => {
    if (parseNumericDraft(intervalDraft, { min: 10, max: 100, integer: true }) === null) {
      setIntervalDraft(String(sharedInputs.intervalPercent));
    }
  };

  const commitCheckpointCount = () => {
    const entered = parseNumericDraft(checkpointCountDraft, { min: 1, integer: true });
    if (entered === null || !availableCheckpointCounts.includes(entered)) {
      setCheckpointCountDraft(String(sharedInputs.pointCount));
    }
  };

  const commitHarvestRate = () => {
    if (parseNumericDraft(harvestRateDraft, { min: 0 }) === null) {
      setHarvestRateDraft(String(activeHarvestRate));
    }
  };

  const commitFirstCheckpoint = () => {
    const entered = parseNumericDraft(firstCheckpointDraft, { min: 1, integer: true });
    if (entered === null || !availableFirstCheckpoints.includes(entered)) {
      setFirstCheckpointDraft(sharedInputs.firstCheckpointPercent?.toString() ?? "");
    }
  };

  const setAnalysisMove = (value: number) => {
    setAnalysisMoveByDirection((current) => ({ ...current, [activeDirection]: value }));
    setAnalysisMoveDraft(String(value));
  };

  const commitAnalysisMove = () => {
    const entered = parseNumericDraft(analysisMoveDraft, {
      min: Math.min(0, evaluationInputs.finalTargetPercent),
      max: Math.max(0, evaluationInputs.finalTargetPercent),
    });
    if (entered === null) {
      setAnalysisMoveDraft(String(analysisMove));
      return;
    }
    setAnalysisMove(entered);
  };
  const beginPointFieldDraft = (id: string, value: number) => {
    setPointFieldDrafts((current) => ({ ...current, [id]: String(value) }));
  };

  const finishPointFieldDraft = (id: string) => {
    setPointFieldDrafts((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  };

  const updateActivePoints = (
    nextPoints: HarvestPoint[],
    selectedId: string | null | undefined = activePlan?.selectedPointId,
    coalesceKey?: string,
  ) => {
    if (!activePlan) return;
    recordUndoState(coalesceKey);
    setPlans((current) => ({
      ...current,
      [activeKind]: updateHarvesterPlanPoints(activePlan, nextPoints, selectedId ?? null),
    }));
  };

  const numericAdjustmentTrigger = (id: string, onBlur?: () => void, onFocus?: () => void) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLInputElement>) => {
      if (event.pointerType !== "touch") return;
      event.preventDefault();
      event.stopPropagation();
      setActiveNumericAdjustmentId(id);
    },
    onFocus: () => {
      setActiveNumericAdjustmentId(id);
      onFocus?.();
    },
    onBlur: (_event: ReactFocusEvent<HTMLInputElement>) => {
      onBlur?.();
      window.setTimeout(() => {
        setActiveNumericAdjustmentId((current) => current === id ? null : current);
      }, 0);
    },
  });

  const resolveNumericAdjustment = (id: string): NumericAdjustmentControl | null => {
    if (id === "final-target") return {
      id, label: "Final target", value: sharedInputs.finalTargetPercent, min: sharedInputs.direction === "long" ? 10 : -99, max: sharedInputs.direction === "long" ? 2000 : -1, steps: [1, 5, 10],
      onChange: (value) => setShared("finalTargetPercent", value),
    };
    if (id === "interval") return {
      id, label: "Interval", value: sharedInputs.intervalPercent, min: 10, max: 100, steps: [1, 5, 10],
      onChange: (value) => setShared("intervalPercent", value),
    };
    if (id === "checkpoints" && availableCheckpointCounts.length > 0) return {
      id, label: "Checkpoints", value: sharedInputs.pointCount, min: 1, max: availableCheckpointCounts[availableCheckpointCounts.length - 1] ?? 1, steps: [1, 5, 10],
      onChange: (value) => setShared("pointCount", Math.round(value)),
    };
    if (id === "harvest-rate") return {
      id, label: "Harvest rate", value: Math.round(activeHarvestRate), min: 0, max: 1000, steps: [1, 5, 10],
      onChange: setLiveHarvestRate,
    };
    if (id === "analysis-move") return {
      id, label: "Analysis point", value: analysisMove, min: Math.min(0, evaluationInputs.finalTargetPercent), max: Math.max(0, evaluationInputs.finalTargetPercent), steps: [1, 5, 10],
      onChange: setAnalysisMove,
    };
    const match = /^(checkpoint|harvest):(.+)$/.exec(id);
    if (!match || !activePlan) return null;
    const [, kind, pointId] = match;
    const entry = result.points.find((candidate) => candidate.id === pointId);
    const index = result.points.findIndex((candidate) => candidate.id === pointId);
    if (!entry || index < 0) return null;
    if (kind === "checkpoint") return {
      id, label: `Checkpoint ${index + 1}`, value: entry.movePercent, min: Math.min(0, evaluationInputs.finalTargetPercent), max: Math.max(0, evaluationInputs.finalTargetPercent), steps: [1, 5, 10],
      onChange: (value) => updateActivePoints(
        editHarvestPoint(snapshot, evaluationInputs.benchmark, evaluationInputs.finalTargetPercent, points, entry.id, { movePercent: value }, "horizontal", evaluationOptions),
        entry.id,
        `checkpoint:${activeKind}:${entry.id}`,
      ),
    };
    const displayedHarvestRate = activeKind === "equalRate" && !activePlan.modified && activePlan.commonHarvestPercent != null
      ? activePlan.commonHarvestPercent
      : entry.harvestPercent;
    return {
      id, label: `Checkpoint ${index + 1} harvest`, value: Math.round(displayedHarvestRate), min: 0, max: 1000, steps: [1, 5, 10],
      onChange: (value) => updateActivePoints(
        editHarvestPointPercent(snapshot, evaluationInputs.benchmark, evaluationInputs.finalTargetPercent, points, entry.id, value, evaluationOptions),
        entry.id,
        `harvest:${activeKind}:${entry.id}`,
      ),
    };
  };

  const activeNumericAdjustment = activeNumericAdjustmentId ? resolveNumericAdjustment(activeNumericAdjustmentId) : null;
  const adjustNumericValue = (amount: number) => {
    if (!activeNumericAdjustment) return;
    const next = Math.min(activeNumericAdjustment.max, Math.max(activeNumericAdjustment.min, activeNumericAdjustment.value + amount));
    if (next !== activeNumericAdjustment.value) activeNumericAdjustment.onChange(next);
  };

  const handleChartClick = (state: any) => {
    if (!activePlan || !addPointArmed || !chartSupportsEditing || typeof state?.activeLabel !== "number") return;
    const clickedProgress = state.activeLabel * (evaluationInputs.direction === "long" ? 1 : -1);
    const targetProgress = Math.abs(evaluationInputs.finalTargetPercent);
    if (clickedProgress <= 0 || clickedProgress >= targetProgress) return;
    const next = insertHarvestPoint(snapshot, evaluationInputs.benchmark, evaluationInputs.finalTargetPercent, points, state.activeLabel, evaluationOptions);
    const inserted = next.find((candidate) => !points.some((point) => point.id === candidate.id));
    updateActivePoints(next, inserted?.id ?? activePlan.selectedPointId);
    setAddPointArmed(false);
  };

  const dragPoint = (point: HarvestPointResult, event: ReactPointerEvent<SVGCircleElement>) => {
    if (!activePlan || !chartSupportsEditing) return;
    event.preventDefault();
    event.stopPropagation();
    const pointerId = event.pointerId;
    const isTouchDrag = event.pointerType === "touch";
    event.currentTarget.setPointerCapture(pointerId);
    setPlans((current) => ({ ...current, [activeKind]: { ...activePlan, selectedPointId: point.id } }));
    let recordedDrag = false;
    const preventTouchScroll = (touchEvent: TouchEvent) => {
      if (touchEvent.cancelable) touchEvent.preventDefault();
    };
    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const bounds = chartRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const plotLeft = bounds.left + 72;
      const plotRight = bounds.right - 34;
      const plotTop = bounds.top + 22;
      const plotBottom = bounds.bottom - 48;
      const chartRatio = Math.max(0, Math.min(1, (moveEvent.clientX - plotLeft) / Math.max(1, plotRight - plotLeft)));
      const movePercent = chartMinMove + chartRatio * (chartMaxMove - chartMinMove);
      const activeAfter = yMax - ((moveEvent.clientY - plotTop) / Math.max(1, plotBottom - plotTop)) * (yMax - yMin);
      if (!recordedDrag) {
        recordUndoState();
        recordedDrag = true;
      }
      setPlans((current) => {
        const currentPlan = current[activeKind];
        if (!currentPlan) return current;
        const next = editHarvestPoint(snapshot, evaluationInputs.benchmark, evaluationInputs.finalTargetPercent, currentPlan.points, point.id, { movePercent, activeAfter }, dragMode, evaluationOptions);
        return { ...current, [activeKind]: updateHarvesterPlanPoints(currentPlan, next, point.id) };
      });
    };
    const onUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (isTouchDrag) window.removeEventListener("touchmove", preventTouchScroll, true);
    };
    if (isTouchDrag) window.addEventListener("touchmove", preventTouchScroll, { capture: true, passive: false });
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  return createPortal(<div className={`harvester-backdrop${isBrowserHarvester ? " harvester-browser-backdrop" : ""}`} style={androidBackdropStyle} role="presentation">
    <div className="harvester-orientation-notice" role="status">
      <strong>Rotate your device</strong>
      <span>Harvester is best viewed in landscape mode.</span>
    </div>
    <section ref={dialogRef} className="harvester-workspace" style={androidWorkspaceStyle} role="dialog" aria-modal="true" aria-labelledby="harvester-title" tabIndex={-1}>
      <header className="harvester-head">
        <div className="harvester-title-area">
          <div>
            <small>SCENARIO WORKSPACE</small>
            <h2 id="harvester-title">Harvester</h2>
          </div>
          <div className="harvester-chart-view-panel">
            <small className="harvester-chart-view-title">CHART VIEW</small>
            <div className="harvester-chart-view" role="group" aria-label="Chart view">
              <div className="harvester-chart-view-sides">
                {(["long", "short"] as const).map((view) => <button key={view} type="button" className={chartView === view ? "on" : ""} onClick={() => { setChartView(view); setAddPointArmed(false); }}>{view[0].toUpperCase() + view.slice(1)}</button>)}
              </div>
              <div className="harvester-complete-view-control">
                <button type="button" className={chartView === "complete" ? "on" : ""} aria-describedby={chartView === "complete" ? "harvester-complete-view-help" : undefined} onClick={() => { setChartView("complete"); setAddPointArmed(false); }}>Complete</button>
              </div>
            </div>
          </div>
          {chartView === "complete" && <div id="harvester-complete-view-help" className="harvester-complete-view-help" role="note">View the complete position at a selected cashout stage. Dotted line shows the harvested-side cashout path.</div>}
        </div>
        <nav className="harvester-plan-tabs" aria-label="Harvest plans">
          {HARVESTER_PLAN_KINDS.map((kind) => <button
            key={kind}
            type="button"
            disabled={!hasGeneratedPlans}
            className={activeKind === kind ? "on" : ""}
            onClick={() => { setActiveKind(kind); setAddPointArmed(false); }}
          >
            <span>{planLabels[kind]}{plans[kind]?.modified && <i aria-label="Modified" title="Modified" />}</span>
            <small>{kind === "earliestRecovery" ? earliestRecoverySummary : plans[kind]?.summary ?? "Generate a plan"}</small>
          </button>)}
        </nav>
        <div className={`harvester-head-actions${chartView === "complete" ? " has-complete-range" : ""}`}>
          {chartView === "complete" && <div className="harvester-complete-range" aria-label="Complete chart range">
            <label><span>SHORT</span><div className="harvester-unit-input"><input aria-label="Complete chart short bound" inputMode="numeric" value={completeMinMove} onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value)) setCompleteMinMove(Math.max(-99, Math.min(-1, evaluationInputs.direction === "short" ? Math.min(value, evaluationInputs.finalTargetPercent) : value))); }} /><em>%</em></div></label>
            <label><span>LONG</span><div className="harvester-unit-input"><input aria-label="Complete chart long bound" inputMode="numeric" value={completeMaxMove} onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value)) setCompleteMaxMove(Math.min(2000, Math.max(10, evaluationInputs.direction === "long" ? Math.max(value, evaluationInputs.finalTargetPercent) : value))); }} /><em>%</em></div></label>
          </div>}
          <div className="harvester-chart-card-toggles" aria-label="Chart display controls">
            <button type="button" className={showLegendCard ? "on" : ""} aria-pressed={showLegendCard} aria-label="Toggle chart legend" onClick={() => setShowLegendCard((visible) => !visible)}>Legend</button>
            <button type="button" className={`harvester-detailed-toggle${showDetailedTooltip ? " on" : ""}`} aria-pressed={showDetailedTooltip} onClick={() => setShowDetailedTooltip((visible) => !visible)}><span>Detailed</span><span>Tooltip</span></button>
          </div>
          <button type="button" className="harvester-close" onClick={onClose}>Close</button>
        </div>
      </header>

      <div className="harvester-chart-shell">
        <div ref={chartRef} className={`harvester-chart${addPointArmed ? " is-placing" : ""}${showLegendCard ? " has-legend-card" : ""}${chartView === "complete" ? " has-complete-help" : ""}`}>
          <label className="harvester-preview-through"><span>CASHOUT STAGE</span><select aria-label="Cashout stage" value={previewThrough} onChange={(event) => setPreviewThrough(event.target.value as HarvesterPreviewThrough)}><option value="before">Before cashouts</option>{result.points.map((point, index) => <option key={point.id} value={`checkpoint:${index}`}>Checkpoint {index + 1} · {signedMove(point.movePercent)} · {money(point.harvested)}</option>)}<option value="all">All cashouts</option></select></label>
          <ResponsiveContainer>
            <ComposedChart data={chartSeries} margin={{ top: 20, right: 32, bottom: 12, left: 10 }} onClick={addPointArmed ? handleChartClick : undefined}>
              <CartesianGrid stroke="#312f2c" strokeOpacity={0.72} vertical={false} />
              <XAxis dataKey="move" type="number" domain={[chartMinMove, chartMaxMove]} allowDataOverflow tickFormatter={signedMove} stroke="#4f4a45" tick={{ fontSize: 11, fill: "#9b9187" }} label={{ value: `${snapshot.assetName} price change`, position: "insideBottom", offset: -7, fill: "#9b9187", fontSize: 11 }} />
              <YAxis type="number" domain={[yMin, yMax]} tickFormatter={(value) => money(value)} width={70} stroke="#4f4a45" tick={{ fontSize: 10, fill: "#9b9187" }} />
              <Tooltip content={<HarvesterTooltip benchmarkLabel={benchmarkLabels[evaluationInputs.benchmark]} comparisonReferenceLabel={chartComparisonReference === null ? null : benchmarkLabels[chartComparisonReference]} detailed={showDetailedTooltip} previewLabel={previewLabel} showTotalWealth completeView={chartView === "complete"} seriesVisibility={chartSeriesVisibility} />} position={harvestedTooltipPosition} />
              {chartView === "complete" && <ReferenceLine x={0} stroke="#6d655e" strokeWidth={1} strokeDasharray="2 4" />}
              <ReferenceLine x={evaluationInputs.finalTargetPercent} stroke="#d7a276" strokeWidth={1.5} strokeDasharray="5 4" />
              {chartSeriesVisibility.original && <Line dataKey="originalActiveV4" name="Original V4" stroke="#8b8178" strokeOpacity={previewPoints.length ? .42 : .7} strokeDasharray="5 5" strokeWidth={1.4} dot={false} isAnimationActive={false} />}
              {chartSeriesVisibility.benchmark && <Line dataKey="benchmark" name={benchmarkLabels[evaluationInputs.benchmark]} stroke="#c4b17d" strokeOpacity={.72} strokeDasharray="3 4" strokeWidth={1.6} dot={false} connectNulls={false} isAnimationActive={false} />}
              {chartSeriesVisibility.comparisonReference && chartComparisonReference !== null && <Line dataKey="comparisonReference" name={`${benchmarkLabels[chartComparisonReference]} Reference`} stroke="#a687d0" strokeOpacity={.82} strokeDasharray="7 3" strokeWidth={1.8} dot={false} connectNulls={false} isAnimationActive={false} />}
              {chartView === "complete" ? <>
                {chartSeriesVisibility.history && <Line dataKey="historicalActiveV4" name="Harvest Path" stroke="#e18a4a" strokeOpacity={.7} strokeWidth={2.4} strokeDasharray="2 5" strokeLinecap="round" dot={false} connectNulls={false} isAnimationActive={false} />}
                {chartSeriesVisibility.wealth && <Line dataKey="previewedTotalWealth" name="Previewed Total Wealth" stroke="#78b8aa" strokeWidth={2.5} dot={false} connectNulls={false} isAnimationActive={false} />}
                {chartSeriesVisibility.active && <Line dataKey="previewedActiveV4" name="Previewed Active V4" stroke="#e18a4a" strokeWidth={3.4} dot={false} connectNulls={false} activeDot={(props: { cx?: number; cy?: number }) => <HarvestedTooltipAnchor {...props} onPosition={setHarvestedTooltipAnchor} />} isAnimationActive={false} />}
              </> : <>
                {chartSeriesVisibility.wealth && <Line dataKey="totalWealth" name="Total Wealth" stroke="#78b8aa" strokeWidth={2.5} dot={false} isAnimationActive={false} />}
                {chartSeriesVisibility.active && <Line dataKey="harvestedActiveV4" name="Active V4" stroke="#e18a4a" strokeWidth={3.4} dot={false} activeDot={(props: { cx?: number; cy?: number }) => <HarvestedTooltipAnchor {...props} onPosition={setHarvestedTooltipAnchor} />} isAnimationActive={false} />}
              </>}
              {chartSupportsEditing && (chartView === "complete" ? chartSeriesVisibility.history : chartSeriesVisibility.active) && result.points.map((point) => <ReferenceDot
                key={point.id}
                x={point.movePercent}
                y={point.activeAfter}
                shape={({ cx, cy }) => <CheckpointDot
                  cx={cx}
                  cy={cy}
                  selected={point.id === activePlan?.selectedPointId}
                  muted={!previewIncludedIds.has(point.id)}
                  onPointerDown={(event) => dragPoint(point, event)}
                  onClick={(event) => {
                  event.stopPropagation();
                  if (activePlan) setPlans((current) => ({ ...current, [activeKind]: { ...activePlan, selectedPointId: point.id } }));
                }}
                />}
              />)}
            </ComposedChart>
          </ResponsiveContainer>
          {addPointArmed && chartSupportsEditing && <div className="harvester-placement-hint">Click the harvested side to place one checkpoint</div>}
          {activeNumericAdjustment && <div className="harvester-touch-number-editor" role="dialog" aria-label={`Adjust ${activeNumericAdjustment.label}`}>
            <div className="harvester-touch-number-steps negative">
              {[...activeNumericAdjustment.steps].reverse().map((step) => <button key={step} type="button" onPointerDown={(event) => event.preventDefault()} onClick={() => adjustNumericValue(-step)}>−{step}</button>)}
            </div>
            <button type="button" className="harvester-touch-number-value" onClick={() => setActiveNumericAdjustmentId(null)}>
              <small>{activeNumericAdjustment.label}</small><b>{activeNumericAdjustment.value}%</b><span>Done</span>
            </button>
            <div className="harvester-touch-number-steps positive">
              {activeNumericAdjustment.steps.map((step) => <button key={step} type="button" onPointerDown={(event) => event.preventDefault()} onClick={() => adjustNumericValue(step)}>+{step}</button>)}
            </div>
          </div>}
          {showLegendCard && <aside className="harvester-legend" aria-label="Chart legend">
            <small>CHART LEGEND</small>
            <HarvesterLegendToggle label="Original V4" seriesClass="original" visible={chartSeriesVisibility.original} onToggle={() => toggleChartSeriesVisibility("original")} />
            <HarvesterLegendToggle label={chartView === "complete" ? "Previewed Active V4" : "Active V4"} seriesClass="active" visible={chartSeriesVisibility.active} onToggle={() => toggleChartSeriesVisibility("active")} />
            <HarvesterLegendToggle label={chartView === "complete" ? "Previewed Total Wealth" : "Total Wealth"} seriesClass="wealth" visible={chartSeriesVisibility.wealth} onToggle={() => toggleChartSeriesVisibility("wealth")} />
            {chartView === "complete" && <HarvesterLegendToggle label="Harvest path" seriesClass="history" visible={chartSeriesVisibility.history} onToggle={() => toggleChartSeriesVisibility("history")} />}
            <HarvesterLegendToggle label={`Benchmark - ${benchmarkLabels[evaluationInputs.benchmark]}`} seriesClass="benchmark" visible={chartSeriesVisibility.benchmark} onToggle={() => toggleChartSeriesVisibility("benchmark")} />
            {chartComparisonReference !== null && <HarvesterLegendToggle label={`Reference - ${benchmarkLabels[chartComparisonReference]}`} seriesClass="comparison-reference" visible={chartSeriesVisibility.comparisonReference} onToggle={() => toggleChartSeriesVisibility("comparisonReference")} />}
          </aside>}
        </div>
        {isShortCashbackUnderReview(snapshot.config.shortMode) && (
          <CalculationUnderReviewWarning className="harvester-product-review-warning" />
        )}
      </div>

      <div className="harvester-bottom">
        <div className="harvester-control-row">
          <div className="harvester-control-plan-title">
            <div><small>HARVEST PLAN</small><strong>{planLabels[activeKind]}</strong></div>
            <span>{activeKind === "earliestRecovery" && snapshot.comparisonMode === "perp"
              ? "Recover initial margin as early as possible while preserving final benchmark parity."
              : planDescriptions[activeKind]}</span>
          </div>
          <div className="harvester-primary-controls">
            <label className="harvester-compact-control"><span>FINAL TARGET</span><div className="harvester-unit-input"><input aria-label="Final target" inputMode="decimal" value={finalTargetDraft} onChange={(event) => updateFinalTargetDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} {...numericAdjustmentTrigger("final-target", commitFinalTarget)} /><em>%</em></div></label>
            <label><span>BENCHMARK</span><select value={sharedInputs.benchmark} onChange={(event) => setShared("benchmark", event.target.value as HarvesterBenchmark)}>{availableBenchmarks.map((value) => <option key={value} value={value}>{benchmarkLabels[value]}</option>)}</select></label>
            <label><span>INTERVAL</span><div className="harvester-combo opens-up"><div className="harvester-unit-input"><input aria-label="Interval" inputMode="numeric" value={intervalDraft} onChange={(event) => updateIntervalDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} {...numericAdjustmentTrigger("interval", commitInterval)} /><em>%</em></div><button type="button" className="harvester-selector-button" aria-label="Choose interval" aria-expanded={openSelector === "interval"} onClick={() => setOpenSelector((current) => current === "interval" ? null : "interval")} />{openSelector === "interval" && <div className="harvester-selector-menu">{intervalOptions.map((value) => <button key={value} type="button" onClick={() => { setShared("intervalPercent", value); setOpenSelector(null); }}>{value}%</button>)}</div>}</div></label>
            <label><span>CHECKPOINTS</span><div className="harvester-combo opens-up"><div className="harvester-unit-input"><input aria-label="Checkpoints" inputMode="numeric" value={checkpointCountDraft} disabled={availableCheckpointCounts.length === 0} onChange={(event) => updateCheckpointCountDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} {...numericAdjustmentTrigger("checkpoints", commitCheckpointCount)} /></div><button type="button" className="harvester-selector-button" disabled={availableCheckpointCounts.length === 0} aria-label="Choose checkpoints" aria-expanded={openSelector === "checkpoints"} onClick={() => setOpenSelector((current) => current === "checkpoints" ? null : "checkpoints")} />{openSelector === "checkpoints" && <div className="harvester-selector-menu">{availableCheckpointCounts.map((value) => <button key={value} type="button" onClick={() => { setShared("pointCount", value); setOpenSelector(null); }}>{value}</button>)}</div>}</div></label>
            <label className={(activeKind === "equalRate" || activeKind === "equalCash") ? "is-disabled" : ""}><span>HARVEST RATE</span><div className="harvester-combo opens-up"><div className="harvester-unit-input"><input aria-label="Harvest rate" inputMode="decimal" value={harvestRateDraft} disabled={activeKind === "equalRate" || activeKind === "equalCash"} onChange={(event) => updateHarvestRateDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} {...numericAdjustmentTrigger("harvest-rate", commitHarvestRate)} /><em>%</em></div><button type="button" className="harvester-selector-button" disabled={activeKind === "equalRate" || activeKind === "equalCash"} aria-label="Choose harvest rate" aria-expanded={openSelector === "harvestRate"} onClick={() => setOpenSelector((current) => current === "harvestRate" ? null : "harvestRate")} />{openSelector === "harvestRate" && <div className="harvester-selector-menu">{DEFAULT_HARVEST_PRESETS.map((value) => <button key={value} type="button" onClick={() => { setLiveHarvestRate(value); setOpenSelector(null); }}>{value}%</button>)}</div>}</div></label>
            <label><span>FIRST CHECKPOINT</span><select aria-label="First checkpoint" value={sharedInputs.firstCheckpointPercent ?? "auto"} onChange={(event) => setLiveFirstCheckpoint(event.target.value === "auto" ? null : Number(event.target.value))}><option value="auto">Auto</option>{availableFirstCheckpoints.map((value) => <option key={value} value={value}>{value}%</option>)}</select></label>
            <fieldset className="harvester-cashback-toggle" aria-label="Include initial cashback in capital recovery"><div className="harvester-cashback-title"><span>INCLUDE INITIAL CASHBACK</span><span>IN CAPITAL RECOVERY</span></div><button type="button" className={accountInitialCashback ? "on" : ""} onClick={() => { if (!accountInitialCashback) { recordUndoState(); setAccountInitialCashback(true); } }}>On</button><button type="button" className={!accountInitialCashback ? "on" : ""} onClick={() => { if (accountInitialCashback) { recordUndoState(); setAccountInitialCashback(false); } }}>Off</button></fieldset>
            <fieldset className="harvester-drag-mode"><legend>CHECKPOINT DRAG MODE</legend>{(["vertical", "horizontal", "both"] as const).map((mode) => <button key={mode} type="button" className={dragMode === mode ? "on" : ""} onClick={() => setDragMode(mode)}>{mode[0].toUpperCase() + mode.slice(1)}</button>)}</fieldset>
          </div>
          <div className="harvester-side-controls">
            <fieldset className="harvester-harvest-direction"><legend>HARVEST DIRECTION</legend>{(["long", "short"] as const).map((direction) => <button key={direction} type="button" className={activeDirection === direction ? "on" : ""} onClick={() => setActiveDirection(direction)}>{direction === "long" ? "Long" : "Short"}</button>)}</fieldset>
            <fieldset className="harvester-withdrawal-source"><legend>WITHDRAWAL SOURCE</legend>{(["proportional", "longFirst", "shortFirst"] as const).map((source) => <button key={source} type="button" className={sharedInputs.withdrawalSource === source ? "on" : ""} onClick={() => setShared("withdrawalSource", source as HarvestWithdrawalSource)}>{source === "proportional" ? "Proportional" : source === "longFirst" ? "Long first" : "Short first"}</button>)}</fieldset>
          </div>
        </div>

        <div className="harvester-output-row">
          <section className="secured-capital" />
          <section className="harvester-final-metrics">
            <div className="harvester-analysis-heading">
              <small>HARVESTING ANALYSIS</small>
              <label className="harvester-analysis-point"><span>ANALYSIS POINT</span><div className="harvester-unit-input"><input aria-label="Harvesting analysis point" inputMode="decimal" value={analysisMoveDraft} onChange={(event) => setAnalysisMoveDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} {...numericAdjustmentTrigger("analysis-move", commitAnalysisMove)} /><em>%</em></div></label>
            </div>
            <div className="harvester-final-summary-card">
              <section className="harvester-analysis-section harvester-analysis-wealth">
                <span className="harvested">Harvested Cash <b>{money(analysisState.cumulativeHarvested)}</b></span>
                <span className="active">Remaining Active V4 at {signedMove(analysisMove)} <b>{money(analysisState.activeV4)}</b></span>
                <div className="harvester-analysis-leg-breakdown">
                  <span>Short component <b>{money(analysisState.remainingShort)}</b></span>
                  <span>Long component <b>{money(analysisState.remainingLong)}</b></span>
                </div>
                <span className="cashback">{analysisCashbackLabel} <b>{money(analysisState.external)}</b></span>
                <strong className="harvester-total-wealth">Total Wealth at {signedMove(analysisMove)} <b>{money(analysisState.totalWealth)}</b></strong>
              </section>
              <section className="harvester-analysis-section harvester-analysis-reference">
                <small>REFERENCE &amp; RECOVERY</small>
                <div className="harvester-reference-metric benchmark"><span>{evaluationInputs.benchmark === "spot" ? "Spot hold" : benchmarkLabels[evaluationInputs.benchmark]} value at {signedMove(analysisMove)}</span><b>{analysisBenchmark.value === null ? "Unavailable" : money(analysisBenchmark.value)}</b></div>
                <div className="harvester-reference-metric v4-delta"><span>Remaining Active V4 vs benchmark at {signedMove(analysisMove)}</span><b className={analysisSurplus !== null && analysisSurplus < 0 ? "negative" : ""}>{analysisSurplus !== null && analysisSurplus !== 0 ? <><small className="harvester-surplus-label">{analysisSurplus > 0 ? "Surplus" : "Shortfall"}</small> {money(Math.abs(analysisSurplus))}</> : finalSurplusLabel(analysisSurplus)}</b></div>
                <div className="harvester-reference-metric recovery-summary"><div><span>{recoveryTargetLabel} coverage</span><b>{money(analysisCoverage)} / {money(analysisRecoveryTarget)}</b></div><small className={analysisCovered ? "covered" : "negative"}>{analysisCovered ? (durableRecoveryReached ? coverageSummary(true, result.recovery.durablyCoveredAtMovePercent, evaluationInputs.finalTargetPercent) : "Covered at this point") : <>Short by {money(Math.abs(analysisCoverageGap))}</>}</small></div>
              </section>
            </div>
          </section>
          <section className="harvester-plan-actions" aria-label="Harvest plan actions">
            <button type="button" className="placeholder" disabled aria-label="Future action" title="Future action placeholder">↑</button>
            <button type="button" disabled={undoCount === 0} aria-label="Undo last action" title="Undo last action" onClick={undoLastAction}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 14-5-5 5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H13" /></svg></button>
            <button type="button" className={addPointArmed ? "armed" : ""} disabled={activeKind !== "user" || !activePlan || !chartSupportsEditing} aria-label="Add point" title={chartSupportsEditing ? "Add point" : "Switch to the harvested side or Complete view to edit checkpoints"} onClick={() => setAddPointArmed((armed) => !armed)}>+</button>
            <button type="button" className="danger" disabled={activeKind !== "user" || !selectedPoint || !activePlan} aria-label="Delete selected point" title="Delete selected point" onClick={() => selectedPoint && updateActivePoints(deleteHarvestPoint(snapshot, evaluationInputs.benchmark, evaluationInputs.finalTargetPercent, points, selectedPoint.id, evaluationOptions), null)}>−</button>
            <button type="button" className="reset" disabled={!activePlan?.modified} aria-label="Reset harvest plan" title="Reset harvest plan" onClick={() => { if (!activePlan?.modified) return; recordUndoState(); setPlans((current) => ({ ...current, [activeKind]: resetHarvesterPlanState(activePlan) })); }}>↺</button>
          </section>
          <section className="harvester-ledger harvester-plan-table">
            <div className="harvester-ledger-title"><small>CHECKPOINT DATA</small><span>View and fine-tune each checkpoint.</span></div>
            <div className="harvester-ledger-scroll">
              <table>
                <colgroup><col className="checkpoint" />{hasKnownAssetPrice && <col className="asset-price" />}<col className="harvest-rate" /><col className="withdrawn" /><col className="running-total" /><col className="v4-after" /></colgroup>
                <thead><tr><th className="checkpoint-heading">Checkpoint</th>{hasKnownAssetPrice && <th className="asset-price-heading">{snapshot.assetName.trim() || "Asset"} Price</th>}<th className="harvest-heading">Harvest %</th><th className="money-heading">Withdrawn</th><th className="money-heading">Running Total</th><th className="money-heading">V4 After</th></tr></thead>
                <tbody>{result.points.length === 0 ? <tr><td colSpan={hasKnownAssetPrice ? 6 : 5}>Select how many checkpoints you would like to regenerate the plan.</td></tr> : result.points.map((entry, index) => {
                  const checkpointFieldId = `checkpoint:${entry.id}`;
                  const harvestFieldId = `harvest:${entry.id}`;
                  const checkpointBounds = horizontalBoundsForPoint(result.points, index, evaluationInputs.finalTargetPercent);
                  const displayedHarvestRate = activeKind === "equalRate" && !activePlan?.modified && activePlan?.commonHarvestPercent != null
                    ? activePlan.commonHarvestPercent
                    : Number(entry.harvestPercent.toFixed(2));
                  return <tr key={entry.id} className={entry.id === activePlan?.selectedPointId ? "selected" : ""} onClick={() => activePlan && setPlans((current) => ({ ...current, [activeKind]: { ...activePlan, selectedPointId: entry.id } }))}>
                    <td className="checkpoint-input-cell"><div className="harvester-table-input"><input aria-label={`${planLabels[activeKind]} checkpoint ${index + 1}`} inputMode="numeric" value={pointFieldDrafts[checkpointFieldId] ?? (entry.movePercent === 0 ? "—" : entry.movePercent)} onChange={(event) => {
                      const draft = event.target.value;
                      setPointFieldDrafts((current) => ({ ...current, [checkpointFieldId]: draft }));
                      const entered = parseNumericDraft(draft, { min: checkpointBounds.min, max: checkpointBounds.max, integer: true });
                      if (entered !== null) updateActivePoints(editHarvestPoint(snapshot, evaluationInputs.benchmark, evaluationInputs.finalTargetPercent, points, entry.id, { movePercent: entered }, "horizontal", evaluationOptions), entry.id, `checkpoint:${activeKind}:${entry.id}`);
                    }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} {...numericAdjustmentTrigger(checkpointFieldId, () => finishPointFieldDraft(checkpointFieldId), () => beginPointFieldDraft(checkpointFieldId, entry.movePercent))} />{(pointFieldDrafts[checkpointFieldId] !== undefined || entry.movePercent !== 0) && <em>%</em>}</div></td>
                    {hasKnownAssetPrice && <td className="asset-price-value">{assetPriceMoney((snapshot.spotAssetPrice ?? 0) * (1 + entry.movePercent / 100))}</td>}
                    <td className="harvest-input-cell"><div className="harvester-table-input"><input aria-label={`${planLabels[activeKind]} harvest percent ${index + 1}`} inputMode="decimal" value={pointFieldDrafts[harvestFieldId] ?? (displayedHarvestRate === 0 ? "—" : displayedHarvestRate)} onChange={(event) => {
                      const draft = event.target.value;
                      setPointFieldDrafts((current) => ({ ...current, [harvestFieldId]: draft }));
                      const entered = parseNumericDraft(draft, { min: 0, max: 1000 });
                      if (entered !== null) updateActivePoints(editHarvestPointPercent(snapshot, evaluationInputs.benchmark, evaluationInputs.finalTargetPercent, points, entry.id, entered, evaluationOptions), entry.id, `harvest:${activeKind}:${entry.id}`);
                    }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} {...numericAdjustmentTrigger(harvestFieldId, () => finishPointFieldDraft(harvestFieldId), () => beginPointFieldDraft(harvestFieldId, displayedHarvestRate))} />{(pointFieldDrafts[harvestFieldId] !== undefined || displayedHarvestRate !== 0) && <em>%</em>}</div></td>
                    <td className="withdrawn-value"><b>{money(entry.harvested)}</b></td>
                    <td className="running-total-value">{money(entry.cumulativeHarvested)}</td>
                    <td className="v4-after-value">{money(entry.activeAfter)}</td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </section>
  </div>, document.body);
}
