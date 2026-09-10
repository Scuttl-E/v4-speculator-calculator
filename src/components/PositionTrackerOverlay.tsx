import { memo, useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  TRACKER_ASSETS,
  TRACKER_PRODUCTS,
  addTrackedPosition,
  buildTrackerCurve,
  correctTrackedPosition,
  deleteTrackedPosition,
  isCashbackProduct,
  reduceTrackedPosition,
  setTrackerActualObservation,
  trackerBaselineV4AtPrice,
  trackerCashbackAtPrice,
  trackerEffectiveCurrentValue,
  trackerAllAssetsSummary,
  trackerAssetSummary,
  createEmptyTrackerState,
  trackerProductLabel,
  trackerProductShortLabel,
  type TrackedPosition,
  type TrackerAsset,
  type TrackerCashbackTranche,
  type TrackerCashbackFundingSelection,
  type TrackerCurvePoint,
  type TrackerProduct,
  type TrackerSide,
  type TrackerState,
  type TrackerWealthView,
} from "../model/tracker";

interface PositionTrackerOverlayProps {
  state: TrackerState;
  onChange: (state: TrackerState) => void;
  onClose: () => void;
}

type PendingDeletion =
  | { kind: "position"; positionId: string; description: string }
  | { kind: "all" };

interface CashbackSourceDraft {
  sourcePositionId: string;
  spotPriceDraft: string;
}

interface TrackerChartRange {
  minMove: number;
  maxMove: number;
}

const DEFAULT_TRACKER_CHART_RANGE: TrackerChartRange = { minMove: -80, maxMove: 200 };
const DETAIL_TRACKER_CHART_RANGE: TrackerChartRange = { minMove: -50, maxMove: 50 };

const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
const preciseMoney = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
const signedMoney = (value: number) => `${value >= 0 ? "+" : "−"}${money(Math.abs(value))}`;
const signedPercent = (value: number) => `${value >= 0 ? "+" : "−"}${Math.abs(value * 100).toFixed(2)}%`;
const compactNumber = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 4 });
const nowLocalDateTime = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const compactDateTime = (value: string) => new Date(value).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
const positionDisplayLabel = (side: TrackerSide, product: TrackerProduct) => `${side.toUpperCase()} ${product === "2x" ? "2x" : product === "2.5x-cashback" ? "2x CASHBACK" : "2.5x"}`;

const wealthViewLabel = (view: TrackerWealthView) => view === "total" ? "TOTAL" : view === "v4-cb" ? "V4 + CB" : "V4 ONLY";

function TrackerTooltip({ active, payload, label, positions, wealthView }: {
  active?: boolean;
  payload?: any[];
  label?: number;
  positions: readonly TrackedPosition[];
  wealthView: TrackerWealthView;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as TrackerCurvePoint | undefined;
  if (!row) return null;
  const visible = positions.filter((position) => position.chartVisible);
  const originalCapital = positions.reduce((sum, position) => sum + position.originalEntryCapital, 0);
  const remainingCapital = positions.reduce((sum, position) => sum + position.originalEntryCapital * position.remainingFraction, 0);
  return <div className="tracker-tooltip">
    <div className="tracker-tooltip-head"><b>{label == null ? "—" : `${label >= 0 ? "+" : ""}${label.toFixed(1)}%`}</b><span>{preciseMoney(row.absolutePrice)}</span></div>
    <section>
      <small>COMBINED · {wealthViewLabel(wealthView)}</small>
      <span>Combined Baseline <strong>{money(row.combinedBaseline)}</strong></span>
      <span>Combined Actual <strong>{money(row.combinedActual)}</strong></span>
      <span>Active V4 <strong>{money(row.baselineV4)} / {money(row.actualV4)}</strong></span>
      <span>Cashback <strong>{money(row.cashback)}</strong></span>
      <span>Withdrawn Cash <strong>{money(row.withdrawnCash)}</strong></span>
      <span>Original / Remaining Capital <strong>{money(originalCapital)} / {money(remainingCapital)}</strong></span>
    </section>
    {visible.slice(0, 2).map((position) => {
      const values = row.positions[position.id];
      if (!values) return null;
      return <section className="selected" key={position.id}>
        <small>{position.assetSymbol} · {trackerProductLabel(position.side, position.product).toUpperCase()}</small>
        <span>Model V4 <strong>{money(values.baselineV4)}</strong></span>
        <span>Projected Actual V4 <strong>{money(values.actualV4)}</strong></span>
        <span>Original capital <strong>{money(position.originalEntryCapital)}</strong></span>
        <span>Remaining capital <strong>{money(position.originalEntryCapital * position.remainingFraction)}</strong></span>
        <span>Entry price <strong>{preciseMoney(position.entryAssetPrice)}</strong></span>
        <span>Cashback {wealthView === "v4-only" ? "(excluded)" : ""}<strong>{money(values.cashback)}</strong></span>
        <span>Withdrawn {wealthView === "total" ? "" : "(excluded)"}<strong>{money(values.withdrawnCash)}</strong></span>
        <span>Displayed wealth <strong>{money(values.actualWealth)}</strong></span>
      </section>;
    })}
    {visible.length > 2 && <small className="tracker-tooltip-more">+{visible.length - 2} more visible position curves</small>}
  </div>;
}

const TrackerChartPanel = memo(function TrackerChartPanel({
  assetSymbol,
  currentPrice,
  positions,
  wealthView,
  cashbackTranches,
  freshExternalCapital,
  setWealthView,
  showCombinedChart,
  setShowCombinedChart,
  showCapitalIn,
  setShowCapitalIn,
  expanded,
  onToggleExpanded,
  chartRange,
  onChartRangeChange,
}: {
  assetSymbol: TrackerAsset;
  currentPrice: number;
  positions: readonly TrackedPosition[];
  wealthView: TrackerWealthView;
  cashbackTranches: readonly TrackerCashbackTranche[];
  freshExternalCapital: number;
  setWealthView: (view: TrackerWealthView) => void;
  showCombinedChart: boolean;
  setShowCombinedChart: Dispatch<SetStateAction<boolean>>;
  showCapitalIn: boolean;
  setShowCapitalIn: Dispatch<SetStateAction<boolean>>;
  expanded: boolean;
  onToggleExpanded: () => void;
  chartRange: TrackerChartRange;
  onChartRangeChange: (boundary: keyof TrackerChartRange, value: string) => void;
}) {
  const sampleCount = Math.max(2, Math.round((chartRange.maxMove - chartRange.minMove) * 10) + 1);
  const curve = useMemo(
    () => buildTrackerCurve(positions, currentPrice, wealthView, chartRange.minMove, chartRange.maxMove, sampleCount, cashbackTranches),
    [positions, currentPrice, wealthView, chartRange.minMove, chartRange.maxMove, sampleCount, cashbackTranches],
  );
  const axisTicks = useMemo(() => {
    const first = Math.ceil(chartRange.minMove / 10) * 10;
    const last = Math.floor(chartRange.maxMove / 10) * 10;
    const ticks = Array.from({ length: Math.max(0, Math.round((last - first) / 10) + 1) }, (_, index) => first + index * 10);
    return ticks.length >= 2 ? ticks : [chartRange.minMove, chartRange.maxMove];
  }, [chartRange.minMove, chartRange.maxMove]);
  const detailGuides = [-25, -10, 10, 25].filter((move) => move > chartRange.minMove && move < chartRange.maxMove);
  const visiblePositions = positions.filter((position) => position.chartVisible);

  return <section className={`tracker-chart-panel${expanded ? " expanded" : ""}`}>
    <div className="tracker-chart-head"><div><small>COMBINED PORTFOLIO RESPONSE · {chartRange.minMove.toFixed(1)}% TO {chartRange.maxMove >= 0 ? "+" : ""}{chartRange.maxMove.toFixed(1)}%</small><b>{assetSymbol} BASELINE vs ACTUAL</b><span>0% = current price {currentPrice > 0 ? preciseMoney(currentPrice) : "not set"} · hover resolution 0.1%</span></div><div className="tracker-chart-actions"><div className="tracker-wealth-view" aria-label="Wealth View">{(["total", "v4-cb", "v4-only"] as const).map((view) => <button key={view} type="button" className={wealthView === view ? "on" : ""} onClick={() => setWealthView(view)}>{wealthViewLabel(view)}</button>)}</div><div className="tracker-chart-range-tools" aria-label="Chart range"><label>FROM <input aria-label="Chart range from" type="number" min="-99.9" max={(chartRange.maxMove - .1).toFixed(1)} step="0.1" value={chartRange.minMove} onChange={(event) => onChartRangeChange("minMove", event.target.value)} />%</label><label>TO <input aria-label="Chart range to" type="number" min={(chartRange.minMove + .1).toFixed(1)} max="500" step="0.1" value={chartRange.maxMove} onChange={(event) => onChartRangeChange("maxMove", event.target.value)} />%</label></div><div className="tracker-chart-legend"><button type="button" className={`tracker-chart-toggle${showCombinedChart ? " on" : ""}`} aria-pressed={showCombinedChart} onClick={() => setShowCombinedChart((visible) => !visible)}><i />COMBINED {showCombinedChart ? "ON" : "OFF"}</button><span className="baseline">BASELINE</span><span className="actual">ACTUAL</span><button type="button" className={`tracker-chart-toggle capital${showCapitalIn ? " on" : ""}`} aria-pressed={showCapitalIn} onClick={() => setShowCapitalIn((visible) => !visible)}><i />CAPITAL IN</button><span>INDIVIDUALS {visiblePositions.length}</span><button type="button" className="tracker-chart-expand" aria-label={expanded ? "Close enlarged chart" : "Enlarge chart"} onClick={onToggleExpanded}>{expanded ? "CLOSE DETAIL" : "ENLARGE"}</button></div></div></div>
    <div className="tracker-chart">{currentPrice <= 0 || positions.length === 0 ? <div className="tracker-chart-empty">{positions.length === 0 ? "Add a position to begin tracking." : `Enter the current ${assetSymbol} price to build the chart.`}</div> : <ResponsiveContainer><ComposedChart data={curve} margin={{ top: 22, right: 28, bottom: 18, left: 24 }}>
      <CartesianGrid stroke="#312f2c" strokeOpacity={.62} vertical />
      <XAxis dataKey="move" type="number" domain={[chartRange.minMove, chartRange.maxMove]} ticks={axisTicks} tickFormatter={(value) => `${value > 0 ? "+" : ""}${value}%`} stroke="#4f4a45" tick={{ fill: "#aaa097", fontSize: 13 }} label={{ value: `${assetSymbol} move from current price`, position: "insideBottom", offset: -10, fill: "#9e958c", fontSize: 13 }} />
      <YAxis tickFormatter={(value) => `$${Math.round(value / 1000)}k`} stroke="#4f4a45" tick={{ fill: "#aaa097", fontSize: 13 }} width={70} />
      <Tooltip content={<TrackerTooltip positions={positions} wealthView={wealthView} />} />
      {detailGuides.map((move) => <ReferenceLine key={move} x={move} stroke="#a79b8d" strokeOpacity={.24} strokeWidth={1} strokeDasharray="3 5" />)}
      {chartRange.minMove <= 0 && chartRange.maxMove >= 0 && <ReferenceLine x={0} stroke="#8c7c70" strokeWidth={1.2} label={{ value: "CURRENT", fill: "#c3b1a1", fontSize: 11 }} />}
      {showCapitalIn && freshExternalCapital > 0 && <ReferenceLine y={freshExternalCapital} stroke="#b7aa9d" strokeWidth={1.25} strokeDasharray="6 5" label={{ value: "CAPITAL IN", position: "insideTopRight", fill: "#a99b8e", fontSize: 11 }} />}
      {showCombinedChart && <Line className="tracker-line-baseline" dataKey="combinedBaseline" name="Combined Baseline" stroke="#e18a4a" strokeWidth={2} dot={false} isAnimationActive={false} />}
      {showCombinedChart && <Line className="tracker-line-actual" dataKey="combinedActual" name="Combined Actual" stroke="#69a67a" strokeWidth={2} dot={false} isAnimationActive={false} />}
      {visiblePositions.map((position) => <Line key={position.id} dataKey={(row: TrackerCurvePoint) => row.positions[position.id]?.actualWealth} name={position.id} stroke={position.side === "long" ? "#75a883" : "#c47169"} strokeWidth={visiblePositions.length === 1 ? 1.6 : 1.1} strokeOpacity={visiblePositions.length === 1 ? .9 : .55} dot={false} isAnimationActive={false} />)}
    </ComposedChart></ResponsiveContainer>}</div>
  </section>;
});

export function PositionTrackerOverlay({ state, onChange, onClose }: PositionTrackerOverlayProps) {
  const [positionSource, setPositionSource] = useState<"manual" | "address">("manual");
  const [addressDraft, setAddressDraft] = useState("");
  const [addressNotice, setAddressNotice] = useState(false);
  const [assetDraft, setAssetDraft] = useState<TrackerAsset>(state.selectedAsset);
  const [side, setSide] = useState<TrackerSide>("long");
  const [product, setProduct] = useState<TrackerProduct>("2x");
  const [amountDraft, setAmountDraft] = useState("");
  const [amountUnit, setAmountUnit] = useState<"asset" | "usd">("asset");
  const [entryPriceDraft, setEntryPriceDraft] = useState("");
  const [cashbackRouting, setCashbackRouting] = useState<"native" | "cash" | "spot">("native");
  const [useCashback, setUseCashback] = useState(false);
  const [cashbackSourceDrafts, setCashbackSourceDrafts] = useState<CashbackSourceDraft[]>([]);
  const [entryDateTime, setEntryDateTime] = useState(nowLocalDateTime);
  const [addError, setAddError] = useState<string | null>(null);
  const [fundingNotice, setFundingNotice] = useState<string | null>(null);
  const [actualDraft, setActualDraft] = useState("");
  const [withdrawalDraft, setWithdrawalDraft] = useState("");
  const [managementError, setManagementError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editSide, setEditSide] = useState<TrackerSide>("long");
  const [editProduct, setEditProduct] = useState<TrackerProduct>("2x");
  const [editRouting, setEditRouting] = useState<"native" | "cash" | "spot">("native");
  const [editAmountDraft, setEditAmountDraft] = useState("");
  const [editEntryPriceDraft, setEditEntryPriceDraft] = useState("");
  const [editDateTime, setEditDateTime] = useState("");
  const [expandedPositionId, setExpandedPositionId] = useState<string | null>(null);
  const [showCombinedChart, setShowCombinedChart] = useState(true);
  const [showCapitalIn, setShowCapitalIn] = useState(true);
  const [chartExpanded, setChartExpanded] = useState(false);
  const [chartRange, setChartRange] = useState<TrackerChartRange>(DEFAULT_TRACKER_CHART_RANGE);
  const [pendingDeletion, setPendingDeletion] = useState<PendingDeletion | null>(null);

  const openExpandedChart = useCallback(() => {
    setChartRange(DETAIL_TRACKER_CHART_RANGE);
    setChartExpanded(true);
  }, []);
  const closeExpandedChart = useCallback(() => {
    setChartExpanded(false);
    setChartRange(DEFAULT_TRACKER_CHART_RANGE);
  }, []);

  const positions = useMemo(() => state.positions.filter((position) => position.assetSymbol === state.selectedAsset), [state.positions, state.selectedAsset]);
  const expanded = positions.find((position) => position.id === expandedPositionId) ?? null;
  const currentPrice = state.currentPrices[state.selectedAsset] ?? 0;
  const [currentPriceDraft, setCurrentPriceDraft] = useState(() => currentPrice > 0 ? String(currentPrice) : "");
  const cashbackSources = useMemo(() => state.cashbackTranches.flatMap((tranche) => {
    const sourcePosition = state.positions.find((position) => position.id === tranche.sourcePositionId);
    return sourcePosition ? [{ tranche, sourcePosition }] : [];
  }), [state.cashbackTranches, state.positions]);
  const selectedCashbackValue = useMemo(() => cashbackSourceDrafts.reduce((sum, draft) => {
    const source = cashbackSources.find(({ tranche }) => tranche.sourcePositionId === draft.sourcePositionId);
    if (!source || source.tranche.remainingNativeAmount <= 0) return sum;
    if (source.tranche.denomination === "usd") return sum + source.tranche.remainingNativeAmount;
    const price = Number(draft.spotPriceDraft);
    return price > 0 ? sum + source.tranche.remainingNativeAmount * price : sum;
  }, 0), [cashbackSourceDrafts, cashbackSources]);
  const summary = useMemo(() => trackerAssetSummary(state.positions, state.selectedAsset, currentPrice, state.cashbackTranches), [state.positions, state.selectedAsset, currentPrice, state.cashbackTranches]);
  const allAssets = useMemo(() => trackerAllAssetsSummary(state), [state]);
  const wealthDelta = summary.actualTotalWealth - summary.baselineTotalWealth;
  const wealthDeltaPercent = summary.baselineTotalWealth > 0 ? wealthDelta / summary.baselineTotalWealth : null;
  const totalReturn = summary.actualTotalWealth - summary.freshExternalCapital;
  const totalReturnPercent = summary.freshExternalCapital > 0 ? totalReturn / summary.freshExternalCapital : null;
  const spotReturnPercent = summary.longEntryValue > 0 ? (summary.longCurrentSpotValue - summary.longEntryValue) / summary.longEntryValue : null;
  const versusSpotPercent = totalReturnPercent !== null && spotReturnPercent !== null ? totalReturnPercent - spotReturnPercent : null;

  useEffect(() => {
    setCurrentPriceDraft(currentPrice > 0 ? String(currentPrice) : "");
  }, [state.selectedAsset, currentPrice]);

  useEffect(() => {
    if (!pendingDeletion) return;
    const closeConfirmation = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPendingDeletion(null);
    };
    window.addEventListener("keydown", closeConfirmation);
    return () => window.removeEventListener("keydown", closeConfirmation);
  }, [pendingDeletion]);

  useEffect(() => {
    if (!chartExpanded) return;
    const closeExpandedChartOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeExpandedChart();
    };
    window.addEventListener("keydown", closeExpandedChartOnEscape);
    return () => window.removeEventListener("keydown", closeExpandedChartOnEscape);
  }, [chartExpanded, closeExpandedChart]);

  useEffect(() => {
    setActualDraft(expanded?.actualCurrentValue == null ? "" : String(expanded.actualCurrentValue));
    setWithdrawalDraft("");
    setManagementError(null);
    setEditMode(false);
    if (expanded) {
      setEditSide(expanded.side);
      setEditProduct(expanded.product);
      setEditRouting(expanded.cashbackRouting);
      setEditAmountDraft(String(expanded.originalInputAmount));
      setEditEntryPriceDraft(String(expanded.entryAssetPrice));
      setEditDateTime(expanded.entryDateTime);
    }
  }, [expanded?.id, expanded?.actualCurrentValue]);

  const updatePosition = (id: string, updater: (position: TrackedPosition) => TrackedPosition) =>
    onChange({ ...state, positions: state.positions.map((position) => position.id === id ? updater(position) : position) });

  const selectAsset = (asset: TrackerAsset) => {
    onChange({ ...state, selectedAsset: asset, selectedPositionId: null });
    setAssetDraft(asset);
    setExpandedPositionId(null);
  };

  const updateChartRange = (boundary: keyof TrackerChartRange, rawValue: string) => {
    if (!rawValue.trim()) return;
    const requested = Number(rawValue);
    if (!Number.isFinite(requested)) return;
    const value = Math.round(requested * 10) / 10;
    setChartRange((current) => boundary === "minMove"
      ? { minMove: Math.max(-99.9, Math.min(value, current.maxMove - .1)), maxMove: current.maxMove }
      : { minMove: current.minMove, maxMove: Math.min(500, Math.max(value, current.minMove + .1)) });
  };

  const selectProduct = (value: string) => {
    const [nextSide, nextProduct] = value.split(":") as [TrackerSide, TrackerProduct];
    if ((nextSide !== "long" && nextSide !== "short") || !TRACKER_PRODUCTS.includes(nextProduct)) return;
    setSide(nextSide);
    setProduct(nextProduct);
  };
  const selectEditProduct = (value: string) => {
    const [nextSide, nextProduct] = value.split(":") as [TrackerSide, TrackerProduct];
    if ((nextSide !== "long" && nextSide !== "short") || !TRACKER_PRODUCTS.includes(nextProduct)) return;
    setEditSide(nextSide);
    setEditProduct(nextProduct);
  };

  const updateEntryDate = (date: string) => setEntryDateTime(`${date}T${entryDateTime.slice(11, 16) || "00:00"}`);
  const updateEntryTime = (time: string) => setEntryDateTime(`${entryDateTime.slice(0, 10) || nowLocalDateTime().slice(0, 10)}T${time}`);
  const toggleCashbackSource = (sourcePositionId: string) => {
    setCashbackSourceDrafts((current) => current.some((draft) => draft.sourcePositionId === sourcePositionId)
      ? current.filter((draft) => draft.sourcePositionId !== sourcePositionId)
      : [...current, { sourcePositionId, spotPriceDraft: "" }]);
  };
  const updateCashbackSourcePrice = (sourcePositionId: string, value: string) => {
    setCashbackSourceDrafts((current) => current.map((draft) => draft.sourcePositionId === sourcePositionId
      ? { ...draft, spotPriceDraft: value }
      : draft));
  };
  const commitCurrentPrice = () => {
    const price = Number(currentPriceDraft);
    const prices = { ...state.currentPrices };
    if (price > 0) prices[state.selectedAsset] = price;
    else delete prices[state.selectedAsset];
    onChange({ ...state, currentPrices: prices });
  };
  const setWealthView = useCallback((view: TrackerWealthView) => {
    onChange({ ...state, wealthView: view });
  }, [onChange, state]);

  const addPosition = () => {
    const entryPrice = Number(entryPriceDraft);
    const inputAmount = Number(amountDraft);
    const amount = side === "long" && amountUnit === "usd" && entryPrice > 0
      ? inputAmount / entryPrice
      : inputAmount;
    if (!(amount > 0) || !(entryPrice > 0) || !entryDateTime) {
      setAddError("Enter a valid amount, entry price, and date/time.");
      return;
    }
    if (useCashback && cashbackSourceDrafts.length === 0) {
      setAddError("Select at least one Cashback source in the order it should be used.");
      return;
    }
    const cashbackSelections: TrackerCashbackFundingSelection[] = cashbackSourceDrafts.map((draft) => ({
      sourcePositionId: draft.sourcePositionId,
      spotAssetPrice: draft.spotPriceDraft === "" ? undefined : Number(draft.spotPriceDraft),
    }));
    const timestamp = new Date().toISOString();
    let result;
    try {
      result = addTrackedPosition(state, { id: crypto.randomUUID(), assetSymbol: assetDraft, side, product, entryDateTime, entryAssetPrice: entryPrice, amount, cashbackRouting, timestamp }, useCashback ? cashbackSelections : []);
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "Unable to apply the selected Cashback sources.");
      return;
    }
    onChange({
      ...result.state,
      currentPrices: { ...state.currentPrices, [assetDraft]: state.currentPrices[assetDraft] ?? entryPrice },
      selectedAsset: assetDraft,
      selectedPositionId: null,
    });
    setAmountDraft("");
    setAmountUnit("asset");
    setEntryPriceDraft("");
    setUseCashback(false);
    setCashbackSourceDrafts([]);
    setAddError(null);
    setFundingNotice(useCashback
      ? `${money(result.cashbackConsumed)} Cashback used · ${money(result.freshExternalCapital)} fresh capital`
      : `${money(result.freshExternalCapital)} fresh capital`);
    setExpandedPositionId(null);
  };

  const commitActualValue = () => {
    if (!expanded) return;
    const actual = actualDraft.trim() === "" ? null : Number(actualDraft);
    if (actual !== null && (!Number.isFinite(actual) || actual < 0)) {
      setManagementError("Actual V4 value must be blank or zero and above.");
      return;
    }
    try {
      updatePosition(expanded.id, (position) => setTrackerActualObservation(position, actual, currentPrice, new Date().toISOString()));
      setManagementError(null);
    } catch (error) {
      setManagementError(error instanceof Error ? error.message : "Unable to record Actual V4.");
    }
  };

  const returnActualToBase = () => {
    if (!expanded) return;
    updatePosition(expanded.id, (position) => setTrackerActualObservation(position, null, currentPrice, new Date().toISOString()));
    setActualDraft("");
    setManagementError(null);
  };

  const recordWithdrawal = () => {
    if (!expanded || currentPrice <= 0) return;
    try {
      updatePosition(expanded.id, (position) => reduceTrackedPosition(position, Number(withdrawalDraft), currentPrice, crypto.randomUUID(), new Date().toISOString()));
      setWithdrawalDraft("");
      setManagementError(null);
    } catch (error) {
      setManagementError(error instanceof Error ? error.message : "Unable to record withdrawal.");
    }
  };

  const savePositionEdit = () => {
    if (!expanded) return;
    const amount = Number(editAmountDraft);
    const entryPrice = Number(editEntryPriceDraft);
    if (!(amount > 0) || !(entryPrice > 0) || !editDateTime) {
      setManagementError("Enter a valid original amount, entry price, and date/time.");
      return;
    }
    try {
      onChange(correctTrackedPosition(state, expanded.id, { side: editSide, product: editProduct, cashbackRouting: editRouting, entryDateTime: editDateTime, entryAssetPrice: entryPrice, amount }, new Date().toISOString()));
      setEditMode(false);
      setManagementError(null);
    } catch (error) {
      setManagementError(error instanceof Error ? error.message : "Unable to correct position.");
    }
  };

  const deleteExpanded = () => {
    if (!expanded) return;
    setPendingDeletion({
      kind: "position",
      positionId: expanded.id,
      description: `${trackerProductLabel(expanded.side, expanded.product)} entered ${new Date(expanded.entryDateTime).toLocaleDateString()}`,
    });
  };

  const confirmDeletion = () => {
    if (!pendingDeletion) return;
    if (pendingDeletion.kind === "position") {
      try {
        const nextState = deleteTrackedPosition(state, pendingDeletion.positionId);
        setExpandedPositionId(null);
        setEditMode(false);
        setActualDraft("");
        setWithdrawalDraft("");
        setManagementError(null);
        onChange(nextState);
      } catch (error) {
        setManagementError(error instanceof Error ? error.message : "Unable to delete position.");
      }
    } else {
      onChange(createEmptyTrackerState(state.selectedAsset));
      setExpandedPositionId(null);
      setActualDraft("");
      setWithdrawalDraft("");
      setManagementError(null);
      setFundingNotice(null);
      setAddError(null);
    }
    setPendingDeletion(null);
  };

  const deleteAllPositions = () => {
    if (state.positions.length > 0) setPendingDeletion({ kind: "all" });
  };

  const productOptions = (optionSide: TrackerSide) => TRACKER_PRODUCTS.map((value) => <option className={optionSide} key={`${optionSide}:${value}`} value={`${optionSide}:${value}`}>{trackerProductShortLabel(value)}</option>);

  return createPortal(<div className="tracker-backdrop">
    <section className="tracker-workspace" aria-label="V4 Position Tracker">
      <header className="tracker-head">
        <div><small>V4 STRUCTURAL ACCOUNTING</small><h2>POSITION TRACKER</h2></div>
        <div className="tracker-asset-context"><span>DISPLAYED ASSET</span><select value={state.selectedAsset} onChange={(event) => selectAsset(event.target.value as TrackerAsset)}>{TRACKER_ASSETS.map((asset) => <option key={asset}>{asset}</option>)}</select></div>
        <button type="button" className="tracker-close" onClick={onClose}>BACK TO CALCULATOR <span>×</span></button>
      </header>

      <aside className="tracker-rail">
        <section className="tracker-add-position">
          <div className="tracker-section-title tracker-add-heading"><b>ADD POSITION</b><div className="tracker-source-toggle" aria-label="Position source">
            <button type="button" className={positionSource === "manual" ? "on" : ""} onClick={() => { setPositionSource("manual"); setAddressNotice(false); }}>MANUAL</button>
            <button type="button" className={positionSource === "address" ? "on" : ""} onClick={() => setPositionSource("address")}>ADDRESS</button>
          </div></div>
          {positionSource === "manual" ? <div className="tracker-compact-form tracker-entry-grid">
            <div className="tracker-entry-row tracker-entry-primary-row">
              <label className="tracker-entry-asset"><span>ASSET</span><select value={assetDraft} onChange={(event) => setAssetDraft(event.target.value as TrackerAsset)}>{TRACKER_ASSETS.map((asset) => <option key={asset}>{asset}</option>)}</select></label>
              <div className={`tracker-product-choice ${side}`}><span>PRODUCT</span><select aria-label="PRODUCT" className={side} value={`${side}:${product}`} onChange={(event) => selectProduct(event.target.value)}><optgroup className="long" label="LONG">{productOptions("long")}</optgroup><optgroup className="short" label="SHORT">{productOptions("short")}</optgroup></select></div>
              <label className="tracker-amount"><span>AMOUNT{side === "long" && amountUnit === "usd" && Number(amountDraft) > 0 && Number(entryPriceDraft) > 0 ? ` (${compactNumber(Number(amountDraft) / Number(entryPriceDraft))} ${assetDraft})` : ""}</span><div><input inputMode="decimal" value={amountDraft} onChange={(event) => setAmountDraft(event.target.value)} placeholder={side === "long" && amountUnit === "asset" ? "5" : "10000"} />{side === "long" ? <span className="tracker-amount-unit" aria-label="Amount unit"><button type="button" className={amountUnit === "asset" ? "on" : ""} aria-pressed={amountUnit === "asset"} onClick={() => setAmountUnit("asset")}>{assetDraft}</button><button type="button" className={amountUnit === "usd" ? "on" : ""} aria-pressed={amountUnit === "usd"} onClick={() => setAmountUnit("usd")}>USD</button></span> : <em>USD</em>}</div></label>
            </div>
            <div className="tracker-entry-row tracker-entry-details-row">
              <label className="tracker-entry-date"><span>DATE</span><input type="date" value={entryDateTime.slice(0, 10)} onChange={(event) => updateEntryDate(event.target.value)} /></label>
              <label className="tracker-entry-time"><span>TIME</span><input type="time" value={entryDateTime.slice(11, 16)} onChange={(event) => updateEntryTime(event.target.value)} /></label>
              <label className="tracker-entry-price"><span>ENTRY PRICE</span><div className="tracker-money-input"><em>$</em><input inputMode="decimal" value={entryPriceDraft} onChange={(event) => setEntryPriceDraft(event.target.value)} placeholder="2000" /></div></label>
            </div>
            <div className="tracker-entry-row tracker-entry-actions-row">
              <fieldset className={`tracker-routing tracker-entry-routing${isCashbackProduct(product) ? "" : " disabled"}`} disabled={!isCashbackProduct(product)}><legend>ROUTING</legend>{(["native", "cash", "spot"] as const).map((value) => <button type="button" key={value} className={cashbackRouting === value ? "on" : ""} onClick={() => setCashbackRouting(value)}>{value.toUpperCase()}</button>)}</fieldset>
              <label className={`tracker-use-cashback${cashbackSources.some(({ tranche }) => tranche.remainingNativeAmount > 0) ? " available" : ""}`}><span className="tracker-use-cashback-box"><input type="checkbox" checked={useCashback} disabled={!cashbackSources.some(({ tranche }) => tranche.remainingNativeAmount > 0)} onChange={(event) => { setUseCashback(event.target.checked); if (!event.target.checked) setCashbackSourceDrafts([]); }} /><span>USE CASHBACK</span></span>{cashbackSources.length > 0 && <small>{useCashback ? `${cashbackSourceDrafts.length} SELECTED · ${money(selectedCashbackValue)}` : `${cashbackSources.filter(({ tranche }) => tranche.remainingNativeAmount > 0).length} SOURCES`}</small>}</label>
              <button type="button" className="tracker-add-action" onClick={addPosition}>ADD</button>
            </div>
            {useCashback && <div className="tracker-cashback-sources">
              <div className="tracker-cashback-sources-head"><b>SELECT SOURCES IN USE ORDER</b><span>Click to assign 1, 2, 3…</span></div>
              <div className="tracker-cashback-source-list">{cashbackSources.map(({ tranche, sourcePosition }) => {
                const selectedIndex = cashbackSourceDrafts.findIndex((draft) => draft.sourcePositionId === sourcePosition.id);
                const selectedDraft = selectedIndex >= 0 ? cashbackSourceDrafts[selectedIndex] : null;
                const available = tranche.remainingNativeAmount > 1e-12;
                return <div key={sourcePosition.id} className={`tracker-cashback-source${selectedDraft ? " selected" : ""}${available ? "" : " unavailable"}`}>
                  <button type="button" disabled={!available} aria-pressed={selectedIndex >= 0} onClick={() => toggleCashbackSource(sourcePosition.id)}>
                    <i>{selectedIndex >= 0 ? selectedIndex + 1 : ""}</i>
                    <span><b>{sourcePosition.assetSymbol} · {trackerProductLabel(sourcePosition.side, sourcePosition.product)}</b><small>{compactDateTime(sourcePosition.entryDateTime)}</small></span>
                    <strong>{tranche.denomination === "usd" ? money(tranche.remainingNativeAmount) : `${compactNumber(tranche.remainingNativeAmount)} ${tranche.assetSymbol}`}<small>{tranche.routing.toUpperCase()}</small></strong>
                  </button>
                  {selectedDraft && tranche.denomination === "asset" && <label><span>{tranche.assetSymbol} SALE PRICE</span><div className="tracker-money-input"><em>$</em><input inputMode="decimal" value={selectedDraft.spotPriceDraft} onChange={(event) => updateCashbackSourcePrice(sourcePosition.id, event.target.value)} placeholder="Required" /></div></label>}
                </div>;
              })}</div>
            </div>}
          </div> : <div className="tracker-address-form"><label><span>ADDRESS</span><input value={addressDraft} onChange={(event) => { setAddressDraft(event.target.value); setAddressNotice(false); }} placeholder="0x…" /></label><button type="button" onClick={() => setAddressNotice(true)}>IMPORT</button>{addressNotice && <p>Address import is reserved for the live-data phase. Imported positions will use this same ledger.</p>}</div>}
          {addError && <p className="tracker-error">{addError}</p>}
          {fundingNotice && !addError && <p className="tracker-funding-notice">{fundingNotice}</p>}
        </section>

        <section className="tracker-current-price"><label><span>{state.selectedAsset} CURRENT PRICE</span><div className="tracker-money-input"><em>$</em><input inputMode="decimal" value={currentPriceDraft} placeholder="Required" onChange={(event) => setCurrentPriceDraft(event.target.value)} onBlur={commitCurrentPrice} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /></div></label></section>

        <section className="tracker-position-list">
          <div className="tracker-section-title"><div className="tracker-section-heading"><b>POSITIONS</b><span>{positions.length}</span></div><button type="button" className="tracker-delete-all" onClick={deleteAllPositions} disabled={state.positions.length === 0}>DELETE ALL</button></div>
          <div className="tracker-position-scroll">
            <button type="button" className={`tracker-combined-row${showCombinedChart ? " on" : ""}`} aria-pressed={showCombinedChart} onClick={() => setShowCombinedChart((visible) => !visible)}><b>COMBINED</b><span>{showCombinedChart ? "ON" : "OFF"}</span></button>
            {positions.length === 0 && <div className="tracker-empty-list">No {state.selectedAsset} positions tracked yet.</div>}
            {positions.map((position) => {
              const isExpanded = position.id === expanded?.id;
              const baselineV4Now = currentPrice > 0 ? trackerBaselineV4AtPrice(position, currentPrice) : null;
              const effectiveV4Now = position.actualCurrentValue !== null ? position.actualCurrentValue : currentPrice > 0 ? trackerEffectiveCurrentValue(position, currentPrice) : null;
              const positionCashbackTranches = state.cashbackTranches.filter((tranche) => tranche.sourcePositionId === position.id);
              const cashbackGenerated = positionCashbackTranches.reduce((sum, tranche) => sum + tranche.originalUsdAmount, 0);
              const cashbackUsed = positionCashbackTranches.reduce((sum, tranche) => sum + tranche.deployedUsdAmount, 0);
              const cashbackAvailable = currentPrice > 0 ? trackerCashbackAtPrice(position, currentPrice, state.cashbackTranches) : Math.max(0, cashbackGenerated - cashbackUsed);
              const hasMixedFunding = position.funding.recycledCashbackCapital > 0;
              return <article key={position.id} className={`${position.chartVisible ? "chart-on" : ""}${isExpanded ? " expanded" : ""}`}>
                <div className="tracker-position-line">
                  <button type="button" className="tracker-position-toggle" aria-pressed={position.chartVisible} onClick={() => updatePosition(position.id, (current) => ({ ...current, chartVisible: !current.chartVisible, updatedAt: new Date().toISOString() }))}>
                    <span className={`tracker-position-badge ${position.side}`}>{positionDisplayLabel(position.side, position.product)}</span>
                    <b className="tracker-position-asset">{position.assetSymbol}</b>
                    <strong className="tracker-position-amount">{position.side === "long" ? `${compactNumber(position.originalInputAmount)} ${position.assetSymbol}` : money(position.originalInputAmount)}</strong>
                    <span className="tracker-position-current"><small>CURRENT V4</small><b>{effectiveV4Now === null ? "—" : money(effectiveV4Now)}</b></span>
                  </button>
                  <button type="button" className="tracker-disclosure" aria-label={`${isExpanded ? "Collapse" : "Expand"} ${trackerProductLabel(position.side, position.product)}`} aria-expanded={isExpanded} onClick={() => setExpandedPositionId(isExpanded ? null : position.id)}>{isExpanded ? "⌄" : "›"}</button>
                </div>
                {isExpanded && <div className="tracker-position-management">
                  {editMode ? <div className="tracker-edit-form">
                    <label><span>PRODUCT</span><select className={editSide} value={`${editSide}:${editProduct}`} onChange={(event) => selectEditProduct(event.target.value)}><optgroup label="LONG">{productOptions("long")}</optgroup><optgroup label="SHORT">{productOptions("short")}</optgroup></select></label>
                    <label><span>{editSide === "long" ? "ORIGINAL AMOUNT" : "ORIGINAL CAPITAL"}</span><input inputMode="decimal" value={editAmountDraft} onChange={(event) => setEditAmountDraft(event.target.value)} /></label>
                    <label><span>ENTRY PRICE</span><div className="tracker-money-input"><em>$</em><input inputMode="decimal" value={editEntryPriceDraft} onChange={(event) => setEditEntryPriceDraft(event.target.value)} /></div></label>
                    {isCashbackProduct(editProduct) && <fieldset className="tracker-routing"><legend>CASHBACK ROUTING</legend>{(["native", "cash", "spot"] as const).map((value) => <button type="button" key={value} className={editRouting === value ? "on" : ""} onClick={() => setEditRouting(value)}>{value.toUpperCase()}</button>)}</fieldset>}
                    <label className="tracker-edit-date"><span>ENTRY DATE / TIME</span><input type="datetime-local" value={editDateTime} onChange={(event) => setEditDateTime(event.target.value)} /></label>
                    <div className="tracker-card-actions"><button type="button" onClick={savePositionEdit}>SAVE CHANGES</button><button type="button" className="secondary" onClick={() => setEditMode(false)}>CANCEL</button></div>
                  </div> : <>
                    <div className="tracker-initial-entry">
                      <span>INITIAL ENTRY</span>
                      <div><b>{money(position.originalEntryCapital)}</b><strong>{position.side === "long" ? `${compactNumber(position.originalInputAmount)} ${position.assetSymbol} @ ${preciseMoney(position.entryAssetPrice)}` : `${money(position.originalInputAmount)} CASH · ASSET ENTRY ${preciseMoney(position.entryAssetPrice)}`}</strong><small>{compactDateTime(position.entryDateTime).replace(",", " ·")}</small></div>
                    </div>
                    <div className="tracker-position-values">
                      <div><span>BASE V4 NOW</span><b>{baselineV4Now === null ? "—" : money(baselineV4Now)}</b></div>
                      <label title="Observed active V4 value only"><span>ACTUAL V4 {position.actualCurrentValue === null && <small>BASE FOLLOWING</small>}</span><div className="tracker-actual-input"><div className="tracker-money-input"><em>$</em><input inputMode="decimal" value={actualDraft} onChange={(event) => setActualDraft(event.target.value)} placeholder={position.actualCurrentValue === null ? "Base following" : "Actual value"} /></div></div><div className="tracker-actual-actions"><button type="button" onClick={commitActualValue}>SAVE</button><button type="button" className="secondary" onClick={returnActualToBase} disabled={position.actualCurrentValue === null}>RETURN TO BASE</button><button type="button" className="secondary" disabled>LINK</button></div></label>
                    </div>
                    {hasMixedFunding && <div className="tracker-position-funding">FUNDING · Fresh {money(position.funding.freshExternalCapital)} · Cashback {money(position.funding.recycledCashbackCapital)}</div>}
                    {cashbackGenerated > 0 && <div className="tracker-position-funding">CB GENERATED {money(cashbackGenerated)} · AVAILABLE {money(cashbackAvailable)} · USED {money(cashbackUsed)}</div>}
                    {position.reductions.length > 0 && <div className="tracker-position-funding">REMAINING CAPITAL BASIS {money(position.originalEntryCapital * position.remainingFraction)}</div>}
                    <div className="tracker-withdraw-operation"><span>WITHDRAW CASH</span><div><div className="tracker-money-input"><em>$</em><input inputMode="decimal" value={withdrawalDraft} onChange={(event) => setWithdrawalDraft(event.target.value)} placeholder="Amount" /></div><button type="button" onClick={recordWithdrawal} disabled={!withdrawalDraft || currentPrice <= 0}>WITHDRAW</button></div></div>
                    <div className="tracker-card-actions"><button type="button" className="secondary" onClick={() => setEditMode(true)}>EDIT / CORRECT</button><button type="button" className="danger" onClick={(event) => { event.stopPropagation(); deleteExpanded(); }}>DELETE POSITION</button></div>
                  </>}
                  {managementError && <p className="tracker-error management">{managementError}</p>}
                </div>}
              </article>;
            })}
          </div>
        </section>
      </aside>

      <div className="tracker-main">
        <TrackerChartPanel
          assetSymbol={state.selectedAsset}
          currentPrice={currentPrice}
          positions={positions}
          wealthView={state.wealthView}
          cashbackTranches={state.cashbackTranches}
          freshExternalCapital={summary.freshExternalCapital}
          setWealthView={setWealthView}
          showCombinedChart={showCombinedChart}
          setShowCombinedChart={setShowCombinedChart}
          showCapitalIn={showCapitalIn}
          setShowCapitalIn={setShowCapitalIn}
          expanded={false}
          onToggleExpanded={openExpandedChart}
          chartRange={chartRange}
          onChartRangeChange={updateChartRange}
        />

        <section className="tracker-portfolio-summary">
          <div className="tracker-summary-column tracker-wealth-column">
            <h3>{state.selectedAsset} WEALTH</h3>
            <div className="tracker-summary-hero">
              <span>ACTUAL WEALTH</span>
              <strong>{currentPrice > 0 ? money(summary.actualTotalWealth) : "—"}</strong>
              <small>Baseline {currentPrice > 0 ? money(summary.baselineTotalWealth) : "—"}<b className={wealthDelta >= 0 ? "positive" : "negative"}>{currentPrice > 0 && wealthDeltaPercent !== null ? `${signedMoney(wealthDelta)} · ${signedPercent(wealthDeltaPercent)}` : ""}</b></small>
            </div>
            <div className="tracker-summary-list tracker-composition-list">
              <div><span>ACTIVE V4</span><b>{money(summary.actualV4)}</b>{Math.abs(summary.actualV4 - summary.baselineV4) >= .5 && <small>Baseline {money(summary.baselineV4)}</small>}</div>
              <div><span>CASHBACK</span><b>{money(summary.cashback)}</b></div>
              <div><span>WITHDRAWN</span><b>{money(summary.withdrawnCash)}</b></div>
            </div>
          </div>

          <div className="tracker-summary-column tracker-performance-column">
            <h3>PERFORMANCE</h3>
            <div className="tracker-performance-block primary">
              <span>TOTAL RETURN</span>
              <strong className={totalReturn >= 0 ? "positive" : "negative"}>{currentPrice > 0 && totalReturnPercent !== null ? signedPercent(totalReturnPercent) : "—"}</strong>
              <b>{currentPrice > 0 && totalReturnPercent !== null ? signedMoney(totalReturn) : "No cash-in basis"}</b>
              <small>Actual wealth vs Cash In</small>
            </div>
            <div className="tracker-performance-block">
              <span>V4 YIELD</span>
              {summary.observedPositionCount > 0 ? <><strong className={summary.observedReturn >= 0 ? "positive" : "negative"}>{summary.observedReturnPercent === null ? "—" : signedPercent(summary.observedReturnPercent)}</strong><b>{signedMoney(summary.observedReturn)}</b><small>APY {summary.impliedApy === null ? "—" : `${(summary.impliedApy * 100).toFixed(1)}%`} · Coverage {summary.observedPositionCount}/{summary.positionCount} ({(summary.actualCoveragePercent * 100).toFixed(0)}%)</small></> : <><strong>—</strong><b>No actual observations</b><small>Coverage 0/{summary.positionCount}</small></>}
            </div>
            <div className="tracker-performance-block tertiary">
              <span>VS SPOT</span>
              <strong className={versusSpotPercent !== null && versusSpotPercent >= 0 ? "positive" : "negative"}>{currentPrice > 0 && versusSpotPercent !== null ? signedPercent(versusSpotPercent) : "—"}</strong>
              <small>{currentPrice > 0 && spotReturnPercent !== null ? `Spot return ${signedPercent(spotReturnPercent)}` : "Requires supplied asset value"}</small>
            </div>
          </div>

          <div className="tracker-summary-column tracker-capital-column">
            <h3>CAPITAL</h3>
            <div className="tracker-capital-primary"><span>CASH IN</span><strong>{money(summary.freshExternalCapital)}</strong></div>
            <div className="tracker-capital-asset">
              <div><span>ASSET SUPPLIED</span><b>{summary.longAssetSupplied > 0 ? `${compactNumber(summary.longAssetSupplied)} ${state.selectedAsset}` : "—"}</b></div>
              <small><span>ENTRY</span><b>{summary.longAssetSupplied > 0 ? money(summary.longEntryValue) : "—"}</b></small>
              <small><span>SPOT NOW</span><b>{summary.longAssetSupplied > 0 && currentPrice > 0 ? money(summary.longCurrentSpotValue) : "—"}</b></small>
            </div>
            <div className="tracker-summary-list">
              <div><span>CASHBACK REUSED</span><b>{money(summary.recycledCashbackCapital)}</b></div>
              <div><span>CUMULATIVE DEPLOYED</span><b>{money(summary.entryCapital)}</b></div>
            </div>
          </div>

          <div className="tracker-summary-column tracker-portfolio-column">
            <h3>PORTFOLIO</h3>
            <div className="tracker-summary-hero compact"><span>TOTAL TRACKED WEALTH</span><strong>{money(allAssets.totalTrackedWealth)}</strong><small>Cash In <b>{money(allAssets.totalInvested)}</b></small></div>
            <div className="tracker-allocation">
              <div className="tracker-allocation-bar">{allAssets.allocations.map((allocation) => <i key={allocation.assetSymbol} className={allocation.assetSymbol.toLowerCase()} style={{ width: `${allocation.percentage * 100}%` }} />)}</div>
              <div className="tracker-allocation-items">{allAssets.allocations.map((allocation) => <button key={allocation.assetSymbol} type="button" className={state.selectedAsset === allocation.assetSymbol ? "on" : ""} onClick={() => selectAsset(allocation.assetSymbol)}><b>{allocation.assetSymbol}</b><span>{(allocation.percentage * 100).toFixed(1)}%</span><strong>{money(allocation.wealth)}</strong></button>)}</div>
            </div>
          </div>
        </section>
      </div>
      {chartExpanded && <div className="tracker-chart-expanded-layer" role="dialog" aria-modal="true" aria-label="Expanded portfolio response chart">
        <TrackerChartPanel
          assetSymbol={state.selectedAsset}
          currentPrice={currentPrice}
          positions={positions}
          wealthView={state.wealthView}
          cashbackTranches={state.cashbackTranches}
          freshExternalCapital={summary.freshExternalCapital}
          setWealthView={setWealthView}
          showCombinedChart={showCombinedChart}
          setShowCombinedChart={setShowCombinedChart}
          showCapitalIn={showCapitalIn}
          setShowCapitalIn={setShowCapitalIn}
          expanded
          onToggleExpanded={closeExpandedChart}
          chartRange={chartRange}
          onChartRangeChange={updateChartRange}
        />
      </div>}
      {pendingDeletion && <div className="tracker-confirm-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) setPendingDeletion(null); }}>
        <section className="tracker-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="tracker-confirm-title" aria-describedby="tracker-confirm-description">
          <small>CONFIRM DELETION</small>
          <h3 id="tracker-confirm-title">{pendingDeletion.kind === "all" ? "Delete every tracked position?" : "Delete this tracked position?"}</h3>
          <p id="tracker-confirm-description">{pendingDeletion.kind === "all"
            ? `This removes all ${state.positions.length} positions and resets the tracker.`
            : pendingDeletion.description}</p>
          <div>
            <button type="button" className="secondary" autoFocus onClick={() => setPendingDeletion(null)}>CANCEL</button>
            <button type="button" className="danger" onClick={confirmDeletion}>{pendingDeletion.kind === "all" ? "DELETE ALL" : "DELETE POSITION"}</button>
          </div>
        </section>
      </div>}
    </section>
  </div>, document.body);
}
