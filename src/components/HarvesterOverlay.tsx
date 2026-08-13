import { useEffect, useMemo, useRef, useState, type FocusEvent as ReactFocusEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
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
  createHarvesterExportPayload,
  deleteHarvestPoint,
  editHarvestPoint,
  editHarvestPointPercent,
  evaluateHarvestPlan,
  insertHarvestPoint,
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
  type HarvesterExportPayload,
  type HarvesterGenerationInputs,
  type HarvesterPlanKind,
  type HarvesterPlans,
  type HarvesterSnapshot,
} from "../model/harvester";

const money = (value: number) => new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
}).format(value);
const signedMove = (value: number) => `${value >= 0 ? "+" : ""}${Math.round(value)}%`;
const benchmarkLabels: Record<HarvesterBenchmark, string> = { spot: "Spot", lending: "Lending", perp: "Perp" };
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
const recoverySummary = (recovered: boolean, movePercent: number | null) => recovered
  ? movePercent === 0 ? "Recovered at entry" : `Recovered at ${signedMove(movePercent ?? 0)}`
  : "Not recovered before target";
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
  onExport?: (payload: HarvesterExportPayload) => void;
}

const HARVESTER_UNDO_LIMIT = 50;

interface HarvesterUndoState {
  plans: HarvesterPlans;
  sharedInputs: HarvesterGenerationInputs;
  accountInitialCashback: boolean;
}

const cloneUndoState = (state: HarvesterUndoState): HarvesterUndoState => structuredClone(state);

function HarvesterTooltip({ active, payload, label }: { active?: boolean; payload?: any[]; label?: number }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return <div className="harvester-chart-tooltip">
    <b>{signedMove(label ?? row.move)}</b>
    <span className="original">Original active V4 <strong>{money(row.originalActiveV4)}</strong></span>
    <span className="active">Harvested active V4 <strong>{money(row.harvestedActiveV4)}</strong></span>
    <span className="wealth">Total wealth <strong>{money(row.totalWealth)}</strong></span>
    <span className="benchmark">Benchmark <strong>{row.benchmark === null ? "Unavailable" : money(row.benchmark)}</strong></span>
  </div>;
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
  onPointerDown,
  onClick,
}: {
  cx?: number;
  cy?: number;
  selected: boolean;
  onPointerDown: (event: ReactPointerEvent<SVGCircleElement>) => void;
  onClick: (event: ReactMouseEvent<SVGCircleElement>) => void;
}) {
  if (typeof cx !== "number" || typeof cy !== "number") return null;
  return <g className="harvester-checkpoint-dot">
    <circle cx={cx} cy={cy} r={selected ? 7 : 5.5} fill={selected ? "#f5b57f" : "#e18a4a"} stroke="#151616" strokeWidth={2} pointerEvents="none" />
    <circle cx={cx} cy={cy} r={16} fill="transparent" stroke="transparent" style={{ touchAction: "none" }} onPointerDown={onPointerDown} onClick={onClick} />
  </g>;
}

export function HarvesterOverlay({ snapshot, onClose, onExport }: HarvesterOverlayProps) {
  const availableBenchmarks = useMemo(() => availableHarvesterBenchmarks(snapshot), [snapshot]);
  const launchedBenchmark = benchmarkForComparisonMode(snapshot.comparisonMode);
  const initialBenchmark = availableBenchmarks.includes(launchedBenchmark) ? launchedBenchmark : "spot";
  const [sharedInputs, setSharedInputs] = useState<HarvesterGenerationInputs>({
    benchmark: initialBenchmark,
    finalTargetPercent: 500,
    intervalPercent: 100,
    firstCheckpointPercent: null,
    pointCount: 4,
    defaultHarvestPercent: 100,
  });
  const [plans, setPlans] = useState<HarvesterPlans>(createEmptyHarvesterPlans);
  const [activeKind, setActiveKind] = useState<HarvesterPlanKind>("user");
  const [accountInitialCashback, setAccountInitialCashback] = useState(false);
  const [dragMode, setDragMode] = useState<HarvesterDragMode>("vertical");
  const [activeNumericAdjustmentId, setActiveNumericAdjustmentId] = useState<string | null>(null);
  const [addPointArmed, setAddPointArmed] = useState(false);
  const [exportReady, setExportReady] = useState(false);
  const [harvestedTooltipAnchor, setHarvestedTooltipAnchor] = useState<{ x: number; y: number } | null>(null);
  const [showLegendCard, setShowLegendCard] = useState(true);
  const [intervalDraft, setIntervalDraft] = useState("100");
  const [firstCheckpointDraft, setFirstCheckpointDraft] = useState("");
  const [harvestRateDraft, setHarvestRateDraft] = useState("100");
  const [openSelector, setOpenSelector] = useState<"interval" | "firstCheckpoint" | "harvestRate" | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const undoHistoryRef = useRef<HarvesterUndoState[]>([]);
  const undoCoalesceKeyRef = useRef<string | null>(null);
  const undoCoalesceTimerRef = useRef<number | null>(null);
  const [undoCount, setUndoCount] = useState(0);

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
  const storedPoints = activePlan?.points ?? [];
  const points = useMemo(() => activePlan && activeKind === "earliestRecovery"
    ? resolveEarliestRecoveryPoints(snapshot, activePlan.generationInputs, storedPoints, accountInitialCashback)
    : storedPoints,
  [snapshot, activePlan, activeKind, storedPoints, accountInitialCashback]);
  const result = useMemo(
    () => evaluateHarvestPlan(snapshot, evaluationInputs.benchmark, evaluationInputs.finalTargetPercent, points, accountInitialCashback),
    [snapshot, evaluationInputs, points, accountInitialCashback],
  );
  const analysisCashbackLabel = useMemo(() => {
    if (snapshot.config.cashbackMode !== "spot") return "Initial Cashback (Cash)";
    const assetName = snapshot.assetName.trim();
    const assetPrice = snapshot.spotAssetPrice;
    const initialCashbackValue = originalExternalValue(snapshot, 1);
    const spotAmount = assetPrice !== null && Number.isFinite(assetPrice) && assetPrice > 0
      ? initialCashbackValue / assetPrice
      : null;
    const spotDescription = spotAmount !== null && assetName
      ? `Spot - ${spotAmount.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${assetName}`
      : "Spot";
    return `Initial Cashback (${spotDescription})`;
  }, [snapshot]);
  const earliestRecoverySummary = useMemo(() => {
    const plan = plans.earliestRecovery;
    if (!plan) return "Generate a plan";
    const resolved = resolveEarliestRecoveryPoints(snapshot, plan.generationInputs, plan.points, accountInitialCashback);
    const recovery = evaluateHarvestPlan(snapshot, plan.generationInputs.benchmark, plan.generationInputs.finalTargetPercent, resolved, accountInitialCashback).recovery;
    return recoverySummary(recovery.recovered, recovery.recoveredAtMovePercent);
  }, [snapshot, plans.earliestRecovery, accountInitialCashback]);
  const chartSeries = useMemo(
    () => buildHarvesterChartSeries(snapshot, evaluationInputs.benchmark, evaluationInputs.finalTargetPercent, points),
    [snapshot, evaluationInputs, points],
  );
  const selectedPoint = result.points.find((point) => point.id === activePlan?.selectedPointId) ?? null;
  const yValues = chartSeries.flatMap((entry) => [entry.originalActiveV4, entry.harvestedActiveV4, entry.totalWealth, entry.benchmark ?? 0]);
  const rawYMax = Math.max(snapshot.config.deposit, ...yValues);
  const yStep = rawYMax <= 100_000 ? 25_000 : rawYMax <= 500_000 ? 100_000 : 250_000;
  const yMax = Math.max(yStep, Math.ceil(rawYMax / yStep) * yStep);
  const yMin = Math.min(0, ...yValues);
  const harvestedTooltipPosition = useMemo(() => {
    if (!harvestedTooltipAnchor) return undefined;
    const tooltipWidth = 190;
    const tooltipHeight = 106;
    const chartWidth = chartRef.current?.clientWidth ?? 0;
    const rightX = harvestedTooltipAnchor.x + 18;
    const x = chartWidth && rightX + tooltipWidth > chartWidth
      ? Math.max(0, harvestedTooltipAnchor.x - tooltipWidth - 18)
      : rightX;
    const aboveY = harvestedTooltipAnchor.y - 150 - tooltipHeight;
    return { x, y: aboveY >= 0 ? aboveY : harvestedTooltipAnchor.y + 150 };
  }, [harvestedTooltipAnchor]);
  const activeHarvestRate = activePlan?.harvestRatePercent ?? sharedInputs.defaultHarvestPercent;

  useEffect(() => {
    setIntervalDraft(String(sharedInputs.intervalPercent));
  }, [sharedInputs.intervalPercent]);

  useEffect(() => {
    setFirstCheckpointDraft(sharedInputs.firstCheckpointPercent?.toString() ?? "");
  }, [sharedInputs.firstCheckpointPercent]);

  useEffect(() => {
    setHarvestRateDraft(String(activeHarvestRate));
  }, [activeHarvestRate]);

  useEffect(() => {
    setPlans((current) => regenerateHarvesterPlansPreservingEdits(current, snapshot, sharedInputs));
  }, [snapshot, sharedInputs.benchmark, sharedInputs.finalTargetPercent, sharedInputs.intervalPercent, sharedInputs.firstCheckpointPercent, sharedInputs.pointCount]);

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
    if (coalesceKey && undoCoalesceKeyRef.current === coalesceKey) return;
    undoHistoryRef.current.unshift(cloneUndoState({ plans, sharedInputs, accountInitialCashback }));
    undoHistoryRef.current.length = Math.min(undoHistoryRef.current.length, HARVESTER_UNDO_LIMIT);
    setUndoCount(undoHistoryRef.current.length);
    if (!coalesceKey) return;
    undoCoalesceKeyRef.current = coalesceKey;
    if (undoCoalesceTimerRef.current !== null) window.clearTimeout(undoCoalesceTimerRef.current);
    undoCoalesceTimerRef.current = window.setTimeout(() => {
      undoCoalesceKeyRef.current = null;
      undoCoalesceTimerRef.current = null;
    }, 700);
  };

  const undoLastAction = () => {
    const previous = undoHistoryRef.current.shift();
    if (!previous) return;
    if (undoCoalesceTimerRef.current !== null) window.clearTimeout(undoCoalesceTimerRef.current);
    undoCoalesceKeyRef.current = null;
    undoCoalesceTimerRef.current = null;
    setPlans(previous.plans);
    setSharedInputs(previous.sharedInputs);
    setAccountInitialCashback(previous.accountInitialCashback);
    setAddPointArmed(false);
    setUndoCount(undoHistoryRef.current.length);
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

  const commitInterval = () => {
    const entered = Number(intervalDraft);
    if (!Number.isFinite(entered)) {
      setIntervalDraft(String(sharedInputs.intervalPercent));
      return;
    }
    setShared("intervalPercent", Math.max(10, Math.min(100, Math.round(entered))));
  };

  const commitHarvestRate = () => {
    const entered = Number(harvestRateDraft);
    if (!Number.isFinite(entered)) {
      setHarvestRateDraft(String(activeHarvestRate));
      return;
    }
    setLiveHarvestRate(Math.max(0, Math.round(entered * 100) / 100));
  };

  const commitFirstCheckpoint = () => {
    if (firstCheckpointDraft.trim() === "") {
      setLiveFirstCheckpoint(null);
      return;
    }
    const entered = Number(firstCheckpointDraft);
    if (!Number.isFinite(entered) || availableFirstCheckpoints.length === 0) {
      setFirstCheckpointDraft(sharedInputs.firstCheckpointPercent?.toString() ?? "");
      return;
    }
    const nearest = availableFirstCheckpoints.reduce((best, move) =>
      Math.abs(move - entered) < Math.abs(best - entered) ? move : best,
    );
    setLiveFirstCheckpoint(nearest);
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

  const numericAdjustmentTrigger = (id: string, onBlur?: () => void) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLInputElement>) => {
      if (event.pointerType !== "touch") return;
      event.preventDefault();
      event.stopPropagation();
      setActiveNumericAdjustmentId(id);
    },
    onFocus: () => setActiveNumericAdjustmentId(id),
    onBlur: (_event: ReactFocusEvent<HTMLInputElement>) => {
      onBlur?.();
      window.setTimeout(() => {
        setActiveNumericAdjustmentId((current) => current === id ? null : current);
      }, 0);
    },
  });

  const resolveNumericAdjustment = (id: string): NumericAdjustmentControl | null => {
    if (id === "final-target") return {
      id, label: "Final target", value: sharedInputs.finalTargetPercent, min: 10, max: 2000, steps: [1, 5, 10],
      onChange: (value) => setShared("finalTargetPercent", value),
    };
    if (id === "interval") return {
      id, label: "Interval", value: sharedInputs.intervalPercent, min: 10, max: 100, steps: [1, 5, 10],
      onChange: (value) => setShared("intervalPercent", value),
    };
    if (id === "harvest-rate") return {
      id, label: "Harvest rate", value: Math.round(activeHarvestRate), min: 0, max: 1000, steps: [1, 5, 10],
      onChange: setLiveHarvestRate,
    };
    const match = /^(checkpoint|harvest):(.+)$/.exec(id);
    if (!match || !activePlan) return null;
    const [, kind, pointId] = match;
    const entry = result.points.find((candidate) => candidate.id === pointId);
    const index = result.points.findIndex((candidate) => candidate.id === pointId);
    if (!entry || index < 0) return null;
    if (kind === "checkpoint") return {
      id, label: `Checkpoint ${index + 1}`, value: entry.movePercent, min: 0, max: evaluationInputs.finalTargetPercent, steps: [1, 5, 10],
      onChange: (value) => updateActivePoints(
        editHarvestPoint(snapshot, evaluationInputs.benchmark, evaluationInputs.finalTargetPercent, points, entry.id, { movePercent: value }, "horizontal"),
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
        editHarvestPointPercent(snapshot, evaluationInputs.benchmark, evaluationInputs.finalTargetPercent, points, entry.id, value),
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
    if (!activePlan || !addPointArmed || typeof state?.activeLabel !== "number") return;
    const next = insertHarvestPoint(snapshot, evaluationInputs.benchmark, evaluationInputs.finalTargetPercent, points, state.activeLabel);
    const inserted = next.find((candidate) => !points.some((point) => point.id === candidate.id));
    updateActivePoints(next, inserted?.id ?? activePlan.selectedPointId);
    setAddPointArmed(false);
  };

  const dragPoint = (point: HarvestPointResult, event: ReactPointerEvent<SVGCircleElement>) => {
    if (!activePlan) return;
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
      const movePercent = Math.max(0, Math.min(evaluationInputs.finalTargetPercent, ((moveEvent.clientX - plotLeft) / Math.max(1, plotRight - plotLeft)) * evaluationInputs.finalTargetPercent));
      const activeAfter = yMax - ((moveEvent.clientY - plotTop) / Math.max(1, plotBottom - plotTop)) * (yMax - yMin);
      if (!recordedDrag) {
        recordUndoState();
        recordedDrag = true;
      }
      setPlans((current) => {
        const currentPlan = current[activeKind];
        if (!currentPlan) return current;
        const next = editHarvestPoint(snapshot, evaluationInputs.benchmark, evaluationInputs.finalTargetPercent, currentPlan.points, point.id, { movePercent, activeAfter }, dragMode);
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

  const exportPayload = () => {
    const payload = createHarvesterExportPayload(snapshot, evaluationInputs.benchmark, evaluationInputs.finalTargetPercent, points, accountInitialCashback);
    onExport?.(payload);
    window.dispatchEvent(new CustomEvent("harvester:export", { detail: payload }));
    setExportReady(true);
    window.setTimeout(() => setExportReady(false), 1800);
  };

  return <div className="harvester-backdrop" role="presentation">
    <section ref={dialogRef} className="harvester-workspace" role="dialog" aria-modal="true" aria-labelledby="harvester-title" tabIndex={-1}>
      <header className="harvester-head">
        <div className="harvester-title-area">
          <div>
            <small>SCENARIO WORKSPACE</small>
            <h2 id="harvester-title">Harvester</h2>
          </div>
          <div className="harvester-chart-card-toggles" aria-label="Chart card visibility">
            <button type="button" className={showLegendCard ? "on" : ""} aria-pressed={showLegendCard} aria-label="Toggle chart legend" title="Toggle chart legend" onClick={() => setShowLegendCard((visible) => !visible)}>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h3M7 4h7M2 8h3M7 8h7M2 12h3M7 12h7" /></svg>
            </button>
          </div>
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
        <div className="harvester-head-actions">
          <button type="button" className="harvester-export" onClick={exportPayload}>{exportReady ? "Payload ready" : "Export Chart"}</button>
          <button type="button" className="harvester-close" onClick={onClose}>Close</button>
        </div>
      </header>

      <div className="harvester-chart-shell">
        <div ref={chartRef} className={`harvester-chart${addPointArmed ? " is-placing" : ""}${showLegendCard ? " has-legend-card" : ""}`}>
          <ResponsiveContainer>
            <ComposedChart data={chartSeries} margin={{ top: 20, right: 32, bottom: 12, left: 10 }} onClick={addPointArmed ? handleChartClick : undefined}>
              <CartesianGrid stroke="#312f2c" strokeOpacity={0.72} vertical={false} />
              <XAxis dataKey="move" type="number" domain={[0, evaluationInputs.finalTargetPercent]} tickFormatter={signedMove} stroke="#4f4a45" tick={{ fontSize: 11, fill: "#9b9187" }} label={{ value: `${snapshot.assetName} price change`, position: "insideBottom", offset: -7, fill: "#9b9187", fontSize: 11 }} />
              <YAxis type="number" domain={[yMin, yMax]} tickFormatter={(value) => money(value)} width={70} stroke="#4f4a45" tick={{ fontSize: 10, fill: "#9b9187" }} />
              <Tooltip content={<HarvesterTooltip />} position={harvestedTooltipPosition} />
              <ReferenceLine x={evaluationInputs.finalTargetPercent} stroke="#d7a276" strokeWidth={1.5} strokeDasharray="5 4" />
              <Line dataKey="originalActiveV4" name="Original Active V4" stroke="#8b8178" strokeOpacity={points.length ? .42 : .7} strokeDasharray="5 5" strokeWidth={1.4} dot={false} isAnimationActive={false} />
              <Line dataKey="benchmark" name={benchmarkLabels[evaluationInputs.benchmark]} stroke="#c4b17d" strokeOpacity={.72} strokeDasharray="3 4" strokeWidth={1.6} dot={false} connectNulls={false} isAnimationActive={false} />
              <Line dataKey="totalWealth" name="Total Wealth" stroke="#78b8aa" strokeWidth={2.5} dot={false} isAnimationActive={false} />
              <Line dataKey="harvestedActiveV4" name="Harvested Active V4" stroke="#e18a4a" strokeWidth={3.4} dot={false} activeDot={(props: { cx?: number; cy?: number }) => <HarvestedTooltipAnchor {...props} onPosition={setHarvestedTooltipAnchor} />} isAnimationActive={false} />
              {result.points.map((point) => <ReferenceDot
                key={point.id}
                x={point.movePercent}
                y={point.activeAfter}
                shape={({ cx, cy }) => <CheckpointDot
                  cx={cx}
                  cy={cy}
                  selected={point.id === activePlan?.selectedPointId}
                  onPointerDown={(event) => dragPoint(point, event)}
                  onClick={(event) => {
                  event.stopPropagation();
                  if (activePlan) setPlans((current) => ({ ...current, [activeKind]: { ...activePlan, selectedPointId: point.id } }));
                }}
                />}
              />)}
            </ComposedChart>
          </ResponsiveContainer>
          {addPointArmed && <div className="harvester-placement-hint">Click the chart to place one checkpoint</div>}
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
            <span className="original">Original Active V4</span>
            <span className="active">Harvested Active V4</span>
            <span className="wealth">Total Wealth</span>
            <span className="benchmark">Benchmark - {benchmarkLabels[evaluationInputs.benchmark]}</span>
          </aside>}
        </div>
      </div>

      <div className="harvester-bottom">
        <div className="harvester-control-row">
          <div className="harvester-control-plan-title">
            <div><small>HARVEST PLAN</small><strong>{planLabels[activeKind]}</strong></div>
            <span>{planDescriptions[activeKind]}</span>
          </div>
          <label><span>FINAL TARGET</span><div className="harvester-unit-input"><input type="number" min={10} max={2000} step={5} value={sharedInputs.finalTargetPercent} onChange={(event) => setShared("finalTargetPercent", Math.min(2000, Math.max(10, Number(event.target.value))))} {...numericAdjustmentTrigger("final-target")} /><em>%</em></div></label>
          <label><span>BENCHMARK</span><select value={sharedInputs.benchmark} onChange={(event) => setShared("benchmark", event.target.value as HarvesterBenchmark)}>{availableBenchmarks.map((value) => <option key={value} value={value}>{benchmarkLabels[value]}</option>)}</select></label>
          <label><span>INTERVAL</span><div className="harvester-combo opens-up"><div className="harvester-unit-input"><input aria-label="Interval" inputMode="numeric" value={intervalDraft} onChange={(event) => setIntervalDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} {...numericAdjustmentTrigger("interval", commitInterval)} /><em>%</em></div><button type="button" className="harvester-selector-button" aria-label="Choose interval" aria-expanded={openSelector === "interval"} onClick={() => setOpenSelector((current) => current === "interval" ? null : "interval")} />{openSelector === "interval" && <div className="harvester-selector-menu">{intervalOptions.map((value) => <button key={value} type="button" onClick={() => { setShared("intervalPercent", value); setOpenSelector(null); }}>{value}%</button>)}</div>}</div></label>
          <label><span>CHECKPOINTS</span><select value={sharedInputs.pointCount} disabled={availableCheckpointCounts.length === 0} onChange={(event) => setShared("pointCount", Number(event.target.value))}>{availableCheckpointCounts.length > 0 ? availableCheckpointCounts.map((value) => <option key={value} value={value}>{value}</option>) : <option value={0}>0</option>}</select></label>
          <i className="harvester-control-row-break" aria-hidden="true" />
          <label className={(activeKind === "equalRate" || activeKind === "equalCash") ? "is-disabled" : ""}><span>HARVEST RATE</span><div className="harvester-combo opens-up"><div className="harvester-unit-input"><input aria-label="Harvest rate" inputMode="decimal" value={harvestRateDraft} disabled={activeKind === "equalRate" || activeKind === "equalCash"} onChange={(event) => setHarvestRateDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} {...numericAdjustmentTrigger("harvest-rate", commitHarvestRate)} /><em>%</em></div><button type="button" className="harvester-selector-button" disabled={activeKind === "equalRate" || activeKind === "equalCash"} aria-label="Choose harvest rate" aria-expanded={openSelector === "harvestRate"} onClick={() => setOpenSelector((current) => current === "harvestRate" ? null : "harvestRate")} />{openSelector === "harvestRate" && <div className="harvester-selector-menu">{DEFAULT_HARVEST_PRESETS.map((value) => <button key={value} type="button" onClick={() => { setLiveHarvestRate(value); setOpenSelector(null); }}>{value}%</button>)}</div>}</div></label>
          <label><span>FIRST CHECKPOINT</span><div className="harvester-combo opens-up"><div className="harvester-unit-input"><input aria-label="First checkpoint" inputMode="numeric" placeholder="Auto" value={firstCheckpointDraft} onChange={(event) => setFirstCheckpointDraft(event.target.value)} onBlur={commitFirstCheckpoint} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} /><em>%</em></div><button type="button" className="harvester-selector-button" aria-label="Choose first checkpoint" aria-expanded={openSelector === "firstCheckpoint"} onClick={() => setOpenSelector((current) => current === "firstCheckpoint" ? null : "firstCheckpoint")} />{openSelector === "firstCheckpoint" && <div className="harvester-selector-menu"><button type="button" onClick={() => { setLiveFirstCheckpoint(null); setOpenSelector(null); }}>Auto</button>{availableFirstCheckpoints.map((value) => <button key={value} type="button" onClick={() => { setLiveFirstCheckpoint(value); setOpenSelector(null); }}>{value}%</button>)}</div>}</div></label>
          <fieldset className="harvester-cashback-toggle" aria-label="Include initial cashback in capital recovery"><div className="harvester-cashback-title"><span>INCLUDE INITIAL CASHBACK</span><span>IN CAPITAL RECOVERY</span></div><button type="button" className={accountInitialCashback ? "on" : ""} onClick={() => { if (!accountInitialCashback) { recordUndoState(); setAccountInitialCashback(true); } }}>On</button><button type="button" className={!accountInitialCashback ? "on" : ""} onClick={() => { if (accountInitialCashback) { recordUndoState(); setAccountInitialCashback(false); } }}>Off</button></fieldset>
          <i className="harvester-control-row-break" aria-hidden="true" />
          <fieldset className="harvester-drag-mode"><legend>CHECKPOINT DRAG MODE</legend>{(["vertical", "horizontal", "both"] as const).map((mode) => <button key={mode} type="button" className={dragMode === mode ? "on" : ""} onClick={() => setDragMode(mode)}>{mode[0].toUpperCase() + mode.slice(1)}</button>)}</fieldset>
        </div>

        <div className="harvester-output-row">
          <section className="secured-capital" />
          <section className="harvester-final-metrics">
            <small>HARVESTING ANALYSIS: <span className="harvester-final-target">{signedMove(evaluationInputs.finalTargetPercent)}</span></small>
            <div className="harvester-final-summary-card">
              <section className="harvester-analysis-section harvester-analysis-wealth">
                <span className="harvested">Harvested <b>{money(result.final.totalHarvested)}</b></span>
                <span className="active">Remaining Active V4 <b>{money(result.final.remainingActiveV4)}</b></span>
                <span className="cashback">{analysisCashbackLabel} <b>{money(result.final.originalExternalCapital)}</b></span>
                <strong className="positive">Total Wealth <b>{money(result.final.totalWealth)}</b></strong>
              </section>
              <section className="harvester-analysis-section harvester-analysis-reference">
                <small>REFERENCE &amp; RECOVERY</small>
                <span className="benchmark">Benchmark ({benchmarkLabels[evaluationInputs.benchmark]}) <b>{result.final.benchmarkValue === null ? "Unavailable" : money(result.final.benchmarkValue)}</b></span>
                <span className="v4-delta">V4 vs Benchmark <b className={result.final.finalSurplus === null || result.final.finalSurplus === 0 ? "" : result.final.finalSurplus > 0 ? "positive" : "negative"}>{finalSurplusLabel(result.final.finalSurplus)}</b></span>
                <span className="recovery-summary"><span>Initial Capital <b>{money(result.recovery.initialInvestment)}</b></span><span>Recovered <b>{result.recovery.recovered ? "Yes" : "No"}</b>{result.recovery.recovered && result.recovery.recoveredAtMovePercent !== null && <> — at <b>{result.recovery.recoveredAtMovePercent === 0 ? "Entry" : signedMove(result.recovery.recoveredAtMovePercent)}</b></>}</span></span>
              </section>
            </div>
          </section>
          <section className="harvester-plan-actions" aria-label="Harvest plan actions">
            <button type="button" className="placeholder" disabled aria-label="Future action" title="Future action placeholder">↑</button>
            <button type="button" disabled={undoCount === 0} aria-label="Undo last action" title="Undo last action" onClick={undoLastAction}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 14-5-5 5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H13" /></svg></button>
            <button type="button" className={addPointArmed ? "armed" : ""} disabled={activeKind !== "user" || !activePlan} aria-label="Add point" title="Add point" onClick={() => setAddPointArmed((armed) => !armed)}>+</button>
            <button type="button" className="danger" disabled={activeKind !== "user" || !selectedPoint || !activePlan} aria-label="Delete selected point" title="Delete selected point" onClick={() => selectedPoint && updateActivePoints(deleteHarvestPoint(snapshot, evaluationInputs.benchmark, evaluationInputs.finalTargetPercent, points, selectedPoint.id), null)}>−</button>
            <button type="button" className="reset" disabled={!activePlan?.modified} aria-label="Reset harvest plan" title="Reset harvest plan" onClick={() => { if (!activePlan?.modified) return; recordUndoState(); setPlans((current) => ({ ...current, [activeKind]: resetHarvesterPlanState(activePlan) })); }}>↺</button>
          </section>
          <section className="harvester-ledger harvester-plan-table">
            <div className="harvester-ledger-title"><small>CHECKPOINT DATA</small><span>View and fine-tune each checkpoint.</span></div>
            <div className="harvester-ledger-scroll">
              <table>
                <colgroup><col className="checkpoint" /><col className="harvest-rate" /><col className="withdrawn" /><col className="v4-after" /></colgroup>
                <thead><tr><th>Checkpoint</th><th>Harvest %</th><th>Withdrawn</th><th>V4 After</th></tr></thead>
                <tbody>{result.points.length === 0 ? <tr><td colSpan={4}>Generate a harvest plan</td></tr> : result.points.map((entry, index) => <tr key={entry.id} className={entry.id === activePlan?.selectedPointId ? "selected" : ""} onClick={() => activePlan && setPlans((current) => ({ ...current, [activeKind]: { ...activePlan, selectedPointId: entry.id } }))}>
                  <td><div className="harvester-table-input"><input aria-label={`${planLabels[activeKind]} checkpoint ${index + 1}`} type="number" step={1} value={entry.movePercent} onChange={(event) => updateActivePoints(editHarvestPoint(snapshot, evaluationInputs.benchmark, evaluationInputs.finalTargetPercent, points, entry.id, { movePercent: Number(event.target.value) }, "horizontal"), entry.id, `checkpoint:${activeKind}:${entry.id}`)} {...numericAdjustmentTrigger(`checkpoint:${entry.id}`)} /><em>%</em></div></td>
                  <td><div className="harvester-table-input"><input aria-label={`${planLabels[activeKind]} harvest percent ${index + 1}`} type="number" min={0} step={1} value={activeKind === "equalRate" && !activePlan?.modified && activePlan?.commonHarvestPercent != null ? activePlan.commonHarvestPercent : Number(entry.harvestPercent.toFixed(2))} onChange={(event) => updateActivePoints(editHarvestPointPercent(snapshot, evaluationInputs.benchmark, evaluationInputs.finalTargetPercent, points, entry.id, Number(event.target.value)), entry.id, `harvest:${activeKind}:${entry.id}`)} {...numericAdjustmentTrigger(`harvest:${entry.id}`)} /><em>%</em></div></td>
                  <td><b>{money(entry.harvested)}</b>{index > 0 && <small> ({money(entry.cumulativeHarvested)})</small>}</td>
                  <td>{money(entry.activeAfter)}</td>
                </tr>)}</tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </section>
  </div>;
}
