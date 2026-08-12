import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
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
  HARVESTER_MAX_POINTS,
  HARVESTER_PLAN_KINDS,
  availableHarvesterBenchmarks,
  applyLiveHarvestRate,
  benchmarkForComparisonMode,
  buildHarvesterChartSeries,
  createEmptyHarvesterPlans,
  createHarvesterExportPayload,
  deleteHarvestPoint,
  editHarvestPoint,
  editHarvestPointPercent,
  evaluateHarvestPlan,
  generateAllHarvesterPlans,
  generateCurrentHarvesterPlan,
  insertHarvestPoint,
  otherPlansContainCustomEdits,
  resetHarvesterPlanState,
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
  equalRate: "Equal Rate",
  equalCash: "Equal Cash",
  earliestRecovery: "Earliest Recovery",
};
const recoverySummary = (recovered: boolean, movePercent: number | null) => recovered
  ? movePercent === 0 ? "Recovered at entry" : `Recovered at ${signedMove(movePercent ?? 0)}`
  : "Not recovered before target";
const intervalOptions = Array.from({ length: 10 }, (_, index) => (index + 1) * 10);

interface HarvesterOverlayProps {
  snapshot: HarvesterSnapshot;
  onClose: () => void;
  onExport?: (payload: HarvesterExportPayload) => void;
}

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

export function HarvesterOverlay({ snapshot, onClose, onExport }: HarvesterOverlayProps) {
  const availableBenchmarks = useMemo(() => availableHarvesterBenchmarks(snapshot), [snapshot]);
  const launchedBenchmark = benchmarkForComparisonMode(snapshot.comparisonMode);
  const initialBenchmark = availableBenchmarks.includes(launchedBenchmark) ? launchedBenchmark : "spot";
  const [sharedInputs, setSharedInputs] = useState<HarvesterGenerationInputs>({
    benchmark: initialBenchmark,
    finalTargetPercent: 500,
    intervalPercent: 100,
    pointCount: 4,
    defaultHarvestPercent: 100,
  });
  const [plans, setPlans] = useState<HarvesterPlans>(createEmptyHarvesterPlans);
  const [activeKind, setActiveKind] = useState<HarvesterPlanKind>("user");
  const [generationMode, setGenerationMode] = useState<"current" | "all">("all");
  const [accountInitialCashback, setAccountInitialCashback] = useState(true);
  const [dragMode, setDragMode] = useState<HarvesterDragMode>("vertical");
  const [addPointArmed, setAddPointArmed] = useState(false);
  const [confirmGenerateAll, setConfirmGenerateAll] = useState(false);
  const [exportReady, setExportReady] = useState(false);
  const [harvestedTooltipAnchor, setHarvestedTooltipAnchor] = useState<{ x: number; y: number } | null>(null);
  const [showFinalTargetCard, setShowFinalTargetCard] = useState(true);
  const [showLegendCard, setShowLegendCard] = useState(true);
  const dialogRef = useRef<HTMLElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);

  const activePlan = plans[activeKind];
  const hasGeneratedPlans = HARVESTER_PLAN_KINDS.every((kind) => plans[kind] !== null);
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
  const activeInputsStale = activePlan !== null && (
    activePlan.generationInputs.benchmark !== sharedInputs.benchmark ||
    activePlan.generationInputs.finalTargetPercent !== sharedInputs.finalTargetPercent ||
    activePlan.generationInputs.intervalPercent !== sharedInputs.intervalPercent ||
    activePlan.generationInputs.pointCount !== sharedInputs.pointCount
  );
  const activeHarvestRate = activePlan?.harvestRatePercent ?? sharedInputs.defaultHarvestPercent;
  const externalLabel = snapshot.config.cashbackMode === "spot"
    ? `External Cashback (Spot) · at ${signedMove(result.recovery.externalCashbackValuationMovePercent)}`
    : "External Cashback (Cash)";
  const finalExternalLabel = snapshot.config.cashbackMode === "spot" ? "External Cashback (Spot) · at final target" : "External Cashback (Cash)";
  const activeSummary = activeKind === "earliestRecovery" ? earliestRecoverySummary : activePlan?.summary ?? "No generated plan";

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

  const setShared = <K extends keyof HarvesterGenerationInputs>(key: K, value: HarvesterGenerationInputs[K]) => {
    setSharedInputs((current) => ({ ...current, [key]: value }));
    setAddPointArmed(false);
    setConfirmGenerateAll(false);
  };

  const performGenerateAll = () => {
    setPlans(generateAllHarvesterPlans(snapshot, sharedInputs));
    setActiveKind("user");
    setConfirmGenerateAll(false);
    setAddPointArmed(false);
  };

  const generate = () => {
    if (!hasGeneratedPlans || generationMode === "all") {
      if (hasGeneratedPlans && otherPlansContainCustomEdits(plans, activeKind)) {
        setConfirmGenerateAll(true);
        return;
      }
      performGenerateAll();
      return;
    }
    const inputs = { ...sharedInputs, defaultHarvestPercent: activePlan?.harvestRatePercent ?? sharedInputs.defaultHarvestPercent };
    setPlans((current) => generateCurrentHarvesterPlan(current, snapshot, inputs, activeKind));
    setConfirmGenerateAll(false);
    setAddPointArmed(false);
  };

  const setLiveHarvestRate = (harvestRatePercent: number) => {
    setSharedInputs((current) => ({ ...current, defaultHarvestPercent: harvestRatePercent }));
    if (activeKind === "equalRate" || activeKind === "equalCash") return;
    setPlans((current) => {
      const plan = current[activeKind];
      return plan ? { ...current, [activeKind]: applyLiveHarvestRate(plan, snapshot, harvestRatePercent) } : current;
    });
  };

  const updateActivePoints = (nextPoints: HarvestPoint[], selectedId: string | null | undefined = activePlan?.selectedPointId) => {
    if (!activePlan) return;
    setPlans((current) => ({
      ...current,
      [activeKind]: updateHarvesterPlanPoints(activePlan, nextPoints, selectedId ?? null),
    }));
  };

  const handleChartClick = (state: any) => {
    if (!activePlan || !addPointArmed || typeof state?.activeLabel !== "number") return;
    const next = insertHarvestPoint(snapshot, evaluationInputs.benchmark, evaluationInputs.finalTargetPercent, points, state.activeLabel);
    const inserted = next.find((candidate) => !points.some((point) => point.id === candidate.id));
    updateActivePoints(next, inserted?.id ?? activePlan.selectedPointId);
    setAddPointArmed(false);
  };

  const dragPoint = (point: HarvestPointResult, event: ReactMouseEvent<SVGCircleElement>) => {
    if (!activePlan) return;
    event.preventDefault();
    event.stopPropagation();
    setPlans((current) => ({ ...current, [activeKind]: { ...activePlan, selectedPointId: point.id } }));
    const onMove = (moveEvent: MouseEvent) => {
      const bounds = chartRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const plotLeft = bounds.left + 72;
      const plotRight = bounds.right - 34;
      const plotTop = bounds.top + 22;
      const plotBottom = bounds.bottom - 48;
      const movePercent = Math.max(0, Math.min(evaluationInputs.finalTargetPercent, ((moveEvent.clientX - plotLeft) / Math.max(1, plotRight - plotLeft)) * evaluationInputs.finalTargetPercent));
      const activeAfter = yMax - ((moveEvent.clientY - plotTop) / Math.max(1, plotBottom - plotTop)) * (yMax - yMin);
      setPlans((current) => {
        const currentPlan = current[activeKind];
        if (!currentPlan) return current;
        const next = editHarvestPoint(snapshot, evaluationInputs.benchmark, evaluationInputs.finalTargetPercent, currentPlan.points, point.id, { movePercent, activeAfter }, dragMode);
        return { ...current, [activeKind]: updateHarvesterPlanPoints(currentPlan, next, point.id) };
      });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const exportPayload = () => {
    const payload = createHarvesterExportPayload(snapshot, evaluationInputs.benchmark, evaluationInputs.finalTargetPercent, points, accountInitialCashback);
    onExport?.(payload);
    window.dispatchEvent(new CustomEvent("harvester:export", { detail: payload }));
    setExportReady(true);
    window.setTimeout(() => setExportReady(false), 1800);
  };

  const benchmarkProblem = result.final.benchmarkStatus === "liquidated"
    ? `${benchmarkLabels[evaluationInputs.benchmark]} is liquidated at the final target.`
    : result.final.benchmarkStatus === "unavailable"
      ? `${benchmarkLabels[evaluationInputs.benchmark]} inputs are unavailable.`
      : !result.feasible
        ? "The imported active V4 cannot meet this benchmark at the final target."
        : null;

  return <div className="harvester-backdrop" role="presentation">
    <section ref={dialogRef} className="harvester-workspace" role="dialog" aria-modal="true" aria-labelledby="harvester-title" tabIndex={-1}>
      <header className="harvester-head">
        <div className="harvester-title-area">
          <div>
            <small>SCENARIO WORKSPACE</small>
            <h2 id="harvester-title">Harvester</h2>
          </div>
          <div className="harvester-chart-card-toggles" aria-label="Chart card visibility">
            <button type="button" className={showFinalTargetCard ? "on" : ""} aria-pressed={showFinalTargetCard} aria-label="Toggle final target card" title="Toggle final target card" onClick={() => setShowFinalTargetCard((visible) => !visible)}>
              <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="4.25" /><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2" /></svg>
            </button>
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
        <div ref={chartRef} className={`harvester-chart${addPointArmed ? " is-placing" : ""}${showFinalTargetCard ? " has-target-card" : ""}${showLegendCard ? " has-legend-card" : ""}`}>
          <ResponsiveContainer>
            <ComposedChart data={chartSeries} margin={{ top: 20, right: 32, bottom: 12, left: 10 }} onClick={handleChartClick}>
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
                r={point.id === activePlan?.selectedPointId ? 7 : 5.5}
                fill={point.id === activePlan?.selectedPointId ? "#f5b57f" : "#e18a4a"}
                stroke="#151616"
                strokeWidth={2}
                onMouseDown={(_dotProps, event) => dragPoint(point, event)}
                onClick={(_dotProps, event) => {
                  event.stopPropagation();
                  if (activePlan) setPlans((current) => ({ ...current, [activeKind]: { ...activePlan, selectedPointId: point.id } }));
                }}
              />)}
            </ComposedChart>
          </ResponsiveContainer>
          {addPointArmed && <div className="harvester-placement-hint">Click the chart to place one checkpoint</div>}
          {showFinalTargetCard && <aside className="harvester-target-card">
            <small>FINAL TARGET · {signedMove(evaluationInputs.finalTargetPercent)}</small>
            <span className="benchmark">Benchmark ({benchmarkLabels[evaluationInputs.benchmark]}) <b>{result.final.benchmarkValue === null ? "Unavailable" : money(result.final.benchmarkValue)}</b></span>
            <span className="active">Active V4 Position <b>{money(result.final.remainingActiveV4)}</b></span>
            <span className="cashback">Initial cashback{snapshot.config.cashbackMode === "spot" ? " (Spot)" : ""} <b>{money(result.final.originalExternalCapital)}</b></span>
            <span className="harvested">Harvested <b>{money(result.final.totalHarvested)}</b></span>
            <strong className="positive">Total Wealth {money(result.final.totalWealth)}</strong>
          </aside>}
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
          <label><span>FINAL TARGET</span><div className="harvester-unit-input"><input type="number" min={10} max={2000} step={5} value={sharedInputs.finalTargetPercent} onChange={(event) => setShared("finalTargetPercent", Math.min(2000, Math.max(10, Number(event.target.value))))} /><em>%</em></div></label>
          <label><span>BENCHMARK</span><select value={sharedInputs.benchmark} onChange={(event) => setShared("benchmark", event.target.value as HarvesterBenchmark)}>{availableBenchmarks.map((value) => <option key={value} value={value}>{benchmarkLabels[value]}</option>)}</select></label>
          <label><span>INTERVAL</span><select value={sharedInputs.intervalPercent} onChange={(event) => setShared("intervalPercent", Number(event.target.value))}>{intervalOptions.map((value) => <option key={value} value={value}>{value}%</option>)}</select></label>
          <label><span>CHECKPOINTS</span><input type="number" min={1} max={HARVESTER_MAX_POINTS} value={sharedInputs.pointCount} onChange={(event) => setShared("pointCount", Math.min(HARVESTER_MAX_POINTS, Math.max(1, Number(event.target.value))))} /></label>
          <div className="harvester-generate-control">
            <span>GENERATE</span>
            <div><select value={generationMode} onChange={(event) => { setGenerationMode(event.target.value as "current" | "all"); setConfirmGenerateAll(false); }}><option value="current">Current</option><option value="all">All</option></select><button type="button" className="primary" onClick={generate}>Generate</button></div>
            {activeInputsStale && <small>Settings changed · generated plan retained</small>}
            {benchmarkProblem && <small className="warning">{benchmarkProblem}</small>}
          </div>
          {confirmGenerateAll && <div className="harvester-generate-warning" role="alert"><small>Other plans contain custom edits. Generate All will replace them.</small><button type="button" className="primary" onClick={performGenerateAll}>Proceed</button><button type="button" onClick={() => setConfirmGenerateAll(false)}>Cancel</button></div>}
          <label className={(activeKind === "equalRate" || activeKind === "equalCash") ? "is-disabled" : ""}><span>HARVEST RATE</span><select disabled={activeKind === "equalRate" || activeKind === "equalCash"} value={activeHarvestRate} onChange={(event) => setLiveHarvestRate(Number(event.target.value))}>{DEFAULT_HARVEST_PRESETS.map((value) => <option key={value} value={value}>{value}%</option>)}</select></label>
          <fieldset className="harvester-cashback-toggle"><legend>ACCOUNT INITIAL CASHBACK</legend><button type="button" className={accountInitialCashback ? "on" : ""} onClick={() => setAccountInitialCashback(true)}>On</button><button type="button" className={!accountInitialCashback ? "on" : ""} onClick={() => setAccountInitialCashback(false)}>Off</button></fieldset>
          <button type="button" className={addPointArmed ? "armed" : ""} disabled={activeKind !== "user" || !activePlan || points.length >= HARVESTER_MAX_POINTS || !result.feasible} onClick={() => setAddPointArmed((armed) => !armed)}>Add Point</button>
          <fieldset className="harvester-drag-mode"><legend>DRAG MODE</legend>{(["vertical", "horizontal", "both"] as const).map((mode) => <button key={mode} type="button" className={dragMode === mode ? "on" : ""} onClick={() => setDragMode(mode)}>{mode[0].toUpperCase() + mode.slice(1)}</button>)}</fieldset>
          <button type="button" disabled={!activePlan} onClick={() => activePlan && setPlans((current) => ({ ...current, [activeKind]: resetHarvesterPlanState(activePlan) }))}>Reset</button>
          <button type="button" className="danger" disabled={activeKind !== "user" || !selectedPoint || !activePlan} onClick={() => selectedPoint && updateActivePoints(deleteHarvestPoint(snapshot, evaluationInputs.benchmark, evaluationInputs.finalTargetPercent, points, selectedPoint.id), null)}>Delete</button>
        </div>

        <div className="harvester-output-row">
          <section className="secured-capital">
            <small>RECOVERY ACCOUNTING</small>
            <strong>{money(result.recovery.countedRecoveredCapital)}</strong>
            <div><span>Harvested cash <b>{money(result.recovery.harvestedCash)}</b></span><span>{externalLabel} <b>{money(result.recovery.externalCashbackValue)}</b></span></div>
            {!accountInitialCashback && <em className="cashback-excluded">Initial cashback excluded from recovery milestone</em>}
            <p>Initial capital: <b>{money(result.recovery.initialInvestment)}</b></p>
            <p>Recovered capital counted{snapshot.config.cashbackMode === "spot" ? ` at ${signedMove(result.recovery.externalCashbackValuationMovePercent)}` : ""}: <b>{money(result.recovery.countedRecoveredCapital)}</b> / {money(result.recovery.initialInvestment)}</p>
            <p>Initial capital recovered: <b>{result.recovery.recovered ? "Yes" : "No"}</b>{result.recovery.recoveredAtMovePercent !== null && <> · Initial capital recovered at <b>{result.recovery.recoveredAtMovePercent === 0 ? "Entry" : signedMove(result.recovery.recoveredAtMovePercent)}</b></>}</p>
            {!result.recovery.recovered && <><progress max={result.recovery.initialInvestment} value={Math.min(result.recovery.initialInvestment, result.recovery.countedRecoveredCapital)} /><em>{money(result.recovery.countedRecoveredCapital)} / {money(result.recovery.initialInvestment)}</em></>}
          </section>
          <section className="harvester-final-metrics">
            <small>FINAL TARGET SUMMARY · {activeSummary}</small>
            <div><span>Remaining active V4<b>{money(result.final.remainingActiveV4)}</b></span><span>{benchmarkLabels[evaluationInputs.benchmark]} value<b>{result.final.benchmarkValue === null ? "Unavailable" : money(result.final.benchmarkValue)}</b></span><span>{finalExternalLabel}<b>{money(result.final.originalExternalCapital)}</b></span><span>Total harvested<b>{money(result.final.totalHarvested)}</b></span><span>Total wealth<b>{money(result.final.totalWealth)}</b></span><span>Surplus over benchmark<b className={result.final.paritySatisfied ? "positive" : "negative"}>{result.final.finalSurplus === null ? "—" : money(result.final.finalSurplus)}</b></span></div>
          </section>
          <section className="harvester-ledger harvester-plan-table">
            <small>HARVEST PLAN</small>
            <div className="harvester-ledger-scroll">
              <table>
                <thead><tr><th>Checkpoint</th><th>Harvest %</th><th>Withdrawn</th><th>V4 After</th></tr></thead>
                <tbody>{result.points.length === 0 ? <tr><td colSpan={4}>Generate a harvest plan</td></tr> : result.points.map((entry, index) => <tr key={entry.id} className={entry.id === activePlan?.selectedPointId ? "selected" : ""} onClick={() => activePlan && setPlans((current) => ({ ...current, [activeKind]: { ...activePlan, selectedPointId: entry.id } }))}>
                  <td><div className="harvester-table-input"><input aria-label={`${planLabels[activeKind]} checkpoint ${index + 1}`} type="number" step={5} value={entry.movePercent} onChange={(event) => updateActivePoints(editHarvestPoint(snapshot, evaluationInputs.benchmark, evaluationInputs.finalTargetPercent, points, entry.id, { movePercent: Number(event.target.value) }, "horizontal"), entry.id)} /><em>%</em></div></td>
                  <td><div className="harvester-table-input"><input aria-label={`${planLabels[activeKind]} harvest percent ${index + 1}`} type="number" min={0} step={1} value={activeKind === "equalRate" && !activePlan?.modified && activePlan?.commonHarvestPercent != null ? activePlan.commonHarvestPercent : Number(entry.harvestPercent.toFixed(2))} onChange={(event) => updateActivePoints(editHarvestPointPercent(snapshot, evaluationInputs.benchmark, evaluationInputs.finalTargetPercent, points, entry.id, Number(event.target.value)), entry.id)} /><em>%</em></div></td>
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
