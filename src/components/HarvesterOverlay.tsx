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
    <span>Original active V4 <strong>{money(row.originalActiveV4)}</strong></span>
    <span>Harvested active V4 <strong>{money(row.harvestedActiveV4)}</strong></span>
    <span>Total wealth <strong>{money(row.totalWealth)}</strong></span>
    <span>Benchmark <strong>{row.benchmark === null ? "Unavailable" : money(row.benchmark)}</strong></span>
  </div>;
}

function PointTooltip({ point }: { point: HarvestPointResult }) {
  return <div className="harvest-point-tooltip">
    <b>{signedMove(point.movePercent)}</b>
    <span>V4 before <strong>{money(point.activeBefore)}</strong></span>
    <span>Harvested here <strong>{money(point.harvested)}</strong></span>
    <span>Active V4 after <strong>{money(point.activeAfter)}</strong></span>
    <span>Cumulative harvested <strong>{money(point.cumulativeHarvested)}</strong></span>
    <span>Maximum additional <strong>{money(point.maximumAdditionalHarvest)}</strong></span>
  </div>;
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
  const [hoveredPointId, setHoveredPointId] = useState<string | null>(null);
  const [confirmGenerateAll, setConfirmGenerateAll] = useState(false);
  const [exportReady, setExportReady] = useState(false);
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
  const tooltipPoint = result.points.find((point) => point.id === hoveredPointId) ?? selectedPoint;
  const yValues = chartSeries.flatMap((entry) => [entry.originalActiveV4, entry.harvestedActiveV4, entry.totalWealth, entry.benchmark ?? 0]);
  const rawYMax = Math.max(snapshot.config.deposit, ...yValues);
  const yStep = rawYMax <= 100_000 ? 25_000 : rawYMax <= 500_000 ? 100_000 : 250_000;
  const yMax = Math.max(yStep, Math.ceil(rawYMax / yStep) * yStep);
  const yMin = Math.min(0, ...yValues);
  const activeInputsStale = activePlan !== null && JSON.stringify(activePlan.generationInputs) !== JSON.stringify(sharedInputs);
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
    setPlans((current) => generateCurrentHarvesterPlan(current, snapshot, sharedInputs, activeKind));
    setConfirmGenerateAll(false);
    setAddPointArmed(false);
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
        <div>
          <small>SCENARIO WORKSPACE</small>
          <h2 id="harvester-title">Harvester</h2>
          <p>Progressively secure capital while preserving final {benchmarkLabels[evaluationInputs.benchmark]} parity.</p>
        </div>
        <div className="harvester-head-actions">
          <button type="button" className="harvester-export" onClick={exportPayload}>{exportReady ? "Payload ready" : "Export Chart"}</button>
          <button type="button" className="harvester-close" onClick={onClose}>Close</button>
        </div>
      </header>

      <div className="harvester-chart-shell">
        <nav className="harvester-plan-tabs" aria-label="Harvest plans">
          {HARVESTER_PLAN_KINDS.map((kind) => <button
            key={kind}
            type="button"
            disabled={!hasGeneratedPlans}
            className={activeKind === kind ? "on" : ""}
            onClick={() => { setActiveKind(kind); setAddPointArmed(false); setHoveredPointId(null); }}
          >
            <span>{planLabels[kind]}{plans[kind]?.modified && <i aria-label="Modified" title="Modified" />}</span>
            <small>{kind === "earliestRecovery" ? earliestRecoverySummary : plans[kind]?.summary ?? "Generate a plan"}</small>
          </button>)}
        </nav>
        <div ref={chartRef} className={`harvester-chart${addPointArmed ? " is-placing" : ""}`}>
          <ResponsiveContainer>
            <ComposedChart data={chartSeries} margin={{ top: 20, right: 32, bottom: 12, left: 10 }} onClick={handleChartClick}>
              <CartesianGrid stroke="#312f2c" strokeOpacity={0.72} vertical={false} />
              <XAxis dataKey="move" type="number" domain={[0, evaluationInputs.finalTargetPercent]} tickFormatter={signedMove} stroke="#4f4a45" tick={{ fontSize: 11, fill: "#9b9187" }} label={{ value: `${snapshot.assetName} price change`, position: "insideBottom", offset: -7, fill: "#9b9187", fontSize: 11 }} />
              <YAxis type="number" domain={[yMin, yMax]} tickFormatter={(value) => money(value)} width={70} stroke="#4f4a45" tick={{ fontSize: 10, fill: "#9b9187" }} />
              <Tooltip content={<HarvesterTooltip />} />
              <ReferenceLine x={evaluationInputs.finalTargetPercent} stroke="#d7a276" strokeWidth={1.5} strokeDasharray="5 4" />
              <Line dataKey="originalActiveV4" name="Original Active V4" stroke="#8b8178" strokeOpacity={points.length ? .42 : .7} strokeDasharray="5 5" strokeWidth={1.4} dot={false} isAnimationActive={false} />
              <Line dataKey="benchmark" name={benchmarkLabels[evaluationInputs.benchmark]} stroke="#c4b17d" strokeOpacity={.72} strokeDasharray="3 4" strokeWidth={1.6} dot={false} connectNulls={false} isAnimationActive={false} />
              <Line dataKey="totalWealth" name="Total Wealth" stroke="#78b8aa" strokeWidth={2.5} dot={false} isAnimationActive={false} />
              <Line dataKey="harvestedActiveV4" name="Harvested Active V4" stroke="#e18a4a" strokeWidth={3.4} dot={false} isAnimationActive={false} />
              {result.points.map((point) => <ReferenceDot
                key={point.id}
                x={point.movePercent}
                y={point.activeAfter}
                r={point.id === activePlan?.selectedPointId ? 7 : 5.5}
                fill={point.id === activePlan?.selectedPointId ? "#f5b57f" : "#e18a4a"}
                stroke="#151616"
                strokeWidth={2}
                onMouseDown={(_dotProps, event) => dragPoint(point, event)}
                onMouseEnter={() => setHoveredPointId(point.id)}
                onMouseLeave={() => setHoveredPointId(null)}
                onClick={(_dotProps, event) => {
                  event.stopPropagation();
                  if (activePlan) setPlans((current) => ({ ...current, [activeKind]: { ...activePlan, selectedPointId: point.id } }));
                }}
              />)}
            </ComposedChart>
          </ResponsiveContainer>
          {addPointArmed && <div className="harvester-placement-hint">Click the chart to place one checkpoint</div>}
          {tooltipPoint && <PointTooltip point={tooltipPoint} />}
          <aside className="harvester-target-card">
            <small>FINAL TARGET · {signedMove(evaluationInputs.finalTargetPercent)}</small>
            <span>Active V4 <b>{money(result.final.remainingActiveV4)}</b></span>
            <span>{benchmarkLabels[evaluationInputs.benchmark]} <b>{result.final.benchmarkValue === null ? "Unavailable" : money(result.final.benchmarkValue)}</b></span>
            <span>External <b>{money(result.final.originalExternalCapital)}</b></span>
            <span>Harvested <b>{money(result.final.totalHarvested)}</b></span>
            <span>Total wealth <b>{money(result.final.totalWealth)}</b></span>
            <strong className={result.final.paritySatisfied ? "positive" : "negative"}>Final surplus {result.final.finalSurplus === null ? "—" : money(result.final.finalSurplus)}</strong>
          </aside>
        </div>
        <div className="harvester-legend">
          <span className="original">Original Active V4</span><span className="active">Harvested Active V4</span><span className="wealth">Total Wealth</span><span className="benchmark">{benchmarkLabels[evaluationInputs.benchmark]}</span>
        </div>
      </div>

      <div className="harvester-bottom">
        <div className="harvester-control-row">
          <label><span>FINAL TARGET</span><div className="harvester-unit-input"><input type="number" min={10} max={2000} step={5} value={sharedInputs.finalTargetPercent} onChange={(event) => setShared("finalTargetPercent", Math.min(2000, Math.max(10, Number(event.target.value))))} /><em>%</em></div></label>
          <label><span>BENCHMARK</span><select value={sharedInputs.benchmark} onChange={(event) => setShared("benchmark", event.target.value as HarvesterBenchmark)}>{availableBenchmarks.map((value) => <option key={value} value={value}>{benchmarkLabels[value]}</option>)}</select></label>
          <label><span>INTERVAL</span><select value={sharedInputs.intervalPercent} onChange={(event) => setShared("intervalPercent", Number(event.target.value))}>{intervalOptions.map((value) => <option key={value} value={value}>{value}%</option>)}</select></label>
          <label><span>CHECKPOINTS</span><input type="number" min={1} max={HARVESTER_MAX_POINTS} value={sharedInputs.pointCount} onChange={(event) => setShared("pointCount", Math.min(HARVESTER_MAX_POINTS, Math.max(1, Number(event.target.value))))} /></label>
          <label className={(activeKind === "equalRate" || activeKind === "equalCash") ? "is-disabled" : ""}><span>DEFAULT HARVEST</span><select disabled={activeKind === "equalRate" || activeKind === "equalCash"} value={sharedInputs.defaultHarvestPercent} onChange={(event) => setShared("defaultHarvestPercent", Number(event.target.value))}>{DEFAULT_HARVEST_PRESETS.map((value) => <option key={value} value={value}>{value}%</option>)}</select></label>
          <fieldset className="harvester-cashback-toggle"><legend>ACCOUNT INITIAL CASHBACK</legend><button type="button" className={accountInitialCashback ? "on" : ""} onClick={() => setAccountInitialCashback(true)}>On</button><button type="button" className={!accountInitialCashback ? "on" : ""} onClick={() => setAccountInitialCashback(false)}>Off</button></fieldset>
          <div className="harvester-generate-control">
            <span>GENERATE</span>
            <div><select value={generationMode} onChange={(event) => { setGenerationMode(event.target.value as "current" | "all"); setConfirmGenerateAll(false); }}><option value="current">Current</option><option value="all">All</option></select><button type="button" className="primary" onClick={generate}>Generate</button></div>
            {activeInputsStale && <small>Settings changed · generated plan retained</small>}
            {benchmarkProblem && <small className="warning">{benchmarkProblem}</small>}
          </div>
          {confirmGenerateAll && <div className="harvester-generate-warning" role="alert"><small>Other plans contain custom edits. Generate All will replace them.</small><button type="button" className="primary" onClick={performGenerateAll}>Proceed</button><button type="button" onClick={() => setConfirmGenerateAll(false)}>Cancel</button></div>}
          <button type="button" className={addPointArmed ? "armed" : ""} disabled={!activePlan || points.length >= HARVESTER_MAX_POINTS || !result.feasible} onClick={() => setAddPointArmed((armed) => !armed)}>Add Point</button>
          <fieldset className="harvester-drag-mode"><legend>DRAG MODE</legend>{(["vertical", "horizontal", "both"] as const).map((mode) => <button key={mode} type="button" className={dragMode === mode ? "on" : ""} onClick={() => setDragMode(mode)}>{mode[0].toUpperCase() + mode.slice(1)}</button>)}</fieldset>
          <button type="button" disabled={!activePlan} onClick={() => activePlan && setPlans((current) => ({ ...current, [activeKind]: resetHarvesterPlanState(activePlan) }))}>Reset</button>
          <button type="button" className="danger" disabled={!selectedPoint || !activePlan} onClick={() => selectedPoint && updateActivePoints(deleteHarvestPoint(snapshot, evaluationInputs.benchmark, evaluationInputs.finalTargetPercent, points, selectedPoint.id), null)}>Delete</button>
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
