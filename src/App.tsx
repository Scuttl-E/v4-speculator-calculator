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
  debtParity: "Maximise protection at lending parity",
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
type ComparisonMode = "base" | "lending" | "perp";
function Slider({
  label,
  value,
  min,
  max,
  onChange,
  detail,
  accent = "amber",
  signedDisplay = false,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  detail: string;
  accent?: string;
  signedDisplay?: boolean;
}) {
  const sliderValue = value,
    displayValue = value,
    inputValue = signedDisplay ? -displayValue : displayValue,
    snapValue = (next: number) => Math.min(max, Math.max(min, Math.round(next))),
    commitValue = (next: number) => onChange(snapValue(next)),
    stepUp = () => {
      const next = signedDisplay
          ? Math.min(max, Math.round(value) + 1)
          : Math.min(max, Math.round(value) + 1);
      onChange(next);
    },
    stepDown = () => {
      const next = signedDisplay
        ? Math.max(min, Math.round(value) - 1)
        : Math.max(min, Math.round(value) - 1);
      onChange(next);
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
          step="1"
          value={sliderValue}
          style={
            {
              "--fill": `${((sliderValue - min) / (max - min)) * 100}%`,
            } as React.CSSProperties
          }
          onChange={(e) => commitValue(+e.target.value)}
        />
        <div className="number-step">
          <input
            type="number"
            step="1"
            min={signedDisplay ? -max : min}
            max={signedDisplay ? -min : max}
            value={inputValue}
            onChange={(e) => commitInput(+e.target.value)}
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
  debtPosition,
  comparisonMode,
  perpPosition,
  baseAssetValue,
  showLong,
  showShort,
}: {
  active?: boolean;
  payload?: any[];
  label?: number;
  config: Config;
  debtPosition: DebtPositionInput;
  comparisonMode: ComparisonMode;
  perpPosition: PerpPositionInput;
  baseAssetValue: number;
  showLong: boolean;
  showShort: boolean;
}) {
  if (!active || !payload?.length) return null;
  const p = 1 + (label ?? 0) / 100,
    v4 = dollarValue(p, config),
    spot = config.deposit * p,
    edge = portfolioReturn(p, config) - (p - 1),
    debtReturn = debtPositionReturn(p, debtPosition),
    debtLiquidated = isDebtPositionLiquidated(p, debtPosition),
    perpReturn = perpPositionReturn(p, perpPosition),
    perpLiquidated = isPerpPositionLiquidated(p, perpPosition),
    liquidated = comparisonMode === "perp" ? perpLiquidated : debtLiquidated,
    assetPrice = comparisonMode === "base" && baseAssetValue > 0
      ? baseAssetValue
      : comparisonMode === "lending"
      ? debtPosition.assetPrice
      : comparisonMode === "perp"
        ? perpPosition.assetPrice
        : null;
  return (
    <div className="chart-tooltip">
      <div className="tooltip-asset">
        <small>ASSET</small>
        <strong>{assetPrice === null ? `${p.toFixed(3)}×` : money(assetPrice * p)}</strong>
        <span aria-hidden="true" />
        <b>{pct(p - 1)}</b>
      </div>
      <div className="tooltip-values">
        <div className="tooltip-value">
          <i className="teal" />
          V4 STRATEGY <b>{pct(portfolioReturn(p, config))}</b>
          <em>{money(v4)}</em>
        </div>
        <div className="tooltip-value">
          <i className="slate" />
          HELD ASSET <b>{pct(p - 1)}</b>
          <em>{money(spot)}</em>
        </div>
      </div>
      {(showLong || showShort) && (
        <div className="tooltip-legs">
          {showLong && <div className="tooltip-value">
            <i className="long" />
            LONG V4 <b>{pct(longValue(p, config.longLtv, config.cashbackMode) - 1)}</b>
            <em>{money(config.deposit * longValue(p, config.longLtv, config.cashbackMode))}</em>
          </div>}
          {showShort && <div className="tooltip-value">
            <i className="short" />
            SHORT V4 <b>{pct(shortValue(p, config.shortLtv, config.cashbackMode) - 1)}</b>
            <em>{money(config.deposit * shortValue(p, config.shortLtv, config.cashbackMode))}</em>
          </div>}
        </div>
      )}
      <div className="edge">
        V4 EDGE VS SPOT <b>{pct(edge).replace("%", " pts")}</b>
      </div>
      {comparisonMode === "lending" && <div>
        <i className="debt" />
        LENDING POSITION {liquidated ? <b>LIQUIDATED</b> : <b>{debtReturn === null ? "—" : pct(debtReturn)}</b>}
        {!liquidated && <em>{money(debtPositionValue(p, debtPosition))}</em>}
      </div>}
      {comparisonMode === "perp" && (
        <div>
          <i className="perp" />
          PERP POSITION <b>{perpLiquidated ? "LIQUIDATED" : perpReturn === null ? "—" : pct(perpReturn)}</b>
          {!perpLiquidated && <em>{money(perpPositionValue(p, perpPosition))}</em>}
        </div>
      )}
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
    [downsideBreakevenMagnitude, setDownsideBreakevenMagnitude] = useState(80),
    [upsideBreakevenMagnitude, setUpsideBreakevenMagnitude] = useState(400),
    [cashbackPreference, setCashbackPreference] =
      useState<OptimiserCashbackMode>("optimise"),
    [requireBreakeven, setRequireBreakeven] = useState(false),
    [maxDD, setMaxDD] = useState(15),
    [minMove, setMinMove] = useState(-80),
    [maxMove, setMaxMove] = useState(150),
    [showLong, setShowLong] = useState(false),
    [showShort, setShowShort] = useState(false),
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
    [optimising, setOptimising] = useState(false),
    [lastRun, setLastRun] = useState<{
      statusKey: string;
      inputs: Record<string, unknown>;
      result: Config;
      outcome: OptimiseOutcome;
    } | null>(null),
    [optimiseError, setOptimiseError] = useState<string | null>(null);
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
      if (saved.objective === "bullish" || saved.objective === "bearish" || saved.objective === "spotParity" || saved.objective === "debtParity") setObjective(saved.objective);
      if (isNumber(saved.spotParityMagnitude)) setSpotParityMagnitude(saved.spotParityMagnitude);
      if (isNumber(saved.debtParityMagnitude)) setDebtParityMagnitude(saved.debtParityMagnitude);
      if (isNumber(saved.downsideBreakevenMagnitude)) setDownsideBreakevenMagnitude(saved.downsideBreakevenMagnitude);
      if (isNumber(saved.upsideBreakevenMagnitude)) setUpsideBreakevenMagnitude(saved.upsideBreakevenMagnitude);
      if (saved.cashbackPreference === "cash" || saved.cashbackPreference === "spot" || saved.cashbackPreference === "optimise") setCashbackPreference(saved.cashbackPreference);
      if (typeof saved.requireBreakeven === "boolean") setRequireBreakeven(saved.requireBreakeven);
      if (isNumber(saved.maxDD)) setMaxDD(saved.maxDD);
      if (isNumber(saved.minMove)) setMinMove(saved.minMove);
      if (isNumber(saved.maxMove)) setMaxMove(saved.maxMove);
      if (typeof saved.showLong === "boolean") setShowLong(saved.showLong);
      if (typeof saved.showShort === "boolean") setShowShort(saved.showShort);
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
        spotParityMagnitude, debtParityMagnitude, downsideBreakevenMagnitude,
        upsideBreakevenMagnitude, cashbackPreference, requireBreakeven, maxDD,
        minMove, maxMove, showLong, showShort, showDebt, showPerp,
        showLiquidationLine, showDrawdownLine, baseAssetValue, assetPrice, assetAmount,
        usdDebt, liquidationLtv, perpState,
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [
    assetAmount, assetPrice, baseAssetValue, cashbackPreference, comparisonMode, debtParityMagnitude,
    downsideBreakevenMagnitude, liquidationLtv, manualConfig, maxDD, maxMove,
    minMove, mode, objective, optimisedConfig, perpState, persistenceLoaded,
    requireBreakeven, showDebt, showDrawdownLine, showLiquidationLine, showLong,
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
  const optimisationCache = useRef(new Map<string, OptimiseOutcome>());
  const maxLtv = MAX_V4_LTV * 100;
  const risk = useMemo(() => {
    const t = findWorstDrawdown(config);
    return { ...t, breakeven: findDownsideBreakeven(config, t) };
  }, [config]);
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
  const activeComparisonIsDefault = comparisonMode === "base"
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
        perpState.side === DEFAULT_PERP.side;
  const resetActiveComparison = () => {
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
    spotParityMagnitude, debtParityMagnitude, downsideBreakevenMagnitude,
    upsideBreakevenMagnitude, cashbackPreference, requireBreakeven, maxDD,
    minMove, maxMove, showLong, showShort, showDebt, showPerp,
    showLiquidationLine, showDrawdownLine, baseAssetValue, assetPrice, assetAmount,
    usdDebt, liquidationLtv, perpState,
  });
  const closeApplication = () => {
    if (!persistenceLoaded) return window.desktopWindow?.close();
    void persistInputsNow()?.catch(() => undefined).finally(() => window.desktopWindow?.close());
  };
  const selectComparisonMode = (nextMode: ComparisonMode) => {
    setComparisonMode(nextMode);
    if (nextMode !== "lending" && objective === "debtParity") setObjective("bullish");
  };
  const optimisationInputs = {
    comparisonMode,
    deposit: config.deposit,
    maxDrawdown: objective === "spotParity" || objective === "debtParity" ? null : maxDD,
    objective,
    spotParityPercent:
      objective === "spotParity" ? spotParityMagnitude : null,
    debtParityPercent:
      objective === "debtParity" ? debtParityMagnitude : null,
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
            lastRun.inputs.debtParityPercent !==
              (objective === "debtParity" ? debtParityMagnitude : null)
          ? "Lending parity target changed"
      : lastRun &&
          lastRun.inputs.maxDrawdown !==
            (objective === "spotParity" || objective === "debtParity" ? null : maxDD)
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
    if (optimising || !comparisonIsValid) return;
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
      debtParityPercent: debtParityMagnitude,
      debtPosition,
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
        <div className="topbar-brand">
          <div className="wordmark">
            <i />
            V4 SPECULATOR <span>PRICE MODEL</span>
          </div>
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
          <div className="control-group capital-settlement">
            <div className="control-group-title">CAPITAL &amp; SETTLEMENT</div>
            {comparisonMode === "base" && (
              <>
                <section className="compact-control">
                  <label className="field-label">V4 DEPOSIT</label>
                  <div className="deposit-input">
                    <span>$</span>
                    <input type="number" min="0" value={config.deposit} onChange={(e) => update("deposit", Math.max(0, +e.target.value || 0))} />
                  </div>
                </section>
                <section className="compact-control base-asset-value">
                  <label className="field-label">ASSET VALUE <small>Optional</small></label>
                  <div className="deposit-input">
                    <span>$</span>
                    <input type="number" min="0" value={baseAssetValue || ""} placeholder="Optional" aria-label="Optional current asset value" onChange={(e) => setBaseAssetValue(Math.max(0, +e.target.value || 0))} />
                  </div>
                </section>
              </>
            )}
            {comparisonMode === "lending" && <>
            <section className="compact-control debt-input-row">
              <label className="field-label">ASSET PRICE
                <div className="deposit-input">
                  <span>$</span>
                  <input type="number" min="0" value={assetPrice} onChange={(e) => setAssetPrice(Math.max(0, +e.target.value || 0))} />
                </div>
              </label>
              <label className="field-label">ASSET AMOUNT
                <div className="deposit-input">
                  <input type="number" min="0" step="0.01" value={assetAmount} onChange={(e) => setAssetAmount(Math.max(0, +e.target.value || 0))} />
                </div>
              </label>
            </section>
            <section className="compact-control debt-inputs">
              <label className="field-label">USD DEBT
                <div className="deposit-input">
                  <span>$</span>
                  <input type="number" min="0" value={usdDebt} onChange={(e) => setUsdDebt(Math.max(0, +e.target.value || 0))} />
                </div>
              </label>
              <label className="field-label">LIQUIDATION LTV
                <div className="deposit-input">
                  <input type="number" min="1" max="99" step="1" value={liquidationLtv} onChange={(e) => setLiquidationLtv(Math.min(99, Math.max(1, +e.target.value || 1)))} />
                  <span>%</span>
                </div>
              </label>
            </section>
            <section className="compact-control derived-deposit">
              <label className="field-label">V4 DEPOSIT <small>Derived from net equity</small></label>
              <div className="deposit-input"><span>$</span><input type="number" value={Math.max(0, config.deposit)} readOnly aria-label="Derived V4 deposit" /></div>
            </section>
            </>}
            {comparisonMode === "perp" && <>
              <section className="compact-control debt-input-row">
                <label className="field-label">CURRENT ASSET PRICE
                  <div className="deposit-input"><span>$</span><input type="number" min="0" value={perpState.assetPrice} onChange={(e) => setPerpState((current) => ({ ...current, assetPrice: Math.max(0, +e.target.value || 0) }))} /></div>
                </label>
                <label className="field-label">POSITION SIZE
                  <div className="deposit-input"><input type="number" min="0" step="0.01" value={perpState.positionSize} onChange={(e) => setPerpState((current) => ({ ...current, positionSize: Math.max(0, +e.target.value || 0) }))} /></div>
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
                  <div className="deposit-input"><span>$</span><input type="number" min="0" value={perpState.averageEntryPrice} onChange={(e) => setPerpState((current) => ({ ...current, averageEntryPrice: Math.max(0, +e.target.value || 0) }))} /></div>
                </label>
              </section>
              <section className="compact-control debt-inputs">
                <label className="field-label">MARGIN / COLLATERAL
                  <div className="deposit-input"><span>$</span><input type="number" min="0" value={perpState.margin} onChange={(e) => setPerpState((current) => ({ ...current, margin: Math.max(0, +e.target.value || 0) }))} /></div>
                </label>
                <label className="field-label">LIQUIDATION PRICE
                  <div className="deposit-input"><span>$</span><input type="number" min="0" value={perpState.liquidationPrice} onChange={(e) => setPerpState((current) => ({ ...current, liquidationPrice: Math.max(0, +e.target.value || 0) }))} /></div>
                </label>
              </section>
              <section className="compact-control derived-deposit">
                <label className="field-label">V4 DEPOSIT <small>Derived from current equity</small></label>
                <div className="deposit-input"><span>$</span><input type="number" value={Math.max(0, config.deposit)} readOnly aria-label="Derived V4 deposit" /></div>
              </section>
            </>}
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
                <div className="control-group-title">RISK &amp; CONSTRAINTS</div>
                <section
                  className={`risk-target ${
                    objective === "spotParity" || objective === "debtParity" ? "objective-owned" : ""
                  }`}
                >
                  {objective === "spotParity" || objective === "debtParity" ? (
                    <div className="risk-context">
                      <i>∿</i>
                      <span>
                        <b>{objective === "debtParity" ? "Lending parity is setting drawdown." : "Spot parity is setting drawdown."}</b>
                        Choose Bullish or Bearish to set a hard limit.
                      </span>
                    </div>
                  ) : (
                    <>
                      <Slider
                        label="MAX DRAWDOWN"
                        value={maxDD}
                        min={0}
                        max={100}
                        onChange={setMaxDD}
                        detail=""
                        accent="risk"
                        signedDisplay
                      />
                    </>
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
                    {Object.entries(objectives)
                      .filter(([v]) => comparisonMode === "lending" || v !== "debtParity")
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
                            At +{parity.targetPercent}% asset move · lending position {money(parity.debtValue)} · V4 {money(parity.v4Value)} · edge {money(edge)} / {pct(edge / parity.debtValue)}
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
          {!comparisonIsValid ? (
            <div className="panel invalid-comparison">
              <b>COMPARISON UNAVAILABLE</b>
              <span>{comparisonMode === "perp" ? "Enter valid mark, entry, size, margin and liquidation values; current perp equity must remain above $0 to compare with V4." : "Repay enough debt or add asset collateral so net equity is above $0."}</span>
            </div>
          ) : <>
          <div className="readouts">
            <div>
              <label>LONG / SHORT RATIO</label>
              <strong>
                {(config.longAllocation * 100).toFixed(0)}% / {((1 - config.longAllocation) * 100).toFixed(0)}%
              </strong>
              <span>capital split</span>
            </div>
            <div className="risk">
              <label>MAX DRAWDOWN</label>
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
            <div className="scenario-key scenario-series-key">
              <span><i className="v4" /> V4 strategy</span>
              <span><i className="spot" /> Asset value - spot</span>
              <span><i className="long" /> {longControlLabel}</span>
              <span><i className="short" /> {shortControlLabel}</span>
              {comparisonMode === "lending" && <span><i className="debt" /> Lending Position</span>}
              {comparisonMode === "perp" && <span><i className="perp" /> Perp position</span>}
            </div>
          </div>
          <div className="panel chart-panel">
            <div className="panel-head">
              <div>
                <b>STRATEGY RESPONSE</b>
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
                {mode === "optimise" && objective !== "spotParity" && objective !== "debtParity" && <label>
                  <input
                    type="checkbox"
                    checked={showDrawdownLine}
                    onChange={(e) => setShowDrawdownLine(e.target.checked)}
                  />{" "}
                  Drawdown limit
                </label>}
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
                    label={{ value: "Asset price change", position: "insideBottom", offset: -8, fill: "#9b9187", fontSize: 12 }}
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
                  <Tooltip content={<ChartTooltip config={config} debtPosition={debtPosition} comparisonMode={comparisonMode} perpPosition={perpState} baseAssetValue={baseAssetValue} showLong={showLong} showShort={showShort} />} />
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
                  {mode === "optimise" && showDrawdownLine && objective !== "spotParity" && objective !== "debtParity" && (
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
                  <Line
                    dataKey="spot"
                    name="Asset value - spot"
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
                        detail="Match the lending position if the asset rises"
                        value={debtParityMagnitude}
                        min={1}
                        max={2000}
                        sign="+"
                        onChange={setDebtParityMagnitude}
                      />
                    </div>
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
          </div>
          <div className={`panel scenarios comparison-${comparisonMode}`}>
            <div className="panel-head">
              <div>
                <b>SCENARIO ANALYSIS</b>
                <span>
                  {comparisonMode === "base"
                    ? "V4 strategy compared with the underlying spot asset"
                    : comparisonMode === "lending"
                      ? "V4 strategy, spot asset and lending position compared at the same price moves"
                      : "V4 strategy, spot asset and perp position compared at the same price moves"}
                </span>
              </div>
            </div>
            <div className="scenario-table">
              <div className="scenario-row headings">
                <span>ASSET MOVE</span>
                <span className="v4-start">V4 VALUE</span>
                <span className="v4-end">V4 RETURN</span>
                <span className="spot-start">ASSET VALUE - SPOT</span>
                <span className="spot-end">ASSET RETURN - SPOT</span>
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
