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
  HARVESTER_MAX_POINTS,
  availableHarvesterBenchmarks,
  benchmarkForComparisonMode,
  buildHarvesterChartSeries,
  createHarvesterExportPayload,
  deleteHarvestPoint,
  editHarvestPoint,
  evaluateHarvestPlan,
  generateHarvestPoints,
  insertHarvestPoint,
  resetHarvestPoints,
  type HarvestPoint,
  type HarvestPointResult,
  type HarvesterBenchmark,
  type HarvesterDragMode,
  type HarvesterExportPayload,
  type HarvesterSnapshot,
} from "../model/harvester";

const money = (value: number) => new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
}).format(value);
const signedMove = (value: number) => `${value >= 0 ? "+" : ""}${Math.round(value)}%`;
const benchmarkLabels: Record<HarvesterBenchmark, string> = { spot: "Spot", lending: "Lending", perp: "Perp" };
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
  const [benchmark, setBenchmark] = useState<HarvesterBenchmark>(
    availableBenchmarks.includes(launchedBenchmark) ? launchedBenchmark : "spot",
  );
  const [finalTarget, setFinalTarget] = useState(500);
  const [planBenchmark, setPlanBenchmark] = useState<HarvesterBenchmark>(
    availableBenchmarks.includes(launchedBenchmark) ? launchedBenchmark : "spot",
  );
  const [planTarget, setPlanTarget] = useState(500);
  const [interval, setInterval] = useState(100);
  const [pointCount, setPointCount] = useState(4);
  const [points, setPoints] = useState<HarvestPoint[]>([]);
  const [generatedPoints, setGeneratedPoints] = useState<HarvestPoint[]>([]);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [hoveredPointId, setHoveredPointId] = useState<string | null>(null);
  const [dragMode, setDragMode] = useState<HarvesterDragMode>("vertical");
  const [addPointArmed, setAddPointArmed] = useState(false);
  const [stale, setStale] = useState(false);
  const [manualEdits, setManualEdits] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [exportReady, setExportReady] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const hasGeneratedPlan = generatedPoints.length > 0 || points.length > 0;
  const evaluatedBenchmark = hasGeneratedPlan ? planBenchmark : benchmark;
  const evaluatedTarget = hasGeneratedPlan ? planTarget : finalTarget;

  const result = useMemo(
    () => evaluateHarvestPlan(snapshot, evaluatedBenchmark, evaluatedTarget, points),
    [snapshot, evaluatedBenchmark, evaluatedTarget, points],
  );
  const chartSeries = useMemo(
    () => buildHarvesterChartSeries(snapshot, evaluatedBenchmark, evaluatedTarget, points),
    [snapshot, evaluatedBenchmark, evaluatedTarget, points],
  );
  const selectedPoint = result.points.find((point) => point.id === selectedPointId) ?? null;
  const tooltipPoint = result.points.find((point) => point.id === hoveredPointId) ?? selectedPoint;
  const yValues = chartSeries.flatMap((entry) => [entry.originalActiveV4, entry.harvestedActiveV4, entry.totalWealth, entry.benchmark ?? 0]);
  const rawYMax = Math.max(snapshot.config.deposit, ...yValues);
  const yStep = rawYMax <= 100_000 ? 25_000 : rawYMax <= 500_000 ? 100_000 : 250_000;
  const yMax = Math.max(yStep, Math.ceil(rawYMax / yStep) * yStep);
  const yMin = Math.min(0, ...yValues);

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

  const markStructuralChange = () => {
    setAddPointArmed(false);
    setConfirmRegenerate(false);
    if (generatedPoints.length > 0 || points.length > 0) setStale(true);
  };

  const performGenerate = () => {
    const next = generateHarvestPoints(snapshot, benchmark, finalTarget, interval, pointCount);
    setPoints(next);
    setGeneratedPoints(next.map((point) => ({ ...point })));
    setSelectedPointId(next[0]?.id ?? null);
    setStale(false);
    setManualEdits(false);
    setAddPointArmed(false);
    setConfirmRegenerate(false);
    setPlanBenchmark(benchmark);
    setPlanTarget(finalTarget);
  };

  const generate = () => {
    if (manualEdits && points.length > 0) {
      setConfirmRegenerate(true);
      return;
    }
    performGenerate();
  };

  const updatePoints = (next: HarvestPoint[], selectedId?: string | null) => {
    setPoints(next);
    setManualEdits(true);
    if (selectedId !== undefined) setSelectedPointId(selectedId);
  };

  const handleChartClick = (state: any) => {
    if (!addPointArmed || typeof state?.activeLabel !== "number") return;
    const next = insertHarvestPoint(snapshot, evaluatedBenchmark, evaluatedTarget, points, state.activeLabel);
    const inserted = next.find((candidate) => !points.some((point) => point.id === candidate.id));
    updatePoints(next, inserted?.id ?? selectedPointId);
    setAddPointArmed(false);
  };

  const dragPoint = (point: HarvestPointResult, event: ReactMouseEvent<SVGCircleElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedPointId(point.id);
    const onMove = (moveEvent: MouseEvent) => {
      const bounds = chartRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const plotLeft = bounds.left + 72;
      const plotRight = bounds.right - 34;
      const plotTop = bounds.top + 22;
      const plotBottom = bounds.bottom - 48;
      const movePercent = Math.max(0, Math.min(evaluatedTarget, ((moveEvent.clientX - plotLeft) / Math.max(1, plotRight - plotLeft)) * evaluatedTarget));
      const activeAfter = yMax - ((moveEvent.clientY - plotTop) / Math.max(1, plotBottom - plotTop)) * (yMax - yMin);
      setPoints((current) => editHarvestPoint(
        snapshot,
        evaluatedBenchmark,
        evaluatedTarget,
        current,
        point.id,
        { movePercent, activeAfter },
        dragMode,
      ));
      setManualEdits(true);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const exportPayload = () => {
    const payload = createHarvesterExportPayload(snapshot, evaluatedBenchmark, evaluatedTarget, points);
    onExport?.(payload);
    window.dispatchEvent(new CustomEvent("harvester:export", { detail: payload }));
    setExportReady(true);
    window.setTimeout(() => setExportReady(false), 1800);
  };

  const benchmarkProblem = result.final.benchmarkStatus === "liquidated"
    ? `${benchmarkLabels[evaluatedBenchmark]} is liquidated at the final target.`
    : result.final.benchmarkStatus === "unavailable"
      ? `${benchmarkLabels[evaluatedBenchmark]} inputs are unavailable.`
      : !result.feasible
        ? "The imported active V4 cannot meet this benchmark at the final target."
        : null;

  return <div className="harvester-backdrop" role="presentation">
    <section
      ref={dialogRef}
      className="harvester-workspace"
      role="dialog"
      aria-modal="true"
      aria-labelledby="harvester-title"
      tabIndex={-1}
    >
      <header className="harvester-head">
        <div>
          <small>SCENARIO WORKSPACE</small>
          <h2 id="harvester-title">Harvester</h2>
          <p>Progressively secure capital while preserving final {benchmarkLabels[evaluatedBenchmark]} parity.</p>
        </div>
        <div className="harvester-head-actions">
          <button type="button" className="harvester-export" onClick={exportPayload}>{exportReady ? "Payload ready" : "Export Chart"}</button>
          <button type="button" className="harvester-close" onClick={onClose}>Close</button>
        </div>
      </header>

      <div className="harvester-chart-shell">
        <div ref={chartRef} className={`harvester-chart${addPointArmed ? " is-placing" : ""}`}>
          <ResponsiveContainer>
            <ComposedChart
              data={chartSeries}
              margin={{ top: 20, right: 32, bottom: 12, left: 10 }}
              onClick={handleChartClick}
            >
              <CartesianGrid stroke="#312f2c" strokeOpacity={0.72} vertical={false} />
              <XAxis
                dataKey="move"
                type="number"
                domain={[0, evaluatedTarget]}
                tickFormatter={signedMove}
                stroke="#4f4a45"
                tick={{ fontSize: 11, fill: "#9b9187" }}
                label={{ value: `${snapshot.assetName} price change`, position: "insideBottom", offset: -7, fill: "#9b9187", fontSize: 11 }}
              />
              <YAxis
                type="number"
                domain={[yMin, yMax]}
                tickFormatter={(value) => money(value)}
                width={70}
                stroke="#4f4a45"
                tick={{ fontSize: 10, fill: "#9b9187" }}
              />
              <Tooltip content={<HarvesterTooltip />} />
              <ReferenceLine x={evaluatedTarget} stroke="#d7a276" strokeWidth={1.5} strokeDasharray="5 4" />
              <Line dataKey="originalActiveV4" name="Original Active V4" stroke="#8b8178" strokeOpacity={points.length ? .42 : .7} strokeDasharray="5 5" strokeWidth={1.4} dot={false} isAnimationActive={false} />
              <Line dataKey="benchmark" name={benchmarkLabels[evaluatedBenchmark]} stroke="#c4b17d" strokeOpacity={.72} strokeDasharray="3 4" strokeWidth={1.6} dot={false} connectNulls={false} isAnimationActive={false} />
              <Line dataKey="totalWealth" name="Total Wealth" stroke="#78b8aa" strokeWidth={2.5} dot={false} isAnimationActive={false} />
              <Line dataKey="harvestedActiveV4" name="Harvested Active V4" stroke="#e18a4a" strokeWidth={3.4} dot={false} isAnimationActive={false} />
              {result.points.map((point) => <ReferenceDot
                key={point.id}
                x={point.movePercent}
                y={point.activeAfter}
                r={point.id === selectedPointId ? 7 : 5.5}
                fill={point.id === selectedPointId ? "#f5b57f" : "#e18a4a"}
                stroke="#151616"
                strokeWidth={2}
                onMouseDown={(_dotProps, event) => dragPoint(point, event)}
                onMouseEnter={() => setHoveredPointId(point.id)}
                onMouseLeave={() => setHoveredPointId(null)}
                onClick={(_dotProps, event) => {
                  event.stopPropagation();
                  setSelectedPointId(point.id);
                }}
              />)}
            </ComposedChart>
          </ResponsiveContainer>
          {addPointArmed && <div className="harvester-placement-hint">Click the chart to place one checkpoint</div>}
          {tooltipPoint && <PointTooltip point={tooltipPoint} />}
          <aside className="harvester-target-card">
            <small>FINAL TARGET · {signedMove(evaluatedTarget)}</small>
            <span>Active V4 <b>{money(result.final.remainingActiveV4)}</b></span>
            <span>{benchmarkLabels[evaluatedBenchmark]} <b>{result.final.benchmarkValue === null ? "Unavailable" : money(result.final.benchmarkValue)}</b></span>
            <span>External <b>{money(result.final.originalExternalCapital)}</b></span>
            <span>Harvested <b>{money(result.final.totalHarvested)}</b></span>
            <span>Total wealth <b>{money(result.final.totalWealth)}</b></span>
            <strong className={result.final.paritySatisfied ? "positive" : "negative"}>
              Final surplus {result.final.finalSurplus === null ? "—" : money(result.final.finalSurplus)}
            </strong>
          </aside>
        </div>
        <div className="harvester-legend">
          <span className="original">Original Active V4</span>
          <span className="active">Harvested Active V4</span>
          <span className="wealth">Total Wealth</span>
          <span className="benchmark">{benchmarkLabels[evaluatedBenchmark]}</span>
        </div>
      </div>

      <div className="harvester-bottom">
        <div className="harvester-control-row">
          <label><span>FINAL TARGET</span><div className="harvester-unit-input"><input type="number" min={10} max={2000} step={5} value={finalTarget} onChange={(event) => { setFinalTarget(Math.min(2000, Math.max(10, Number(event.target.value)))); markStructuralChange(); }} /><em>%</em></div></label>
          <label><span>BENCHMARK</span><select value={benchmark} onChange={(event) => { setBenchmark(event.target.value as HarvesterBenchmark); markStructuralChange(); }}>{availableBenchmarks.map((value) => <option key={value} value={value}>{benchmarkLabels[value]}</option>)}</select></label>
          <label><span>INTERVAL</span><select value={interval} onChange={(event) => { setInterval(Number(event.target.value)); markStructuralChange(); }}>{intervalOptions.map((value) => <option key={value} value={value}>{value}%</option>)}</select></label>
          <label><span>POINTS</span><input type="number" min={1} max={HARVESTER_MAX_POINTS} value={pointCount} onChange={(event) => { setPointCount(Math.min(HARVESTER_MAX_POINTS, Math.max(1, Number(event.target.value)))); markStructuralChange(); }} /></label>
          <div className="harvester-action-group">
            {confirmRegenerate ? <div className="harvester-regenerate-confirm" role="alert">
              <small>Replace manual edits?</small>
              <button type="button" className="primary" onClick={performGenerate}>Replace plan</button>
              <button type="button" onClick={() => setConfirmRegenerate(false)}>Keep edits</button>
            </div> : <button type="button" className="primary" onClick={generate}>{stale ? "Regenerate Points" : "Generate Points"}</button>}
            {stale && <small>Settings changed · current plan retained</small>}
            {benchmarkProblem && <small className="warning">{benchmarkProblem}</small>}
          </div>
          <div className="harvester-action-group">
            <button type="button" className={addPointArmed ? "armed" : ""} disabled={points.length >= HARVESTER_MAX_POINTS || !result.feasible} onClick={() => setAddPointArmed((armed) => !armed)}>Add Point</button>
            {points.length >= HARVESTER_MAX_POINTS && <small>Maximum 10 harvest points</small>}
          </div>
          <fieldset className="harvester-drag-mode"><legend>DRAG MODE</legend>{(["vertical", "horizontal", "both"] as const).map((mode) => <button key={mode} type="button" className={dragMode === mode ? "on" : ""} onClick={() => setDragMode(mode)}>{mode[0].toUpperCase() + mode.slice(1)}</button>)}</fieldset>
          <button type="button" disabled={generatedPoints.length === 0} onClick={() => { setPoints(resetHarvestPoints(generatedPoints)); setManualEdits(false); setSelectedPointId(generatedPoints[0]?.id ?? null); }}>Reset Points</button>
          {selectedPoint && <div className="harvester-exact-controls">
            <label><span>CHECKPOINT</span><div className="harvester-unit-input"><input type="number" step={5} value={selectedPoint.movePercent} onChange={(event) => updatePoints(editHarvestPoint(snapshot, evaluatedBenchmark, evaluatedTarget, points, selectedPoint.id, { movePercent: Number(event.target.value) }, "horizontal"))} /><em>%</em></div></label>
            <label><span>ACTIVE V4 AFTER</span><div className="harvester-unit-input money"><em>$</em><input type="number" step={100} value={Math.round(selectedPoint.activeAfter)} onChange={(event) => updatePoints(editHarvestPoint(snapshot, evaluatedBenchmark, evaluatedTarget, points, selectedPoint.id, { activeAfter: Number(event.target.value) }, "vertical"))} /></div></label>
            <button type="button" className="danger" onClick={() => { updatePoints(deleteHarvestPoint(snapshot, evaluatedBenchmark, evaluatedTarget, points, selectedPoint.id), null); }}>Delete</button>
          </div>}
        </div>

        <div className="harvester-output-row">
          <section className="secured-capital">
            <small>SECURED CAPITAL</small>
            <strong>{money(result.recovery.currentSecured)}</strong>
            <div><span>Harvested cash <b>{money(result.final.totalHarvested)}</b></span><span>Original external <b>{money(result.recovery.originalExternalAtLatestCheckpoint)}</b></span></div>
            <p>Initial capital recovered: <b>{result.recovery.recovered ? "Yes" : "No"}</b>{result.recovery.recoveredAtMovePercent !== null && <> · Initial capital recovered at <b>{signedMove(result.recovery.recoveredAtMovePercent)}</b></>}</p>
            {!result.recovery.recovered && <progress max={result.recovery.initialInvestment} value={Math.min(result.recovery.initialInvestment, result.recovery.currentSecured)} />}
            {!result.recovery.recovered && <em>{money(result.recovery.currentSecured)} / {money(result.recovery.initialInvestment)}</em>}
          </section>
          <section className="harvester-final-metrics">
            <small>FINAL TARGET SUMMARY</small>
            <div><span>Remaining active V4<b>{money(result.final.remainingActiveV4)}</b></span><span>{benchmarkLabels[evaluatedBenchmark]} value<b>{result.final.benchmarkValue === null ? "Unavailable" : money(result.final.benchmarkValue)}</b></span><span>Original external<b>{money(result.final.originalExternalCapital)}</b></span><span>Total harvested<b>{money(result.final.totalHarvested)}</b></span><span>Total wealth<b>{money(result.final.totalWealth)}</b></span><span>Surplus over benchmark<b className={result.final.paritySatisfied ? "positive" : "negative"}>{result.final.finalSurplus === null ? "—" : money(result.final.finalSurplus)}</b></span></div>
          </section>
          <section className="harvester-ledger">
            <small>CHECKPOINT LEDGER</small>
            <div className="harvester-ledger-scroll">
              <table>
                <thead><tr><th>Checkpoint</th><th>V4 Before</th><th>Harvested</th><th>V4 After</th><th>Cumulative</th></tr></thead>
                <tbody>{result.points.length === 0 ? <tr><td colSpan={5}>No harvest points</td></tr> : result.points.map((entry) => <tr key={entry.id} className={entry.id === selectedPointId ? "selected" : ""} onClick={() => setSelectedPointId(entry.id)}><td>{signedMove(entry.movePercent)}</td><td>{money(entry.activeBefore)}</td><td>{money(entry.harvested)}</td><td>{money(entry.activeAfter)}</td><td>{money(entry.cumulativeHarvested)}</td></tr>)}</tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </section>
  </div>;
}
