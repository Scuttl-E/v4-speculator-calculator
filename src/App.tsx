import { useEffect, useLayoutEffect, useMemo, useRef, useState, type SetStateAction, type WheelEvent } from "react";
import { flushSync } from "react-dom";
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
  analysisRangeFromPercent,
  analysisRangeToPercent,
  clampV4Ltv,
  dollarValue,
  findDownsideBreakeven,
  findWorstComponentDrawdown,
  MAX_V4_LTV,
  longLtvForMode,
  longModeLabel,
  shortModeLabel,
  portfolioComponents,
  portfolioReturn,
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
  CashbackPolicy,
  CashbackRoutingPreference,
  ComparisonMode,
  Config,
  DegenMode,
  Objective,
  OptimiseOptions,
  OptimiseOutcome,
  LongV4Mode,
  ShortV4Mode,
} from "./model/types";
import { degenRecycleTargetRatio } from "./model/degen";
import {
  createObjectiveAnalysis,
  type ObjectiveAnalysis,
} from "./model/objectiveAnalysis";
import type { ProductRoutingDecision } from "./model/productRoutingDecision";
import {
  createDefaultOptimisationOptions,
  DEFAULT_OPTIMISATION_PRESETS,
  DEFAULT_OPTIMISATION_PRESET_MODEL_VERSION,
  DEFAULT_OPTIMISER_ANALYSIS_MAX_PERCENT,
  DEFAULT_OPTIMISER_ANALYSIS_MIN_PERCENT,
  DEFAULT_OPTIMISER_MAX_DRAWDOWN_PERCENT,
  MAX_OPTIMISER_DRAWDOWN_PERCENT,
} from "./model/defaultOptimisationPresets";
import {
  completeOptimisation,
  createOptimisationSignature,
  OPTIMISER_STATE_MODEL_VERSION,
  optimisationStatusFor,
  restorePassivePresetResult,
  type OptimiserRunState,
  type SuccessfulOptimisationResult,
} from "./model/optimisationState";
import {
  isDesktopShell,
  loadCalculatorInputs,
  saveCalculatorInputs,
} from "./persistence";
import { HarvesterOverlay } from "./components/HarvesterOverlay";
import {
  CalculationUnderReviewWarning,
  isShortCashbackUnderReview,
} from "./components/CalculationUnderReviewWarning";
import { createHarvesterSnapshot, type HarvesterSnapshot } from "./model/harvester";

const money = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
const signedMoney = (n: number) => `${n >= 0 ? "+" : "−"}${money(Math.abs(n))}`;
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

function OptimisationRequiredBadge({
  className,
  calculating = false,
  compact = false,
}: {
  className: string;
  calculating?: boolean;
  compact?: boolean;
}) {
  return (
    <div className={`optimisation-required-badge ${className}`} role="status" aria-live="polite">
      {compact ? (
        calculating ? "OPTIMISING" : "OPTIMISATION REQUIRED"
      ) : calculating ? (
        <>OPTIMISING <i>&middot;</i> SHOWING PREVIOUS RESULT</>
      ) : (
        <>SETTINGS CHANGED <i>&middot;</i> OPTIMISATION REQUIRED</>
      )}
    </div>
  );
}

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
        <div className="analytical-stat-grid objective-analysis-grid">
          <span>Tested range</span>
          <b><CrossoverValue value={analysis.result.effectiveMinMove} suffix="%" />{" "}<span className="crossover-output-arrow">&rarr;</span>{" "}<CrossoverValue value={analysis.result.effectiveMaxMove} suffix="%" /></b>
        </div>
        <h4 className="crossover-subheading">WORST EDGE</h4>
        <div className="analytical-stat-grid objective-analysis-grid">
          <span>V4 vs {benchmarkLabel}</span>
          <b><CrossoverValue value={analysis.result.worstEdgePts} suffix="pts" /></b>
          <span>Occurs at</span>
          <b><CrossoverValue value={analysis.result.worstMove} suffix="%" /> move</b>
          <span>Outperforms benchmark across</span>
          <b>{analysis.result.aheadPercent.toFixed(1)}<span className="crossover-percent">%</span></b>
          <span>Average edge</span>
          <b><CrossoverValue value={analysis.result.averageEdgePts} suffix="pts" /></b>
        </div>
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
          <span>V4 max drawdown<br /><small>Across {signedFixed(analysis.analysisMinMove)}% to {signedFixed(analysis.analysisMaxMove)}%</small></span>
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

const routingLabel = (routing: CashbackMode) => routing === "cash" ? "Cash" : "Spot asset";

function CashbackControlLabel({ label, help, className = "" }: { label: string; help: string; className?: string }) {
  return <div className={`section-label cashback-control-label ${className}`.trim()}>
    <b>{label}</b>
    <button type="button" className="cashback-control-help" aria-label={`${label} help: ${help}`}>
      ?
      <span role="tooltip">{help}</span>
    </button>
  </div>;
}

function ProductRoutingDecisionBlock({ decision }: { decision: ProductRoutingDecision }) {
  const selectedAdvantagePoints = decision.selected.targetReturn - decision.alternative.targetReturn;
  const selectedAdvantagePercent = Math.abs(decision.alternative.targetReturn) > 1e-9
    ? selectedAdvantagePoints / Math.abs(decision.alternative.targetReturn) * 100
    : null;

  return <section className="analytical-section product-routing-decision" aria-label="Product and routing decision">
    <h3>PRODUCT &amp; ROUTING DECISION</h3>
    <div className="analytical-stat-grid routing-decision-grid">
      <span>Selected routing</span>
      <b className="routing-decision-route">{routingLabel(decision.selected.routing)}</b>
      <span>Return at {signedFixed(decision.targetPercent)}%</span>
      <b>{signedFixed(decision.selected.targetReturn)}%</b>
      <span className="routing-decision-opposing">Best opposing route</span>
      <b className="routing-decision-route routing-decision-opposing">{routingLabel(decision.alternative.routing)}</b>
      <span>Return at {signedFixed(decision.targetPercent)}%</span>
      <b>{signedFixed(decision.alternative.targetReturn)}%</b>
      <span>Selected-route advantage</span>
      <b>
        {signedFixed(selectedAdvantagePoints)} pts
        <small> ({selectedAdvantagePercent === null ? "n/a" : `${signedFixed(selectedAdvantagePercent)}%`})</small>
      </b>
    </div>
  </section>;
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
  longMode: "2x",
  shortMode: "2x",
  shortLtv: 0.5,
  cashbackMode: "cash",
  cashOutEnabled: true,
  degenEnabled: false,
  degenMode: "x1",
  customRecyclePct: 50,
};
const DEFAULT_LENDING = {
  assetPrice: 2000,
  assetAmount: 20,
  usdDebt: 15000,
  liquidationLtv: 85,
};
const DEFAULT_PERP: PerpPositionInput = {
  assetPrice: 2000,
  averageEntryPrice: 2500,
  positionSize: 15,
  margin: 25000,
  liquidationPrice: 1200,
  side: "long",
};
const DEFAULT_ASSET_NAME = "ETH";
const SCUTTLE_LINK = "https://x.com/chainsandtrains";
const DEFAULT_MAX_DRAWDOWN = DEFAULT_OPTIMISER_MAX_DRAWDOWN_PERCENT;
const DEFAULT_ANALYSIS_MIN_PERCENT = DEFAULT_OPTIMISER_ANALYSIS_MIN_PERCENT;
const DEFAULT_ANALYSIS_MAX_PERCENT = DEFAULT_OPTIMISER_ANALYSIS_MAX_PERCENT;
const DEFAULT_MAX_DRAWDOWN_BY_MODE: Record<ComparisonMode, number> = {
  base: DEFAULT_MAX_DRAWDOWN,
  lending: DEFAULT_MAX_DRAWDOWN,
  perp: DEFAULT_MAX_DRAWDOWN,
};
interface OptimiserControls {
  objective: Objective;
  spotParityMagnitude: number;
  debtParityMagnitude: number;
  perpParityMagnitude: number;
  downsideBreakevenMagnitude: number;
  upsideBreakevenMagnitude: number;
  cashbackPolicy: CashbackPolicy;
  cashbackRouting: CashbackRoutingPreference;
  requireBreakeven: boolean;
  longLtvLimit: number;
  shortLtvLimit: number;
  bullishTarget: number;
  bearishTarget: number;
  analysisMinPercent: number;
  analysisMaxPercent: number;
  searchStep: number;
}
type OptimiserControlsByMode = Record<ComparisonMode, OptimiserControls>;
interface WorkspaceControls {
  mode: "manual" | "optimise";
  leverageLimitsExpanded: boolean;
  minMove: number;
  maxMove: number;
  showLiquidationLine: boolean;
  showDrawdownLine: boolean;
  scenarioPositionSummaryCollapsed: boolean;
}
type WorkspaceControlsByMode = Record<ComparisonMode, WorkspaceControls>;
const createDefaultWorkspaceControls = (): WorkspaceControls => ({
  mode: "optimise",
  leverageLimitsExpanded: false,
  minMove: DEFAULT_CHART_MIN_MOVE,
  maxMove: DEFAULT_CHART_MAX_MOVE,
  showLiquidationLine: true,
  showDrawdownLine: true,
  scenarioPositionSummaryCollapsed: false,
});
const createDefaultWorkspaceControlsByMode = (): WorkspaceControlsByMode => ({
  base: createDefaultWorkspaceControls(),
  lending: createDefaultWorkspaceControls(),
  perp: createDefaultWorkspaceControls(),
});
const createDefaultOptimiserControls = (): OptimiserControls => ({
  objective: "bullish",
  spotParityMagnitude: 50,
  debtParityMagnitude: 50,
  perpParityMagnitude: 50,
  downsideBreakevenMagnitude: 80,
  upsideBreakevenMagnitude: 200,
  cashbackPolicy: "auto",
  cashbackRouting: "auto",
  requireBreakeven: false,
  longLtvLimit: MAX_V4_LTV * 100,
  shortLtvLimit: MAX_V4_LTV * 100,
  bullishTarget: 200,
  bearishTarget: -75,
  analysisMinPercent: DEFAULT_ANALYSIS_MIN_PERCENT,
  analysisMaxPercent: DEFAULT_ANALYSIS_MAX_PERCENT,
  searchStep: 1,
});
const createDefaultOptimiserControlsByMode = (): OptimiserControlsByMode => ({
  base: createDefaultOptimiserControls(),
  lending: createDefaultOptimiserControls(),
  perp: createDefaultOptimiserControls(),
});
type DegenSettings = Pick<Config, "degenEnabled" | "degenMode" | "customRecyclePct">;
type DegenSettingsByMode = Record<ComparisonMode, DegenSettings>;
const DEFAULT_DEGEN_SETTINGS: DegenSettings = {
  degenEnabled: false,
  degenMode: "x1",
  customRecyclePct: 50,
};
const createDefaultDegenSettingsByMode = (): DegenSettingsByMode => ({
  base: { ...DEFAULT_DEGEN_SETTINGS },
  lending: { ...DEFAULT_DEGEN_SETTINGS },
  perp: { ...DEFAULT_DEGEN_SETTINGS },
});
type OptimisedConfigsByMode = Record<ComparisonMode, Config>;
type ManualConfigsByMode = Record<ComparisonMode, Config>;
const createDefaultManualConfigsByMode = (): ManualConfigsByMode => ({
  base: { ...INITIAL_CONFIG },
  lending: { ...INITIAL_CONFIG },
  perp: { ...INITIAL_CONFIG },
});
const createDefaultOptimisedConfigsByMode = (): OptimisedConfigsByMode => ({
  base: { ...INITIAL_CONFIG },
  lending: { ...INITIAL_CONFIG },
  perp: { ...INITIAL_CONFIG },
});
type DisplayedResultsByMode = Record<ComparisonMode, SuccessfulOptimisationResult | null>;
const createEmptyDisplayedResultsByMode = (): DisplayedResultsByMode => ({
  base: null,
  lending: null,
  perp: null,
});
type ChartSeriesVisibility = {
  long: boolean;
  short: boolean;
  spot: boolean;
};
type ChartSeriesVisibilityByMode = Record<ComparisonMode, ChartSeriesVisibility>;
const DEFAULT_CHART_SERIES_VISIBILITY: ChartSeriesVisibilityByMode = {
  base: { long: false, short: false, spot: true },
  lending: { long: false, short: false, spot: false },
  perp: { long: false, short: false, spot: false },
};
const DEFAULT_CHART_MIN_MOVE = -80;
const DEFAULT_CHART_MAX_MOVE = 200;
const DEGEN_PRESET_OPTIONS: Array<{ mode: Exclude<DegenMode, "custom">; label: string }> = [
  { mode: "x1", label: "×1" },
  { mode: "x2", label: "×2" },
  { mode: "x3", label: "×3" },
  { mode: "x4", label: "×4" },
  { mode: "max", label: "MAX" },
];

const defaultOptimisationInputs = (options: OptimiseOptions): Record<string, unknown> => {
  return {
    comparisonMode: options.comparisonMode,
    deposit: options.deposit,
    maxDrawdown: DEFAULT_MAX_DRAWDOWN_BY_MODE[options.comparisonMode ?? "base"],
    objective: options.objective,
    spotParityPercent: options.objective === "spotParity" ? options.spotParityPercent : null,
    debtParityPercent: options.objective === "debtParity" ? options.debtParityPercent : null,
    perpParityPercent: options.objective === "perpParity" ? options.perpParityPercent : null,
    cashbackPolicy: options.cashbackPolicy ?? "auto",
    cashbackRouting: options.cashbackRouting ?? "auto",
    degenEnabled: options.degenEnabled,
    degenMode: options.degenMode,
    customRecyclePct: options.degenMode === "custom" ? options.customRecyclePct : null,
    requireBreakeven: options.requireBreakeven,
    downsideBreakevenPercent: options.downsideBreakevenPercent,
    upsideBreakevenPercent: options.upsideBreakevenPercent,
    analysisMinPercent: (options.analysisRange.minPriceRatio - 1) * 100,
    analysisMaxPercent: (options.analysisRange.maxPriceRatio - 1) * 100,
  };
};

const createDefaultOptimisationCache = () => {
  const cache = new Map<string, SuccessfulOptimisationResult>();
  if (DEFAULT_OPTIMISATION_PRESET_MODEL_VERSION !== OPTIMISER_STATE_MODEL_VERSION)
    return cache;
  for (const preset of DEFAULT_OPTIMISATION_PRESETS) {
    if (!preset.outcome.config) continue;
    const options = createDefaultOptimisationOptions(preset.comparisonMode, preset.objective);
    const signature = createOptimisationSignature(options);
    cache.set(signature, {
      signature,
      options,
      inputs: defaultOptimisationInputs(options),
      result: preset.outcome.config,
      outcome: preset.outcome,
      productRoutingDecision: preset.productRoutingDecision,
      objectiveAnalysis: preset.objectiveAnalysis,
      baseAssetValue: 0,
    });
  }
  return cache;
};
const createDefaultDisplayedResultsByMode = (
  cache: ReadonlyMap<string, SuccessfulOptimisationResult>,
): DisplayedResultsByMode => {
  const displayed = createEmptyDisplayedResultsByMode();
  for (const comparisonMode of ["base", "lending", "perp"] as const) {
    const options = createDefaultOptimisationOptions(comparisonMode, "bullish");
    displayed[comparisonMode] = cache.get(createOptimisationSignature(options)) ?? null;
  }
  return displayed;
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
  deferRangeCommit = false,
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
  deferRangeCommit?: boolean;
  step?: number;
  displayPrecision?: number;
}) {
  const [rangeDraft, setRangeDraft] = useState(value);
  const rangeDraftRef = useRef(value);
  const deferredCommitTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (deferredCommitTimerRef.current !== null) {
      window.clearTimeout(deferredCommitTimerRef.current);
      deferredCommitTimerRef.current = null;
    }
    rangeDraftRef.current = value;
    setRangeDraft(value);
  }, [value]);
  useEffect(() => () => {
    if (deferredCommitTimerRef.current !== null) {
      window.clearTimeout(deferredCommitTimerRef.current);
    }
  }, []);
  const sliderValue = deferRangeCommit ? rangeDraft : value,
    displayValue = sliderValue,
    inputValue = signedDisplay ? -displayValue : displayValue,
    isAuto = autoWhenMax && value >= max,
    snapValue = (next: number) => {
      const snapped = min + Math.round((next - min) / step) * step;
      return Math.min(max, Math.max(min, +snapped.toFixed(10)));
    },
    commitValue = (next: number) => {
      const snapped = snapValue(next);
      if (deferRangeCommit) {
        rangeDraftRef.current = snapped;
        setRangeDraft(snapped);
      }
      else onChange(snapped);
    },
    commitRangeDraft = () => {
      if (deferredCommitTimerRef.current !== null) {
        window.clearTimeout(deferredCommitTimerRef.current);
        deferredCommitTimerRef.current = null;
      }
      if (deferRangeCommit && rangeDraftRef.current !== value) onChange(rangeDraftRef.current);
    },
    commitSteppedValue = (next: number) => {
      const snapped = snapValue(next);
      if (!deferRangeCommit) {
        onChange(snapped);
        return;
      }
      rangeDraftRef.current = snapped;
      setRangeDraft(snapped);
      if (deferredCommitTimerRef.current !== null) {
        window.clearTimeout(deferredCommitTimerRef.current);
      }
      deferredCommitTimerRef.current = window.setTimeout(() => {
        deferredCommitTimerRef.current = null;
        if (rangeDraftRef.current !== value) onChange(rangeDraftRef.current);
      }, 160);
    },
    stepUp = () => {
      commitSteppedValue(Math.min(max, sliderValue + step));
    },
    stepDown = () => {
      commitSteppedValue(Math.max(min, sliderValue - step));
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
          onPointerUp={commitRangeDraft}
          onKeyUp={commitRangeDraft}
          onBlur={commitRangeDraft}
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
  const v4Components = portfolioComponents(p, config);
  const cashbackInitialValue = config.deposit * v4Components.cashOut;
  const insideV4InitialValue = config.deposit - cashbackInitialValue;
  const cashbackValue = config.deposit * v4Components.cashbackValue;
  const insideV4Value = config.deposit * v4Components.insideV4;
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
    metrics.push({ key: "spot", label: `SPOT ${assetLabel}`, edgeLabel: assetLabel, icon: "slate", returnValue: p - 1, dollarValue: config.deposit * p });
  }
  if (showLong) {
    const value = portfolioReturn(p, { ...config, longAllocation: 1 }) + 1;
    metrics.push({ key: "long", label: "LONG COMPONENT", edgeLabel: "LONG", icon: "long", returnValue: config.longAllocation * (value - 1), dollarValue: config.deposit * config.longAllocation * value });
  }
  if (showShort) {
    const value = portfolioReturn(p, { ...config, longAllocation: 0 }) + 1;
    metrics.push({ key: "short", label: "SHORT COMPONENT", edgeLabel: "SHORT", icon: "short", returnValue: (1 - config.longAllocation) * (value - 1), dollarValue: config.deposit * (1 - config.longAllocation) * value });
  }

  const primaryMetric = metrics.find((metric) => metric.key === "lending" || metric.key === "perp")
    ?? metrics.find((metric) => metric.returnValue !== null)
    ?? metrics[0]
    ?? null;
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
        <div className="tooltip-value v4">
          <i className="teal" />
          V4 STRATEGY COMBINED <b>{pct(v4Return)}</b>
          <em>{money(v4)}</em>
        </div>
        {primaryMetric && renderMetric(primaryMetric)}
      </div>
      {v4Components.cashOut > 1e-12 && <div className="tooltip-cashback-split">
        <span className="v4">
          INSIDE V4
          <b>{money(insideV4Value)}</b>
          <small>P/L {signedMoney(insideV4Value - insideV4InitialValue)}</small>
        </span>
        <span className="v4">
          CASHBACK · {config.cashbackMode === "cash" ? "CASH" : "SPOT"}
          <b>{money(cashbackValue)}</b>
          <small>P/L {signedMoney(cashbackValue - cashbackInitialValue)}</small>
        </span>
      </div>}
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
  const [optimisationCache] = useState(createDefaultOptimisationCache);
  const [defaultPresetSignatures] = useState(
    () => new Set(createDefaultOptimisationCache().keys()),
  );
  const [manualConfigsByMode, setManualConfigsByMode] = useState<ManualConfigsByMode>(
      createDefaultManualConfigsByMode,
    ),
    [optimisedConfigsByMode, setOptimisedConfigsByMode] = useState<OptimisedConfigsByMode>(
      createDefaultOptimisedConfigsByMode,
    ),
    [optimiserDeposit, setOptimiserDeposit] = useState(INITIAL_CONFIG.deposit);
  const [comparisonMode, setComparisonMode] = useState<ComparisonMode>("base"),
    [workspaceControlsByMode, setWorkspaceControlsByMode] = useState<WorkspaceControlsByMode>(
      createDefaultWorkspaceControlsByMode,
    ),
    [optimiserControlsByMode, setOptimiserControlsByMode] = useState<OptimiserControlsByMode>(
      createDefaultOptimiserControlsByMode,
    ),
    [degenSettingsByMode, setDegenSettingsByMode] = useState<DegenSettingsByMode>(
      createDefaultDegenSettingsByMode,
    ),
    [showDegenSelector, setShowDegenSelector] = useState(false),
    [defaultMaxDrawdown, setDefaultMaxDrawdown] = useState(DEFAULT_MAX_DRAWDOWN),
    [maxDrawdownByMode, setMaxDrawdownByMode] = useState<Record<ComparisonMode, number>>(() => ({
      ...DEFAULT_MAX_DRAWDOWN_BY_MODE,
    })),
    [chartSeriesVisibility, setChartSeriesVisibility] = useState<ChartSeriesVisibilityByMode>(() => ({
      base: { ...DEFAULT_CHART_SERIES_VISIBILITY.base },
      lending: { ...DEFAULT_CHART_SERIES_VISIBILITY.lending },
      perp: { ...DEFAULT_CHART_SERIES_VISIBILITY.perp },
    })),
    [showDebt, setShowDebt] = useState(true),
    [baseAssetValue, setBaseAssetValue] = useState(0),
    [assetPrice, setAssetPrice] = useState(DEFAULT_LENDING.assetPrice),
    [assetAmount, setAssetAmount] = useState(DEFAULT_LENDING.assetAmount),
    [usdDebt, setUsdDebt] = useState(DEFAULT_LENDING.usdDebt),
    [liquidationLtv, setLiquidationLtv] = useState(DEFAULT_LENDING.liquidationLtv),
    [perpState, setPerpState] = useState<PerpPositionInput>({ ...DEFAULT_PERP }),
    [showPerp, setShowPerp] = useState(true),
    [webChartWheelZoomEnabled, setWebChartWheelZoomEnabled] = useState(false),
    [showMaths, setShowMaths] = useState(false),
    [showSettings, setShowSettings] = useState(false),
    [showAssetName, setShowAssetName] = useState(false),
    [isPeaNileEnhanced, setIsPeaNileEnhanced] = useState(false),
    [assetName, setAssetName] = useState(DEFAULT_ASSET_NAME),
    [displayedResultsByMode, setDisplayedResultsByMode] = useState<DisplayedResultsByMode>(() =>
      createDefaultDisplayedResultsByMode(optimisationCache),
    ),
    [runState, setRunState] = useState<OptimiserRunState>({ kind: "idle" });
  const [harvesterSnapshot, setHarvesterSnapshot] = useState<HarvesterSnapshot | null>(null);
  const {
    mode,
    leverageLimitsExpanded,
    minMove,
    maxMove,
    showLiquidationLine,
    showDrawdownLine,
    scenarioPositionSummaryCollapsed,
  } = workspaceControlsByMode[comparisonMode];
  const setWorkspaceControl = <K extends keyof WorkspaceControls>(
    key: K,
    value: SetStateAction<WorkspaceControls[K]>,
  ) => setWorkspaceControlsByMode((current) => {
    const controls = current[comparisonMode];
    const nextValue = typeof value === "function"
      ? (value as (previous: WorkspaceControls[K]) => WorkspaceControls[K])(controls[key])
      : value;
    if (Object.is(nextValue, controls[key])) return current;
    return { ...current, [comparisonMode]: { ...controls, [key]: nextValue } };
  });
  const setMode = (value: SetStateAction<WorkspaceControls["mode"]>) => setWorkspaceControl("mode", value);
  const setLeverageLimitsExpanded = (value: SetStateAction<boolean>) => setWorkspaceControl("leverageLimitsExpanded", value);
  const setMinMove = (value: SetStateAction<number>) => setWorkspaceControl("minMove", value);
  const setMaxMove = (value: SetStateAction<number>) => setWorkspaceControl("maxMove", value);
  const setShowLiquidationLine = (value: SetStateAction<boolean>) => setWorkspaceControl("showLiquidationLine", value);
  const setShowDrawdownLine = (value: SetStateAction<boolean>) => setWorkspaceControl("showDrawdownLine", value);
  const setScenarioPositionSummaryCollapsed = (value: SetStateAction<boolean>) => setWorkspaceControl("scenarioPositionSummaryCollapsed", value);
  const manualConfig = manualConfigsByMode[comparisonMode];
  const setManualConfig = (value: SetStateAction<Config>) =>
    setManualConfigsByMode((current) => {
      const config = current[comparisonMode];
      const nextConfig = typeof value === "function"
        ? (value as (previous: Config) => Config)(config)
        : value;
      if (Object.is(nextConfig, config)) return current;
      return { ...current, [comparisonMode]: nextConfig };
    });
  const {
    objective,
    spotParityMagnitude,
    debtParityMagnitude,
    perpParityMagnitude,
    downsideBreakevenMagnitude,
    upsideBreakevenMagnitude,
    cashbackPolicy,
    cashbackRouting,
    requireBreakeven,
    longLtvLimit,
    shortLtvLimit,
    bullishTarget,
    bearishTarget,
    analysisMinPercent,
    analysisMaxPercent,
    searchStep,
  } = optimiserControlsByMode[comparisonMode];
  const setOptimiserControl = <K extends keyof OptimiserControls>(
    key: K,
    value: SetStateAction<OptimiserControls[K]>,
  ) => setOptimiserControlsByMode((current) => {
    const controls = current[comparisonMode];
    const nextValue = typeof value === "function"
      ? (value as (previous: OptimiserControls[K]) => OptimiserControls[K])(controls[key])
      : value;
    if (Object.is(nextValue, controls[key])) return current;
    return { ...current, [comparisonMode]: { ...controls, [key]: nextValue } };
  });
  const setObjective = (value: SetStateAction<Objective>) => setOptimiserControl("objective", value);
  const setSpotParityMagnitude = (value: SetStateAction<number>) => setOptimiserControl("spotParityMagnitude", value);
  const setDebtParityMagnitude = (value: SetStateAction<number>) => setOptimiserControl("debtParityMagnitude", value);
  const setPerpParityMagnitude = (value: SetStateAction<number>) => setOptimiserControl("perpParityMagnitude", value);
  const setDownsideBreakevenMagnitude = (value: SetStateAction<number>) => setOptimiserControl("downsideBreakevenMagnitude", value);
  const setUpsideBreakevenMagnitude = (value: SetStateAction<number>) => setOptimiserControl("upsideBreakevenMagnitude", value);
  const setCashbackPolicy = (value: SetStateAction<CashbackPolicy>) => setOptimiserControl("cashbackPolicy", value);
  const setCashbackRouting = (value: SetStateAction<CashbackRoutingPreference>) => setOptimiserControl("cashbackRouting", value);
  const setRequireBreakeven = (value: SetStateAction<boolean>) => setOptimiserControl("requireBreakeven", value);
  const setLongLtvLimit = (value: SetStateAction<number>) => setOptimiserControl("longLtvLimit", value);
  const setShortLtvLimit = (value: SetStateAction<number>) => setOptimiserControl("shortLtvLimit", value);
  const setBullishTarget = (value: SetStateAction<number>) => setOptimiserControl("bullishTarget", value);
  const setBearishTarget = (value: SetStateAction<number>) => setOptimiserControl("bearishTarget", value);
  const setAnalysisMinPercent = (value: SetStateAction<number>) => setOptimiserControl("analysisMinPercent", value);
  const setAnalysisMaxPercent = (value: SetStateAction<number>) => setOptimiserControl("analysisMaxPercent", value);
  const setSearchStep = (value: SetStateAction<number>) => setOptimiserControl("searchStep", value);
  const { degenEnabled, degenMode, customRecyclePct } = degenSettingsByMode[comparisonMode];
  const displayedResult = displayedResultsByMode[comparisonMode];
  const maxDD = maxDrawdownByMode[comparisonMode];
  const setMaxDD = (value: number) => setMaxDrawdownByMode((current) => ({
    ...current,
    [comparisonMode]: value,
  }));
  const railScrollRef = useRef<HTMLDivElement>(null);
  const peaNileButtonRef = useRef<HTMLButtonElement>(null);
  const optimiserWorkerRef = useRef<Worker | null>(null);
  const degenSelectorRef = useRef<HTMLDivElement>(null);
  const pendingSignaturesRef = useRef<Record<ComparisonMode, string>>({
    base: "",
    lending: "",
    perp: "",
  });
  const [railCanScrollUp, setRailCanScrollUp] = useState(false);
  const [railCanScrollDown, setRailCanScrollDown] = useState(false);
  const updateRailScrollIndicators = () => {
    const rail = railScrollRef.current;
    if (!rail) return;
    setRailCanScrollUp(rail.scrollTop > 1);
    setRailCanScrollDown(rail.scrollTop + rail.clientHeight < rail.scrollHeight - 1);
  };
  const [persistenceLoaded, setPersistenceLoaded] = useState(false);
  const isDesktopApp = isDesktopShell();
  const canZoomChartWithWheel = isDesktopApp || webChartWheelZoomEnabled;
  useEffect(() => {
    if (isDesktopApp) return;
    const isAndroid = /Android/i.test(navigator.userAgent);
    const isPhone = /Android.*Mobile|iPhone|iPod/i.test(navigator.userAgent);
    document.documentElement.classList.add("web-build");
    document.body.classList.add("web-build");
    if (isPhone) {
      document.documentElement.classList.add("phone-web");
      document.body.classList.add("phone-web");
    }
    if (isAndroid) {
      document.documentElement.classList.add("android-web");
      document.body.classList.add("android-web");
    }
    return () => {
      document.documentElement.classList.remove("web-build");
      document.body.classList.remove("web-build");
      document.documentElement.classList.remove("phone-web");
      document.body.classList.remove("phone-web");
      document.documentElement.classList.remove("android-web");
      document.body.classList.remove("android-web");
    };
  }, [isDesktopApp]);
  useEffect(() => {
    if (!showMaths) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowMaths(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [showMaths]);
  useEffect(() => {
    if (!showDegenSelector) return;
    const closeSelector = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event instanceof PointerEvent &&
        degenSelectorRef.current?.contains(event.target as Node)) return;
      setShowDegenSelector(false);
    };
    document.addEventListener("pointerdown", closeSelector);
    document.addEventListener("keydown", closeSelector);
    return () => {
      document.removeEventListener("pointerdown", closeSelector);
      document.removeEventListener("keydown", closeSelector);
    };
  }, [showDegenSelector]);
  useEffect(() => {
    if (!isPeaNileEnhanced) return;
    const exitEnhancement = (event: KeyboardEvent) => {
      if (event.key === "Escape") peaNileButtonRef.current?.click();
    };
    window.addEventListener("keydown", exitEnhancement);
    return () => window.removeEventListener("keydown", exitEnhancement);
  }, [isPeaNileEnhanced]);
  useEffect(() => {
    const frame = window.requestAnimationFrame(updateRailScrollIndicators);
    window.addEventListener("resize", updateRailScrollIndicators);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updateRailScrollIndicators);
    };
  }, [comparisonMode, mode, leverageLimitsExpanded, requireBreakeven, displayedResult]);
  useEffect(() => {
    let cancelled = false;
    const isChartSeriesVisibility = (value: unknown): value is ChartSeriesVisibilityByMode => {
      if (!value || typeof value !== "object") return false;
      const modes = value as Record<string, unknown>;
      return (["base", "lending", "perp"] as const).every((modeName) => {
        const modeVisibility = modes[modeName];
        if (!modeVisibility || typeof modeVisibility !== "object") return false;
        const visibility = modeVisibility as Record<string, unknown>;
        return typeof visibility.long === "boolean" &&
          typeof visibility.short === "boolean" &&
          typeof visibility.spot === "boolean";
      });
    };
    void loadCalculatorInputs().then((value) => {
      if (cancelled || !value || typeof value !== "object") return;
      const saved = value as Record<string, unknown>;
      if (saved.comparisonMode === "base" || saved.comparisonMode === "lending" || saved.comparisonMode === "perp") setComparisonMode(saved.comparisonMode);
      if (isChartSeriesVisibility(saved.chartSeriesVisibility)) {
        setChartSeriesVisibility(saved.chartSeriesVisibility);
      }
      if (typeof saved.showDebt === "boolean") setShowDebt(saved.showDebt);
      if (typeof saved.showPerp === "boolean") setShowPerp(saved.showPerp);
      if (typeof saved.webChartWheelZoomEnabled === "boolean") {
        setWebChartWheelZoomEnabled(saved.webChartWheelZoomEnabled);
      }
      if (typeof saved.assetName === "string") setAssetName(saved.assetName.trim().slice(0, 16) || DEFAULT_ASSET_NAME);
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
    if (!persistenceLoaded) return;
    const timer = window.setTimeout(() => {
      void saveCalculatorInputs({
        comparisonMode, manualConfigsByMode, optimiserDeposit, optimiserControlsByMode,
        workspaceControlsByMode,
        degenSettingsByMode, defaultMaxDrawdown, maxDrawdownByMode,
        minMove, maxMove, chartSeriesVisibility, showDebt, showPerp, webChartWheelZoomEnabled,
        showLiquidationLine, showDrawdownLine, baseAssetValue, assetPrice, assetAmount,
        usdDebt, liquidationLtv, perpState, assetName,
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [
    assetAmount, assetName, assetPrice, baseAssetValue, chartSeriesVisibility, comparisonMode,
    defaultMaxDrawdown, degenSettingsByMode, liquidationLtv, manualConfigsByMode, maxDrawdownByMode,
    optimiserControlsByMode, optimiserDeposit, perpState, persistenceLoaded,
    showDebt, showPerp, usdDebt, webChartWheelZoomEnabled, workspaceControlsByMode,
  ]);
  const pendingComparisonIsValid = comparisonMode === "base"
    ? true
    : comparisonMode === "lending"
      ? debtSummary.netEquity > 0
      : perpInputsAreValid && perpSummary.currentEquity > 0;
  const pendingBaseConfig = mode === "manual"
    ? manualConfig
    : { ...optimisedConfigsByMode[comparisonMode], deposit: optimiserDeposit };
  const pendingConfig = useMemo(
    () => ({
      ...pendingBaseConfig,
      deposit: comparisonMode === "lending"
        ? Math.max(0, debtSummary.netEquity)
        : comparisonMode === "perp"
          ? Math.max(0, perpSummary.currentEquity)
          : pendingBaseConfig.deposit,
    }),
    [pendingBaseConfig, comparisonMode, debtSummary.netEquity, perpSummary.currentEquity],
  );
  const displayComparisonMode = mode === "optimise" && displayedResult
    ? displayedResult.options.comparisonMode ?? "base"
    : comparisonMode;
  const {
    spot: showSpot,
    long: showLongSeries,
    short: showShortSeries,
  } = chartSeriesVisibility[displayComparisonMode];
  const setChartSeriesVisible = (series: keyof ChartSeriesVisibility, visible: boolean) => {
    setChartSeriesVisibility((current) => ({
      ...current,
      [displayComparisonMode]: {
        ...current[displayComparisonMode],
        [series]: visible,
      },
    }));
  };
  const displayDebtPosition = mode === "optimise" && displayedResult
    ? displayedResult.options.debtPosition
    : debtPosition;
  const displayPerpState = mode === "optimise" && displayedResult
    ? displayedResult.options.perpPosition
    : perpState;
  const displayDebtSummary = useMemo(() => debtPositionSummary(displayDebtPosition), [displayDebtPosition]);
  const displayPerpSummary = useMemo(() => perpPositionSummary(displayPerpState), [displayPerpState]);
  const displayBaseAssetValue = mode === "optimise" && displayedResult
    ? displayedResult.baseAssetValue
    : baseAssetValue;
  const config = mode === "optimise" && displayedResult
    ? displayedResult.result
    : pendingConfig;
  const hasLong = config.longAllocation > 1e-12;
  const hasShort = config.longAllocation < 1 - 1e-12;
  const isLongOnly = hasLong && !hasShort;
  const isShortOnly = hasShort && !hasLong;
  const showLong = hasLong && (showLongSeries || isLongOnly);
  const showShort = hasShort && (showShortSeries || isShortOnly);
  const displayObjective = mode === "optimise" && displayedResult
    ? displayedResult.options.objective
    : objective;
  const displayIsParityObjective = displayObjective === "spotParity" ||
    displayObjective === "debtParity" || displayObjective === "perpParity";
  const displayMaxDrawdown = mode === "optimise" && displayedResult
    ? displayedResult.options.maxDrawdown * 100
    : maxDD;
  const displayComparisonIsValid = mode === "optimise" && displayedResult
    ? true
    : pendingComparisonIsValid;
  const lastRun = displayedResult;
  const optimising = runState.kind === "running";
  const maxLtv = MAX_V4_LTV * 100;
  const pendingAnalysisRange = useMemo(
    () => analysisRangeFromPercent(analysisMinPercent, analysisMaxPercent),
    [analysisMinPercent, analysisMaxPercent],
  );
  const displayAnalysisRange = mode === "optimise" && displayedResult
    ? displayedResult.options.analysisRange
    : pendingAnalysisRange;
  const displayAnalysisMoves = analysisRangeToPercent(displayAnalysisRange);
  const risk = useMemo(() => ({
    ...findWorstComponentDrawdown(config, displayAnalysisRange),
    breakeven: findDownsideBreakeven(config),
  }), [config, displayAnalysisRange]);
  const positionBreakdown = useMemo(() => {
    const longCashback = config.longMode === "2.5x-cashback" ? config.longAllocation * .5 : 0;
    const shortCashback = config.shortMode === "2.5x-cashback" ? (1 - config.longAllocation) * .5 : 0;
    const longLooped = config.longMode === "2.5x-looped" ? config.longAllocation * .5 : 0;
    const shortLooped = config.shortMode === "2.5x-looped" ? (1 - config.longAllocation) * .5 : 0;
    const cashOutAmount = config.deposit * (longCashback + shortCashback);
    const currentAssetPrice = displayComparisonMode === "base"
      ? displayBaseAssetValue > 0 ? displayBaseAssetValue : null
      : displayComparisonMode === "lending"
        ? displayDebtPosition.assetPrice
        : displayPerpState.assetPrice;
    return {
      // Keep the user's own capital distinct from the additional capital retained
      // inside the 2.5x product, which is shown on its own line below.
      longCapital: config.deposit * config.longAllocation,
      shortCapital: config.deposit * (1 - config.longAllocation),
      loopedLongCapital: config.deposit * longLooped,
      loopedShortCapital: config.deposit * shortLooped,
      recycledLongCapital: 0,
      recycledShortCapital: 0,
      cashOutAmount,
      spotUnits: config.cashbackMode === "spot" && currentAssetPrice && currentAssetPrice > 0
        ? cashOutAmount / currentAssetPrice
        : null,
      recycledIntoV4: 0,
    };
  }, [config, displayBaseAssetValue, displayComparisonMode, displayDebtPosition.assetPrice, displayPerpState.assetPrice]);
  const xAxisTicks = useMemo(
    () => [
      minMove,
      (minMove * 2) / 3,
      minMove / 3,
      0,
      maxMove / 4,
      maxMove / 2,
      (maxMove * 3) / 4,
      maxMove,
    ],
    [minMove, maxMove],
  );
  const points = useMemo(
    () => {
      const moves = Array.from(
        { length: 180 },
        (_, i) => minMove + ((maxMove - minMove) * i) / 179,
      );
      moves.push(...xAxisTicks);
      const liquidationMove = displayComparisonMode === "lending"
        ? displayDebtSummary.liquidationAssetMove
        : displayComparisonMode === "perp"
          ? displayPerpSummary.liquidationAssetMove
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
          long: config.longAllocation * portfolioReturn(p, { ...config, longAllocation: 1 }) * 100,
          short: (1 - config.longAllocation) * portfolioReturn(p, { ...config, longAllocation: 0 }) * 100,
          debt:
            displayComparisonMode === "lending" && isDebtPositionLiquidated(p, displayDebtPosition) &&
            move !== displayDebtSummary.liquidationAssetMove
              ? null
              : displayComparisonMode === "lending"
                ? (debtPositionReturn(p, displayDebtPosition) ?? 0) * 100
                : null,
          perp:
            displayComparisonMode === "perp" && isPerpPositionLiquidated(p, displayPerpState) &&
            move !== displayPerpSummary.liquidationAssetMove
              ? null
              : displayComparisonMode === "perp"
                ? (perpPositionReturn(p, displayPerpState) ?? 0) * 100
                : null,
        };
      });
    },
    [config, displayComparisonMode, displayDebtPosition, displayDebtSummary.liquidationAssetMove, minMove, maxMove, displayPerpState, displayPerpSummary.liquidationAssetMove, xAxisTicks],
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
  const update = (key: keyof Config, v: number | CashbackMode | LongV4Mode | ShortV4Mode) => {
    const value = (key === "longLtv" || key === "shortLtv") && typeof v === "number"
      ? clampV4Ltv(v)
      : v;
    const updateConfig = (current: Config) => {
      const next = { ...current, [key]: value } as Config;
      if (key === "longMode") next.longLtv = value === "2x" ? .5 : .75;
      if (key === "shortMode") next.shortLtv = value === "2x" ? .5 : .75;
      return next;
    };
    if (mode === "manual") setManualConfig(updateConfig);
    else if (key === "deposit" && typeof v === "number") setOptimiserDeposit(v);
    else setOptimisedConfigsByMode((current) => ({
      ...current,
      [comparisonMode]: updateConfig(current[comparisonMode]),
    }));
  };
  const updateDegenSettings = (patch: Partial<Pick<Config, "degenEnabled" | "degenMode" | "customRecyclePct">>) => {
    if (mode === "manual") {
      setManualConfig((current) => ({ ...current, ...patch }));
      return;
    }
    setDegenSettingsByMode((current) => ({
      ...current,
      [comparisonMode]: {
        ...current[comparisonMode],
        ...patch,
        customRecyclePct: patch.customRecyclePct === undefined
          ? current[comparisonMode].customRecyclePct
          : Math.min(100, Math.max(0, patch.customRecyclePct)),
      },
    }));
  };
  const selectedRecycleRatio = degenRecycleTargetRatio({ ...pendingConfig, degenEnabled: true });
  const selectedRecyclePercentage = `${(selectedRecycleRatio * 100).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")}%`;
  const degenSelectorLabel = pendingConfig.degenMode === "custom"
    ? `CUSTOM · ${selectedRecyclePercentage}`
    : pendingConfig.degenMode === "max"
      ? `MAX · ${selectedRecyclePercentage}`
      : `${pendingConfig.degenMode.replace("x", "×")} · ${selectedRecyclePercentage}`;
  const manualPositionIsDefault = manualConfig.longAllocation === 0.5 &&
    manualConfig.longLtv === 0.5 && manualConfig.shortLtv === 0.5 &&
    manualConfig.longMode === "2x" && manualConfig.shortMode === "2x" &&
    manualConfig.cashbackMode === "cash";
  const resetOptimisationOptions = createDefaultOptimisationOptions(comparisonMode, objective);
  const resetAnalysisMoves = analysisRangeToPercent(resetOptimisationOptions.analysisRange);
  const optimiserControlsAreResetDefaults =
    cashbackPolicy === (resetOptimisationOptions.cashbackPolicy ?? "auto") &&
    cashbackRouting === (resetOptimisationOptions.cashbackRouting ?? "auto") &&
    longLtvLimit === (resetOptimisationOptions.longMaxLtv ?? resetOptimisationOptions.maxLtv) * 100 &&
    shortLtvLimit === (resetOptimisationOptions.shortMaxLtv ?? resetOptimisationOptions.maxLtv) * 100 &&
    bullishTarget === (resetOptimisationOptions.bullishTargetPercent ?? 200) &&
    bearishTarget === (resetOptimisationOptions.bearishTargetPercent ?? -75) &&
    spotParityMagnitude === resetOptimisationOptions.spotParityPercent &&
    debtParityMagnitude === resetOptimisationOptions.debtParityPercent &&
    perpParityMagnitude === resetOptimisationOptions.perpParityPercent &&
    requireBreakeven === resetOptimisationOptions.requireBreakeven &&
    downsideBreakevenMagnitude === Math.abs(resetOptimisationOptions.downsideBreakevenPercent) &&
    upsideBreakevenMagnitude === resetOptimisationOptions.upsideBreakevenPercent &&
    analysisMinPercent === resetAnalysisMoves.minMovePercent &&
    analysisMaxPercent === resetAnalysisMoves.maxMovePercent &&
    searchStep === (resetOptimisationOptions.searchStepPercent ?? 1);
  const activeComparisonIsDefault = (comparisonMode === "base"
    ? pendingConfig.deposit === INITIAL_CONFIG.deposit && baseAssetValue === 0
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
    maxDD === defaultMaxDrawdown &&
    !pendingConfig.degenEnabled &&
    (mode === "manual" ? manualPositionIsDefault : optimiserControlsAreResetDefaults);
  const resetActiveComparison = () => {
    optimiserWorkerRef.current?.terminate();
    optimiserWorkerRef.current = null;
    const defaultCache = createDefaultOptimisationCache();
    for (const [signature, result] of optimisationCache) {
      if ((result.options.comparisonMode ?? "base") === comparisonMode)
        optimisationCache.delete(signature);
    }
    for (const [signature, result] of defaultCache) {
      if ((result.options.comparisonMode ?? "base") === comparisonMode)
        optimisationCache.set(signature, result);
    }
    if (mode === "optimise") {
      const resetSignature = createOptimisationSignature({
        ...resetOptimisationOptions,
        maxDrawdown: defaultMaxDrawdown / 100,
      });
      setDisplayedResultsByMode((current) => ({
        ...current,
        [comparisonMode]: defaultCache.get(resetSignature) ?? null,
      }));
    }
    setRunState({ kind: "idle" });
    setOptimisedConfigsByMode((current) => ({
      ...current,
      [comparisonMode]: { ...INITIAL_CONFIG },
    }));
    setMaxDD(defaultMaxDrawdown);
    if (mode === "manual") {
      setManualConfig((current) => ({
        ...current,
        longAllocation: 0.5,
        longLtv: 0.5,
        longMode: "2x",
        shortLtv: 0.5,
        shortMode: "2x",
        cashbackMode: "cash",
        degenEnabled: false,
        degenMode: "x1",
        customRecyclePct: 50,
      }));
    } else {
      setDegenSettingsByMode((current) => ({
        ...current,
        [comparisonMode]: { ...DEFAULT_DEGEN_SETTINGS },
      }));
      setCashbackPolicy(resetOptimisationOptions.cashbackPolicy ?? "auto");
      setCashbackRouting(resetOptimisationOptions.cashbackRouting ?? "auto");
      setLongLtvLimit((resetOptimisationOptions.longMaxLtv ?? resetOptimisationOptions.maxLtv) * 100);
      setShortLtvLimit((resetOptimisationOptions.shortMaxLtv ?? resetOptimisationOptions.maxLtv) * 100);
      setBullishTarget(resetOptimisationOptions.bullishTargetPercent ?? 200);
      setBearishTarget(resetOptimisationOptions.bearishTargetPercent ?? -75);
      setSpotParityMagnitude(resetOptimisationOptions.spotParityPercent);
      setDebtParityMagnitude(resetOptimisationOptions.debtParityPercent);
      setPerpParityMagnitude(resetOptimisationOptions.perpParityPercent);
      setRequireBreakeven(resetOptimisationOptions.requireBreakeven);
      setDownsideBreakevenMagnitude(Math.abs(resetOptimisationOptions.downsideBreakevenPercent));
      setUpsideBreakevenMagnitude(resetOptimisationOptions.upsideBreakevenPercent);
      setAnalysisMinPercent(resetAnalysisMoves.minMovePercent);
      setAnalysisMaxPercent(resetAnalysisMoves.maxMovePercent);
      setSearchStep(resetOptimisationOptions.searchStepPercent ?? 1);
    }
    if (comparisonMode === "base") {
      update("deposit", resetOptimisationOptions.deposit);
      setBaseAssetValue(resetOptimisationOptions.baseAssetValue ?? 0);
      return;
    }
    if (comparisonMode === "lending") {
      setAssetPrice(resetOptimisationOptions.debtPosition.assetPrice);
      setAssetAmount(resetOptimisationOptions.debtPosition.assetAmount);
      setUsdDebt(resetOptimisationOptions.debtPosition.usdDebt);
      setLiquidationLtv(resetOptimisationOptions.debtPosition.liquidationLtv * 100);
      return;
    }
    setPerpState({ ...resetOptimisationOptions.perpPosition });
  };
  const persistInputsNow = () => saveCalculatorInputs({
    comparisonMode, manualConfigsByMode, optimiserDeposit, optimiserControlsByMode,
    workspaceControlsByMode,
    degenSettingsByMode, defaultMaxDrawdown, maxDrawdownByMode,
    minMove, maxMove, chartSeriesVisibility, showDebt, showPerp, webChartWheelZoomEnabled,
    showLiquidationLine, showDrawdownLine, baseAssetValue, assetPrice, assetAmount,
    usdDebt, liquidationLtv, perpState, assetName,
  });
  const closeApplication = () => {
    if (!isDesktopApp) return;
    if (!persistenceLoaded) return window.desktopWindow?.close();
    void persistInputsNow()?.catch(() => undefined).finally(() => window.desktopWindow?.close());
  };
  const togglePeaNileEnhancement = () => {
    const toggle = () => flushSync(() => setIsPeaNileEnhanced((enhanced) => !enhanced));
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const transitionDocument = document as Document & {
      startViewTransition?: (update: () => void) => unknown;
    };
    if (!reducedMotion && transitionDocument.startViewTransition) {
      transitionDocument.startViewTransition(toggle);
      return;
    }
    const chartPanel = document.querySelector<HTMLElement>(".chart-panel");
    const before = chartPanel?.getBoundingClientRect();
    toggle();
    if (!reducedMotion && chartPanel && before) {
      const after = chartPanel.getBoundingClientRect();
      chartPanel.animate([
        {
          transformOrigin: "top left",
          transform: `translate(${before.left - after.left}px, ${before.top - after.top}px) scale(${before.width / after.width}, ${before.height / after.height})`,
        },
        { transformOrigin: "top left", transform: "none" },
      ], {
        duration: 400,
        easing: "cubic-bezier(.22, .75, .18, 1)",
      });
    }
  };
  const selectComparisonMode = (nextMode: ComparisonMode) => {
    if (nextMode === comparisonMode) return;
    optimiserWorkerRef.current?.terminate();
    optimiserWorkerRef.current = null;
    setRunState({ kind: "idle" });
    setShowDegenSelector(false);
    setComparisonMode(nextMode);
  };
  const isParityObjective = objective === "spotParity" ||
    objective === "debtParity" || objective === "perpParity";
  const optimisationInputs: Record<string, unknown> = {
    comparisonMode,
    deposit: pendingConfig.deposit,
    maxDrawdown: maxDD,
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
    cashbackPolicy,
    cashbackRouting,
    degenEnabled,
    degenMode,
    customRecyclePct: degenMode === "custom" ? customRecyclePct : null,
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
    analysisMinPercent,
    analysisMaxPercent,
    searchStep,
  };
  const pendingOptions: OptimiseOptions = {
    maxDrawdown: maxDD / 100,
    maxLtv: maxLtv / 100,
    longMaxLtv: longLtvLimit / 100,
    shortMaxLtv: shortLtvLimit / 100,
    bullishTargetPercent: bullishTarget,
    bearishTargetPercent: bearishTarget,
    searchStepPercent: searchStep,
    objective,
    comparisonMode,
    baseAssetValue,
    analysisRange: pendingAnalysisRange,
    spotParityPercent: spotParityMagnitude,
    debtParityPercent: debtParityMagnitude,
    perpParityPercent: perpParityMagnitude,
    debtPosition: {
      ...debtPosition,
      liquidationLtv: debtPosition.liquidationLtv ?? 0.9,
    },
    perpPosition: perpState,
    cashbackPolicy,
    cashbackRouting,
    degenEnabled,
    degenMode,
    customRecyclePct,
    requireBreakeven,
    downsideBreakevenPercent: -downsideBreakevenMagnitude,
    upsideBreakevenPercent: upsideBreakevenMagnitude,
    deposit: pendingConfig.deposit,
  };
  const pendingSignature = createOptimisationSignature(pendingOptions);
  pendingSignaturesRef.current[comparisonMode] = pendingSignature;
  useLayoutEffect(() => {
    // Select the startup preset only after persisted controls have hydrated.
    // Otherwise the initial Base/Bullish preset becomes stale as soon as the
    // saved objective and mode-specific inputs arrive.
    if (!persistenceLoaded || mode !== "optimise") return;
    setDisplayedResultsByMode((current) => {
      // Ordinary control changes retain the displayed strategy as stale.
      // Only an exact shipped preset may replace it without pressing Optimise.
      const restored = restorePassivePresetResult(
        current[comparisonMode],
        optimisationCache,
        defaultPresetSignatures,
        pendingSignature,
        comparisonMode,
      );
      return restored === current[comparisonMode]
        ? current
        : { ...current, [comparisonMode]: restored };
    });
    setRunState((current) =>
      current.kind === "failed" && current.signature !== pendingSignature
        ? { kind: "idle" }
        : current,
    );
  }, [comparisonMode, defaultPresetSignatures, mode, optimisationCache, pendingSignature, persistenceLoaded]);
  useEffect(() => () => {
    optimiserWorkerRef.current?.terminate();
    optimiserWorkerRef.current = null;
  }, []);
  const optimisationStatus = optimisationStatusFor(displayedResult, pendingSignature, runState);
  const stalePanelActive = mode === "optimise" && optimisationStatus !== "current";
  const stalePanelCalculating = optimisationStatus === "calculating";
  const optimiseError = runState.kind === "failed" && runState.signature === pendingSignature
    ? runState.message
    : null;
  const productRoutingDecision = mode === "optimise" && displayedResult?.options.objective === "bullish"
    ? displayedResult.productRoutingDecision
    : null;
  const objectiveAnalysis = mode === "optimise" ? displayedResult?.objectiveAnalysis ?? null : null;
  const longReferenceLabel = `Long component · ${longModeLabel(config.longMode ?? "2x")}`;
  const shortReferenceLabel = `Short component · ${shortModeLabel(config.shortMode ?? "2x")}`;
  const longControlLabel = longReferenceLabel;
  const shortControlLabel = shortReferenceLabel;
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
            maxDD
        ? "Risk target changed"
      : lastRun &&
            (lastRun.inputs.cashbackPolicy !== cashbackPolicy ||
              (cashbackPolicy !== "off" && lastRun.inputs.cashbackRouting !== cashbackRouting) ||
              lastRun.inputs.longLtvLimit !== longLtvLimit ||
              lastRun.inputs.shortLtvLimit !== shortLtvLimit)
          ? "Product selection changed"
      : lastRun &&
            (lastRun.inputs.degenEnabled !== degenEnabled ||
              (degenEnabled && lastRun.inputs.degenMode !== degenMode) ||
              (degenEnabled && degenMode === "custom" &&
                lastRun.inputs.customRecyclePct !== customRecyclePct))
          ? "Degen settings changed"
        : lastRun &&
            (lastRun.inputs.downsideBreakevenPercent !==
              (requireBreakeven ? -downsideBreakevenMagnitude : null) ||
              lastRun.inputs.upsideBreakevenPercent !==
                (requireBreakeven ? upsideBreakevenMagnitude : null))
          ? "Breakeven limits changed"
        : lastRun &&
            (lastRun.inputs.analysisMinPercent !== analysisMinPercent ||
              lastRun.inputs.analysisMaxPercent !== analysisMaxPercent)
          ? "Analysis range changed"
        : "Strategy inputs changed";
  const sendToManual = () => {
    if (!displayedResult) return;
    setManualConfig({ ...displayedResult.result });
    setMode("manual");
  };
  const runOptimisation = () => {
    if (optimising || !pendingComparisonIsValid) return;
    const cached = optimisationCache.get(pendingSignature);
    if (cached) {
      setDisplayedResultsByMode((current) => ({
        ...current,
        [comparisonMode]: cached,
      }));
      setOptimisedConfigsByMode((current) => ({
        ...current,
        [comparisonMode]: cached.result,
      }));
      setRunState({ kind: "idle" });
      return;
    }
    const jobComparisonMode = comparisonMode;
    const jobOptions = structuredClone(pendingOptions);
    const jobInputs = structuredClone(optimisationInputs);
    const jobSignature = createOptimisationSignature(jobOptions);
    setRunState({ kind: "running", signature: jobSignature });
    const worker = new Worker(
      new URL("./model/optimiser.worker.ts", import.meta.url),
      { type: "module" },
    );
    optimiserWorkerRef.current = worker;
    worker.onmessage = (
      event: MessageEvent<{
        ok: boolean;
        outcome?: OptimiseOutcome;
        productRoutingDecision?: ProductRoutingDecision | null;
        error?: string;
      }>,
    ) => {
      worker.terminate();
      if (optimiserWorkerRef.current === worker) optimiserWorkerRef.current = null;
      if (!event.data.ok || !event.data.outcome) {
        setRunState({ kind: "failed", signature: jobSignature, message: event.data.error ?? "Optimisation failed" });
        return;
      }
      const outcome = event.data.outcome;
      if (!outcome.config) {
        setRunState({ kind: "failed", signature: jobSignature, message: outcome.failure ?? "Optimisation failed" });
        return;
      }
      const result = outcome.config;
      const completed: SuccessfulOptimisationResult = {
        signature: jobSignature,
        options: jobOptions,
        inputs: jobInputs,
        result,
        outcome,
        productRoutingDecision: event.data.productRoutingDecision ?? null,
        objectiveAnalysis: createObjectiveAnalysis({
          objective: jobOptions.objective,
          config: result,
          spotParityPercent: jobOptions.spotParityPercent,
          debtParityPercent: jobOptions.debtParityPercent,
          perpParityPercent: jobOptions.perpParityPercent,
          debtPosition: jobOptions.debtPosition,
          perpPosition: jobOptions.perpPosition,
          bearishTargetPercent: jobOptions.bearishTargetPercent ?? -75,
          analysisRange: jobOptions.analysisRange,
          comparisonMode: jobOptions.comparisonMode ?? "base",
        }),
        baseAssetValue: jobOptions.baseAssetValue ?? 0,
      };
      setDisplayedResultsByMode((current) => {
        const displayedForMode = current[jobComparisonMode];
        const next = completeOptimisation(
          displayedForMode,
          optimisationCache,
          completed,
          pendingSignaturesRef.current[jobComparisonMode],
        );
        return next === displayedForMode
          ? current
          : { ...current, [jobComparisonMode]: next };
      });
      if (pendingSignaturesRef.current[jobComparisonMode] === jobSignature) {
        setOptimisedConfigsByMode((current) => ({
          ...current,
          [jobComparisonMode]: result,
        }));
      }
      setRunState({ kind: "idle" });
    };
    worker.onerror = () => {
      worker.terminate();
      if (optimiserWorkerRef.current === worker) optimiserWorkerRef.current = null;
      setRunState({ kind: "failed", signature: jobSignature, message: "Optimisation worker failed" });
    };
    worker.postMessage(jobOptions);
  };
  const zoomChart = (scale: number, anchorRatio = 0.5) => {
    const currentSpan = Math.max(20, maxMove - minMove);
    const nextSpan = Math.min(2090, Math.max(20, Math.round((currentSpan * scale) / 10) * 10));
    const boundedAnchorRatio = Math.min(1, Math.max(0, anchorRatio));
    const anchorMove = minMove + currentSpan * boundedAnchorRatio;
    let nextMin = Math.round((anchorMove - nextSpan * boundedAnchorRatio) / 10) * 10;
    let nextMax = nextMin + nextSpan;
    if (nextMin < -90) {
      nextMax += -90 - nextMin;
      nextMin = -90;
    }
    if (nextMax > 2000) {
      nextMin -= nextMax - 2000;
      nextMax = 2000;
    }
    setMinMove(nextMin);
    setMaxMove(nextMax);
  };
  const handleChartWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (event.deltaY === 0) return;
    event.preventDefault();
    const plotGrid = event.currentTarget.querySelector<SVGGraphicsElement>(".recharts-cartesian-grid");
    const plotBounds = plotGrid?.getBoundingClientRect() ?? event.currentTarget.getBoundingClientRect();
    const anchorRatio = plotBounds.width > 0
      ? (event.clientX - plotBounds.left) / plotBounds.width
      : 0.5;
    zoomChart(event.deltaY < 0 ? 0.85 : 1.15, anchorRatio);
  };
  const resetChartZoom = () => {
    setMinMove(DEFAULT_CHART_MIN_MOVE);
    setMaxMove(DEFAULT_CHART_MAX_MOVE);
  };
  const scenarios = useMemo(() => {
    const negativeMoves = Array.from({ length: 4 }, (_, index) => minMove + ((-minMove) * index) / 4);
    const positiveMoves = Array.from({ length: 4 }, (_, index) => (maxMove * (index + 1)) / 4);
    return [...negativeMoves, 0, ...positiveMoves].map((move) => 1 + move / 100);
  }, [minMove, maxMove]);
  const assetLabel = assetName.trim() || DEFAULT_ASSET_NAME;
  const assetLabelLower = assetLabel.toLowerCase();
  const assetLabelUpper = assetLabel.toUpperCase();
  return (
    <main className={isDesktopApp ? "desktop-app" : "web-app"}>
      <header className="topbar">
        <div className="topbar-brand">
          <div className="wordmark">
            V4 SPECULATOR
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
            <button
              ref={peaNileButtonRef}
              type="button"
              className={`comparison-settings ${isPeaNileEnhanced ? "active" : ""}`}
              aria-pressed={isPeaNileEnhanced}
              onClick={() => {
                setShowSettings(false);
                setShowAssetName(false);
                togglePeaNileEnhancement();
              }}
            >
              {isPeaNileEnhanced ? "DISENGAGE PEA-NILE ENHANCEMENT" : "ENGAGE PEA-NILE ENHANCEMENT"}
            </button>
          </div>
        </div>
        <div className="topbar-actions">
          <div className="creator-credit" aria-label="Created by Scuttle.eth">
            <span className="creator-credit-label">CREATED BY-</span>
            <a
              className="comparison-settings creator-credit-button"
              href={SCUTTLE_LINK}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => {
                if (!isDesktopApp || !window.desktopWindow?.openExternal) return;
                event.preventDefault();
                void window.desktopWindow.openExternal(SCUTTLE_LINK);
              }}
            >
              SCUTTLE.ETH
            </a>
          </div>
          {/* Legacy status removed from the titlebar.
            <span>LOCAL · BASE PRICE MODEL · YIELD &amp; LP FEES EXCLUDED</span>
          */}
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
          {isDesktopApp && <button
            type="button"
            className="window-close"
            aria-label="Close application"
            title="Close"
            onClick={closeApplication}
          >
            <span />
          </button>}
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
            {!isDesktopApp && (
              <label className="settings-wheel-zoom-toggle">
                <span>
                  <b>CHART MOUSE-WHEEL ZOOM</b>
                  <small>Zoom Strategy Response with the mouse wheel</small>
                </span>
                <input
                  type="checkbox"
                  checked={webChartWheelZoomEnabled}
                  onChange={(event) => setWebChartWheelZoomEnabled(event.target.checked)}
                  aria-label="Enable chart mouse-wheel zoom"
                />
                <i aria-hidden="true" />
              </label>
            )}
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
                <span>ANALYSIS RANGE MIN</span>
                <small>Lower bound for portfolio risk and full-range comparisons</small>
                <NumericInput className="settings-number" value={analysisMinPercent} min={-99} max={-1} onValueChange={(value) => setAnalysisMinPercent(Math.min(-1, Math.max(-99, value)))} />
                <em>%</em>
              </label>
              <label>
                <span>ANALYSIS RANGE MAX</span>
                <small>Upper bound for portfolio risk and full-range comparisons</small>
                <NumericInput className="settings-number" value={analysisMaxPercent} min={1} max={2000} onValueChange={(value) => setAnalysisMaxPercent(Math.min(2000, Math.max(1, value)))} />
                <em>%</em>
              </label>
              <label>
                <span>FINAL RESOLUTION</span>
                <small>Automatic 5% to 2% refinement to this grid</small>
                <NumericInput className="settings-number" value={searchStep} min={0.25} max={5} step="0.25" onValueChange={(value) => setSearchStep(Math.min(5, Math.max(0.25, value)))} />
                <em>%</em>
              </label>
              <label>
                <span>DEFAULT DRAWDOWN</span>
                <small>Used when Reset is pressed</small>
                <NumericInput className="settings-number" value={defaultMaxDrawdown} min={0} max={MAX_OPTIMISER_DRAWDOWN_PERCENT} step="0.1" onValueChange={(value) => setDefaultMaxDrawdown(Math.min(MAX_OPTIMISER_DRAWDOWN_PERCENT, Math.max(0, value)))} />
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
            <p>V4 products remain capped at 2.5x.</p>
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
                onBlur={() => setAssetName((value) => value.trim() || DEFAULT_ASSET_NAME)}
                aria-label="Asset name or symbol"
              />
            </label>
            <div className="asset-name-actions">
              <button type="button" onClick={() => setAssetName(DEFAULT_ASSET_NAME)}>RESET TO {DEFAULT_ASSET_NAME}</button>
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
                <p>Normalised gross structural equations used for every plotted {assetLabelLower} price.</p>
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
                  <code>LF<sub>L/S</sub> = 1 + 2 × LTV<sub>L/S</sub></code>
                  <code><var>m</var><sub>S</sub> = 0.5 ÷ (1 − LTV<sub>S</sub>)</code>
                  <code>S<sub>m</sub>(p) = 0.5 + 0.5p + 0.5m ÷ p − 0.5m</code>
                  <code>S<sub>m</sub>(p) = 0.5p + 0.5m ÷ p + 0.5(1 − m)</code>
                  <code><var>V</var><sub>4</sub>(p) = <var>a</var>L<sub>product</sub>(p) + (1 − <var>a</var>)S<sub>product</sub>(p)</code>
                  <code>chart return = 100 × [<var>V</var><sub>4</sub>(p) − 1]</code>
                </div>
                <p>
                  <var>a</var> is the long allocation; the remainder is short.
                  Dollar value is deposit × <var>V</var><sub>4</sub>(p). The held-spot
                  comparator is simply deposit × <var>p</var>. Long and Short products
                  are discrete. <var>LF</var> describes gross position formation, not a
                  direct return multiplier; <var>m</var><sub>S</sub> scales the Short
                  inverse-price sleeve.
                </p>
              </section>

              <div className="maths-modes">
                <section className="maths-card cash">
                  <div className="maths-card-title">
                    <i>02</i>
                    <div>
                      <b>Long products</b>
                      <span>Cashback routing is separate from product selection</span>
                    </div>
                  </div>
                  <div className="equation-stack">
                    <code>L<sub>2x</sub>(p) = p</code>
                    <code>L<sub>cashback,cash</sub>(p) = 0.5 + 0.5p<sup>2</sup></code>
                    <code>L<sub>cashback,spot</sub>(p) = 0.5p + 0.5p<sup>2</sup></code>
                    <code>L<sub>2.5x</sub>(p) = p<sup>2</sup></code>
                  </div>
                </section>

                <section className="maths-card spot">
                  <div className="maths-card-title">
                    <i>03</i>
                    <div>
                      <b>Short products</b>
                      <span>Cashback partitions the m = 2 Short curve once</span>
                    </div>
                  </div>
                  <div className="equation-stack">
                    <code>S<sub>2x</sub>(p) = S<sub>m=1</sub>(p)</code>
                    <code>S<sub>cashback,cash</sub>(p) = 0.5 + 0.5S<sub>m=2</sub>(p)</code>
                    <code>S<sub>cashback,spot</sub>(p) = 0.5p + 0.5S<sub>m=2</sub>(p)</code>
                    <code>S<sub>2.5x</sub>(p) = S<sub>m=2</sub>(p)</code>
                    <CalculationUnderReviewWarning className="maths-review-warning" />
                  </div>
                </section>
              </div>

              <section className="maths-assumptions">
                <div>
                  <small>USER-FACING PRODUCTS</small>
                  <strong>2x</strong>
                  <strong>2x Cashback</strong>
                  <strong>2.5x</strong>
                  <small>SHORT CURVE PARAMETER</small>
                  <strong>2x → m = 1.00</strong>
                  <strong>2x Cashback → m = 2.00, partitioned</strong>
                  <strong>2.5x → m = 2.00</strong>
                </div>
                <div>
                  <small>MODEL ASSUMPTIONS</small>
                  <ul>
                    <li>All curves start at 1.00 when <var>p</var> = 1.</li>
                    <li>
                      Long and Short products are independently selected. Each closed-form curve
                      assumes its target exposure is ideally maintained through rebalancing;
                      the rebalancing path itself is not simulated.
                    </li>
                    <li>
                      On either side, Cashback partitions the eligible curve once;
                      the 2.5x product keeps the complete eligible curve in V4. Nothing is recursively layered.
                    </li>
                    <li>
                      Gross, frictionless and path-independent: the equations show structural
                      value at each price ratio, not the realised journey to that price.
                    </li>
                    <li>
                      Volatility-farming yield, borrowing and funding costs, fees, rebalancing
                      execution, liquidation effects and slippage are excluded. The model does not
                      determine whether yield outweighs those costs.
                    </li>
                    <li>
                      “Short” identifies the inverse/rebalanced product family. Cashback routing
                      can offset its directional exposure.
                    </li>
                    <li>
                      <var>p</var> is floored internally at 0.000001 because the Short equation
                      contains 1 ÷ <var>p</var>. Extreme downside values are idealised curve
                      extrapolations without liquidity or capacity limits.
                    </li>
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
      <div className={`shell ${isPeaNileEnhanced ? "pea-nile-enhanced" : ""}`}>
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
          {comparisonMode !== "base" && (
            <p className="comparison-mode-explainer">
              Assess whether moving your position's current equity into V4 could improve performance.
            </p>
          )}
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
                    <NumericInput min={0} value={pendingConfig.deposit} onValueChange={(value) => update("deposit", Math.max(0, value))} />
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
                <div className="deposit-input liquidation-ltv-input">
                  <NumericInput min={1} max={99} step="1" value={liquidationLtv} onValueChange={(value) => setLiquidationLtv(Math.min(99, Math.max(1, value)))} />
                  <span>%</span>
                </div>
              </label>
            </section>
            <section className="compact-control derived-deposit">
              <label className="field-label">V4 DEPOSIT <small>— Derived from net equity</small></label>
              <div className="deposit-input"><span>$</span><NumericInput value={Math.max(0, pendingConfig.deposit)} onValueChange={() => undefined} readOnly aria-label="Derived V4 deposit" /></div>
            </section>
            </>}
            {comparisonMode === "perp" && <>
              <section className="compact-control debt-input-row">
                <label className="field-label">CURRENT {assetLabel} PRICE
                  <div className="deposit-input"><span>$</span><NumericInput min={0} value={perpState.assetPrice} onValueChange={(value) => setPerpState((current) => ({ ...current, assetPrice: Math.max(0, value) }))} /></div>
                </label>
                <label className="field-label">POSITION SIZE - {assetLabel}
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
                <label className="field-label">V4 DEPOSIT <small>— Derived from net equity</small></label>
                <div className="deposit-input"><span>$</span><NumericInput value={Math.max(0, pendingConfig.deposit)} onValueChange={() => undefined} readOnly aria-label="Derived V4 deposit" /></div>
              </section>
            </>}
            <section className="compact-control cashback-degen-control">
              <CashbackControlLabel
                label={mode === "manual" ? "CASHBACK ROUTING" : "CASHBACK"}
                help={mode === "manual"
                  ? "Choose how Cashback is held. Cash keeps it uninvested, while Spot asset converts it to spot exposure."
                  : "Controls whether Cashback is excluded, required, or left for the optimizer to decide."}
              />
              {mode === "manual" ? <div className="segments wide cashback-segments">
                <button className={manualConfig.cashbackMode === "cash" ? "on" : ""} onClick={() => update("cashbackMode", "cash")}>Cash</button>
                <button className={manualConfig.cashbackMode === "spot" ? "on" : ""} onClick={() => update("cashbackMode", "spot")}>Spot asset</button>
              </div> : <div className="cashback-policy-controls">
                <div className="segments wide cashback-segments">
                  <button className={cashbackPolicy === "off" ? "on" : ""} onClick={() => setCashbackPolicy("off")}>Off</button>
                  <button className={cashbackPolicy === "forced" ? "on" : ""} onClick={() => setCashbackPolicy("forced")}>Forced</button>
                  <button className={cashbackPolicy === "auto" ? "on" : ""} onClick={() => setCashbackPolicy("auto")}>Auto</button>
                </div>
                <CashbackControlLabel
                  className="cashback-routing-label"
                  label="CASHBACK ROUTING"
                  help="Choose how Cashback is held. Cash keeps it uninvested, Spot asset converts it to spot exposure, and Auto lets the optimizer choose."
                />
                <div className={`segments wide cashback-segments ${cashbackPolicy === "off" ? "cashout-disabled" : ""}`}>
                  <button className={cashbackRouting === "cash" ? "on" : ""} disabled={cashbackPolicy === "off"} onClick={() => setCashbackRouting("cash")}>Cash</button>
                  <button className={cashbackRouting === "spot" ? "on" : ""} disabled={cashbackPolicy === "off"} onClick={() => setCashbackRouting("spot")}>Spot asset</button>
                  <button className={cashbackRouting === "auto" ? "on" : ""} disabled={cashbackPolicy === "off"} onClick={() => setCashbackRouting("auto")}>Auto</button>
                </div>
              </div>}
            </section>
            {/* Retired Cash-out and Degen controls.
            <section className="compact-control cashback-degen-control">
              <div className="section-label">
                <b>CASH-OUT &amp; DEGEN</b>
                <label className="switch precision-switch cashout-master-toggle" aria-label="Enable cash-out and Degen">
                  <input
                    type="checkbox"
                    checked={cashOutEnabled}
                    onChange={toggleCashOutAndDegen}
                  />
                  <span />
                </label>
              </div>
              <div className={`cashback-degen-capsule ${cashOutEnabled ? "" : "cashout-disabled"}`}>
                <div className="segments wide cashback-segments cashback-routing-row">
                  <button
                    className={
                      (mode === "manual"
                        ? displayedCashbackMode === "cash"
                        : cashbackPreference === "cash")
                        ? "on"
                        : ""
                    }
                    onClick={() => setCashbackMode("cash")}
                    disabled={cashbackRoutingUnavailable}
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
                    disabled={cashbackRoutingUnavailable}
                  >
                    Reinvest in spot
                  </button>
                  {mode === "optimise" && (
                    <button
                      className={cashbackPreference === "optimise" ? "on" : ""}
                      onClick={() => setCashbackPreference("optimise")}
                      disabled={!cashOutEnabled}
                    >
                      Auto
                    </button>
                  )}
                </div>
                <div className={`degen-control-row ${cashOutEnabled && pendingConfig.degenEnabled ? "enabled" : "disabled"}`}>
                  <button
                    type="button"
                    className="degen-toggle"
                    aria-pressed={pendingConfig.degenEnabled}
                    disabled={!cashOutEnabled}
                    onClick={() => {
                      updateDegenSettings({ degenEnabled: !pendingConfig.degenEnabled });
                      if (pendingConfig.degenEnabled) setShowDegenSelector(false);
                    }}
                  >
                    <span>DEGEN</span>
                    <b>{pendingConfig.degenEnabled ? "ON" : "OFF"}</b>
                  </button>
                  <div className="degen-selector-wrap" ref={degenSelectorRef}>
                    <button
                      type="button"
                      className="degen-selector-trigger"
                      disabled={!pendingConfig.degenEnabled}
                      aria-expanded={showDegenSelector}
                      aria-haspopup="dialog"
                      onClick={() => setShowDegenSelector((open) => !open)}
                    >
                      <span>{degenSelectorLabel}</span><i aria-hidden="true" />
                    </button>
                    {showDegenSelector && pendingConfig.degenEnabled && (
                      <div className="degen-selector-popover" role="dialog" aria-label="Degen recycle selector">
                        <div className="degen-popover-heading">
                          <b>RECYCLE ROUNDS</b>
                          <span>Percentages are actual additional V4 capital funded by eligible Long cash-out.</span>
                        </div>
                        <div className="degen-option-grid" role="group" aria-label="Recycle target">
                          {DEGEN_PRESET_OPTIONS.slice(0, 4).map((option) => (
                            <button
                              type="button"
                              key={option.mode}
                              className={pendingConfig.degenMode === option.mode ? "on" : ""}
                              onClick={() => {
                                updateDegenSettings({ degenMode: option.mode });
                                setShowDegenSelector(false);
                              }}
                            >
                              <b>{option.label}</b><span>{(degenRecycleTargetRatio({ ...pendingConfig, degenEnabled: true, degenMode: option.mode }) * 100).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")}%</span>
                            </button>
                          ))}
                          <button
                            type="button"
                            className={pendingConfig.degenMode === "custom" ? "on" : ""}
                            onClick={() => updateDegenSettings({ degenMode: "custom" })}
                          >
                            <b>CUSTOM</b><span>{selectedRecyclePercentage}</span>
                          </button>
                          <button
                            type="button"
                            className={pendingConfig.degenMode === "max" ? "on" : ""}
                            onClick={() => {
                              updateDegenSettings({ degenMode: "max" });
                              setShowDegenSelector(false);
                            }}
                          >
                            <b>MAX</b><span>{(degenRecycleTargetRatio({ ...pendingConfig, degenEnabled: true, degenMode: "max" }) * 100).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")}%</span>
                          </button>
                        </div>
                        {pendingConfig.degenMode === "custom" && (
                          <label className="degen-custom-input">
                            <span>CUSTOM · % OF INITIAL DEPOSIT</span>
                            <div className="deposit-input">
                              <NumericInput
                                min={0}
                                max={100}
                                step="1"
                                value={pendingConfig.customRecyclePct}
                                onValueChange={(value) => updateDegenSettings({ customRecyclePct: value })}
                                aria-label="Custom recycled capital percentage of initial deposit"
                              />
                              <b>%</b>
                            </div>
                          </label>
                        )}
                        <div className="degen-explainer">
                          <p><b>ROUNDS</b> ×1 recycles the eligible Long cash-out once. Each additional round uses only eligible Long cash-out generated by the preceding recycled deposit.</p>
                          <p><b>CUSTOM</b> Requests a total recycle amount. It is capped at the cash-out the selected Long allocation and LTV can generate.</p>
                          <p><b>MAX</b> Models continuous recycling up to that same mathematical limit. Short capital never funds recycling.</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              {mode === "optimise" && <div className={`force-cashout-control ${cashOutEnabled ? "" : "disabled"}`}>
                <label className="switch precision-switch">
                  <input
                    type="checkbox"
                    checked={forceCashOut}
                    disabled={!cashOutEnabled}
                    onChange={(event) => {
                      const next = event.target.checked;
                      if (next) setLongLtvLimit(MAX_V4_LTV * 100);
                      setForceCashOut(next);
                    }}
                  />
                  <span />
                  <div>
                    Force cash-out
                    <small>Requires an eligible 75% Long position with cash-out; the optimiser otherwise assesses the position normally.</small>
                  </div>
                </label>
              </div>}
            </section>
            */}
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
                  <span>Up to 2.5x</span>
                </div>
                <label className="field-label">LONG PRODUCT</label>
                <div className="segments wide cashback-segments product-mode-segments">
                  {(["2x", "2.5x-cashback", "2.5x-looped"] as const).map((longMode) => <button key={longMode} className={config.longMode === longMode ? "on" : ""} onClick={() => update("longMode", longMode)}>{longModeLabel(longMode)}</button>)}
                </div>
                <label className="field-label">SHORT PRODUCT</label>
                <div className="segments wide cashback-segments product-mode-segments">
                  {(["2x", "2.5x-cashback", "2.5x-looped"] as const).map((shortMode) => <button key={shortMode} className={config.shortMode === shortMode ? "on" : ""} onClick={() => update("shortMode", shortMode)}>{shortModeLabel(shortMode)}</button>)}
                </div>
                {isShortCashbackUnderReview(config.shortMode) && (
                  <CalculationUnderReviewWarning className="manual-product-review-warning" />
                )}
              </section>
            </div>
          )}

          {mode === "optimise" && (
            <>
              <div className="control-group risk-constraints">
                <section className="risk-target">
                  <div className="optimise-leverage-limits discrete-leverage-limits">
                    <div className="leverage-limits-header">
                      <span>LEVERAGE LIMITS</span>
                      <button type="button" className={`leverage-limits-toggle ${leverageLimitsExpanded ? "expanded" : ""}`} onClick={() => setLeverageLimitsExpanded((expanded) => !expanded)} aria-expanded={leverageLimitsExpanded}>
                        <b>{longLtvLimit >= maxLtv && shortLtvLimit >= maxLtv ? "AUTO" : "CUSTOM"}</b><i aria-hidden="true" />
                      </button>
                    </div>
                    {leverageLimitsExpanded && <div className="leverage-limit-editor">
                      <label className="field-label">LONG</label>
                      <div className="segments wide cashback-segments">
                        <button className={longLtvLimit < maxLtv ? "on" : ""} onClick={() => setLongLtvLimit(50)}>2x</button>
                        <button className={longLtvLimit >= maxLtv ? "on" : ""} onClick={() => setLongLtvLimit(maxLtv)}>2.5x</button>
                      </div>
                      <label className="field-label">SHORT</label>
                      <div className="segments wide cashback-segments">
                        <button className={shortLtvLimit < maxLtv ? "on" : ""} onClick={() => setShortLtvLimit(50)}>2x</button>
                        <button className={shortLtvLimit >= maxLtv ? "on" : ""} onClick={() => setShortLtvLimit(maxLtv)}>2.5x</button>
                      </div>
                      <button type="button" className="reset-leverage-limits" onClick={() => { setLongLtvLimit(maxLtv); setShortLtvLimit(maxLtv); setLeverageLimitsExpanded(false); }}>RESET TO AUTO</button>
                    </div>}
                  </div>
                  <Slider
                    label="MAX LEG DRAWDOWN"
                    value={maxDD}
                    min={0}
                    max={MAX_OPTIMISER_DRAWDOWN_PERCENT}
                    onChange={setMaxDD}
                    step={0.1}
                    displayPrecision={1}
                    detail=""
                    accent="risk"
                    signedDisplay
                    deferRangeCommit
                  />
                </section>
                <label className="switch precision-switch breakeven-required">
                  <input
                    type="checkbox"
                    checked={requireBreakeven}
                    onChange={(e) => setRequireBreakeven(e.target.checked)}
                  />
                  <span />
                  <div>
                    Require opposing-side profit
                    <small>Opposing leg must eventually exceed the initial deposit value</small>
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
                            : optimisationStatus === "failed"
                              ? "!"
                              : "●"}
                      </i>
                      <span>
                        {optimisationStatus === "not-run"
                          ? "Optimisation required"
                          : optimisationStatus === "current"
                            ? "Optimised"
                            : optimisationStatus === "stale"
                              ? staleReason
                              : optimisationStatus === "failed"
                                ? "Optimisation failed"
                                : "Optimising…"}
                      </span>
                    </div>
                    <button
                      className={`optimise-action ${optimisationStatus}`}
                      onClick={runOptimisation}
                      disabled={optimising || !pendingComparisonIsValid}
                    >
                      {optimising
                        ? "Optimising…"
                        : optimisationStatus === "current"
                          ? "Re-run"
                          : optimisationStatus === "stale"
                            ? "Re-run optimisation"
                            : optimisationStatus === "failed"
                              ? "Retry optimisation"
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
                      <div className={`spot-parity-result ${lastRun.outcome.parity?.reached === false ? "best-effort" : ""}`}>
                        <b>{lastRun.outcome.parity?.reached === false ? "BEST AVAILABLE — SPOT PARITY NOT REACHED" : "SPOT PARITY SECURED"}</b>
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
                        <div className={`spot-parity-result debt-parity-result ${parity.secured ? "" : "best-effort"}`}>
                          <b>{parity.secured ? "LENDING PARITY SECURED" : "BEST AVAILABLE — LENDING PARITY NOT REACHED"}</b>
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
                        <div className={`spot-parity-result debt-parity-result ${parity.secured ? "" : "best-effort"}`}>
                          <b>{parity.secured ? "PERP PARITY SECURED" : "BEST AVAILABLE — PERP PARITY NOT REACHED"}</b>
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
                        <em>LONG <b>{(lastRun.result.longAllocation * 100).toFixed(0)}%</b></em>
                        <i>({money(lastRun.result.deposit * lastRun.result.longAllocation)})</i>
                      </span>
                      <span>
                        <em>SHORT <b>{((1 - lastRun.result.longAllocation) * 100).toFixed(0)}%</b></em>
                        <i>({money(lastRun.result.deposit * (1 - lastRun.result.longAllocation))})</i>
                      </span>
                    </small>
                  </div>
                  <div className="optimised-values">
                    {lastRun.result.longAllocation > 1e-12 && <span>
                      LONG PRODUCT
                      <b>{longModeLabel(lastRun.result.longMode ?? "2x")}</b>
                    </span>}
                    {lastRun.result.longAllocation < 1 - 1e-12 && <span>
                      SHORT PRODUCT
                      <b>{shortModeLabel(lastRun.result.shortMode ?? "2x")}</b>
                    </span>}
                  </div>
                  {isShortCashbackUnderReview(lastRun.result.shortMode) && (
                    <CalculationUnderReviewWarning className="optimised-product-review-warning" />
                  )}
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
          {!displayComparisonIsValid ? (
            <div className="panel invalid-comparison">
              <b>COMPARISON UNAVAILABLE</b>
              <span>{displayComparisonMode === "perp" ? "Enter valid mark, entry, size, margin and liquidation values; current perp equity must remain above $0 to compare with V4." : `Repay enough debt or add ${assetLabelLower} collateral so net equity is above $0.`}</span>
            </div>
          ) : <>
          <div className={`readouts analytical-panel${stalePanelActive ? " is-stale" : ""}`}>
            {stalePanelActive && (
              <OptimisationRequiredBadge
                className="analytical-optimisation-required"
                calculating={stalePanelCalculating}
                compact
              />
            )}
            <div className="analytical-panel-scroll">
            <section className="analytical-section summary-position">
              <h3>POSITION BREAKDOWN</h3>
              <div className="position-breakdown-grid">
                <span className="position-breakdown-label">LONG V4</span>
                <small className="position-product-label">{longModeLabel(config.longMode ?? "2x")}</small>
                <b className="position-capital-value">
                  {money(positionBreakdown.longCapital)}
                  {positionBreakdown.recycledLongCapital > 0 && <small className="degen-recycled-allocation">(+{money(positionBreakdown.recycledLongCapital)})</small>}
                </b>
                {positionBreakdown.loopedLongCapital > 0 && <>
                  <span className="position-looped-capital-label">LEVERAGE ADDED</span>
                  <b className="position-looped-capital-value">+{money(positionBreakdown.loopedLongCapital)}</b>
                </>}
                <span className="position-leg-separator" aria-hidden="true" />
                <span className="position-breakdown-label">SHORT V4</span>
                <small className="position-product-label">{shortModeLabel(config.shortMode ?? "2x")}</small>
                <b className="position-capital-value">
                  {money(positionBreakdown.shortCapital)}
                  {positionBreakdown.recycledShortCapital > 0 && <small className="degen-recycled-allocation">(+{money(positionBreakdown.recycledShortCapital)})</small>}
                </b>
                {isShortCashbackUnderReview(config.shortMode) && (
                  <CalculationUnderReviewWarning className="position-product-review-warning" />
                )}
                {positionBreakdown.loopedShortCapital > 0 && <>
                  <span className="position-looped-capital-label">LEVERAGE ADDED</span>
                  <b className="position-looped-capital-value">+{money(positionBreakdown.loopedShortCapital)}</b>
                </>}
                {positionBreakdown.cashOutAmount > 0 && <span className="position-leg-separator" aria-hidden="true" />}
                {config.degenEnabled && positionBreakdown.recycledIntoV4 > 0 && <>
                  <span>RECYCLED INTO V4</span>
                  <b className="degen-recycled-value">+{money(positionBreakdown.recycledIntoV4)}</b>
                </>}
                {positionBreakdown.cashOutAmount > 0 && <>
                  <span>{config.cashbackMode === "spot" ? <>CASHBACK CONVERTED<br />TO {assetLabelUpper}</> : "CASHBACK"}</span>
                  {config.cashbackMode === "cash" ? (
                    <b className="cashback-cash-value">{money(positionBreakdown.cashOutAmount)}</b>
                  ) : (
                    <span className="cashback-spot-value">
                      <b>{positionBreakdown.spotUnits === null ? "SPOT" : `${positionBreakdown.spotUnits.toFixed(2)} ${assetLabel}`}</b>
                      <small>({money(positionBreakdown.cashOutAmount)})</small>
                    </span>
                  )}
                </>}
              </div>
            </section>
            <section className="analytical-section summary-risk risk" title={`Trough at ${pct(risk.p - 1)} underlying`}>
              <h3>MAX DRAWDOWN</h3>
              <div className="drawdown-summary-row">
                <strong className="analytical-primary">{pct(risk.drawdown)}</strong>
                <span className="analytical-note">
                  Across {signedFixed(displayAnalysisMoves.minMovePercent)}% to {signedFixed(displayAnalysisMoves.maxMovePercent)}%
                  <br />
                  {risk.breakeven ? `Downside breakeven at ${pct(risk.breakeven - 1)}` : "No downside breakeven in modelled range"}
                </span>
              </div>
            </section>
            {productRoutingDecision && <ProductRoutingDecisionBlock decision={productRoutingDecision} />}
            {objectiveAnalysis && <ObjectiveAnalysisBlock analysis={objectiveAnalysis} />}
            </div>
          </div>
          <div className={`panel chart-panel${stalePanelActive ? " is-stale" : ""}`}>
            <div className="panel-head">
              <div>
                <b>STRATEGY RESPONSE</b>
                <span>
                  V4 return vs {comparisonMode === "lending" ? "Lending Position" : comparisonMode === "perp" ? "Perp Position" : `${assetLabelUpper} move`} · Yield &amp; LP fees excluded
                </span>
              </div>
              <div className="chart-controls">
                <div className="chart-zoom-controls" role="group" aria-label="Chart zoom controls">
                  <button
                    type="button"
                    aria-label="Zoom out"
                    title="Zoom out"
                    onClick={() => zoomChart(1.25)}
                    disabled={minMove <= -90 && maxMove >= 2000}
                  >
                    <span className="zoom-glyph">−</span>
                  </button>
                  <button
                    type="button"
                    aria-label="Zoom in"
                    title="Zoom in"
                    onClick={() => zoomChart(0.8)}
                    disabled={maxMove - minMove <= 20}
                  >
                    <span className="zoom-glyph">+</span>
                  </button>
                  <button
                    type="button"
                    className="zoom-reset"
                    aria-label="Reset chart zoom"
                    title="Reset chart zoom"
                    onClick={resetChartZoom}
                    disabled={minMove === DEFAULT_CHART_MIN_MOVE && maxMove === DEFAULT_CHART_MAX_MOVE}
                  >
                    <span aria-hidden="true">↺</span>
                  </button>
                </div>
                <button
                  type="button"
                  className="open-harvester"
                  disabled={!displayComparisonIsValid}
                  onClick={() => setHarvesterSnapshot(createHarvesterSnapshot({
                    config,
                    comparisonMode: displayComparisonMode,
                    spotAssetPrice: displayComparisonMode === "base"
                      ? displayBaseAssetValue
                      : displayComparisonMode === "lending"
                        ? displayDebtPosition.assetPrice
                        : displayPerpState.assetPrice,
                    ...(displayComparisonMode === "lending" ? { debtPosition: displayDebtPosition } : {}),
                    ...(displayComparisonMode === "perp" ? { perpPosition: displayPerpState } : {}),
                    assetName: assetLabel,
                    defaultHarvestDirection: mode === "optimise" && displayObjective === "bearish" ? "short" : "long",
                  }))}
                >
                  Open Harvester
                </button>
                <div className="chart-series-controls">
                  <label>
                    <input
                      type="checkbox"
                      checked={showLong}
                      disabled={!hasLong || isLongOnly}
                      onChange={(e) => setChartSeriesVisible("long", e.target.checked)}
                    />{" "}
                    Long component
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={showShort}
                      disabled={!hasShort || isShortOnly}
                      onChange={(e) => setChartSeriesVisible("short", e.target.checked)}
                    />{" "}
                    Short component
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={showSpot}
                      onChange={(e) => setChartSeriesVisible("spot", e.target.checked)}
                    />{" "}
                    {assetLabel} value - spot
                  </label>
                  {displayComparisonMode === "lending" && <label>
                    <input
                      type="checkbox"
                      checked={showDebt}
                      onChange={(e) => setShowDebt(e.target.checked)}
                    />{" "}
                    Lending Position
                  </label>}
                  {displayComparisonMode === "perp" && <label>
                    <input
                      type="checkbox"
                      checked={showPerp}
                      onChange={(e) => setShowPerp(e.target.checked)}
                    />{" "}
                    Perp position
                  </label>}
                  {displayComparisonMode !== "base" && <label>
                    <input
                      type="checkbox"
                      checked={showLiquidationLine}
                      onChange={(e) => setShowLiquidationLine(e.target.checked)}
                    />{" "}
                    Liquidation line
                  </label>}
                  {mode === "optimise" && <label>
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
              <div className="chart-plot" onWheel={canZoomChartWithWheel ? handleChartWheel : undefined}>
              {stalePanelActive && (
                <OptimisationRequiredBadge
                  className="chart-optimisation-required"
                  calculating={stalePanelCalculating}
                />
              )}
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
                    <filter id="v4SeriesGlow" x="-30%" y="-30%" width="160%" height="160%">
                      <feGaussianBlur stdDeviation="4" />
                    </filter>
                    <filter id="secondarySeriesGlow" x="-20%" y="-20%" width="140%" height="140%">
                      <feGaussianBlur in="SourceGraphic" stdDeviation="1.8" result="softGlow" />
                      <feComponentTransfer in="softGlow" result="restrainedGlow">
                        <feFuncA type="linear" slope="0.38" />
                      </feComponentTransfer>
                      <feMerge>
                        <feMergeNode in="restrainedGlow" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
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
                    ticks={xAxisTicks}
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
                  <Tooltip content={<ChartTooltip config={config} debtPosition={displayDebtPosition} comparisonMode={displayComparisonMode} perpPosition={displayPerpState} baseAssetValue={displayBaseAssetValue} assetLabel={assetLabel} showLong={showLong} showShort={showShort} showSpot={showSpot} showDebt={showDebt} showPerp={showPerp} />} />
                  <ReferenceLine y={0} stroke="#7e756c" strokeOpacity={0.72} />
                  <ReferenceLine
                    x={0}
                    stroke="#d4874c"
                    strokeOpacity={0.72}
                    strokeWidth={1.5}
                  />
                  {displayComparisonMode === "lending" && showDebt && showLiquidationLine && displayDebtSummary.liquidationAssetMove !== null &&
                    displayDebtSummary.liquidationAssetMove >= minMove &&
                    displayDebtSummary.liquidationAssetMove <= maxMove && (
                      <>
                        <ReferenceLine
                          x={displayDebtSummary.liquidationAssetMove}
                          stroke="#c96d58"
                          strokeDasharray="4 4"
                          label={{
                            value: `LENDING LIQUIDATION · ${money(displayDebtSummary.liquidationPrice ?? 0)} · ${pct(displayDebtSummary.liquidationAssetMove / 100)}`,
                            fill: "#c8b991",
                            fontSize: 10,
                          }}
                        />
                        <ReferenceDot
                          x={displayDebtSummary.liquidationAssetMove}
                          y={(debtPositionReturn(displayDebtSummary.liquidationPriceRatio ?? 1, displayDebtPosition) ?? 0) * 100}
                          r={isPeaNileEnhanced ? 7 : 5}
                          fill="#cf7961"
                          stroke="#151616"
                        />
                      </>
                    )}
                  {displayComparisonMode === "perp" && showPerp && showLiquidationLine && displayPerpSummary.liquidationAssetMove !== null &&
                    displayPerpSummary.liquidationAssetMove >= minMove &&
                    displayPerpSummary.liquidationAssetMove <= maxMove && (
                      <>
                        <ReferenceLine
                          x={displayPerpSummary.liquidationAssetMove}
                          stroke="#c96d58"
                          strokeDasharray="4 4"
                          label={{
                            value: `PERP LIQUIDATION · ${displayPerpState.side.toUpperCase()} · ${money(displayPerpState.liquidationPrice)} · ${pct(displayPerpSummary.liquidationAssetMove / 100)}`,
                            fill: "#c98c78",
                            fontSize: 10,
                          }}
                        />
                        <ReferenceDot
                          x={displayPerpSummary.liquidationAssetMove}
                          y={(perpPositionReturn(displayPerpSummary.liquidationPriceRatio ?? 1, displayPerpState) ?? 0) * 100}
                          r={isPeaNileEnhanced ? 7 : 5}
                          fill="#cf7961"
                          stroke="#151616"
                        />
                      </>
                    )}
                  {mode === "optimise" && showDrawdownLine && (
                    <ReferenceLine
                      y={-displayMaxDrawdown}
                      stroke="#a55f47"
                      strokeDasharray="5 4"
                      label={{
                        value: `drawdown limit −${displayMaxDrawdown}%`,
                        fill: "#be806b",
                        fontSize: 10,
                      }}
                    />
                  )}
                  {isPeaNileEnhanced && <Line
                    dataKey="v4"
                    stroke="#e18a4a"
                    strokeWidth={10}
                    strokeOpacity={0.28}
                    dot={false}
                    filter="url(#v4SeriesGlow)"
                    isAnimationActive={false}
                    legendType="none"
                    tooltipType="none"
                  />}
                  <Area
                    dataKey="v4"
                    name="V4 combined position"
                    stroke="#e18a4a"
                    fill="url(#v4Fill)"
                    fillOpacity={1}
                    strokeWidth={isPeaNileEnhanced ? 4.6 : 3.4}
                    dot={false}
                    isAnimationActive={false}
                  />
                  {showSpot && <Line
                    dataKey="spot"
                    name={`${assetLabel} value - spot`}
                    stroke="#b8aea3"
                    strokeOpacity={0.78}
                    strokeWidth={isPeaNileEnhanced ? 1.8 : 1.35}
                    filter={isPeaNileEnhanced ? "url(#secondarySeriesGlow)" : undefined}
                    dot={false}
                    isAnimationActive={false}
                  />}
                  {showLong && (
                    <Line
                      dataKey="long"
                      name={longReferenceLabel}
                      stroke="#e18a4a"
                      strokeDasharray="3 3"
                      strokeWidth={isPeaNileEnhanced ? 2.2 : 1.5}
                      filter={isPeaNileEnhanced ? "url(#secondarySeriesGlow)" : undefined}
                      dot={false}
                      isAnimationActive={false}
                    />
                  )}{" "}
                  {showShort && (
                    <Line
                      dataKey="short"
                      name={shortReferenceLabel}
                      stroke="#e0c45d"
                      strokeDasharray="3 3"
                      strokeWidth={isPeaNileEnhanced ? 2.2 : 1.5}
                      filter={isPeaNileEnhanced ? "url(#secondarySeriesGlow)" : undefined}
                      dot={false}
                      isAnimationActive={false}
                    />
                  )}
                  {displayComparisonMode === "lending" && showDebt && (
                    <Line
                      dataKey="debt"
                      name="Lending Position"
                      stroke="#c4b17d"
                      strokeWidth={isPeaNileEnhanced ? 3 : 2.25}
                      filter={isPeaNileEnhanced ? "url(#secondarySeriesGlow)" : undefined}
                      dot={false}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  )}
                  {displayComparisonMode === "perp" && showPerp && (
                    <Line
                      dataKey="perp"
                      name="Perp position"
                      stroke="#c4b17d"
                      strokeWidth={isPeaNileEnhanced ? 3 : 2.25}
                      filter={isPeaNileEnhanced ? "url(#secondarySeriesGlow)" : undefined}
                      dot={false}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  )}
                  <ReferenceDot
                    x={(risk.p - 1) * 100}
                    y={risk.drawdown * 100}
                    r={isPeaNileEnhanced ? 7 : 5}
                    fill="#c8674f"
                    stroke="#151616"
                  />
                  <ReferenceDot
                    x={risk.breakeven ? (risk.breakeven - 1) * 100 : 0}
                    y={0}
                    r={isPeaNileEnhanced ? 5.5 : 4}
                    fill="#d4874c"
                    stroke="#151616"
                  />
                </ComposedChart>
              </ResponsiveContainer>
              </div>
              <div className="scenario-key scenario-series-key chart-series-legend">
                <span><i className="v4" /> V4 strategy combined</span>
                {showSpot && <span><i className="spot" /> {assetLabel} value - spot</span>}
                {showLong && <span><i className="long" /> {longControlLabel}</span>}
                {showShort && <span><i className="short" /> {shortControlLabel}</span>}
                {displayComparisonMode === "lending" && showDebt && <span><i className="debt" /> Lending Position</span>}
                {displayComparisonMode === "perp" && showPerp && <span><i className="perp" /> Perp position</span>}
              </div>
            </div>
          </div>
          <div className={`panel scenarios comparison-${displayComparisonMode}${stalePanelActive ? " is-stale" : ""}${displayComparisonMode !== "base" && !showSpot ? " spot-hidden" : ""}`}>
            <div className="panel-head">
              <div>
                <b>SCENARIO ANALYSIS</b>
                <span>
                  {displayComparisonMode === "base"
                    ? `V4 strategy compared with the underlying spot ${assetLabelLower}`
                    : displayComparisonMode === "lending"
                      ? `V4 strategy, spot ${assetLabelLower} and lending position compared at the same price moves`
                      : `V4 strategy, spot ${assetLabelLower} and perp position compared at the same price moves`}
                </span>
              </div>
              {stalePanelActive && (
                <OptimisationRequiredBadge
                  className="scenario-optimisation-required"
                  calculating={stalePanelCalculating}
                />
              )}
            </div>
            <div className="scenario-table">
              <div className="scenario-row headings">
                <span>{assetLabel} MOVE</span>
                <span className="v4-start">V4 VALUE</span>
                {displayComparisonMode === "base" ? <>
                  <span className="spot-start">SPOT {assetLabel}<br />VALUE</span>
                  <span className="edge-cell">V4 EDGE</span>
                  <span className="v4-end">V4 RETURN<br />FROM ENTRY</span>
                </> : <>
                  <span className="debt-cell">{displayComparisonMode === "lending" ? "LENDING POSITION" : "PERP POSITION"}</span>
                  <span className="comparison-edge">V4 EDGE</span>
                  <span className="v4-end">V4 RETURN<br />FROM ENTRY</span>
                </>}
                {displayComparisonMode !== "base" && showSpot && <>
                  <span className="spot-start">SPOT {assetLabel}<br />VALUE</span>
                  <span className="edge-cell">V4 EDGE</span>
                </>}
              </div>
              {scenarios.map((p) => {
                const v4Return = portfolioReturn(p, config),
                  v = dollarValue(p, config),
                  spot = config.deposit * p,
                  spotEdge = v4Return - (p - 1),
                  comparisonLiquidated = displayComparisonMode === "lending"
                    ? isDebtPositionLiquidated(p, displayDebtPosition)
                    : displayComparisonMode === "perp"
                      ? isPerpPositionLiquidated(p, displayPerpState)
                      : false,
                  comparisonReturn = displayComparisonMode === "lending"
                    ? debtPositionReturn(p, displayDebtPosition)
                    : displayComparisonMode === "perp"
                      ? perpPositionReturn(p, displayPerpState)
                      : null,
                  comparisonEdge = comparisonLiquidated || comparisonReturn === null
                    ? null
                    : v4Return - comparisonReturn,
                  components = portfolioComponents(p, config),
                  cash = config.deposit * components.cashOut,
                  long = config.deposit * components.long,
                  short = config.deposit * components.short,
                  compositionTotal =
                    Math.abs(cash) + Math.abs(long) + Math.abs(short) || 1,
                  cashWidth = (Math.abs(cash) / compositionTotal) * 100,
                  longWidth = (Math.abs(long) / compositionTotal) * 100,
                  shortWidth = (Math.abs(short) / compositionTotal) * 100;
                return (
                  <div
                    className={`scenario-row ${p < 1 ? "down" : "up"}${p === 1 ? " zero" : ""}`}
                    key={p}
                  >
                    <span className="scenario-asset-move">
                      <strong>{pct(p - 1)}</strong>
                      {displayComparisonMode === "base" && displayBaseAssetValue > 0 && <small>{money(displayBaseAssetValue * p)}</small>}
                    </span>
                    <b className="v4-start">{money(v)}</b>
                    {displayComparisonMode === "base" ? <>
                      <span className="spot-start">{money(spot)}</span>
                      <span className={`edge-cell ${p === 1 ? "" : spotEdge >= 0 ? "positive" : "negative"}`}>
                        {pct(spotEdge).replace("%", " pts")}
                      </span>
                      <span className={`v4-end ${p !== 1 ? (v4Return >= 0 ? "positive" : "negative") : ""}`}>
                        {pct(v4Return)}
                      </span>
                    </> : <>
                      <span className="debt-cell debt-scenario">
                        {displayComparisonMode === "lending" ? (isDebtPositionLiquidated(p, displayDebtPosition) ? (
                          <b className="position-liquidated">RIP</b>
                        ) : (
                          <b className="position-value">{money(debtPositionValue(p, displayDebtPosition))}</b>
                        )) : (isPerpPositionLiquidated(p, displayPerpState) ? (
                          <b className="position-liquidated">RIP</b>
                        ) : (
                          <b className="position-value">{money(perpPositionValue(p, displayPerpState))}</b>
                        ))}
                      </span>
                      <span className={`comparison-edge ${comparisonEdge === null ? "unavailable" : p === 1 ? "" : comparisonEdge >= 0 ? "positive" : "negative"}`}>
                        {comparisonEdge === null ? "—" : pct(comparisonEdge).replace("%", " pts")}
                      </span>
                      <span className={`v4-end ${p !== 1 ? (v4Return >= 0 ? "positive" : "negative") : ""}`}>
                        {pct(v4Return)}
                      </span>
                    </>}
                    {displayComparisonMode !== "base" && showSpot && <>
                      <span className="spot-start">{money(spot)}</span>
                      <span className={`edge-cell ${p === 1 ? "" : spotEdge >= 0 ? "positive" : "negative"}`}>
                        {pct(spotEdge).replace("%", " pts")}
                      </span>
                    </>}
                  </div>
                );
              })}
            </div>
            {displayComparisonMode === "lending" && <section className="scenario-debt-summary">
              <div className="section-label"><b>LENDING POSITION</b><span>{((displayDebtPosition.liquidationLtv ?? 0.9) * 100).toFixed(0)}% liquidation LTV</span></div>
              <div className="debt-summary-grid">
                <span>COLLATERAL <b>{money(displayDebtSummary.grossCollateral)}</b></span>
                <span>DEBT <b>{money(displayDebtPosition.usdDebt)}</b></span>
                <span>NET EQUITY <b>{money(displayDebtSummary.netEquity)}</b></span>
                <span>CURRENT LTV <b>{displayDebtSummary.currentLtv === null ? "—" : `${(displayDebtSummary.currentLtv * 100).toFixed(2)}%`}</b></span>
                <span>LIQUIDATION PRICE <b>{displayDebtSummary.liquidationPrice === null ? "—" : money(displayDebtSummary.liquidationPrice)}</b></span>
                <span>LIQUIDATION MOVE <b>{displayDebtSummary.liquidationAssetMove === null ? "—" : pct(displayDebtSummary.liquidationAssetMove / 100)}</b></span>
              </div>
              {!displayComparisonIsValid && <p className="debt-invalid">Net equity must remain above $0 to compare with V4.</p>}
            </section>}
            {displayComparisonMode === "perp" && <section className="scenario-debt-summary">
              <div className="section-label"><b>PERP POSITION</b><span>{displayPerpState.side.toUpperCase()}</span></div>
              <div className="perp-position-identity">
                <span>
                  <small>POSITION SIZE</small>
                  <b>{displayPerpState.positionSize.toLocaleString("en-US", { maximumFractionDigits: 4 })} {assetLabel}</b>
                </span>
                <span>
                  <small>CURRENT {assetLabel} PRICE</small>
                  <b>{money(displayPerpState.assetPrice)}</b>
                </span>
              </div>
              <div className="debt-summary-grid">
                <span>NOTIONAL <b>{money(displayPerpSummary.notional)}</b></span>
                <span>MARGIN <b>{money(displayPerpState.margin)}</b></span>
                <span>UNREALISED PNL <b>{money(displayPerpSummary.unrealisedPnl)}</b></span>
                <span>CURRENT EQUITY <b>{money(displayPerpSummary.currentEquity)}</b></span>
                <span>EFFECTIVE EXPOSURE <b>{displayPerpSummary.effectiveExposure === null ? "—" : `${displayPerpSummary.effectiveExposure.toFixed(2)}×`}</b></span>
                <span>LIQUIDATION PRICE <b>{money(displayPerpState.liquidationPrice)}</b></span>
                <span>LIQUIDATION MOVE <b>{displayPerpSummary.liquidationAssetMove === null ? "—" : pct(displayPerpSummary.liquidationAssetMove / 100)}</b></span>
              </div>
              {displayPerpSummary.liquidationOnUnexpectedSide && <p className="debt-invalid">Liquidation price is on the unexpected side for this {displayPerpState.side}.</p>}
              {!displayComparisonIsValid && <p className="debt-invalid">Current equity must remain above $0 to compare with V4.</p>}
            </section>}
          </div>
          </>}
        </section>
      </div>
      {harvesterSnapshot && (
        <HarvesterOverlay
          snapshot={harvesterSnapshot}
          onClose={() => setHarvesterSnapshot(null)}
        />
      )}
    </main>
  );
}
