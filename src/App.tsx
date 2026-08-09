import { useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
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
  dollarValue,
  effectiveLeverage,
  findDownsideBreakeven,
  findWorstDrawdown,
  longValue,
  MAX_V4_LTV,
  portfolioReturn,
  shortValue,
} from "./model/v4Math";
import {
  debtPositionReturn,
  debtPositionSummary,
  debtPositionValue,
  isDebtPositionLiquidated,
  type DebtPositionInput,
} from "./model/debtPosition";
import {
  isPerpPositionLiquidated,
  perpPositionReturn,
  perpPositionSummary,
  perpPositionValue,
  type PerpPositionInput,
} from "./model/perpPosition";
import type {
  CashbackMode,
  ComparisonMode,
  Config,
  Objective,
  OptimiserCashbackMode,
  OptimiseOutcome,
} from "./model/types";
import {
  supportsCashbackCrossover,
  type CashbackCrossoverResult,
} from "./model/cashbackCrossover";
import {
  createObjectiveAnalysis,
  type ObjectiveAnalysis,
} from "./model/objectiveAnalysis";

const money = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
const pct = (n: number) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(2)}%`;
const normaliseDisplayZero = (n: number, precision = 1) =>
  Math.abs(n) < 0.5 * 10 ** -precision ? 0 : n;
const signedFixed = (n: number, precision = 1) => {
  const value = normaliseDisplayZero(n, precision);
  return `${value > 0 ? "+" : ""}${value.toFixed(precision)}`;
};
function CrossoverValue({
  value,
  suffix,
  precision = 1,
}: {
  value: number;
  suffix: "%" | "pts";
  precision?: number;
}) {
  const normalised = normaliseDisplayZero(value, precision);
  return <>
    {normalised !== 0 && <span className="crossover-sign">{normalised > 0 ? "+" : "−"}</span>}
    {Math.abs(normalised).toFixed(precision)}
    <span className={suffix === "%" ? "crossover-percent" : "crossover-unit"}>{suffix === "%" ? "%" : " pts"}</span>
  </>;
}

const crossoverTradeoffText = (result: CashbackCrossoverResult) => {
  if (result.efficiency === null) return "No material drawdown change";
  const ratio = result.efficiency < 0.005 ? "<0.01" : result.efficiency.toFixed(2);
  const drawdownDirection = result.changePts > 0 ? "more" : "less";
  const payoffEffect = result.payoffDeltaPts < -0.05 ? "costs" : "buys";
  return `1 pt ${drawdownDirection} drawdown ${payoffEffect} ${ratio} payoff pts`;
};

function ObjectiveAnalysisBlock({ analysis }: { analysis: ObjectiveAnalysis }) {
  if (analysis.kind === "bearish") return (
    <section className="analytical-section objective-analysis" aria-label="Downside recovery analysis">
      <div className="crossover-section-heading">
        <h3>DOWNSIDE RECOVERY</h3>
        <span className="comparison-settings crossover-objective-tag">BEARISH</span>
      </div>
      <h4 className="objective-analysis-subheading">TROUGH <span className="crossover-output-arrow">&rarr;</span> TARGET</h4>
      <div className="analytical-stat-grid objective-analysis-grid">
        <span>Asset move</span>
        <b><CrossoverValue value={analysis.troughMove} suffix="%" />{" "}<span className="crossover-output-arrow">&rarr;</span>{" "}<CrossoverValue value={analysis.targetMove} suffix="%" /></b>
        <span>V4 return</span>
        <b><CrossoverValue value={analysis.troughReturn} suffix="%" />{" "}<span className="crossover-output-arrow">&rarr;</span>{" "}<CrossoverValue value={analysis.targetReturn} suffix="%" /></b>
      </div>
      <h4 className="crossover-subheading">RECOVERY</h4>
      <div className="analytical-stat-grid objective-analysis-grid objective-analysis-emphasis">
        <span>Return recovered</span>
        <b><CrossoverValue value={analysis.recoveryPts} suffix="pts" /></b>
      </div>
    </section>
  );

  if (analysis.kind === "dominance") {
    const benchmark = analysis.result.benchmark;
    const tag = benchmark === "lending" ? "LENDING" : benchmark === "perp" ? "PERP" : "SPOT";
    const benchmarkLabel = benchmark === "lending" ? "lending position" : benchmark === "perp" ? "perp position" : "spot";
    return (
      <section className="analytical-section objective-analysis" aria-label="Benchmark dominance analysis">
        <div className="crossover-section-heading">
          <h3>BENCHMARK DOMINANCE</h3>
          <span className="comparison-settings crossover-objective-tag">{tag}</span>
        </div>
        <h4 className="objective-analysis-subheading">TESTED RANGE</h4>
        <div className="objective-analysis-range">
          <b><CrossoverValue value={analysis.result.effectiveMinMove} suffix="%" />{" "}<span className="crossover-output-arrow">&rarr;</span>{" "}<CrossoverValue value={analysis.result.effectiveMaxMove} suffix="%" /></b>
        </div>
        <h4 className="crossover-subheading">WORST EDGE</h4>
        <div className="analytical-stat-grid objective-analysis-grid">
          <span>V4 vs {benchmarkLabel}</span>
          <b><CrossoverValue value={analysis.result.worstEdgePts} suffix="pts" /></b>
          <span>Occurs at</span>
          <b><CrossoverValue value={analysis.result.worstMove} suffix="%" /> move</b>
        </div>
        <h4 className="crossover-subheading">V4 AHEAD</h4>
        <div className="objective-analysis-range"><b>{analysis.result.aheadPercent.toFixed(1)}<span className="crossover-percent">%</span></b><span> of tested range</span></div>
        <h4 className="crossover-subheading">AVERAGE EDGE</h4>
        <div className="objective-analysis-range"><b><CrossoverValue value={analysis.result.averageEdgePts} suffix="pts" /></b></div>
      </section>
    );
  }

  const isSpot = analysis.kind === "spot";
  const benchmarkLabel = analysis.kind === "lending"
    ? "Lending position"
    : analysis.kind === "perp"
      ? "Perp position"
      : "Spot";
  const tag = analysis.kind === "spot"
    ? "SPOT"
    : analysis.kind === "lending"
      ? "LENDING"
      : "PERP";
  return (
    <section className="analytical-section objective-analysis" aria-label={`${tag.toLowerCase()} parity analysis`}>
      <div className="crossover-section-heading">
        <h3>{isSpot ? "PROTECTION AT PARITY" : "BENCHMARK PROTECTION"}</h3>
        <span className="comparison-settings crossover-objective-tag">{tag}</span>
      </div>
      <h4 className="objective-analysis-subheading">AT PARITY TARGET</h4>
      <div className="analytical-stat-grid objective-analysis-grid">
        <span>V4</span>
        <b><CrossoverValue value={analysis.target.v4Return} suffix="%" /></b>
        <span>{benchmarkLabel}</span>
        <b><CrossoverValue value={analysis.target.benchmarkReturn} suffix="%" /></b>
        <span>Margin</span>
        <b><CrossoverValue value={analysis.target.parityMargin} suffix="pts" /></b>
      </div>
      {analysis.kind === "spot" ? <>
        <h4 className="crossover-subheading">DOWNSIDE PROTECTION</h4>
        <div className="analytical-stat-grid objective-analysis-grid">
          <span>V4 max drawdown</span>
          <b><CrossoverValue value={analysis.v4MaxDrawdown} suffix="%" /></b>
          <span>Spot max drawdown</span>
          <b><CrossoverValue value={analysis.spotMaxDrawdown} suffix="%" /></b>
          <span>Protection gained</span>
          <b><CrossoverValue value={analysis.protectionGained} suffix="pts" /></b>
        </div>
      </> : analysis.liquidation && <>
        <h4 className="liquidation-subheading">
          {analysis.kind === "lending" ? "LENDING POSITION LIQUIDATION LEVEL" : "PERP POSITION LIQUIDATION LEVEL"}
        </h4>
        <div className="analytical-stat-grid objective-analysis-grid">
          <span>Liquidates at</span>
          <b><CrossoverValue value={analysis.liquidation.assetMove} suffix="%" /></b>
          <span>V4 return at that point</span>
          <b><CrossoverValue value={analysis.liquidation.v4Return} suffix="%" /></b>
          <span>V4 value at that point</span>
          <b>{money(analysis.liquidation.v4Value)}</b>
        </div>
      </>}
    </section>
  );
}
const formatLtv = (ltv: number) => {
  const percent = ltv * 100;
  return `${Math.abs(percent - Math.round(percent)) < 1e-8 ? percent.toFixed(0) : percent.toFixed(2)}%`;
};
const objectives: Record<Objective, string> = {
  bullish: "Maximise bullish exposure",
  bearish: "Maximise bearish exposure",
  spotParity: "Maximise protection at spot parity",
  debtParity: "Maximise protection at lending parity",
  perpParity: "Maximise protection at perp parity",
  benchmarkDominance: "Benchmark dominance",
};
const INITIAL_CONFIG: Config = {
  deposit: 10000,
  longAllocation: 0.5,
  longLtv: 0.5,
  shortLtv: 0.5,
  cashbackMode: "spot",
};
const DEFAULT_LENDING = {
  assetPrice: 4000,
  assetAmount: 20,
  usdDebt: 15000,
  liquidationLtv: 90,
};
const DEFAULT_PERP: PerpPositionInput = {
  assetPrice: 1900,
  averageEntryPrice: 1500,
  positionSize: 20,
  margin: 10000,
  liquidationPrice: 1100,
  side: "long",
};
function NumericInput({
  value,
  onValueChange,
  emptyWhenZero = false,
  min,
  max,
  step,
  placeholder,
  readOnly = false,
  className,
  displayPrecision,
  "aria-label": ariaLabel,
}: {
  value: number;
  onValueChange: (value: number) => void;
  emptyWhenZero?: boolean;
  min?: number;
  max?: number;
  step?: number | string;
  placeholder?: string;
  readOnly?: boolean;
  className?: string;
  displayPrecision?: number;
  "aria-label"?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const formattedValue = () => emptyWhenZero && value === 0
    ? ""
    : displayPrecision === undefined
      ? String(value)
      : value.toFixed(displayPrecision);
  const [draft, setDraft] = useState(formattedValue);
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setDraft(formattedValue());
  }, [value, emptyWhenZero, displayPrecision]);
  const commit = (next: string) => {
    setDraft(next);
    if (next.trim() === "") return;
    const parsed = Number(next);
    if (Number.isFinite(parsed)) onValueChange(parsed);
  };
  return (
    <input
      ref={inputRef}
      type="number"
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      className={className}
      aria-label={ariaLabel}
      readOnly={readOnly}
      value={draft}
      onChange={(event) => commit(event.target.value)}
      onBlur={() => {
        if (draft.trim() === "") setDraft(formattedValue());
      }}
    />
  );
}
function Slider({
  label,
  value,
  min,
  max,
  onChange,
  detail,
  accent = "amber",
  signedDisplay = false,
  autoWhenMax = false,
  disabled = false,
  step = 1,
  displayPrecision,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  detail: string;
  accent?: string;
  signedDisplay?: boolean;
  autoWhenMax?: boolean;
  disabled?: boolean;
  step?: number;
  displayPrecision?: number;
}) {
  const sliderValue = value,
    displayValue = value,
    inputValue = signedDisplay ? -displayValue : displayValue,
    isAuto = autoWhenMax && value >= max,
    snapValue = (next: number) => {
      const snapped = min + Math.round((next - min) / step) * step;
      return Math.min(max, Math.max(min, +snapped.toFixed(10)));
    },
    commitValue = (next: number) => onChange(snapValue(next)),
    stepUp = () => {
      const next = signedDisplay
          ? Math.min(max, value + step)
          : Math.min(max, value + step);
      onChange(snapValue(next));
    },
    stepDown = () => {
      const next = signedDisplay
        ? Math.max(min, value - step)
        : Math.max(min, value - step);
      onChange(snapValue(next));
    },
    commitInput = (next: number) => {
      if (!Number.isFinite(next)) return;
      onChange(snapValue(signedDisplay ? Math.abs(next) : next));
    };
  return (
    <div className={`slider-control ${accent}`}>
      <div className="control-label">
        <span>{label}</span>
        {detail && <b>{detail}</b>}
      </div>
      <div className="slider-line">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={sliderValue}
          style={
            {
              "--fill": `${((sliderValue - min) / (max - min)) * 100}%`,
            } as React.CSSProperties
          }
          onChange={(e) => commitValue(+e.target.value)}
          disabled={disabled}
        />
        <div className="number-step">
          {isAuto ? (
            <input type="text" value="AUTO" readOnly aria-label={`${label} automatic`} />
          ) : (
            <NumericInput
              step={step}
              min={signedDisplay ? -max : min}
              max={signedDisplay ? -min : max}
              value={inputValue}
              displayPrecision={displayPrecision}
              onValueChange={commitInput}
              readOnly={disabled}
            />
          )}
          <button
            type="button"
            aria-label={`Increase ${label}`}
            onClick={stepUp}
            disabled={disabled}
          >
            <span className="step-chevron" />
          </button>
          <button
            type="button"
            aria-label={`Decrease ${label}`}
            onClick={stepDown}
            disabled={disabled}
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
        <NumericInput
          min={min}
          max={max}
          step="1"
          value={value}
          onValueChange={commitValue}
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
      <NumericInput
        aria-label={label}
        step="10"
        value={value}
        onValueChange={commitValue}
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
  active, payload, label, config, debtPosition, comparisonMode, perpPosition,
  baseAssetValue, assetLabel, showLong, showShort, showSpot, showDebt, showPerp,
}: {
  active?: boolean;
  payload?: any[];
  label?: number;
  config: Config;
  debtPosition: DebtPositionInput;
  comparisonMode: ComparisonMode;
  perpPosition: PerpPositionInput;
  baseAssetValue: number;
  assetLabel: string;
  showLong: boolean;
  showShort: boolean;
  showSpot: boolean;
  showDebt: boolean;
  showPerp: boolean;
}) {
  if (!active || !payload?.length) return null;

  const p = 1 + (label ?? 0) / 100;
  const v4 = dollarValue(p, config);
  const v4Return = portfolioReturn(p, config);
  const debtReturn = debtPositionReturn(p, debtPosition);
  const debtLiquidated = isDebtPositionLiquidated(p, debtPosition);
  const perpReturn = perpPositionReturn(p, perpPosition);
  const perpLiquidated = isPerpPositionLiquidated(p, perpPosition);
  const assetPrice = comparisonMode === "base" && baseAssetValue > 0
    ? baseAssetValue
    : comparisonMode === "lending"
      ? debtPosition.assetPrice
      : comparisonMode === "perp"
        ? perpPosition.assetPrice
        : null;

  type TooltipMetric = {
    key: "lending" | "perp" | "spot" | "long" | "short";
    label: string;
    edgeLabel: string;
    icon: string;
    returnValue: number | null;
    dollarValue: number | null;
    liquidated?: boolean;
  };
  const metrics: TooltipMetric[] = [];

  if (comparisonMode === "lending" && showDebt) {
    metrics.push({ key: "lending", label: "LENDING POSITION", edgeLabel: "LENDING", icon: "debt", returnValue: debtLiquidated ? null : debtReturn, dollarValue: debtLiquidated ? null : debtPositionValue(p, debtPosition), liquidated: debtLiquidated });
  }
  if (comparisonMode === "perp" && showPerp) {
    metrics.push({ key: "perp", label: "PERP POSITION", edgeLabel: "PERP", icon: "perp", returnValue: perpLiquidated ? null : perpReturn, dollarValue: perpLiquidated ? null : perpPositionValue(p, perpPosition), liquidated: perpLiquidated });
  }
  if (showSpot) {
    metrics.push({ key: "spot", label: `HELD ${assetLabel}`, edgeLabel: assetLabel, icon: "slate", returnValue: p - 1, dollarValue: config.deposit * p });
  }
  if (showLong) {
    const value = longValue(p, config.longLtv, config.cashbackMode);
    metrics.push({ key: "long", label: "LONG V4", edgeLabel: "LONG V4", icon: "long", returnValue: value - 1, dollarValue: config.deposit * value });
  }
  if (showShort) {
    const value = shortValue(p, config.shortLtv, config.cashbackMode);
    metrics.push({ key: "short", label: "SHORT V4", edgeLabel: "SHORT V4", icon: "short", returnValue: value - 1, dollarValue: config.deposit * value });
  }

  const primaryMetric = metrics.find((metric) => metric.returnValue !== null) ?? metrics[0] ?? null;
  const secondaryMetrics = primaryMetric ? metrics.filter((metric) => metric.key !== primaryMetric.key) : [];
  const renderMetric = (metric: TooltipMetric) => (
    <div className="tooltip-value" key={metric.key}>
      <i className={metric.icon} />
      {metric.label}
      <b>{metric.liquidated ? "LIQUIDATED" : metric.returnValue === null ? "—" : pct(metric.returnValue)}</b>
      {metric.dollarValue !== null && <em>{money(metric.dollarValue)}</em>}
    </div>
  );

  return (
    <div className="chart-tooltip">
      <div className="tooltip-asset">
        <small>{assetLabel}</small>
        <strong>{assetPrice === null ? `${p.toFixed(3)}×` : money(assetPrice * p)}</strong>
        <span aria-hidden="true" />
        <b>{pct(p - 1)}</b>
      </div>
      <div className={`tooltip-values${primaryMetric ? "" : " single"}`}>
        <div className="tooltip-value">
          <i className="teal" />
          V4 STRATEGY <b>{pct(v4Return)}</b>
          <em>{money(v4)}</em>
        </div>
        {primaryMetric && renderMetric(primaryMetric)}
      </div>
      {primaryMetric && primaryMetric.returnValue !== null && (
        <div className="edge">
          V4 EDGE VS {primaryMetric.edgeLabel} <b>{pct(v4Return - primaryMetric.returnValue).replace("%", " pts")}</b>
        </div>
      )}
      {secondaryMetrics.length > 0 && <div className="tooltip-legs">{secondaryMetrics.map(renderMetric)}</div>}
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
    [comparisonMode, setComparisonMode] = useState<ComparisonMode>("base"),
    [objective, setObjective] = useState<Objective>("bullish"),
    [spotParityMagnitude, setSpotParityMagnitude] = useState(100),
    [debtParityMagnitude, setDebtParityMagnitude] = useState(50),
    [perpParityMagnitude, setPerpParityMagnitude] = useState(50),
    [downsideBreakevenMagnitude, setDownsideBreakevenMagnitude] = useState(80),
    [upsideBreakevenMagnitude, setUpsideBreakevenMagnitude] = useState(400),
    [cashbackPreference, setCashbackPreference] =
      useState<OptimiserCashbackMode>("optimise"),
    [requireBreakeven, setRequireBreakeven] = useState(false),
    [maxDD, setMaxDD] = useState(15),
    [longLtvLimit, setLongLtvLimit] = useState(MAX_V4_LTV * 100),
    [shortLtvLimit, setShortLtvLimit] = useState(MAX_V4_LTV * 100),
    [leverageLimitsExpanded, setLeverageLimitsExpanded] = useState(false),
    [bullishTarget, setBullishTarget] = useState(200),
    [bearishTarget, setBearishTarget] = useState(-75),
    [searchStep, setSearchStep] = useState(1),
    [minMove, setMinMove] = useState(-80),
    [maxMove, setMaxMove] = useState(150),
    [showLong, setShowLong] = useState(false),
    [showShort, setShowShort] = useState(false),
    [showSpot, setShowSpot] = useState(true),
    [showDebt, setShowDebt] = useState(true),
    [showLiquidationLine, setShowLiquidationLine] = useState(true),
    [showDrawdownLine, setShowDrawdownLine] = useState(true),
    [baseAssetValue, setBaseAssetValue] = useState(0),
    [assetPrice, setAssetPrice] = useState(DEFAULT_LENDING.assetPrice),
    [assetAmount, setAssetAmount] = useState(DEFAULT_LENDING.assetAmount),
    [usdDebt, setUsdDebt] = useState(DEFAULT_LENDING.usdDebt),
    [liquidationLtv, setLiquidationLtv] = useState(DEFAULT_LENDING.liquidationLtv),
    [perpState, setPerpState] = useState<PerpPositionInput>({ ...DEFAULT_PERP }),
    [showPerp, setShowPerp] = useState(true),
    [showMaths, setShowMaths] = useState(false),
    [showSettings, setShowSettings] = useState(false),
    [showAssetName, setShowAssetName] = useState(false),
    [assetName, setAssetName] = useState("ASSET"),
    [optimising, setOptimising] = useState(false),
    [lastRun, setLastRun] = useState<{
      statusKey: string;
      inputs: Record<string, unknown>;
      result: Config;
      outcome: OptimiseOutcome;
      crossover: CashbackCrossoverResult | null;
    } | null>(null),
    [optimiseError, setOptimiseError] = useState<string | null>(null);
  const railScrollRef = useRef<HTMLDivElement>(null);
  const [railCanScrollUp, setRailCanScrollUp] = useState(false);
  const [railCanScrollDown, setRailCanScrollDown] = useState(false);
  const updateRailScrollIndicators = () => {
    const rail = railScrollRef.current;
    if (!rail) return;
    setRailCanScrollUp(rail.scrollTop > 1);
    setRailCanScrollDown(rail.scrollTop + rail.clientHeight < rail.scrollHeight - 1);
  };
  const [persistenceLoaded, setPersistenceLoaded] = useState(
    () => !window.desktopWindow?.loadInputs,
  );
  useEffect(() => {
    if (!showMaths) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowMaths(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [showMaths]);
  useEffect(() => {
    const frame = window.requestAnimationFrame(updateRailScrollIndicators);
    window.addEventListener("resize", updateRailScrollIndicators);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updateRailScrollIndicators);
    };
  }, [comparisonMode, mode, leverageLimitsExpanded, requireBreakeven, lastRun]);
  useEffect(() => {
    const loadInputs = window.desktopWindow?.loadInputs;
    if (!loadInputs) return;
    let cancelled = false;
    const isNumber = (value: unknown): value is number =>
      typeof value === "number" && Number.isFinite(value);
    const isConfig = (value: unknown): value is Config => {
      if (!value || typeof value !== "object") return false;
      const input = value as Record<string, unknown>;
      return isNumber(input.deposit) && isNumber(input.longAllocation) &&
        isNumber(input.longLtv) && isNumber(input.shortLtv) &&
        (input.cashbackMode === "cash" || input.cashbackMode === "spot");
    };
    const isPerp = (value: unknown): value is PerpPositionInput => {
      if (!value || typeof value !== "object") return false;
      const input = value as Record<string, unknown>;
      return isNumber(input.assetPrice) && isNumber(input.averageEntryPrice) &&
        isNumber(input.positionSize) && isNumber(input.margin) &&
        isNumber(input.liquidationPrice) &&
        (input.side === "long" || input.side === "short");
    };
    void loadInputs().then((value) => {
      if (cancelled || !value || typeof value !== "object") return;
      const saved = value as Record<string, unknown>;
      if (saved.comparisonMode === "base" || saved.comparisonMode === "lending" || saved.comparisonMode === "perp") setComparisonMode(saved.comparisonMode);
      if (saved.mode === "manual" || saved.mode === "optimise") setMode(saved.mode);
      if (isConfig(saved.manualConfig)) setManualConfig(saved.manualConfig);
      if (isConfig(saved.optimisedConfig)) setOptimisedConfig(saved.optimisedConfig);
      if (saved.objective === "bullish" || saved.objective === "bearish" || saved.objective === "spotParity" || saved.objective === "debtParity" || saved.objective === "perpParity" || saved.objective === "benchmarkDominance") setObjective(saved.objective);
      if (isNumber(saved.spotParityMagnitude)) setSpotParityMagnitude(saved.spotParityMagnitude);
      if (isNumber(saved.debtParityMagnitude)) setDebtParityMagnitude(saved.debtParityMagnitude);
      if (isNumber(saved.perpParityMagnitude)) setPerpParityMagnitude(saved.perpParityMagnitude);
      if (isNumber(saved.downsideBreakevenMagnitude)) setDownsideBreakevenMagnitude(saved.downsideBreakevenMagnitude);
      if (isNumber(saved.upsideBreakevenMagnitude)) setUpsideBreakevenMagnitude(saved.upsideBreakevenMagnitude);
      if (saved.cashbackPreference === "cash" || saved.cashbackPreference === "spot" || saved.cashbackPreference === "optimise") setCashbackPreference(saved.cashbackPreference);
      if (typeof saved.requireBreakeven === "boolean") setRequireBreakeven(saved.requireBreakeven);
      if (isNumber(saved.maxDD)) setMaxDD(saved.maxDD);
      if (isNumber(saved.longLtvLimit)) setLongLtvLimit(Math.min(MAX_V4_LTV * 100, Math.max(50, saved.longLtvLimit)));
      if (isNumber(saved.shortLtvLimit)) setShortLtvLimit(Math.min(MAX_V4_LTV * 100, Math.max(50, saved.shortLtvLimit)));
      if (isNumber(saved.bullishTarget)) setBullishTarget(Math.max(1, saved.bullishTarget));
      if (isNumber(saved.bearishTarget)) setBearishTarget(Math.min(-1, Math.max(-99, saved.bearishTarget)));
      if (isNumber(saved.searchStep)) setSearchStep(Math.min(5, Math.max(0.25, saved.searchStep)));
      if (isNumber(saved.minMove)) setMinMove(saved.minMove);
      if (isNumber(saved.maxMove)) setMaxMove(saved.maxMove);
      if (typeof saved.showLong === "boolean") setShowLong(saved.showLong);
      if (typeof saved.showShort === "boolean") setShowShort(saved.showShort);
      if (typeof saved.showSpot === "boolean") setShowSpot(saved.showSpot);
      if (typeof saved.showDebt === "boolean") setShowDebt(saved.showDebt);
      if (typeof saved.showPerp === "boolean") setShowPerp(saved.showPerp);
      if (typeof saved.showLiquidationLine === "boolean") setShowLiquidationLine(saved.showLiquidationLine);
      if (typeof saved.showDrawdownLine === "boolean") setShowDrawdownLine(saved.showDrawdownLine);
      if (isNumber(saved.baseAssetValue)) setBaseAssetValue(Math.max(0, saved.baseAssetValue));
      if (isNumber(saved.assetPrice)) setAssetPrice(saved.assetPrice);
      if (isNumber(saved.assetAmount)) setAssetAmount(saved.assetAmount);
      if (isNumber(saved.usdDebt)) setUsdDebt(saved.usdDebt);
      if (isNumber(saved.liquidationLtv)) setLiquidationLtv(saved.liquidationLtv);
      if (isPerp(saved.perpState)) setPerpState(saved.perpState);
      if (typeof saved.assetName === "string") setAssetName(saved.assetName.trim().slice(0, 16) || "ASSET");
    }).finally(() => {
      if (!cancelled) setPersistenceLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);
  const debtPosition = useMemo<DebtPositionInput>(
    () => ({ assetPrice, assetAmount, usdDebt, liquidationLtv: liquidationLtv / 100 }),
    [assetPrice, assetAmount, usdDebt, liquidationLtv],
  );
  const debtSummary = useMemo(
    () => debtPositionSummary(debtPosition),
    [debtPosition],
  );
  const perpSummary = useMemo(() => perpPositionSummary(perpState), [perpState]);
  const perpInputsAreValid =
    Number.isFinite(perpState.assetPrice) && perpState.assetPrice > 0 &&
    Number.isFinite(perpState.averageEntryPrice) && perpState.averageEntryPrice > 0 &&
    Number.isFinite(perpState.positionSize) && perpState.positionSize > 0 &&
    Number.isFinite(perpState.margin) && perpState.margin >= 0 &&
    Number.isFinite(perpState.liquidationPrice) && perpState.liquidationPrice > 0;
  useEffect(() => {
    const saveInputs = window.desktopWindow?.saveInputs;
    if (!persistenceLoaded || !saveInputs) return;
    const timer = window.setTimeout(() => {
      void saveInputs({
        comparisonMode, mode, manualConfig, optimisedConfig, objective,
        spotParityMagnitude, debtParityMagnitude, perpParityMagnitude, downsideBreakevenMagnitude,
        upsideBreakevenMagnitude, cashbackPreference, requireBreakeven, maxDD, longLtvLimit, shortLtvLimit, bullishTarget, bearishTarget, searchStep,
        minMove, maxMove, showLong, showShort, showSpot, showDebt, showPerp,
        showLiquidationLine, showDrawdownLine, baseAssetValue, assetPrice, assetAmount,
        usdDebt, liquidationLtv, perpState, assetName,
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [
    assetAmount, assetName, assetPrice, baseAssetValue, cashbackPreference, comparisonMode, debtParityMagnitude,
    bearishTarget, bullishTarget, downsideBreakevenMagnitude, liquidationLtv, longLtvLimit, manualConfig, maxDD, maxMove,
    minMove, mode, objective, optimisedConfig, perpParityMagnitude, perpState, persistenceLoaded,
    requireBreakeven, searchStep, shortLtvLimit, showDebt, showDrawdownLine, showLiquidationLine, showLong, showSpot,
    showPerp, showShort, spotParityMagnitude, upsideBreakevenMagnitude, usdDebt,
  ]);
  const comparisonIsValid = comparisonMode === "base"
    ? true
    : comparisonMode === "lending"
      ? debtSummary.netEquity > 0
      : perpInputsAreValid && perpSummary.currentEquity > 0;
  const baseConfig = mode === "manual" ? manualConfig : optimisedConfig;
  const config = useMemo(
    () => ({
      ...baseConfig,
      deposit: comparisonMode === "lending"
        ? Math.max(0, debtSummary.netEquity)
        : comparisonMode === "perp"
          ? Math.max(0, perpSummary.currentEquity)
          : baseConfig.deposit,
    }),
    [baseConfig, comparisonMode, debtSummary.netEquity, perpSummary.currentEquity],
  );
  const displayedCashbackMode =
    mode === "manual" || cashbackPreference === "optimise"
      ? config.cashbackMode
      : cashbackPreference;
  const optimisationCache = useRef(new Map<string, {
    outcome: OptimiseOutcome;
    crossover: CashbackCrossoverResult | null;
  }>());
  const maxLtv = MAX_V4_LTV * 100;
  const risk = useMemo(() => {
    const t = findWorstDrawdown(config);
    return { ...t, breakeven: findDownsideBreakeven(config, t) };
  }, [config]);
  const positionBreakdown = useMemo(() => {
    const cashbackAmount = config.deposit * 0.5;
    const currentAssetPrice = comparisonMode === "lending"
      ? assetPrice
      : comparisonMode === "perp"
        ? perpState.assetPrice
        : null;
    const spotUnits = config.cashbackMode === "spot" && currentAssetPrice && currentAssetPrice > 0
      ? cashbackAmount / currentAssetPrice
      : null;
    return {
      longCapital: config.deposit * config.longAllocation,
      shortCapital: config.deposit * (1 - config.longAllocation),
      cashbackAmount,
      spotUnits,
    };
  }, [assetPrice, comparisonMode, config, perpState.assetPrice]);
  const points = useMemo(
    () => {
      const moves = Array.from(
        { length: 180 },
        (_, i) => minMove + ((maxMove - minMove) * i) / 179,
      );
      const liquidationMove = comparisonMode === "lending"
        ? debtSummary.liquidationAssetMove
        : comparisonMode === "perp"
          ? perpSummary.liquidationAssetMove
          : null;
      if (
        liquidationMove !== null &&
        liquidationMove >= minMove &&
        liquidationMove <= maxMove
      ) moves.push(liquidationMove);
      return [...new Set(moves)].sort((a, b) => a - b).map((move) => {
        const
          p = 1 + move / 100;
        return {
          move,
          v4: portfolioReturn(p, config) * 100,
          spot: move,
          long: (longValue(p, config.longLtv, config.cashbackMode) - 1) * 100,
          short:
            (shortValue(p, config.shortLtv, config.cashbackMode) - 1) * 100,
          debt:
            comparisonMode === "lending" && isDebtPositionLiquidated(p, debtPosition) &&
            move !== debtSummary.liquidationAssetMove
              ? null
              : comparisonMode === "lending"
                ? (debtPositionReturn(p, debtPosition) ?? 0) * 100
                : null,
          perp:
            comparisonMode === "perp" && isPerpPositionLiquidated(p, perpState) &&
            move !== perpSummary.liquidationAssetMove
              ? null
              : comparisonMode === "perp"
                ? (perpPositionReturn(p, perpState) ?? 0) * 100
                : null,
        };
      });
    },
    [comparisonMode, config, debtPosition, debtSummary.liquidationAssetMove, minMove, maxMove, perpState, perpSummary.liquidationAssetMove],
  );
  const yAxisMax = useMemo(() => {
    const highest = Math.max(
      0,
      ...points.flatMap((point) => [point.v4, point.spot, point.long, point.short, point.debt ?? 0, point.perp ?? 0]),
    );
    const step = highest <= 200 ? 50 : highest <= 500 ? 100 : highest <= 1000 ? 200 : 500;
    return Math.max(step, Math.ceil(highest / step) * step);
  }, [points]);
  const yAxisTicks = useMemo(() => {
    const step = yAxisMax <= 200 ? 50 : yAxisMax <= 500 ? 100 : yAxisMax <= 1000 ? 200 : 500;
    const ticks = [-100];
    for (let value = -100 + step; value <= yAxisMax; value += step) ticks.push(value);
    if (!ticks.includes(0)) ticks.push(0);
    if (!ticks.includes(yAxisMax)) ticks.push(yAxisMax);
    return [...new Set(ticks)].sort((a, b) => a - b);
  }, [yAxisMax]);
  const update = (key: keyof Config, v: number | CashbackMode) => {
    const updateConfig = (current: Config) => ({ ...current, [key]: v });
    if (mode === "manual") setManualConfig(updateConfig);
    else setOptimisedConfig(updateConfig);
  };
  const setCashbackMode = (cashbackMode: CashbackMode) => {
    update("cashbackMode", cashbackMode);
    if (mode === "optimise") setCashbackPreference(cashbackMode);
  };
  const manualPositionIsDefault = manualConfig.longAllocation === 0.5 &&
    manualConfig.longLtv === 0.5 && manualConfig.shortLtv === 0.5 &&
    manualConfig.cashbackMode === "cash";
  const activeComparisonIsDefault = (comparisonMode === "base"
    ? config.deposit === INITIAL_CONFIG.deposit && baseAssetValue === 0
    : comparisonMode === "lending"
      ? assetPrice === DEFAULT_LENDING.assetPrice &&
        assetAmount === DEFAULT_LENDING.assetAmount &&
        usdDebt === DEFAULT_LENDING.usdDebt &&
        liquidationLtv === DEFAULT_LENDING.liquidationLtv
      : perpState.assetPrice === DEFAULT_PERP.assetPrice &&
        perpState.averageEntryPrice === DEFAULT_PERP.averageEntryPrice &&
        perpState.positionSize === DEFAULT_PERP.positionSize &&
        perpState.margin === DEFAULT_PERP.margin &&
        perpState.liquidationPrice === DEFAULT_PERP.liquidationPrice &&
        perpState.side === DEFAULT_PERP.side) &&
    (mode !== "manual" || manualPositionIsDefault);
  const resetActiveComparison = () => {
    if (mode === "manual") {
      setManualConfig((current) => ({
        ...current,
        longAllocation: 0.5,
        longLtv: 0.5,
        shortLtv: 0.5,
        cashbackMode: "cash",
      }));
    }
    if (comparisonMode === "base") {
      update("deposit", INITIAL_CONFIG.deposit);
      setBaseAssetValue(0);
      return;
    }
    if (comparisonMode === "lending") {
      setAssetPrice(DEFAULT_LENDING.assetPrice);
      setAssetAmount(DEFAULT_LENDING.assetAmount);
      setUsdDebt(DEFAULT_LENDING.usdDebt);
      setLiquidationLtv(DEFAULT_LENDING.liquidationLtv);
      return;
    }
    setPerpState({ ...DEFAULT_PERP });
  };
  const persistInputsNow = () => window.desktopWindow?.saveInputs({
    comparisonMode, mode, manualConfig, optimisedConfig, objective,
    spotParityMagnitude, debtParityMagnitude, perpParityMagnitude, downsideBreakevenMagnitude,
    upsideBreakevenMagnitude, cashbackPreference, requireBreakeven, maxDD, longLtvLimit, shortLtvLimit, bullishTarget, bearishTarget, searchStep,
    minMove, maxMove, showLong, showShort, showSpot, showDebt, showPerp,
    showLiquidationLine, showDrawdownLine, baseAssetValue, assetPrice, assetAmount,
    usdDebt, liquidationLtv, perpState, assetName,
  });
  const closeApplication = () => {
    if (!persistenceLoaded) return window.desktopWindow?.close();
    void persistInputsNow()?.catch(() => undefined).finally(() => window.desktopWindow?.close());
  };
  const selectComparisonMode = (nextMode: ComparisonMode) => {
    setComparisonMode(nextMode);
    if (
      (objective === "debtParity" && nextMode !== "lending") ||
      (objective === "perpParity" && nextMode !== "perp")
    ) setObjective("bullish");
  };
  const isParityObjective = objective === "spotParity" ||
    objective === "debtParity" || objective === "perpParity";
  const optimisationInputs = {
    comparisonMode,
    deposit: config.deposit,
    maxDrawdown: isParityObjective ? null : maxDD,
    objective,
    spotParityPercent:
      objective === "spotParity" ? spotParityMagnitude : null,
    debtParityPercent:
      objective === "debtParity" ? debtParityMagnitude : null,
    perpParityPercent:
      objective === "perpParity" ? perpParityMagnitude : null,
    assetPrice: comparisonMode === "lending" ? assetPrice : null,
    assetAmount: comparisonMode === "lending" ? assetAmount : null,
    usdDebt: comparisonMode === "lending" ? usdDebt : null,
    liquidationLtv: comparisonMode === "lending" ? liquidationLtv : null,
    perpState: comparisonMode === "perp" ? perpState : null,
    cashbackMode: cashbackPreference,
    requireBreakeven,
    downsideBreakevenPercent: requireBreakeven
      ? -downsideBreakevenMagnitude
      : null,
    upsideBreakevenPercent: requireBreakeven
      ? upsideBreakevenMagnitude
      : null,
    maxLtv,
    longLtvLimit,
    shortLtvLimit,
    bullishTarget,
    bearishTarget,
    analysisMinPercent: -downsideBreakevenMagnitude,
    analysisMaxPercent: bullishTarget,
    searchStep,
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
  const cashbackCrossover = supportsCashbackCrossover({
    mode,
    optimisationStatus,
    objective,
    result: lastRun?.crossover,
  }) ? lastRun!.crossover : null;
  const objectiveAnalysis = useMemo(
    () => mode === "optimise" && optimisationStatus === "current"
      ? createObjectiveAnalysis({
          objective,
          config,
          spotParityPercent: spotParityMagnitude,
          debtParityPercent: debtParityMagnitude,
          perpParityPercent: perpParityMagnitude,
          debtPosition,
          perpPosition: perpState,
          bearishTargetPercent: bearishTarget,
          analysisMinPercent: -downsideBreakevenMagnitude,
          analysisMaxPercent: bullishTarget,
          comparisonMode,
        })
      : null,
    [
      config,
      bearishTarget,
      bullishTarget,
      comparisonMode,
      debtParityMagnitude,
      debtPosition,
      downsideBreakevenMagnitude,
      mode,
      objective,
      optimisationStatus,
      perpParityMagnitude,
      perpState,
      spotParityMagnitude,
    ],
  );
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
            lastRun.inputs.debtParityPercent !==
              (objective === "debtParity" ? debtParityMagnitude : null)
          ? "Lending parity target changed"
      : lastRun &&
            lastRun.inputs.perpParityPercent !==
              (objective === "perpParity" ? perpParityMagnitude : null)
          ? "Perp parity target changed"
      : lastRun &&
          lastRun.inputs.maxDrawdown !==
            (isParityObjective ? null : maxDD)
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
    crossover: CashbackCrossoverResult | null = null,
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
      crossover,
    });
    setOptimising(false);
  };
  const sendToManual = () => {
    setManualConfig({ ...optimisedConfig });
    setMode("manual");
  };
  const runOptimisation = () => {
    if (optimising || !comparisonIsValid) return;
    setOptimiseError(null);
    const cached = optimisationCache.current.get(searchKey);
    if (cached)
      return applyOptimisedResult(
        cached.outcome,
        optimisationInputs,
        cached.crossover,
      );
    setOptimising(true);
    const worker = new Worker(
      new URL("./model/optimiser.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = (
      event: MessageEvent<{
        ok: boolean;
        outcome?: OptimiseOutcome;
        crossover?: CashbackCrossoverResult | null;
        error?: string;
      }>,
    ) => {
      worker.terminate();
      if (!event.data.ok || !event.data.outcome) {
        setOptimising(false);
        setOptimiseError(event.data.error ?? "Optimisation failed");
        return;
      }
      const cachedResult = {
        outcome: event.data.outcome,
        crossover: event.data.crossover ?? null,
      };
      optimisationCache.current.set(searchKey, cachedResult);
      applyOptimisedResult(
        cachedResult.outcome,
        optimisationInputs,
        cachedResult.crossover,
      );
    };
    worker.onerror = () => {
      worker.terminate();
      setOptimising(false);
      setOptimiseError("Optimisation worker failed");
    };
    worker.postMessage({
      maxDrawdown: maxDD / 100,
      maxLtv: maxLtv / 100,
      longMaxLtv: longLtvLimit / 100,
      shortMaxLtv: shortLtvLimit / 100,
      bullishTargetPercent: bullishTarget,
      bearishTargetPercent: bearishTarget,
      searchStepPercent: searchStep,
      objective,
      comparisonMode,
      analysisMinPercent: -downsideBreakevenMagnitude,
      analysisMaxPercent: bullishTarget,
      spotParityPercent: spotParityMagnitude,
      debtParityPercent: debtParityMagnitude,
      perpParityPercent: perpParityMagnitude,
      debtPosition,
      perpPosition: perpState,
      cashbackMode: cashbackPreference,
      requireBreakeven,
      downsideBreakevenPercent: -downsideBreakevenMagnitude,
      upsideBreakevenPercent: upsideBreakevenMagnitude,
      deposit: config.deposit,
    });
  };
  const scenarios = [0.25, 0.5, 0.75, 0.9, 1.25, 1.5, 2, 3];
  const assetLabel = assetName.trim() || "ASSET";
  const assetLabelLower = assetLabel.toLowerCase();
  return (
    <main>
      <header className="topbar">
        <div className="topbar-brand">
          <div className="wordmark">
            <i />
            V4 SPECULATOR <span>PRICE MODEL</span>
          </div>
          <div className="topbar-mode-actions">
            <div className="comparison-modes" aria-label="Comparison mode">
              <button className={comparisonMode === "base" ? "on" : ""} onClick={() => selectComparisonMode("base")}>BASE</button>
              <button className={comparisonMode === "lending" ? "on" : ""} onClick={() => selectComparisonMode("lending")}>LENDING POSITION</button>
              <button className={comparisonMode === "perp" ? "on" : ""} onClick={() => selectComparisonMode("perp")}>PERP POSITION</button>
            </div>
            <button
              className="comparison-reset"
              disabled={activeComparisonIsDefault}
              onClick={resetActiveComparison}
              title="Reset current comparison inputs"
            >
              RESET
            </button>
            <button
              className={`comparison-settings ${showSettings ? "active" : ""}`}
              onClick={() => {
                setShowAssetName(false);
                setShowSettings((visible) => !visible);
              }}
              aria-expanded={showSettings}
              aria-controls="calculation-settings"
            >
              OPTIMISER SETTINGS
            </button>
            <button
              className={`comparison-settings ${showAssetName ? "active" : ""}`}
              onClick={() => {
                setShowSettings(false);
                setShowAssetName((visible) => !visible);
              }}
              aria-expanded={showAssetName}
              aria-controls="asset-name-settings"
            >
              ASSET NAME : {assetLabel}
            </button>
          </div>
        </div>
        <div className="topbar-actions">
          <div className="status">
            <span>LOCAL · BASE PRICE MODEL · YIELD &amp; LP FEES EXCLUDED</span>
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
            onClick={closeApplication}
          >
            <span />
          </button>
        </div>
      </header>
      {showSettings && (
        <div className="settings-overlay" onClick={() => setShowSettings(false)}>
          <section
            id="calculation-settings"
            className="settings-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <small>CALCULATION ASSUMPTIONS</small>
                <h2 id="settings-title">Settings</h2>
              </div>
              <button type="button" aria-label="Close settings" onClick={() => setShowSettings(false)}>×</button>
            </header>
            <div className="settings-grid">
              <label>
                <span>BULLISH TARGET</span>
                <small>Used by Maximise bullish exposure</small>
                <NumericInput className="settings-number" value={bullishTarget} min={1} max={2000} onValueChange={(value) => setBullishTarget(Math.min(2000, Math.max(1, value)))} />
                <em>%</em>
              </label>
              <label>
                <span>BEARISH TARGET</span>
                <small>Used by Maximise bearish exposure</small>
                <NumericInput className="settings-number" value={bearishTarget} min={-99} max={-1} onValueChange={(value) => setBearishTarget(Math.min(-1, Math.max(-99, value)))} />
                <em>%</em>
              </label>
              <label>
                <span>SEARCH RESOLUTION</span>
                <small>Allocation and LTV search increment</small>
                <NumericInput className="settings-number" value={searchStep} min={0.25} max={5} step="0.25" onValueChange={(value) => setSearchStep(Math.min(5, Math.max(0.25, value)))} />
                <em>%</em>
              </label>
              <label>
                <span>DOWNSIDE RECOVERY</span>
                <small>Adverse-side breakeven horizon</small>
                <NumericInput className="settings-number" value={downsideBreakevenMagnitude} min={1} max={99} onValueChange={(value) => setDownsideBreakevenMagnitude(Math.min(99, Math.max(1, value)))} />
                <em>%</em>
              </label>
              <label>
                <span>UPSIDE RECOVERY</span>
                <small>Adverse-side breakeven horizon</small>
                <NumericInput className="settings-number" value={upsideBreakevenMagnitude} min={1} max={2000} onValueChange={(value) => setUpsideBreakevenMagnitude(Math.min(2000, Math.max(1, value)))} />
                <em>%</em>
              </label>
            </div>
            <p>V4 leverage remains capped at 80% LTV / 2.50×.</p>
          </section>
        </div>
      )}
      {showAssetName && (
        <div className="settings-overlay" onClick={() => setShowAssetName(false)}>
          <section
            id="asset-name-settings"
            className="settings-panel asset-name-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="asset-name-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <small>DISPLAY TERMINOLOGY</small>
                <h2 id="asset-name-title">Asset name</h2>
              </div>
              <button type="button" aria-label="Close asset name settings" onClick={() => setShowAssetName(false)}>×</button>
            </header>
            <label className="asset-name-field">
              <span>ASSET NAME OR SYMBOL</span>
              <input
                value={assetName}
                maxLength={16}
                onChange={(event) => setAssetName(event.target.value.slice(0, 16))}
                onBlur={() => setAssetName((value) => value.trim() || "ASSET")}
                aria-label="Asset name or symbol"
              />
            </label>
            <div className="asset-name-actions">
              <button type="button" onClick={() => setAssetName("ASSET")}>RESET TO ASSET</button>
              <button type="button" onClick={() => setShowAssetName(false)}>DONE</button>
            </div>
          </section>
        </div>
      )}
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
                <p>Normalised equations used for every plotted {assetLabelLower} price.</p>
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
                  <code><var>p</var> = 1 + {assetLabelLower} move ÷ 100</code>
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
                      <span>The cashback component moves with the {assetLabelLower}</span>
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
                  <strong>80% LTV → 2.50×</strong>
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
          <div
            className="rail-scroll"
            ref={railScrollRef}
            onScroll={updateRailScrollIndicators}
          >
          <div className="control-group capital-settlement">
            {comparisonMode === "base" && (
              <>
                <section className="compact-control">
                  <label className="field-label">V4 DEPOSIT</label>
                  <div className="deposit-input">
                    <span>$</span>
                    <NumericInput min={0} value={config.deposit} onValueChange={(value) => update("deposit", Math.max(0, value))} />
                  </div>
                </section>
                <section className="compact-control base-asset-value">
                  <label className="field-label">{assetLabel} VALUE <small>Optional</small></label>
                  <div className="deposit-input">
                    <span>$</span>
                    <NumericInput min={0} value={baseAssetValue} emptyWhenZero placeholder="Optional" aria-label={`Optional current ${assetLabelLower} value`} onValueChange={(value) => setBaseAssetValue(Math.max(0, value))} />
                  </div>
                </section>
              </>
            )}
            {comparisonMode === "lending" && <>
            <section className="compact-control debt-input-row">
              <label className="field-label">{assetLabel} PRICE
                <div className="deposit-input">
                  <span>$</span>
                  <NumericInput min={0} value={assetPrice} onValueChange={(value) => setAssetPrice(Math.max(0, value))} />
                </div>
              </label>
              <label className="field-label">{assetLabel} AMOUNT
                <div className="deposit-input">
                  <NumericInput min={0} step="0.01" value={assetAmount} onValueChange={(value) => setAssetAmount(Math.max(0, value))} />
                </div>
              </label>
            </section>
            <section className="compact-control debt-inputs">
              <label className="field-label">USD DEBT
                <div className="deposit-input">
                  <span>$</span>
                  <NumericInput min={0} value={usdDebt} onValueChange={(value) => setUsdDebt(Math.max(0, value))} />
                </div>
              </label>
              <label className="field-label">LIQUIDATION LTV
                <div className="deposit-input">
                  <NumericInput min={1} max={99} step="1" value={liquidationLtv} onValueChange={(value) => setLiquidationLtv(Math.min(99, Math.max(1, value)))} />
                  <span>%</span>
                </div>
              </label>
            </section>
            <section className="compact-control derived-deposit">
              <label className="field-label">V4 DEPOSIT <small>Derived from net equity</small></label>
              <div className="deposit-input"><span>$</span><NumericInput value={Math.max(0, config.deposit)} onValueChange={() => undefined} readOnly aria-label="Derived V4 deposit" /></div>
            </section>
            </>}
            {comparisonMode === "perp" && <>
              <section className="compact-control debt-input-row">
                <label className="field-label">CURRENT {assetLabel} PRICE
                  <div className="deposit-input"><span>$</span><NumericInput min={0} value={perpState.assetPrice} onValueChange={(value) => setPerpState((current) => ({ ...current, assetPrice: Math.max(0, value) }))} /></div>
                </label>
                <label className="field-label">POSITION SIZE
                  <div className="deposit-input"><NumericInput min={0} step="0.01" value={perpState.positionSize} onValueChange={(value) => setPerpState((current) => ({ ...current, positionSize: Math.max(0, value) }))} /></div>
                </label>
              </section>
              <section className="compact-control perp-position-row">
                <div className="perp-side-control">
                  <label className="field-label">POSITION</label>
                  <div className="segments cashback-segments">
                    <button className={perpState.side === "long" ? "on" : ""} onClick={() => setPerpState((current) => ({ ...current, side: "long" }))}>Long</button>
                    <button className={perpState.side === "short" ? "on" : ""} onClick={() => setPerpState((current) => ({ ...current, side: "short" }))}>Short</button>
                  </div>
                </div>
                <label className="field-label">AVERAGE ENTRY PRICE
                  <div className="deposit-input"><span>$</span><NumericInput min={0} value={perpState.averageEntryPrice} onValueChange={(value) => setPerpState((current) => ({ ...current, averageEntryPrice: Math.max(0, value) }))} /></div>
                </label>
              </section>
              <section className="compact-control debt-inputs">
                <label className="field-label">MARGIN / COLLATERAL
                  <div className="deposit-input"><span>$</span><NumericInput min={0} value={perpState.margin} onValueChange={(value) => setPerpState((current) => ({ ...current, margin: Math.max(0, value) }))} /></div>
                </label>
                <label className="field-label">LIQUIDATION PRICE
                  <div className="deposit-input"><span>$</span><NumericInput min={0} value={perpState.liquidationPrice} onValueChange={(value) => setPerpState((current) => ({ ...current, liquidationPrice: Math.max(0, value) }))} /></div>
                </label>
              </section>
              <section className="compact-control derived-deposit">
                <label className="field-label">V4 DEPOSIT <small>Derived from current equity</small></label>
                <div className="deposit-input"><span>$</span><NumericInput value={Math.max(0, config.deposit)} onValueChange={() => undefined} readOnly aria-label="Derived V4 deposit" /></div>
              </section>
            </>}
            <section className="compact-control">
              <div className="section-label">
                <b>CASHBACK PREFERENCE</b>
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
                <div className="split allocation-split" aria-label={`Long ${Math.round(config.longAllocation * 100)}%, Short ${Math.round((1 - config.longAllocation) * 100)}%`}>
                  <span
                    className="long"
                    style={{ width: `${config.longAllocation * 100}%` }}
                  />
                  <span className="short" />
                  <div className="allocation-split-labels">
                    {config.longAllocation > 0 && <span className={config.longAllocation === 1 ? "only-side" : "long-label"}>LONG <b>{(config.longAllocation * 100).toFixed(0)}%</b></span>}
                    {config.longAllocation < 1 && <span className={config.longAllocation === 0 ? "only-side" : "short-label"}>SHORT <b>{((1 - config.longAllocation) * 100).toFixed(0)}%</b></span>}
                  </div>
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
                  <span>Up to 80% LTV / 2.50×</span>
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
            </div>
          )}

          {mode === "optimise" && (
            <>
              <div className="control-group risk-constraints">
                <section
                  className={`risk-target ${
                    isParityObjective ? "objective-owned" : ""
                  }`}
                >
                  <div className="optimise-leverage-limits">
                    <div className="leverage-limits-header">
                      <span>LEVERAGE LIMITS</span>
                      <button
                        type="button"
                        className={`leverage-limits-toggle ${leverageLimitsExpanded ? "expanded" : ""}`}
                        onClick={() => setLeverageLimitsExpanded((expanded) => !expanded)}
                        aria-expanded={leverageLimitsExpanded}
                      >
                        <b>{longLtvLimit >= maxLtv && shortLtvLimit >= maxLtv ? "AUTO" : "CUSTOM"}</b>
                        <i aria-hidden="true" />
                      </button>
                    </div>
                    {leverageLimitsExpanded && <div className="leverage-limit-editor">
                      <Slider
                        label="LONG"
                        value={longLtvLimit}
                        min={50}
                        max={maxLtv}
                        onChange={setLongLtvLimit}
                        detail={longLtvLimit >= maxLtv ? "" : `${effectiveLeverage(longLtvLimit / 100).toFixed(2)}× max`}
                        accent="amber"
                        autoWhenMax
                      />
                      <Slider
                        label="SHORT"
                        value={shortLtvLimit}
                        min={50}
                        max={maxLtv}
                        onChange={setShortLtvLimit}
                        detail={shortLtvLimit >= maxLtv ? "" : `${effectiveLeverage(shortLtvLimit / 100).toFixed(2)}× max`}
                        accent="violet"
                        autoWhenMax
                      />
                      <button
                        type="button"
                        className="reset-leverage-limits"
                        onClick={() => {
                          setLongLtvLimit(maxLtv);
                          setShortLtvLimit(maxLtv);
                        }}
                      >
                        RESET TO AUTO
                      </button>
                    </div>}
                  </div>
                  <Slider
                    label="MAX DRAWDOWN"
                    value={maxDD}
                    min={0}
                    max={100}
                    onChange={setMaxDD}
                    step={0.1}
                    displayPrecision={1}
                    detail={isParityObjective ? "SET BY PARITY" : ""}
                    accent="risk"
                    signedDisplay
                    disabled={isParityObjective}
                  />
                  {isParityObjective && (
                    <div className="risk-context compact">
                      <i>∿</i>
                      <span>
                        <b>{objective === "debtParity" ? "Lending parity is setting drawdown." : objective === "perpParity" ? "Perp parity is setting drawdown." : "Spot parity is setting drawdown."}</b>
                        Choose Bullish or Bearish to set a hard limit.
                      </span>
                    </div>
                  )}
                </section>
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
                        detail={`Breakeven before ${assetLabelLower} falls`}
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
                        detail={`Breakeven before ${assetLabelLower} rises`}
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
                <section className="optimise target-control">
                  <label className="field-label">OBJECTIVE</label>
                  <select
                    value={objective}
                    onChange={(e) => setObjective(e.target.value as Objective)}
                  >
                    {Object.entries(objectives)
                      .filter(([v]) =>
                        (v !== "debtParity" || comparisonMode === "lending") &&
                        (v !== "perpParity" || comparisonMode === "perp")
                      )
                      .map(([v, n]) => (
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
                        detail={`Match spot if the ${assetLabelLower} rises`}
                        value={spotParityMagnitude}
                        min={1}
                        max={2000}
                        sign="+"
                        onChange={setSpotParityMagnitude}
                      />
                    </div>
                  )}
                  {objective === "debtParity" && (
                    <div className="spot-parity-control">
                      <div className="spot-parity-note">
                        <i>≋</i>
                        <span>
                          Match the lending position at the selected target,
                          then maximise downside protection.
                        </span>
                      </div>
                      <HorizonInput
                        label="LENDING PARITY TARGET"
                        detail={`Match the lending position if the ${assetLabelLower} rises`}
                        value={debtParityMagnitude}
                        min={1}
                        max={2000}
                        sign="+"
                        onChange={setDebtParityMagnitude}
                      />
                    </div>
                  )}
                  {objective === "perpParity" && (
                    <div className="spot-parity-control">
                      <div className="spot-parity-note">
                        <i>≋</i>
                        <span>
                          Match the perp position at the selected target,
                          then maximise downside protection.
                        </span>
                      </div>
                      <HorizonInput
                        label="PERP PARITY TARGET"
                        detail={`Match the perp position if the ${assetLabelLower} rises`}
                        value={perpParityMagnitude}
                        min={1}
                        max={2000}
                        sign="+"
                        onChange={setPerpParityMagnitude}
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
                      disabled={optimising || !comparisonIsValid}
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
                  {lastRun.inputs.objective === "debtParity" &&
                    lastRun.outcome.debtParity && (() => {
                      const parity = lastRun.outcome.debtParity,
                        edge = parity.v4Value - parity.debtValue;
                      return (
                        <div className="spot-parity-result debt-parity-result">
                          <b>LENDING PARITY SECURED</b>
                          <span>
                            At +{parity.targetPercent}% {assetLabelLower} move · lending position {money(parity.debtValue)} · V4 {money(parity.v4Value)} · edge {money(edge)} / {pct(edge / parity.debtValue)}
                          </span>
                        </div>
                      );
                    })()}
                  {lastRun.inputs.objective === "perpParity" &&
                    lastRun.outcome.perpParity && (() => {
                      const parity = lastRun.outcome.perpParity,
                        edge = parity.v4Value - parity.perpValue;
                      return (
                        <div className="spot-parity-result debt-parity-result">
                          <b>PERP PARITY SECURED</b>
                          <span>
                            At +{parity.targetPercent}% {assetLabelLower} move · perp position {money(parity.perpValue)} · V4 {money(parity.v4Value)} · edge {money(edge)}{parity.perpValue !== 0 ? ` / ${pct(edge / parity.perpValue)}` : ""}
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
          </div>
          {railCanScrollUp && <div className="rail-scroll-indicator top" aria-hidden="true"><i /></div>}
          {railCanScrollDown && <div className="rail-scroll-indicator bottom" aria-hidden="true"><i /></div>}
        </aside>
        <section className="workspace">
          {!comparisonIsValid ? (
            <div className="panel invalid-comparison">
              <b>COMPARISON UNAVAILABLE</b>
              <span>{comparisonMode === "perp" ? "Enter valid mark, entry, size, margin and liquidation values; current perp equity must remain above $0 to compare with V4." : `Repay enough debt or add ${assetLabelLower} collateral so net equity is above $0.`}</span>
            </div>
          ) : <>
          <div className="readouts analytical-panel">
            <section className="analytical-section summary-position">
              <h3>POSITION BREAKDOWN</h3>
              <div className="position-breakdown-grid">
                <span className="position-breakdown-label">LONG V4 <small>&middot; {effectiveLeverage(config.longLtv).toFixed(2)}&times;</small></span>
                <b>{money(positionBreakdown.longCapital)}</b>
                <span className="position-breakdown-label">SHORT V4 <small>&middot; {effectiveLeverage(config.shortLtv).toFixed(2)}&times;</small></span>
                <b>{money(positionBreakdown.shortCapital)}</b>
                <span>CASHBACK</span>
                {config.cashbackMode === "cash" ? (
                  <b className="cashback-cash-value">{money(positionBreakdown.cashbackAmount)}</b>
                ) : (
                  <span className="cashback-spot-value">
                    <b>{positionBreakdown.spotUnits === null ? "SPOT" : `${positionBreakdown.spotUnits.toFixed(2)} ${assetLabel}`}</b>
                    {positionBreakdown.spotUnits !== null && <small>({money(positionBreakdown.cashbackAmount)})</small>}
                  </span>
                )}
              </div>
            </section>
            <section className="analytical-section summary-risk risk" title={`Trough at ${pct(risk.p - 1)} underlying`}>
              <h3>MAX DRAWDOWN</h3>
              <div className="drawdown-summary-row">
                <strong className="analytical-primary">{pct(risk.drawdown)}</strong>
                <span className="analytical-note">{risk.breakeven ? `Breakeven at ${pct(risk.breakeven - 1)}` : "No breakeven in modelled range"}</span>
              </div>
            </section>
            {cashbackCrossover && <section className="analytical-section cashback-crossover" aria-label="Cashback switch point analysis">
              <div className="crossover-section-heading">
                <h3>CASHBACK SWITCH POINT</h3>
                <span className="comparison-settings crossover-objective-tag">BULLISH</span>
              </div>
              <div className="analytical-stat-grid crossover-switch-grid">
                <span>{cashbackCrossover.becomesOptimal === "spot" ? "Spot" : "Cash"} becomes optimal at a<br />drawdown limit of</span>
                <b><CrossoverValue value={-cashbackCrossover.crossoverDrawdown * 100} suffix="%" /></b>
                <span>Current &rarr; switch</span>
                <b><CrossoverValue value={-cashbackCrossover.currentDrawdown * 100} suffix="%" />{" "}<span className="crossover-output-arrow">&rarr;</span>{" "}<CrossoverValue value={-cashbackCrossover.crossoverDrawdown * 100} suffix="%" /></b>
                <span>Change</span><b><CrossoverValue value={cashbackCrossover.changePts} suffix="pts" /></b>
              </div>
              <h4 className="crossover-subheading">TARGET PAYOFF</h4>
              <div className="analytical-stat-grid crossover-outcome-grid">
                <span>Current &rarr; switch</span>
                <b><CrossoverValue value={cashbackCrossover.currentPayoff} suffix="%" />{" "}<span className="crossover-output-arrow">&rarr;</span>{" "}<CrossoverValue value={cashbackCrossover.switchPayoff} suffix="%" /></b>
                <span>{cashbackCrossover.payoffDeltaPts < -0.05 ? "Cost" : "Gain"}</span><b><CrossoverValue value={cashbackCrossover.payoffDeltaPts} suffix="pts" /></b>
              </div>
              <h4 className="crossover-subheading">TRADE-OFF</h4>
              <p className="crossover-tradeoff">{crossoverTradeoffText(cashbackCrossover)}</p>
            </section>}
            {objectiveAnalysis && <ObjectiveAnalysisBlock analysis={objectiveAnalysis} />}
          </div>
          <div className="panel chart-panel">
            <div className="panel-head">
              <div>
                <b>STRATEGY RESPONSE</b>
                <span>
                  V4 strategy return against underlying {assetLabelLower} movement
                </span>
              </div>
              <div className="chart-controls">
                <div className="chart-series-controls">
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
                  <label>
                    <input
                      type="checkbox"
                      checked={showSpot}
                      onChange={(e) => setShowSpot(e.target.checked)}
                    />{" "}
                    {assetLabel} value - spot
                  </label>
                  {comparisonMode === "lending" && <label>
                    <input
                      type="checkbox"
                      checked={showDebt}
                      onChange={(e) => setShowDebt(e.target.checked)}
                    />{" "}
                    Lending Position
                  </label>}
                  {comparisonMode === "perp" && <label>
                    <input
                      type="checkbox"
                      checked={showPerp}
                      onChange={(e) => setShowPerp(e.target.checked)}
                    />{" "}
                    Perp position
                  </label>}
                  {comparisonMode !== "base" && <label>
                    <input
                      type="checkbox"
                      checked={showLiquidationLine}
                      onChange={(e) => setShowLiquidationLine(e.target.checked)}
                    />{" "}
                    Liquidation line
                  </label>}
                  {mode === "optimise" && !isParityObjective && <label>
                    <input
                      type="checkbox"
                      checked={showDrawdownLine}
                      onChange={(e) => setShowDrawdownLine(e.target.checked)}
                    />{" "}
                    Drawdown limit
                  </label>}
                </div>
                <div className="chart-range-control">
                  <b>RANGE</b>
                  <ChartRangeInput
                    label={`Minimum ${assetLabelLower} move`}
                    value={minMove}
                    onChange={setMinMove}
                  />
                  <i>to</i>
                  <ChartRangeInput
                    label={`Maximum ${assetLabelLower} move`}
                    value={maxMove}
                    onChange={setMaxMove}
                  />
                  <em>%</em>
                </div>
              </div>
            </div>
            <div className="chart">
              <div className="chart-plot">
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
                    label={{ value: `${assetLabel} price change`, position: "insideBottom", offset: -8, fill: "#9b9187", fontSize: 12 }}
                  />
                  <YAxis
                    domain={[-100, yAxisMax]}
                    allowDataOverflow
                    ticks={yAxisTicks}
                    tickFormatter={(v) => `${Math.round(v)}%`}
                    stroke="#4f4a45"
                    tick={{ fontSize: 12, fill: "#9b9187" }}
                    label={{ value: "Portfolio return", angle: -90, position: "insideLeft", fill: "#9b9187", fontSize: 12 }}
                  />
                  <Tooltip content={<ChartTooltip config={config} debtPosition={debtPosition} comparisonMode={comparisonMode} perpPosition={perpState} baseAssetValue={baseAssetValue} assetLabel={assetLabel} showLong={showLong} showShort={showShort} showSpot={showSpot} showDebt={showDebt} showPerp={showPerp} />} />
                  <ReferenceLine y={0} stroke="#7e756c" strokeOpacity={0.72} />
                  <ReferenceLine
                    x={0}
                    stroke="#d4874c"
                    strokeOpacity={0.72}
                    strokeWidth={1.5}
                  />
                  {comparisonMode === "lending" && showDebt && showLiquidationLine && debtSummary.liquidationAssetMove !== null &&
                    debtSummary.liquidationAssetMove >= minMove &&
                    debtSummary.liquidationAssetMove <= maxMove && (
                      <>
                        <ReferenceLine
                          x={debtSummary.liquidationAssetMove}
                          stroke="#c4b17d"
                          strokeDasharray="4 4"
                          label={{
                            value: `LENDING LIQUIDATION · ${money(debtSummary.liquidationPrice ?? 0)} · ${pct(debtSummary.liquidationAssetMove / 100)}`,
                            fill: "#c8b991",
                            fontSize: 10,
                          }}
                        />
                        <ReferenceDot
                          x={debtSummary.liquidationAssetMove}
                          y={(debtPositionReturn(debtSummary.liquidationPriceRatio ?? 1, debtPosition) ?? 0) * 100}
                          r={5}
                          fill="#c4b17d"
                          stroke="#151616"
                        />
                      </>
                    )}
                  {comparisonMode === "perp" && showPerp && showLiquidationLine && perpSummary.liquidationAssetMove !== null &&
                    perpSummary.liquidationAssetMove >= minMove &&
                    perpSummary.liquidationAssetMove <= maxMove && (
                      <>
                        <ReferenceLine
                          x={perpSummary.liquidationAssetMove}
                          stroke="#c96d58"
                          strokeDasharray="4 4"
                          label={{
                            value: `PERP LIQUIDATION · ${perpState.side.toUpperCase()} · ${money(perpState.liquidationPrice)} · ${pct(perpSummary.liquidationAssetMove / 100)}`,
                            fill: "#c98c78",
                            fontSize: 10,
                          }}
                        />
                        <ReferenceDot
                          x={perpSummary.liquidationAssetMove}
                          y={(perpPositionReturn(perpSummary.liquidationPriceRatio ?? 1, perpState) ?? 0) * 100}
                          r={5}
                          fill="#cf7961"
                          stroke="#151616"
                        />
                      </>
                    )}
                  {mode === "optimise" && showDrawdownLine && !isParityObjective && (
                    <ReferenceLine
                      y={-maxDD}
                      stroke="#a55f47"
                      strokeDasharray="5 4"
                      label={{
                        value: `drawdown limit −${maxDD}%`,
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
                  {showSpot && <Line
                    dataKey="spot"
                    name={`${assetLabel} value - spot`}
                    stroke="#b8aea3"
                    strokeOpacity={0.78}
                    strokeWidth={1.35}
                    dot={false}
                    isAnimationActive={false}
                  />}
                  {showLong && (
                    <Line
                      dataKey="long"
                      name={longReferenceLabel}
                      stroke="#e18a4a"
                      strokeDasharray="3 3"
                      dot={false}
                      isAnimationActive={false}
                    />
                  )}{" "}
                  {showShort && (
                    <Line
                      dataKey="short"
                      name={shortReferenceLabel}
                      stroke="#aa9481"
                      strokeDasharray="3 3"
                      dot={false}
                      isAnimationActive={false}
                    />
                  )}
                  {comparisonMode === "lending" && showDebt && (
                    <Line
                      dataKey="debt"
                      name="Lending Position"
                      stroke="#c4b17d"
                      strokeWidth={2.25}
                      dot={false}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  )}
                  {comparisonMode === "perp" && showPerp && (
                    <Line
                      dataKey="perp"
                      name="Perp position"
                      stroke="#cf7961"
                      strokeWidth={2.25}
                      dot={false}
                      connectNulls={false}
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
              <div className="scenario-key scenario-series-key chart-series-legend">
                <span><i className="v4" /> V4 strategy</span>
                <span><i className="spot" /> {assetLabel} value - spot</span>
                <span><i className="long" /> {longControlLabel}</span>
                <span><i className="short" /> {shortControlLabel}</span>
                {comparisonMode === "lending" && <span><i className="debt" /> Lending Position</span>}
                {comparisonMode === "perp" && <span><i className="perp" /> Perp position</span>}
              </div>
            </div>
          </div>
          <div className={`panel scenarios comparison-${comparisonMode}`}>
            <div className="panel-head">
              <div>
                <b>SCENARIO ANALYSIS</b>
                <span>
                  {comparisonMode === "base"
                  ? `V4 strategy compared with the underlying spot ${assetLabelLower}`
                    : comparisonMode === "lending"
                      ? `V4 strategy, spot ${assetLabelLower} and lending position compared at the same price moves`
                      : `V4 strategy, spot ${assetLabelLower} and perp position compared at the same price moves`}
                </span>
              </div>
            </div>
            <div className="scenario-table">
              <div className="scenario-row headings">
                <span>{assetLabel} MOVE</span>
                <span className="v4-start">V4 VALUE</span>
                <span className="v4-end">V4 RETURN</span>
                <span className="spot-start">{assetLabel} VALUE - SPOT</span>
                <span className="spot-end">{assetLabel} RETURN - SPOT</span>
                <span className="edge-cell">V4 EDGE</span>
                {comparisonMode === "lending" && <span className="debt-cell">LENDING POSITION</span>}
                {comparisonMode === "perp" && <span className="debt-cell">PERP POSITION</span>}
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
                  settlementLabel = config.cashbackMode === "cash" ? "Cash" : "Spot",
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
                    <span className="scenario-asset-move">
                      <strong>{pct(p - 1)}</strong>
                      {comparisonMode === "base" && baseAssetValue > 0 && <small>{money(baseAssetValue * p)}</small>}
                    </span>
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
                    {comparisonMode === "lending" && <span className="debt-cell debt-scenario">
                      {isDebtPositionLiquidated(p, debtPosition) ? (
                        <><b>LIQUIDATED</b><small>{liquidationLtv}% LTV reached</small></>
                      ) : (
                        <><b>{money(debtPositionValue(p, debtPosition))}</b><small>{pct(debtPositionReturn(p, debtPosition) ?? 0)}</small></>
                      )}
                    </span>}
                    {comparisonMode === "perp" && <span className="debt-cell debt-scenario">
                      {isPerpPositionLiquidated(p, perpState) ? (
                        <><b>LIQUIDATED</b><small>Liquidation at {perpSummary.liquidationAssetMove === null ? "—" : pct(perpSummary.liquidationAssetMove / 100)}</small></>
                      ) : (
                        <><b>{money(perpPositionValue(p, perpState))}</b><small>{pct(perpPositionReturn(p, perpState) ?? 0)}</small></>
                      )}
                    </span>}
                  </div>
                );
              })}
            </div>
            {comparisonMode === "lending" && <section className="scenario-debt-summary">
              <div className="section-label"><b>LENDING POSITION</b><span>{liquidationLtv}% liquidation LTV</span></div>
              <div className="debt-summary-grid">
                <span>COLLATERAL <b>{money(debtSummary.grossCollateral)}</b></span>
                <span>DEBT <b>{money(usdDebt)}</b></span>
                <span>NET EQUITY <b>{money(debtSummary.netEquity)}</b></span>
                <span>CURRENT LTV <b>{debtSummary.currentLtv === null ? "—" : `${(debtSummary.currentLtv * 100).toFixed(2)}%`}</b></span>
                <span>LIQUIDATION PRICE <b>{debtSummary.liquidationPrice === null ? "—" : money(debtSummary.liquidationPrice)}</b></span>
                <span>LIQUIDATION MOVE <b>{debtSummary.liquidationAssetMove === null ? "—" : pct(debtSummary.liquidationAssetMove / 100)}</b></span>
              </div>
              {!comparisonIsValid && <p className="debt-invalid">Net equity must remain above $0 to compare with V4.</p>}
            </section>}
            {comparisonMode === "perp" && <section className="scenario-debt-summary">
              <div className="section-label"><b>PERP POSITION</b><span>{perpState.side.toUpperCase()}</span></div>
              <div className="debt-summary-grid">
                <span>NOTIONAL <b>{money(perpSummary.notional)}</b></span>
                <span>MARGIN <b>{money(perpState.margin)}</b></span>
                <span>UNREALISED PNL <b>{money(perpSummary.unrealisedPnl)}</b></span>
                <span>CURRENT EQUITY <b>{money(perpSummary.currentEquity)}</b></span>
                <span>EFFECTIVE EXPOSURE <b>{perpSummary.effectiveExposure === null ? "—" : `${perpSummary.effectiveExposure.toFixed(2)}×`}</b></span>
                <span>LIQUIDATION PRICE <b>{money(perpState.liquidationPrice)}</b></span>
                <span>LIQUIDATION MOVE <b>{perpSummary.liquidationAssetMove === null ? "—" : pct(perpSummary.liquidationAssetMove / 100)}</b></span>
              </div>
              {perpSummary.liquidationOnUnexpectedSide && <p className="debt-invalid">Liquidation price is on the unexpected side for this {perpState.side}.</p>}
              {!comparisonIsValid && <p className="debt-invalid">Current equity must remain above $0 to compare with V4.</p>}
            </section>}
          </div>
          </>}
        </section>
      </div>
    </main>
  );
}
