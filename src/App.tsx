import { useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ADVANCED_MAX_LTV,
  dollarValue,
  effectiveLeverage,
  findDownsideBreakeven,
  findWorstDrawdown,
  longValue,
  portfolioReturn,
  shortValue,
} from "./model/v4Math";
import type {
  CashbackMode,
  Config,
  Objective,
  OptimiserCashbackMode,
  OptimiseOutcome,
} from "./model/types";

const money = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
const pct = (n: number) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(2)}%`;
const formatLtv = (ltv: number) => {
  const percent = ltv * 100;
  return `${Math.abs(percent - Math.round(percent)) < 1e-8 ? percent.toFixed(0) : percent.toFixed(2)}%`;
};
const objectives: Record<Objective, string> = {
  bullish: "Maximise bullish exposure",
  bearish: "Maximise bearish exposure",
  spotParity: "Maximise protection at spot parity",
};
const INITIAL_CONFIG: Config = {
  deposit: 10000,
  longAllocation: 0.6,
  longLtv: 0.75,
  shortLtv: 0.5,
  cashbackMode: "spot",
};
function Slider({
  label,
  value,
  min,
  max,
  onChange,
  detail,
  accent = "amber",
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  detail: string;
  accent?: string;
}) {
  const wholeMax = Math.floor(max),
    hasTerminalStop = max > wholeMax,
    sliderMax = hasTerminalStop ? wholeMax + 1 : max,
    sliderValue = hasTerminalStop && value > wholeMax ? sliderMax : value,
    displayValue = hasTerminalStop && value > wholeMax ? +max.toFixed(2) : value,
    snapValue = (next: number) => {
      if (hasTerminalStop && next > wholeMax) return max;
      return Math.min(wholeMax, Math.max(min, Math.round(next)));
    },
    commitValue = (next: number) => onChange(snapValue(next)),
    stepUp = () =>
      onChange(
        hasTerminalStop && value >= wholeMax
          ? max
          : Math.min(max, Math.round(value) + 1),
      ),
    stepDown = () =>
      onChange(
        hasTerminalStop && value > wholeMax
          ? wholeMax
          : Math.max(min, Math.round(value) - 1),
      );
  return (
    <div className={`slider-control ${accent}`}>
      <div className="control-label">
        <span>{label}</span>
        <b>{detail}</b>
      </div>
      <div className="slider-line">
        <input
          type="range"
          min={min}
          max={sliderMax}
          step="1"
          value={sliderValue}
          style={
            {
              "--fill": `${((sliderValue - min) / (sliderMax - min)) * 100}%`,
            } as React.CSSProperties
          }
          onChange={(e) => commitValue(+e.target.value)}
        />
        <div className="number-step">
          <input
            type="number"
            min={min}
            max={max}
            step={hasTerminalStop ? "0.01" : "1"}
            value={displayValue}
            onChange={(e) => commitValue(+e.target.value)}
          />
          <button
            type="button"
            aria-label={`Increase ${label}`}
            onClick={stepUp}
          >
            <span className="step-chevron" />
          </button>
          <button
            type="button"
            aria-label={`Decrease ${label}`}
            onClick={stepDown}
          >
            <span className="step-chevron down" />
          </button>
        </div>
      </div>
    </div>
  );
}
function HorizonInput({
  label,
  detail,
  value,
  min,
  max,
  sign,
  onChange,
}: {
  label: string;
  detail: string;
  value: number;
  min: number;
  max: number;
  sign: "+" | "−";
  onChange: (value: number) => void;
}) {
  const commitValue = (next: number) =>
    onChange(Math.min(max, Math.max(min, Math.round(next))));
  return (
    <div className="horizon-input">
      <div>
        <b>{label}</b>
        <small>{detail}</small>
      </div>
      <div className="horizon-step">
        <span>{sign}</span>
        <input
          type="number"
          min={min}
          max={max}
          step="1"
          value={value}
          onChange={(event) => commitValue(+event.target.value)}
        />
        <em>%</em>
        <button
          type="button"
          aria-label={`Increase ${label}`}
          onClick={() => commitValue(value + 1)}
        >
          <span className="step-chevron" />
        </button>
        <button
          type="button"
          aria-label={`Decrease ${label}`}
          onClick={() => commitValue(value - 1)}
        >
          <span className="step-chevron down" />
        </button>
      </div>
    </div>
  );
}
function ChartRangeInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const commitValue = (next: number) => onChange(Math.round(next / 10) * 10);
  return (
    <div className="chart-range-step">
      <input
        aria-label={label}
        type="number"
        step="10"
        value={value}
        onChange={(event) => commitValue(+event.target.value)}
      />
      <button
        type="button"
        aria-label={`Increase ${label}`}
        onClick={() => commitValue(value + 10)}
      >
        <span className="step-chevron" />
      </button>
      <button
        type="button"
        aria-label={`Decrease ${label}`}
        onClick={() => commitValue(value - 10)}
      >
        <span className="step-chevron down" />
      </button>
    </div>
  );
}
function ChartTooltip({
  active,
  payload,
  label,
  config,
}: {
  active?: boolean;
  payload?: any[];
  label?: number;
  config: Config;
}) {
  if (!active || !payload?.length) return null;
  const p = 1 + (label ?? 0) / 100,
    v4 = dollarValue(p, config),
    spot = config.deposit * p,
    edge = portfolioReturn(p, config) - (p - 1);
  return (
    <div className="chart-tooltip">
      <small>ASSET MOVE</small>
      <strong>{pct(p - 1)}</strong>
      <div>
        <i className="teal" />
        V4 STRATEGY <b>{pct(portfolioReturn(p, config))}</b>
        <em>{money(v4)}</em>
      </div>
      <div>
        <i className="slate" />
        HELD ASSET <b>{pct(p - 1)}</b>
        <em>{money(spot)}</em>
      </div>
      <div className="edge">
        EDGE VS SPOT <b>{pct(edge).replace("%", " pts")}</b>
      </div>
    </div>
  );
}
export default function App() {
  const [manualConfig, setManualConfig] = useState<Config>(() => ({
      ...INITIAL_CONFIG,
    })),
    [optimisedConfig, setOptimisedConfig] = useState<Config>(() => ({
      ...INITIAL_CONFIG,
    }));
  const [mode, setMode] = useState<"manual" | "optimise">("manual"),
    [objective, setObjective] = useState<Objective>("bullish"),
    [spotParityMagnitude, setSpotParityMagnitude] = useState(100),
    [downsideBreakevenMagnitude, setDownsideBreakevenMagnitude] = useState(80),
    [upsideBreakevenMagnitude, setUpsideBreakevenMagnitude] = useState(400),
    [cashbackPreference, setCashbackPreference] =
      useState<OptimiserCashbackMode>("optimise"),
    [requireBreakeven, setRequireBreakeven] = useState(false),
    [maxDD, setMaxDD] = useState(10),
    [advanced, setAdvanced] = useState(false),
    [minMove, setMinMove] = useState(-80),
    [maxMove, setMaxMove] = useState(150),
    [showLong, setShowLong] = useState(false),
    [showShort, setShowShort] = useState(false),
    [showMaths, setShowMaths] = useState(false),
    [optimising, setOptimising] = useState(false),
    [lastRun, setLastRun] = useState<{
      statusKey: string;
      inputs: Record<string, unknown>;
      result: Config;
      outcome: OptimiseOutcome;
    } | null>(null),
    [optimiseError, setOptimiseError] = useState<string | null>(null);
  useEffect(() => {
    if (!showMaths) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowMaths(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [showMaths]);
  const config = mode === "manual" ? manualConfig : optimisedConfig;
  const displayedCashbackMode =
    mode === "manual" || cashbackPreference === "optimise"
      ? config.cashbackMode
      : cashbackPreference;
  const optimisationCache = useRef(new Map<string, OptimiseOutcome>());
  const maxLtv = advanced ? ADVANCED_MAX_LTV * 100 : 75;
  const risk = useMemo(() => {
    const t = findWorstDrawdown(config);
    return { ...t, breakeven: findDownsideBreakeven(config, t) };
  }, [config]);
  const points = useMemo(
    () =>
      Array.from({ length: 180 }, (_, i) => {
        const move = minMove + ((maxMove - minMove) * i) / 179,
          p = 1 + move / 100;
        return {
          move,
          v4: portfolioReturn(p, config) * 100,
          spot: move,
          long: (longValue(p, config.longLtv, config.cashbackMode) - 1) * 100,
          short:
            (shortValue(p, config.shortLtv, config.cashbackMode) - 1) * 100,
        };
      }),
    [config, minMove, maxMove],
  );
  const update = (key: keyof Config, v: number | CashbackMode) => {
    const updateConfig = (current: Config) => ({ ...current, [key]: v });
    if (mode === "manual") setManualConfig(updateConfig);
    else setOptimisedConfig(updateConfig);
  };
  const setCashbackMode = (cashbackMode: CashbackMode) => {
    update("cashbackMode", cashbackMode);
    if (mode === "optimise") setCashbackPreference(cashbackMode);
  };
  const optimisationInputs = {
    deposit: config.deposit,
    maxDrawdown: objective === "spotParity" ? null : maxDD,
    objective,
    spotParityPercent:
      objective === "spotParity" ? spotParityMagnitude : null,
    cashbackMode: cashbackPreference,
    requireBreakeven,
    downsideBreakevenPercent: requireBreakeven
      ? -downsideBreakevenMagnitude
      : null,
    upsideBreakevenPercent: requireBreakeven
      ? upsideBreakevenMagnitude
      : null,
    maxLtv,
    advanced,
  };
  const searchKey = JSON.stringify(optimisationInputs);
  const statusKeyFor = (
    c: Config,
    inputs: Record<string, unknown> = optimisationInputs,
  ) =>
    JSON.stringify({
      ...inputs,
      longAllocation: c.longAllocation,
      longLtv: c.longLtv,
      shortLtv: c.shortLtv,
    });
  const currentStatusKey = statusKeyFor(config);
  const optimisationStatus = optimising
    ? "calculating"
    : !lastRun
      ? "not-run"
      : lastRun.statusKey === currentStatusKey
        ? "current"
        : "stale";
  const longReferenceLabel = `Long V4 · ${formatLtv(config.longLtv)} LTV · ${effectiveLeverage(config.longLtv).toFixed(2)}×`;
  const shortReferenceLabel = `Short V4 · ${formatLtv(config.shortLtv)} LTV · ${effectiveLeverage(config.shortLtv).toFixed(2)}×`;
  const longControlLabel = `Long V4 · ${formatLtv(config.longLtv)} · ${effectiveLeverage(config.longLtv).toFixed(2)}×`;
  const shortControlLabel = `Short V4 · ${formatLtv(config.shortLtv)} · ${effectiveLeverage(config.shortLtv).toFixed(2)}×`;
  const staleReason =
    lastRun && lastRun.inputs.objective !== objective
      ? "Objective changed"
      : lastRun &&
          lastRun.inputs.spotParityPercent !==
            (objective === "spotParity" ? spotParityMagnitude : null)
        ? "Spot parity target changed"
      : lastRun &&
          lastRun.inputs.maxDrawdown !==
            (objective === "spotParity" ? null : maxDD)
        ? "Risk target changed"
        : lastRun &&
            (lastRun.inputs.downsideBreakevenPercent !==
              (requireBreakeven ? -downsideBreakevenMagnitude : null) ||
              lastRun.inputs.upsideBreakevenPercent !==
                (requireBreakeven ? upsideBreakevenMagnitude : null))
          ? "Breakeven limits changed"
        : "Strategy inputs changed";
  const applyOptimisedResult = (
    outcome: OptimiseOutcome,
    requestedInputs: Record<string, unknown> = optimisationInputs,
  ) => {
    if (!outcome.config) {
      setOptimising(false);
      setOptimiseError(outcome.failure ?? "Optimisation failed");
      return;
    }
    const result = outcome.config;
    setOptimisedConfig(result);
    setCashbackPreference(
      requestedInputs.cashbackMode === "optimise"
        ? "optimise"
        : result.cashbackMode,
    );
    setLastRun({
      statusKey: statusKeyFor(result, requestedInputs),
      inputs: requestedInputs,
      result,
      outcome,
    });
    setOptimising(false);
  };
  const sendToManual = () => {
    setManualConfig({ ...optimisedConfig });
    setMode("manual");
  };
  const runOptimisation = () => {
    if (optimising) return;
    setOptimiseError(null);
    const cached = optimisationCache.current.get(searchKey);
    if (cached) return applyOptimisedResult(cached, optimisationInputs);
    setOptimising(true);
    const worker = new Worker(
      new URL("./model/optimiser.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = (
      event: MessageEvent<{
        ok: boolean;
        outcome?: OptimiseOutcome;
        error?: string;
      }>,
    ) => {
      worker.terminate();
      if (!event.data.ok || !event.data.outcome) {
        setOptimising(false);
        setOptimiseError(event.data.error ?? "Optimisation failed");
        return;
      }
      optimisationCache.current.set(searchKey, event.data.outcome);
      applyOptimisedResult(event.data.outcome, optimisationInputs);
    };
    worker.onerror = () => {
      worker.terminate();
      setOptimising(false);
      setOptimiseError("Optimisation worker failed");
    };
    worker.postMessage({
      maxDrawdown: maxDD / 100,
      maxLtv: maxLtv / 100,
      objective,
      spotParityPercent: spotParityMagnitude,
      cashbackMode: cashbackPreference,
      requireBreakeven,
      downsideBreakevenPercent: -downsideBreakevenMagnitude,
      upsideBreakevenPercent: upsideBreakevenMagnitude,
      deposit: config.deposit,
    });
  };
  const scenarios = [0.25, 0.5, 0.75, 0.9, 1.25, 1.5, 2, 3];
  return (
    <main>
      <header className="topbar">
        <div className="wordmark">
          <i />
          V4 SPECULATOR <span>PRICE MODEL</span>
        </div>
        <div className="topbar-actions">
          <div className="status">
            <b>LOCAL</b>
            <span>PRICE-ONLY</span>
            <span>NO FEES</span>
            <span>NO LIQUIDATION MODEL</span>
          </div>
          <button
            type="button"
            className={`maths-toggle ${showMaths ? "active" : ""}`}
            aria-pressed={showMaths}
            aria-expanded={showMaths}
            aria-controls="maths-dialog"
            onClick={() => setShowMaths((visible) => !visible)}
          >
            <span>ƒ</span>
            Show me the maths
          </button>
          <button
            type="button"
            className="window-close"
            aria-label="Close application"
            title="Close"
            onClick={() => window.desktopWindow?.close()}
          >
            <span />
          </button>
        </div>
      </header>
      {showMaths && (
        <div className="maths-overlay" onClick={() => setShowMaths(false)}>
          <article
            id="maths-dialog"
            className="maths-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="maths-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="maths-head">
              <div>
                <small>PAYOFF ENGINE</small>
                <h2 id="maths-title">The maths behind the chart</h2>
                <p>Normalised equations used for every plotted asset price.</p>
              </div>
              <button
                type="button"
                aria-label="Close maths"
                onClick={() => setShowMaths(false)}
              >
                ×
              </button>
            </header>

            <div className="maths-body">
              <section className="maths-card base">
                <div className="maths-card-title">
                  <i>01</i>
                  <div>
                    <b>Base chart calculation</b>
                    <span>Price, leverage and portfolio composition</span>
                  </div>
                </div>
                <div className="equation-stack">
                  <code><var>p</var> = 1 + asset move ÷ 100</code>
                  <code><var>m</var><sub>L/S</sub> = 0.5 ÷ (1 − LTV<sub>L/S</sub>)</code>
                  <code><var>V</var><sub>4</sub>(p) = <var>a</var>L(p) + (1 − <var>a</var>)S(p)</code>
                  <code>chart return = 100 × [<var>V</var><sub>4</sub>(p) − 1]</code>
                </div>
                <p>
                  <var>a</var> is the long allocation; the remainder is short.
                  Dollar value is deposit × <var>V</var><sub>4</sub>(p). The held-spot
                  comparator is simply deposit × <var>p</var>.
                </p>
              </section>

              <div className="maths-modes">
                <section className="maths-card cash">
                  <div className="maths-card-title">
                    <i>02</i>
                    <div>
                      <b>Cashback held as cash</b>
                      <span>The cashback component does not compound with spot</span>
                    </div>
                  </div>
                  <div className="equation-stack">
                    <code>L<sub>cash</sub>(p) = 0.5 + 0.5p<sup>m<sub>L</sub></sup></code>
                    <code>S<sub>cash</sub>(p) = 0.5 + 0.5p + 0.5m<sub>S</sub> ÷ p − 0.5m<sub>S</sub></code>
                  </div>
                </section>

                <section className="maths-card spot">
                  <div className="maths-card-title">
                    <i>03</i>
                    <div>
                      <b>Cashback reinvested in spot</b>
                      <span>The cashback component moves with the asset</span>
                    </div>
                  </div>
                  <div className="equation-stack">
                    <code>L<sub>spot</sub>(p) = 0.5p + 0.5p<sup>m<sub>L</sub></sup></code>
                    <code>S<sub>spot</sub>(p) = p + 0.5m<sub>S</sub> ÷ p − 0.5m<sub>S</sub></code>
                  </div>
                </section>
              </div>

              <section className="maths-assumptions">
                <div>
                  <small>LEVERAGE REFERENCE</small>
                  <strong>50% LTV → 1.00×</strong>
                  <strong>75% LTV → 2.00×</strong>
                  <strong>83% LTV → 2.94×</strong>
                  <strong>83.33% LTV → 3.00×</strong>
                </div>
                <div>
                  <small>MODEL ASSUMPTIONS</small>
                  <ul>
                    <li>All curves start at 1.00 when <var>p</var> = 1.</li>
                    <li>
                      Long and short LTVs are independently set and assumed to
                      be maintained through rebalancing.
                    </li>
                    <li>Price-only, static and path-independent.</li>
                    <li>
                      Base model excludes fees, yield, borrowing costs,
                      liquidation effects and slippage.
                    </li>
                    <li><var>p</var> is floored internally at 0.000001 because the short equation contains 1 ÷ <var>p</var>.</li>
                  </ul>
                </div>
              </section>
            </div>
            <footer>
              <span>V4 model equations · Normalised at entry</span>
              <button type="button" onClick={() => setShowMaths(false)}>
                Back to calculator
              </button>
            </footer>
          </article>
        </div>
      )}
      <div className="shell">
        <aside
          className={`rail ${mode} ${lastRun ? "has-optimised-result" : ""}`}
        >
          <div className="rail-head">
            <b>MODEL CONTROLS</b>
            <div className="segments">
              <button
                className={mode === "manual" ? "on" : ""}
                onClick={() => setMode("manual")}
              >
                Manual
              </button>
              <button
                className={mode === "optimise" ? "on" : ""}
                onClick={() => setMode("optimise")}
              >
                Optimise
              </button>
            </div>
          </div>
          <div className="control-group capital-settlement">
            <div className="control-group-title">CAPITAL &amp; SETTLEMENT</div>
            <section className="compact-control">
              <label className="field-label">DEPOSIT</label>
              <div className="deposit-input">
                <span>$</span>
                <input
                  type="number"
                  value={config.deposit}
                  onChange={(e) =>
                    update("deposit", Math.max(1, +e.target.value))
                  }
                />
              </div>
            </section>
            <section className="compact-control">
              <div className="section-label">
                <b>CASHBACK</b>
                <span>Settlement preference</span>
              </div>
              <div className="segments wide cashback-segments">
                <button
                  className={
                    (mode === "manual"
                      ? displayedCashbackMode === "cash"
                      : cashbackPreference === "cash")
                      ? "on"
                      : ""
                  }
                  onClick={() => setCashbackMode("cash")}
                >
                  Hold as cash
                </button>
                <button
                  className={
                    (mode === "manual"
                      ? displayedCashbackMode === "spot"
                      : cashbackPreference === "spot")
                      ? "on"
                      : ""
                  }
                  onClick={() => setCashbackMode("spot")}
                >
                  Reinvest in spot
                </button>
                {mode === "optimise" && (
                  <button
                    className={cashbackPreference === "optimise" ? "on" : ""}
                    onClick={() => setCashbackPreference("optimise")}
                  >
                    Auto
                  </button>
                )}
              </div>
            </section>
          </div>

          {mode === "manual" && (
            <div className="control-group manual-position">
              <div className="control-group-title">POSITION &amp; LEVERAGE</div>
              <section>
                <div className="section-label">
                  <b>ALLOCATION</b>
                  <span>Capital split</span>
                </div>
                <div className="split">
                  <span
                    className="long"
                    style={{ width: `${config.longAllocation * 100}%` }}
                  >
                    LONG <b>{(config.longAllocation * 100).toFixed(0)}%</b>
                  </span>
                  <span className="short">
                    SHORT <b>{((1 - config.longAllocation) * 100).toFixed(0)}%</b>
                  </span>
                </div>
                <Slider
                  label="Adjust allocation"
                  value={config.longAllocation * 100}
                  min={0}
                  max={100}
                  onChange={(v) => update("longAllocation", v / 100)}
                  detail="LONG ↔ SHORT"
                />
              </section>
              <section>
                <div className="section-label">
                  <b>LEVERAGE</b>
                  <span>Experimental above 75%</span>
                </div>
                <Slider
                  label="LONG"
                  value={config.longLtv * 100}
                  min={50}
                  max={maxLtv}
                  onChange={(v) => update("longLtv", v / 100)}
                  detail={`${effectiveLeverage(config.longLtv).toFixed(2)}× effective`}
                  accent="amber"
                />
                <Slider
                  label="SHORT"
                  value={config.shortLtv * 100}
                  min={50}
                  max={maxLtv}
                  onChange={(v) => update("shortLtv", v / 100)}
                  detail={`${effectiveLeverage(config.shortLtv).toFixed(2)}× effective`}
                  accent="violet"
                />
              </section>
              <label className="switch precision-switch">
                <input
                  type="checkbox"
                  checked={advanced}
                  onChange={(e) => setAdvanced(e.target.checked)}
                />
                <span />
                <div>
                  Advanced experimental range
                  <small>Extend controls to 83.33% LTV</small>
                </div>
              </label>
            </div>
          )}

          {mode === "optimise" && (
            <>
              <div className="control-group risk-constraints">
                <div className="control-group-title">RISK &amp; CONSTRAINTS</div>
                <section
                  className={`risk-target ${
                    objective === "spotParity" ? "objective-owned" : ""
                  }`}
                >
                  {objective === "spotParity" ? (
                    <div className="risk-context">
                      <i>∿</i>
                      <span>
                        <b>Spot parity is setting drawdown.</b>
                        Choose Bullish or Bearish to set a hard limit.
                      </span>
                    </div>
                  ) : (
                    <>
                      <div className="section-label">
                        <b>DRAWDOWN LIMIT</b>
                        <span>Maximum allowed</span>
                      </div>
                      <Slider
                        label="RISK LIMIT"
                        value={maxDD}
                        min={0}
                        max={50}
                        onChange={setMaxDD}
                        detail={`−${maxDD}%`}
                        accent="risk"
                      />
                    </>
                  )}
                </section>
                <label className="switch precision-switch">
                  <input
                    type="checkbox"
                    checked={advanced}
                    onChange={(e) => setAdvanced(e.target.checked)}
                  />
                  <span />
                  <div>
                    Advanced experimental range
                    <small>Permit LTVs up to 83.33%</small>
                  </div>
                </label>
                <label className="switch precision-switch breakeven-required">
                  <input
                    type="checkbox"
                    checked={requireBreakeven}
                    onChange={(e) => setRequireBreakeven(e.target.checked)}
                  />
                  <span />
                  <div>
                    Require adverse-side breakeven
                    <small>Allow the smallest necessary risk relaxation</small>
                  </div>
                </label>
                {requireBreakeven && (
                  <div className="breakeven-horizons">
                    {objective !== "bearish" && (
                      <HorizonInput
                        label="DOWNSIDE RECOVERY"
                        detail="Breakeven before asset falls"
                        value={downsideBreakevenMagnitude}
                        min={1}
                        max={99}
                        sign="−"
                        onChange={setDownsideBreakevenMagnitude}
                      />
                    )}
                    {objective === "bearish" && (
                      <HorizonInput
                        label="UPSIDE RECOVERY"
                        detail="Breakeven before asset rises"
                        value={upsideBreakevenMagnitude}
                        min={1}
                        max={2000}
                        sign="+"
                        onChange={setUpsideBreakevenMagnitude}
                      />
                    )}
                  </div>
                )}
              </div>

              <div className="control-group optimisation-target">
                <div className="control-group-title">OPTIMISATION TARGET</div>
                <section className="optimise target-control">
                  <label className="field-label">OBJECTIVE</label>
                  <select
                    value={objective}
                    onChange={(e) => setObjective(e.target.value as Objective)}
                  >
                    {Object.entries(objectives).map(([v, n]) => (
                      <option value={v} key={v}>
                        {n}
                      </option>
                    ))}
                  </select>
                  {objective === "spotParity" && (
                    <div className="spot-parity-control">
                      <div className="spot-parity-note">
                        <i>≋</i>
                        <span>
                          Match or outperform held spot at the selected target,
                          then maximise downside protection.
                        </span>
                      </div>
                      <HorizonInput
                        label="SPOT PARITY TARGET"
                        detail="Match spot if the asset rises"
                        value={spotParityMagnitude}
                        min={1}
                        max={2000}
                        sign="+"
                        onChange={setSpotParityMagnitude}
                      />
                    </div>
                  )}
                </section>
              </div>

              <div className="control-group optimisation-result">
                <div className="control-group-title">OPTIMISATION RESULT</div>
                <section className="optimise result-control">
                  <div className="optimisation-command">
                    <div className={`optimisation-state ${optimisationStatus}`}>
                      <i>
                        {optimisationStatus === "current"
                          ? "✓"
                          : optimisationStatus === "not-run"
                            ? "○"
                            : "●"}
                      </i>
                      <span>
                        {optimisationStatus === "not-run"
                          ? "Optimisation required"
                          : optimisationStatus === "current"
                            ? "Optimised"
                            : optimisationStatus === "stale"
                              ? staleReason
                              : "Optimising…"}
                      </span>
                    </div>
                    <button
                      className={`optimise-action ${optimisationStatus}`}
                      onClick={runOptimisation}
                      disabled={optimising}
                    >
                      {optimising
                        ? "Optimising…"
                        : optimisationStatus === "current"
                          ? "Re-run"
                          : optimisationStatus === "stale"
                            ? "Re-run optimisation"
                            : "Optimise"}
                    </button>
                  </div>
                  {optimiseError && (
                    <small className="optimise-error">{optimiseError}</small>
                  )}
                  {lastRun && (
                    <div
                      className={`optimised-config ${
                        optimisationStatus === "current" ? "current" : "previous"
                      }`}
                    >
                  {lastRun.inputs.objective === "spotParity" && (() => {
                    const parityPercent = Number(
                        lastRun.inputs.spotParityPercent,
                      ),
                      parityPrice = 1 + parityPercent / 100,
                      v4Return = portfolioReturn(parityPrice, lastRun.result),
                      spotReturn = parityPrice - 1;
                    return (
                      <div className="spot-parity-result">
                        <b>SPOT PARITY SECURED</b>
                        <span>
                          At +{parityPercent}% · V4 {pct(v4Return)} · spot{" "}
                          {pct(spotReturn)} · edge{" "}
                          {pct(v4Return - spotReturn).replace("%", " pts")}
                        </span>
                      </div>
                    );
                  })()}
                  {lastRun.outcome.drawdownRelaxed &&
                    lastRun.outcome.effectiveMaxDrawdown !== null && (
                      <div className="breakeven-result warning">
                        <b>RISK LIMIT EXCEEDED FOR BREAKEVEN</b>
                        <span>{`Requested −${(
                          lastRun.outcome.requestedMaxDrawdown * 100
                        ).toFixed(0)}% · Required −${(
                          lastRun.outcome.effectiveMaxDrawdown * 100
                        ).toFixed(0)}% · Exceeded by ${(
                          (lastRun.outcome.effectiveMaxDrawdown -
                            lastRun.outcome.requestedMaxDrawdown) *
                          100
                        ).toFixed(0)} pts`}</span>
                      </div>
                    )}
                  {lastRun.inputs.requireBreakeven === true &&
                    (lastRun.outcome.downsideBreakeven !== null ||
                      lastRun.outcome.upsideBreakeven !== null) && (
                      <div className="breakeven-result secured">
                        {lastRun.outcome.downsideBreakeven !== null && (
                          <span>
                            Downside{" "}
                            <b>{pct(lastRun.outcome.downsideBreakeven - 1)}</b>
                            {` within −${Math.abs(Number(lastRun.inputs.downsideBreakevenPercent))}%`}
                          </span>
                        )}
                        {lastRun.outcome.upsideBreakeven !== null && (
                          <span>
                            Upside{" "}
                            <b>{pct(lastRun.outcome.upsideBreakeven - 1)}</b>
                            {` within +${Number(lastRun.inputs.upsideBreakevenPercent)}%`}
                          </span>
                        )}
                      </div>
                    )}
                  <div className="optimised-config-head">
                    {optimisationStatus === "current"
                      ? "OPTIMISED CONFIGURATION"
                      : "LAST OPTIMISED CONFIGURATION"}
                  </div>
                  <div className="optimised-allocation">
                    <div>
                      <span
                        className="long"
                        style={{
                          width: `${lastRun.result.longAllocation * 100}%`,
                        }}
                      />
                      <span className="short" />
                    </div>
                    <small>
                      <span>
                        LONG <b>{(lastRun.result.longAllocation * 100).toFixed(0)}%</b>
                      </span>
                      <span>
                        SHORT <b>{((1 - lastRun.result.longAllocation) * 100).toFixed(0)}%</b>
                      </span>
                    </small>
                  </div>
                  <div className="optimised-values">
                    <span>
                      LONG LTV
                      <b>{formatLtv(lastRun.result.longLtv)}</b>
                    </span>
                    <span>
                      SHORT LTV
                      <b>{formatLtv(lastRun.result.shortLtv)}</b>
                    </span>
                    <span>
                      CASHBACK
                      <b>
                        {lastRun.result.cashbackMode === "cash" ? "CASH" : "SPOT"}
                      </b>
                    </span>
                  </div>
                    </div>
                  )}
                  <button
                    type="button"
                    className="send-manual"
                    onClick={sendToManual}
                    disabled={!lastRun || optimising}
                  >
                    Send current settings to Manual <b>→</b>
                  </button>
                </section>
              </div>
            </>
          )}
        </aside>
        <section className="workspace">
          <div className="readouts">
            <div>
              <label>PORTFOLIO</label>
              <strong>{money(config.deposit)}</strong>
              <span>
                {(config.longAllocation * 100).toFixed(0)}% long /{" "}
                {((1 - config.longAllocation) * 100).toFixed(0)}% short
              </span>
            </div>
            <div className="risk">
              <label>WORST DRAWDOWN</label>
              <strong>{pct(risk.drawdown)}</strong>
              <span>at {pct(risk.p - 1)} underlying</span>
            </div>
            <div>
              <label>DOWNSIDE BREAKEVEN</label>
              <strong>{risk.breakeven ? pct(risk.breakeven - 1) : "—"}</strong>
              <span>
                {risk.breakeven
                  ? "lower-price recovery"
                  : "not in modelled range"}
              </span>
            </div>
            <div>
              <label>LEVERAGE</label>
              <strong>
                {effectiveLeverage(config.longLtv).toFixed(2)}× <em>/</em>{" "}
                {effectiveLeverage(config.shortLtv).toFixed(2)}×
              </strong>
              <span>long / short effective</span>
            </div>
          </div>
          <div className="panel chart-panel">
            <div className="panel-head">
              <div>
                <b>PAYOFF SURFACE</b>
                <span>
                  V4 strategy return against underlying asset movement
                </span>
              </div>
              <div className="chart-controls">
                <label>
                  <input
                    type="checkbox"
                    checked={showLong}
                    onChange={(e) => setShowLong(e.target.checked)}
                  />{" "}
                  {longControlLabel}
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={showShort}
                    onChange={(e) => setShowShort(e.target.checked)}
                  />{" "}
                  {shortControlLabel}
                </label>
                <div className="chart-range-control">
                  <b>RANGE</b>
                  <ChartRangeInput
                    label="Minimum asset move"
                    value={minMove}
                    onChange={setMinMove}
                  />
                  <i>to</i>
                  <ChartRangeInput
                    label="Maximum asset move"
                    value={maxMove}
                    onChange={setMaxMove}
                  />
                  <em>%</em>
                </div>
              </div>
            </div>
            <div className="chart">
              <ResponsiveContainer>
                <ComposedChart
                  data={points}
                  margin={{ top: 15, right: 20, bottom: 12, left: 8 }}
                >
                  <defs>
                    <linearGradient id="v4Fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#d78349" stopOpacity={0.24} />
                      <stop offset="72%" stopColor="#b86f3c" stopOpacity={0.055} />
                      <stop offset="100%" stopColor="#b86f3c" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    stroke="#312f2c"
                    strokeOpacity={0.72}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="move"
                    type="number"
                    domain={[minMove, maxMove]}
                    ticks={[
                      minMove,
                      (minMove * 2) / 3,
                      minMove / 3,
                      0,
                      maxMove / 4,
                      maxMove / 2,
                      (maxMove * 3) / 4,
                      maxMove,
                    ]}
                    tickFormatter={(v) =>
                      `${v > 0 ? "+" : ""}${Math.round(v)}%`
                    }
                    stroke="#4f4a45"
                    tick={{ fontSize: 12, fill: "#9b9187" }}
                    allowDecimals={false}
                  />
                  <YAxis
                    domain={[-100, "auto"]}
                    allowDataOverflow
                    tickFormatter={(v) => `${Math.round(v)}%`}
                    stroke="#4f4a45"
                    tick={{ fontSize: 12, fill: "#9b9187" }}
                  />
                  <Tooltip content={<ChartTooltip config={config} />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <ReferenceLine y={0} stroke="#7e756c" strokeOpacity={0.72} />
                  <ReferenceLine
                    x={0}
                    stroke="#d4874c"
                    strokeOpacity={0.72}
                    strokeWidth={1.5}
                  />
                  {mode === "optimise" && objective !== "spotParity" && (
                    <ReferenceLine
                      y={-maxDD}
                      stroke="#a55f47"
                      strokeDasharray="5 4"
                      label={{
                        value: `risk limit −${maxDD}%`,
                        fill: "#be806b",
                        fontSize: 10,
                      }}
                    />
                  )}
                  <Area
                    dataKey="v4"
                    name="V4 strategy"
                    stroke="#e18a4a"
                    fill="url(#v4Fill)"
                    fillOpacity={1}
                    strokeWidth={3.4}
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    dataKey="spot"
                    name="Held asset"
                    stroke="#b8aea3"
                    strokeOpacity={0.78}
                    strokeWidth={1.35}
                    dot={false}
                    isAnimationActive={false}
                  />
                  {showLong && (
                    <Line
                      dataKey="long"
                      name={longReferenceLabel}
                      stroke="#db8b4c"
                      dot={false}
                      isAnimationActive={false}
                    />
                  )}{" "}
                  {showShort && (
                    <Line
                      dataKey="short"
                      name={shortReferenceLabel}
                      stroke="#837a70"
                      dot={false}
                      isAnimationActive={false}
                    />
                  )}
                  <ReferenceDot
                    x={(risk.p - 1) * 100}
                    y={risk.drawdown * 100}
                    r={5}
                    fill="#c8674f"
                    stroke="#151616"
                  />
                  <ReferenceDot
                    x={risk.breakeven ? (risk.breakeven - 1) * 100 : 0}
                    y={0}
                    r={4}
                    fill="#d4874c"
                    stroke="#151616"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="panel scenarios">
            <div className="panel-head">
              <div>
                <b>SCENARIO ANALYSIS</b>
                <span>
                  V4 strategy compared with the underlying spot asset
                </span>
              </div>
              <div className="scenario-key">
                <i /> V4 strategy <i /> spot asset
              </div>
            </div>
            <div className="scenario-table">
              <div className="scenario-row headings">
                <span>ASSET MOVE</span>
                <span className="v4-start">V4 VALUE</span>
                <span className="v4-end">V4 RETURN</span>
                <span className="spot-start">SPOT ASSET VALUE</span>
                <span className="spot-end">SPOT ASSET RETURN</span>
                <span className="edge-cell">V4 EDGE</span>
                <span>POSITION MIX</span>
              </div>
              {scenarios.map((p) => {
                const v = dollarValue(p, config),
                  spot = config.deposit * p,
                  edge = portfolioReturn(p, config) - (p - 1),
                  cash =
                    config.deposit *
                    0.5 *
                    (config.cashbackMode === "cash" ? 1 : p),
                  long =
                    config.deposit *
                    config.longAllocation *
                    0.5 *
                    p ** effectiveLeverage(config.longLtv),
                  short = v - cash - long,
                  compositionTotal =
                    Math.abs(cash) + Math.abs(long) + Math.abs(short) || 1,
                  cashWidth = (Math.abs(cash) / compositionTotal) * 100,
                  longWidth = (Math.abs(long) / compositionTotal) * 100,
                  shortWidth = (Math.abs(short) / compositionTotal) * 100;
                return (
                  <div
                    className={`scenario-row ${p < 1 ? "down" : "up"}`}
                    key={p}
                  >
                    <strong>{pct(p - 1)}</strong>
                    <b className="v4-start">{money(v)}</b>
                    <span className="v4-end">
                      {pct(portfolioReturn(p, config))}
                    </span>
                    <span className="spot-start">{money(spot)}</span>
                    <span className="spot-end">{pct(p - 1)}</span>
                    <span
                      className={`edge-cell ${edge >= 0 ? "positive" : "negative"}`}
                    >
                      {pct(edge).replace("%", " pts")}
                    </span>
                    <div
                      className="position-visual"
                      title={`Cash ${money(cash)}, Long ${money(long)}, Short ${money(short)}`}
                    >
                      <div className="position-stack" aria-hidden="true">
                        <span className="cash" style={{ width: `${cashWidth}%` }} />
                        <span className="long" style={{ width: `${longWidth}%` }} />
                        <span className="short" style={{ width: `${shortWidth}%` }} />
                      </div>
                      <small>
                        <span><i className="cash" />{money(cash)}</span>
                        <span><i className="long" />{money(long)}</span>
                        <span><i className="short" />{money(short)}</span>
                      </small>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
