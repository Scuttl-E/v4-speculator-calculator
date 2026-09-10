import { longPositionValue, productCashOutRate, resolveCashbackRouting, shortPositionValue } from "./v4Math";
import type { CashbackMode, LongV4Mode, ShortV4Mode } from "./types";

export const TRACKER_ASSETS = ["ETH", "BTC", "PEAS"] as const;
export type TrackerAsset = typeof TRACKER_ASSETS[number];
export type TrackerSide = "long" | "short";
export type TrackerProduct = "2x" | "2.5x-cashback" | "2.5x-looped";
export type TrackerWealthView = "total" | "v4-cb" | "v4-only";

export interface TrackerReduction {
  id: string;
  timestamp: string;
  assetPrice: number;
  effectivePreReductionValue: number;
  usdWithdrawal: number;
  reductionFraction: number;
  resultingRemainingFraction: number;
  resultingEffectiveValue: number;
}

export interface TrackerPositionFunding {
  entryCapital: number;
  freshExternalCapital: number;
  recycledCashbackCapital: number;
}

export interface TrackerCashbackTranche {
  id: string;
  sourcePositionId: string;
  createdAt: string;
  assetSymbol: TrackerAsset;
  routing: CashbackMode;
  denomination: "usd" | "asset";
  originalUsdAmount: number;
  originalNativeAmount: number;
  remainingNativeAmount: number;
  deployedNativeAmount: number;
  deployedUsdAmount: number;
}

export interface TrackerCashbackFundingTransaction {
  id: string;
  sourceTrancheId: string;
  sourcePositionId: string;
  targetPositionId: string;
  nativeAmountConsumed: number;
  usdValue: number;
  sourceAssetPrice: number | null;
}

export interface TrackedPosition {
  id: string;
  source: "manual" | "imported";
  assetSymbol: TrackerAsset;
  side: TrackerSide;
  product: TrackerProduct;
  entryDateTime: string;
  entryAssetPrice: number;
  originalInputAmount: number;
  originalInputUnit: "asset" | "usd";
  originalAssetQuantity: number | null;
  originalEntryCapital: number;
  cashbackRouting: CashbackMode;
  remainingFraction: number;
  chartVisible: boolean;
  actualCurrentValue: number | null;
  actualObservedAt: string | null;
  actualObservedAssetPrice: number | null;
  funding: TrackerPositionFunding;
  reductions: TrackerReduction[];
  createdAt: string;
  updatedAt: string;
}

export interface TrackerState {
  version: 1;
  positions: TrackedPosition[];
  currentPrices: Partial<Record<TrackerAsset, number>>;
  selectedAsset: TrackerAsset;
  selectedPositionId: string | null;
  wealthView: TrackerWealthView;
  cashbackTranches: TrackerCashbackTranche[];
  fundingTransactions: TrackerCashbackFundingTransaction[];
}

export interface CreateTrackedPositionInput {
  id: string;
  assetSymbol: TrackerAsset;
  side: TrackerSide;
  product: TrackerProduct;
  entryDateTime: string;
  entryAssetPrice: number;
  amount: number;
  cashbackRouting?: CashbackMode;
  actualCurrentValue?: number | null;
  timestamp: string;
}

export interface TrackerCashbackFundingSelection {
  sourcePositionId: string;
  spotAssetPrice?: number;
}

export interface TrackerPositionCurveValues {
  baselineV4: number;
  actualV4: number;
  cashback: number;
  cashbackGenerated: number;
  cashbackDeployed: number;
  withdrawnCash: number;
  baselineWealth: number;
  actualWealth: number;
}

export interface TrackerCurvePoint {
  move: number;
  absolutePrice: number;
  combinedBaseline: number;
  combinedActual: number;
  baselineV4: number;
  actualV4: number;
  cashback: number;
  cashbackGenerated: number;
  cashbackDeployed: number;
  withdrawnCash: number;
  positions: Record<string, TrackerPositionCurveValues>;
}

export interface TrackerAssetSummary {
  assetSymbol: TrackerAsset;
  positionCount: number;
  baselineV4: number;
  actualV4: number;
  cashback: number;
  cashbackGenerated: number;
  cashbackDeployed: number;
  withdrawnCash: number;
  baselineTotalWealth: number;
  actualTotalWealth: number;
  observedPositionCount: number;
  observedBaselineV4: number;
  observedActualV4: number;
  observedReturn: number;
  observedReturnPercent: number | null;
  actualCoveragePercent: number;
  impliedApy: number | null;
  originalCapital: number;
  entryCapital: number;
  freshExternalCapital: number;
  recycledCashbackCapital: number;
  remainingCapitalBasis: number;
  hasReductions: boolean;
  longAssetSupplied: number;
  longEntryValue: number;
  longCurrentSpotValue: number;
  recycledLongAssetEquivalent: number;
  recycledLongCapital: number;
  shortCapital: number;
}

export interface TrackerAssetAllocation {
  assetSymbol: TrackerAsset;
  wealth: number;
  percentage: number;
}

export interface TrackerAllAssetsSummary {
  totalTrackedWealth: number;
  totalInvested: number;
  allocations: TrackerAssetAllocation[];
}

export const TRACKER_PRODUCTS: readonly TrackerProduct[] = ["2x", "2.5x-cashback", "2.5x-looped"];

export const trackerProductShortLabel = (product: TrackerProduct) =>
  product === "2x" ? "2x" : product === "2.5x-cashback" ? "2x CB" : "2.5x";

export const trackerProductLabel = (side: TrackerSide, product: TrackerProduct) =>
  `${trackerProductShortLabel(product)} ${side === "long" ? "Long" : "Short"}`;

export const trackerProductBadge = (product: TrackerProduct) => trackerProductShortLabel(product);

export const isCashbackProduct = (product: TrackerProduct) => product === "2.5x-cashback";

export function normaliseAssetSymbol(value: string): TrackerAsset {
  const symbol = value.trim().toUpperCase();
  return TRACKER_ASSETS.includes(symbol as TrackerAsset) ? symbol as TrackerAsset : "ETH";
}

export function createEmptyTrackerState(selectedAsset = "ETH"): TrackerState {
  return {
    version: 1,
    positions: [],
    currentPrices: {},
    selectedAsset: normaliseAssetSymbol(selectedAsset),
    selectedPositionId: null,
    wealthView: "total",
    cashbackTranches: [],
    fundingTransactions: [],
  };
}

const finitePositive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;
const finiteNonNegative = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

function normaliseReduction(value: unknown): TrackerReduction | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (!(typeof item.id === "string" && typeof item.timestamp === "string" &&
    finitePositive(item.assetPrice) && finiteNonNegative(item.effectivePreReductionValue) &&
    finiteNonNegative(item.usdWithdrawal) && finiteNonNegative(item.reductionFraction) &&
    finiteNonNegative(item.resultingRemainingFraction) && finiteNonNegative(item.resultingEffectiveValue))) return null;
  return item as unknown as TrackerReduction;
}

function normalisePositionFunding(value: unknown, entryCapital: number): TrackerPositionFunding {
  if (!value || typeof value !== "object") return { entryCapital, freshExternalCapital: entryCapital, recycledCashbackCapital: 0 };
  const item = value as Record<string, unknown>;
  if (!(finitePositive(item.entryCapital) && finiteNonNegative(item.freshExternalCapital) && finiteNonNegative(item.recycledCashbackCapital))) {
    return { entryCapital, freshExternalCapital: entryCapital, recycledCashbackCapital: 0 };
  }
  return {
    entryCapital: item.entryCapital,
    freshExternalCapital: item.freshExternalCapital,
    recycledCashbackCapital: item.recycledCashbackCapital,
  };
}

function normaliseCashbackTranche(value: unknown): TrackerCashbackTranche | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (!(typeof item.id === "string" && typeof item.sourcePositionId === "string" && typeof item.createdAt === "string" &&
    TRACKER_ASSETS.includes(item.assetSymbol as TrackerAsset) && (item.routing === "native" || item.routing === "cash" || item.routing === "spot") &&
    (item.denomination === "usd" || item.denomination === "asset") && finiteNonNegative(item.originalUsdAmount) &&
    finiteNonNegative(item.originalNativeAmount) && finiteNonNegative(item.remainingNativeAmount) &&
    finiteNonNegative(item.deployedNativeAmount) && finiteNonNegative(item.deployedUsdAmount))) return null;
  return {
    id: item.id,
    sourcePositionId: item.sourcePositionId,
    createdAt: item.createdAt,
    assetSymbol: item.assetSymbol as TrackerAsset,
    routing: item.routing,
    denomination: item.denomination,
    originalUsdAmount: item.originalUsdAmount,
    originalNativeAmount: item.originalNativeAmount,
    remainingNativeAmount: item.remainingNativeAmount,
    deployedNativeAmount: item.deployedNativeAmount,
    deployedUsdAmount: item.deployedUsdAmount,
  };
}

function normaliseFundingTransaction(value: unknown): TrackerCashbackFundingTransaction | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (!(typeof item.id === "string" && typeof item.sourceTrancheId === "string" &&
    typeof item.sourcePositionId === "string" && typeof item.targetPositionId === "string" &&
    finitePositive(item.nativeAmountConsumed) && finitePositive(item.usdValue))) return null;
  return {
    id: item.id,
    sourceTrancheId: item.sourceTrancheId,
    sourcePositionId: item.sourcePositionId,
    targetPositionId: item.targetPositionId,
    nativeAmountConsumed: item.nativeAmountConsumed,
    usdValue: item.usdValue,
    sourceAssetPrice: item.sourceAssetPrice === null || item.sourceAssetPrice === undefined
      ? null
      : finitePositive(item.sourceAssetPrice) ? item.sourceAssetPrice : null,
  };
}

function normalisePosition(value: unknown): TrackedPosition | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const assetSymbol = typeof item.assetSymbol === "string" ? item.assetSymbol.toUpperCase() : "";
  const reductions = Array.isArray(item.reductions) ? item.reductions.map(normaliseReduction) : [];
  if (!(typeof item.id === "string" && (item.source === "manual" || item.source === "imported") &&
    TRACKER_ASSETS.includes(assetSymbol as TrackerAsset) && (item.side === "long" || item.side === "short") &&
    TRACKER_PRODUCTS.includes(item.product as TrackerProduct) && typeof item.entryDateTime === "string" &&
    finitePositive(item.entryAssetPrice) && finitePositive(item.originalInputAmount) &&
    (item.originalInputUnit === "asset" || item.originalInputUnit === "usd") &&
    (item.originalAssetQuantity === null || finitePositive(item.originalAssetQuantity)) &&
    finitePositive(item.originalEntryCapital) && (item.cashbackRouting === "native" || item.cashbackRouting === "cash" || item.cashbackRouting === "spot") &&
    finiteNonNegative(item.remainingFraction) && item.remainingFraction <= 1 &&
    (item.actualCurrentValue === null || finiteNonNegative(item.actualCurrentValue)) &&
    (item.actualObservedAt === undefined || item.actualObservedAt === null || typeof item.actualObservedAt === "string") &&
    (item.actualObservedAssetPrice === undefined || item.actualObservedAssetPrice === null || finitePositive(item.actualObservedAssetPrice)) &&
    reductions.every(Boolean) && typeof item.createdAt === "string" && typeof item.updatedAt === "string")) return null;
  return {
    id: item.id,
    source: item.source,
    assetSymbol: assetSymbol as TrackerAsset,
    side: item.side,
    product: item.product as TrackerProduct,
    entryDateTime: item.entryDateTime,
    entryAssetPrice: item.entryAssetPrice,
    originalInputAmount: item.originalInputAmount,
    originalInputUnit: item.originalInputUnit,
    originalAssetQuantity: item.originalAssetQuantity as number | null,
    originalEntryCapital: item.originalEntryCapital,
    cashbackRouting: item.cashbackRouting,
    remainingFraction: item.remainingFraction,
    chartVisible: typeof item.chartVisible === "boolean" ? item.chartVisible : false,
    actualCurrentValue: item.actualCurrentValue as number | null,
    actualObservedAt: typeof item.actualObservedAt === "string" ? item.actualObservedAt : null,
    actualObservedAssetPrice: finitePositive(item.actualObservedAssetPrice) ? item.actualObservedAssetPrice : null,
    funding: normalisePositionFunding(item.funding, item.originalEntryCapital),
    reductions: reductions as TrackerReduction[],
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function normaliseTrackerState(value: unknown, fallbackAsset = "ETH"): TrackerState {
  if (!value || typeof value !== "object") return createEmptyTrackerState(fallbackAsset);
  const item = value as Record<string, unknown>;
  const positions = Array.isArray(item.positions)
    ? item.positions.map(normalisePosition).filter((position): position is TrackedPosition => position !== null)
    : [];
  const currentPrices: Partial<Record<TrackerAsset, number>> = {};
  if (item.currentPrices && typeof item.currentPrices === "object") {
    for (const asset of TRACKER_ASSETS) {
      const price = (item.currentPrices as Record<string, unknown>)[asset];
      if (finitePositive(price)) currentPrices[asset] = price;
    }
  }
  const selectedAsset = normaliseAssetSymbol(typeof item.selectedAsset === "string" ? item.selectedAsset : fallbackAsset);
  const selectedPositionId = typeof item.selectedPositionId === "string" && positions.some((position) => position.id === item.selectedPositionId)
    ? item.selectedPositionId
    : null;
  const wealthView = item.wealthView === "v4-cb" || item.wealthView === "v4-only" ? item.wealthView : "total";
  const cashbackTranches = Array.isArray(item.cashbackTranches)
    ? item.cashbackTranches.map(normaliseCashbackTranche).filter((tranche): tranche is TrackerCashbackTranche => tranche !== null)
    : [];
  for (const position of positions) {
    if (isCashbackProduct(position.product) && !cashbackTranches.some((tranche) => tranche.sourcePositionId === position.id)) {
      cashbackTranches.push(createCashbackTrancheForPosition(position));
    }
  }
  const fundingTransactions = Array.isArray(item.fundingTransactions)
    ? item.fundingTransactions.map(normaliseFundingTransaction).filter((transaction): transaction is TrackerCashbackFundingTransaction => transaction !== null)
    : [];
  return { version: 1, positions, currentPrices, selectedAsset, selectedPositionId, wealthView, cashbackTranches, fundingTransactions };
}

export function createTrackedPosition(input: CreateTrackedPositionInput): TrackedPosition {
  if (!finitePositive(input.entryAssetPrice)) throw new RangeError("Entry price must be greater than zero");
  if (!finitePositive(input.amount)) throw new RangeError("Position amount must be greater than zero");
  if (input.actualCurrentValue != null && !finiteNonNegative(input.actualCurrentValue)) throw new RangeError("Actual value cannot be negative");
  const isLong = input.side === "long";
  const originalEntryCapital = isLong ? input.amount * input.entryAssetPrice : input.amount;
  return {
    id: input.id,
    source: "manual",
    assetSymbol: input.assetSymbol,
    side: input.side,
    product: input.product,
    entryDateTime: input.entryDateTime,
    entryAssetPrice: input.entryAssetPrice,
    originalInputAmount: input.amount,
    originalInputUnit: isLong ? "asset" : "usd",
    originalAssetQuantity: isLong ? input.amount : null,
    originalEntryCapital,
    cashbackRouting: input.cashbackRouting ?? "native",
    remainingFraction: 1,
    chartVisible: false,
    actualCurrentValue: input.actualCurrentValue ?? null,
    actualObservedAt: input.actualCurrentValue == null ? null : input.timestamp,
    actualObservedAssetPrice: input.actualCurrentValue == null ? null : input.entryAssetPrice,
    funding: {
      entryCapital: originalEntryCapital,
      freshExternalCapital: originalEntryCapital,
      recycledCashbackCapital: 0,
    },
    reductions: [],
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
  };
}

export function createCashbackTrancheForPosition(position: TrackedPosition): TrackerCashbackTranche {
  const originalUsdAmount = position.originalEntryCapital * productCashOutRate(position.product);
  const denomination = resolveCashbackRouting(position.cashbackRouting, position.side) === "spot" ? "asset" : "usd";
  const originalNativeAmount = denomination === "asset" ? originalUsdAmount / position.entryAssetPrice : originalUsdAmount;
  return {
    id: `${position.id}:cashback`,
    sourcePositionId: position.id,
    createdAt: position.createdAt,
    assetSymbol: position.assetSymbol,
    routing: position.cashbackRouting,
    denomination,
    originalUsdAmount,
    originalNativeAmount,
    remainingNativeAmount: originalNativeAmount,
    deployedNativeAmount: 0,
    deployedUsdAmount: 0,
  };
}

export interface AddTrackedPositionResult {
  state: TrackerState;
  position: TrackedPosition;
  cashbackConsumed: number;
  freshExternalCapital: number;
  transactions: TrackerCashbackFundingTransaction[];
}

export function addTrackedPosition(state: TrackerState, input: CreateTrackedPositionInput, cashbackSelections: readonly TrackerCashbackFundingSelection[] = []): AddTrackedPositionResult {
  if (state.positions.some((position) => position.id === input.id)) throw new Error("Position ID already exists");
  const basePosition = createTrackedPosition(input);
  const tranches = state.cashbackTranches.map((tranche) => ({ ...tranche }));
  const transactions: TrackerCashbackFundingTransaction[] = [];
  const selectedSources = new Set<string>();
  let requiredCapital = basePosition.originalEntryCapital;

  for (const selection of cashbackSelections) {
      if (requiredCapital <= 1e-8) break;
      if (selectedSources.has(selection.sourcePositionId)) throw new RangeError("Each Cashback source can only be selected once");
      selectedSources.add(selection.sourcePositionId);
      const tranche = tranches.find((candidate) => candidate.sourcePositionId === selection.sourcePositionId);
      if (!tranche || tranche.remainingNativeAmount <= 1e-12) throw new RangeError("A selected Cashback source is no longer available");
      const sourcePrice = tranche.denomination === "usd" ? null : selection.spotAssetPrice;
      if (tranche.denomination === "asset" && !finitePositive(sourcePrice)) {
        throw new RangeError(`Enter a valid ${tranche.assetSymbol} sale price for each selected Spot Cashback source`);
      }
      const availableUsd = tranche.denomination === "usd"
        ? tranche.remainingNativeAmount
        : tranche.remainingNativeAmount * (sourcePrice as number);
      const usdValue = Math.min(requiredCapital, availableUsd);
      if (usdValue <= 1e-8) continue;
      const nativeAmountConsumed = tranche.denomination === "usd" ? usdValue : usdValue / (sourcePrice as number);
      const transactionId = `${input.id}:cashback-funding:${transactions.length + 1}`;
      tranche.remainingNativeAmount = Math.max(0, tranche.remainingNativeAmount - nativeAmountConsumed);
      tranche.deployedNativeAmount += nativeAmountConsumed;
      tranche.deployedUsdAmount += usdValue;
      transactions.push({
        id: transactionId,
        sourceTrancheId: tranche.id,
        sourcePositionId: tranche.sourcePositionId,
        targetPositionId: input.id,
        nativeAmountConsumed,
        usdValue,
        sourceAssetPrice: sourcePrice ?? null,
      });
      requiredCapital -= usdValue;
  }

  const cashbackConsumed = Math.max(0, basePosition.originalEntryCapital - requiredCapital);
  const freshExternalCapital = Math.max(0, requiredCapital);
  const position: TrackedPosition = {
    ...basePosition,
    funding: {
      entryCapital: basePosition.originalEntryCapital,
      freshExternalCapital,
      recycledCashbackCapital: cashbackConsumed,
    },
  };
  const cashbackTranches = isCashbackProduct(position.product)
    ? [...tranches, createCashbackTrancheForPosition(position)]
    : tranches;
  return {
    state: {
      ...state,
      positions: [...state.positions, position],
      cashbackTranches,
      fundingTransactions: [...state.fundingTransactions, ...transactions],
    },
    position,
    cashbackConsumed,
    freshExternalCapital,
    transactions,
  };
}

export interface CorrectTrackedPositionChanges {
  side: TrackerSide;
  product: TrackerProduct;
  cashbackRouting: CashbackMode;
  entryDateTime: string;
  entryAssetPrice: number;
  amount: number;
}

function detachPositionFundingLinks(state: TrackerState, positionId: string): TrackerState {
  const linkedTransactions = state.fundingTransactions.filter((transaction) =>
    transaction.sourcePositionId === positionId || transaction.targetPositionId === positionId);
  if (linkedTransactions.length === 0) return state;

  const incomingTransactions = linkedTransactions.filter((transaction) => transaction.targetPositionId === positionId);
  const outgoingByTarget = new Map<string, number>();
  for (const transaction of linkedTransactions) {
    if (transaction.sourcePositionId !== positionId || transaction.targetPositionId === positionId) continue;
    outgoingByTarget.set(transaction.targetPositionId, (outgoingByTarget.get(transaction.targetPositionId) ?? 0) + transaction.usdValue);
  }

  const positions = state.positions.map((position) => {
    if (position.id === positionId && incomingTransactions.length > 0) {
      return {
        ...position,
        funding: {
          entryCapital: position.funding.entryCapital,
          freshExternalCapital: position.funding.entryCapital,
          recycledCashbackCapital: 0,
        },
      };
    }
    const detachedUsd = outgoingByTarget.get(position.id) ?? 0;
    if (detachedUsd <= 0) return position;
    return {
      ...position,
      funding: {
        ...position.funding,
        freshExternalCapital: Math.min(position.funding.entryCapital, position.funding.freshExternalCapital + detachedUsd),
        recycledCashbackCapital: Math.max(0, position.funding.recycledCashbackCapital - detachedUsd),
      },
    };
  });

  const cashbackTranches = state.cashbackTranches
    .filter((tranche) => tranche.sourcePositionId !== positionId)
    .map((tranche) => {
      const refunds = incomingTransactions.filter((transaction) => transaction.sourceTrancheId === tranche.id);
      if (refunds.length === 0) return tranche;
      const nativeAmount = refunds.reduce((sum, transaction) => sum + transaction.nativeAmountConsumed, 0);
      const usdAmount = refunds.reduce((sum, transaction) => sum + transaction.usdValue, 0);
      return {
        ...tranche,
        remainingNativeAmount: Math.min(tranche.originalNativeAmount, tranche.remainingNativeAmount + nativeAmount),
        deployedNativeAmount: Math.max(0, tranche.deployedNativeAmount - nativeAmount),
        deployedUsdAmount: Math.max(0, tranche.deployedUsdAmount - usdAmount),
      };
    });

  return {
    ...state,
    positions,
    cashbackTranches,
    fundingTransactions: state.fundingTransactions.filter((transaction) => !linkedTransactions.includes(transaction)),
  };
}

export function correctTrackedPosition(state: TrackerState, positionId: string, changes: CorrectTrackedPositionChanges, timestamp: string): TrackerState {
  const position = state.positions.find((candidate) => candidate.id === positionId);
  if (!position) throw new Error("Position no longer exists");
  if (!finitePositive(changes.entryAssetPrice) || !finitePositive(changes.amount) || !changes.entryDateTime) throw new RangeError("Enter a valid original amount, entry price, and date/time");
  const nextCapital = changes.side === "long" ? changes.amount * changes.entryAssetPrice : changes.amount;
  const isEconomicCorrection = changes.side !== position.side || changes.product !== position.product ||
    resolveCashbackRouting(changes.cashbackRouting, changes.side) !== resolveCashbackRouting(position.cashbackRouting, position.side) || changes.entryAssetPrice !== position.entryAssetPrice ||
    changes.amount !== position.originalInputAmount;
  const accountingState = isEconomicCorrection ? detachPositionFundingLinks(state, positionId) : state;
  const accountingPosition = accountingState.positions.find((candidate) => candidate.id === positionId) ?? position;
  const corrected: TrackedPosition = {
    ...accountingPosition,
    side: changes.side,
    product: changes.product,
    cashbackRouting: changes.cashbackRouting,
    entryDateTime: changes.entryDateTime,
    entryAssetPrice: changes.entryAssetPrice,
    originalInputAmount: changes.amount,
    originalInputUnit: changes.side === "long" ? "asset" : "usd",
    originalAssetQuantity: changes.side === "long" ? changes.amount : null,
    originalEntryCapital: nextCapital,
    funding: isEconomicCorrection
      ? { entryCapital: nextCapital, freshExternalCapital: nextCapital, recycledCashbackCapital: 0 }
      : accountingPosition.funding,
    updatedAt: timestamp,
  };
  let cashbackTranches = accountingState.cashbackTranches;
  if (isEconomicCorrection) {
    cashbackTranches = cashbackTranches.filter((tranche) => tranche.sourcePositionId !== positionId);
    if (isCashbackProduct(corrected.product)) cashbackTranches = [...cashbackTranches, createCashbackTrancheForPosition(corrected)];
  } else if (changes.cashbackRouting !== position.cashbackRouting) {
    cashbackTranches = cashbackTranches.map((tranche) => tranche.sourcePositionId === positionId
      ? { ...tranche, routing: changes.cashbackRouting } : tranche);
  }
  return { ...accountingState, positions: accountingState.positions.map((candidate) => candidate.id === positionId ? corrected : candidate), cashbackTranches };
}

export function deleteTrackedPosition(state: TrackerState, positionId: string): TrackerState {
  const accountingState = detachPositionFundingLinks(state, positionId);
  return {
    ...accountingState,
    positions: accountingState.positions.filter((position) => position.id !== positionId),
    cashbackTranches: accountingState.cashbackTranches.filter((tranche) => tranche.sourcePositionId !== positionId),
    selectedPositionId: accountingState.selectedPositionId === positionId ? null : accountingState.selectedPositionId,
  };
}

const activeV4EntryFraction = (position: TrackedPosition) => 1 - productCashOutRate(position.product);

export function trackerBaselineV4AtPrice(position: TrackedPosition, absoluteAssetPrice: number) {
  if (!finitePositive(absoluteAssetPrice)) throw new RangeError("Asset price must be greater than zero");
  const p = absoluteAssetPrice / position.entryAssetPrice;
  const response = position.side === "long"
    ? longPositionValue(p, position.product as LongV4Mode)
    : shortPositionValue(p, position.product as ShortV4Mode);
  return position.originalEntryCapital * activeV4EntryFraction(position) * position.remainingFraction * response;
}

export const trackerBaselineCurrentValue = trackerBaselineV4AtPrice;

export function trackerProjectedActualV4AtPrice(position: TrackedPosition, absoluteAssetPrice: number, currentAssetPrice: number) {
  const baselineAtPrice = trackerBaselineV4AtPrice(position, absoluteAssetPrice);
  if (position.actualCurrentValue === null) return baselineAtPrice;
  const baselineNow = trackerBaselineV4AtPrice(position, currentAssetPrice);
  return baselineNow > 0 ? position.actualCurrentValue * baselineAtPrice / baselineNow : baselineAtPrice;
}

export function trackerEffectiveCurrentValue(position: TrackedPosition, currentAssetPrice: number) {
  return position.actualCurrentValue ?? trackerBaselineV4AtPrice(position, currentAssetPrice);
}

function cashbackTranchesForPosition(position: TrackedPosition, cashbackTranches?: readonly TrackerCashbackTranche[]) {
  if (!cashbackTranches) return isCashbackProduct(position.product) ? [createCashbackTrancheForPosition(position)] : [];
  return cashbackTranches.filter((tranche) => tranche.sourcePositionId === position.id);
}

export function trackerCashbackTrancheValueAtPrice(tranche: TrackerCashbackTranche, absoluteAssetPrice: number) {
  if (!finitePositive(absoluteAssetPrice)) throw new RangeError("Asset price must be greater than zero");
  return tranche.denomination === "usd" ? tranche.remainingNativeAmount : tranche.remainingNativeAmount * absoluteAssetPrice;
}

export function trackerCashbackAtPrice(position: TrackedPosition, absoluteAssetPrice: number, cashbackTranches?: readonly TrackerCashbackTranche[]) {
  return cashbackTranchesForPosition(position, cashbackTranches)
    .reduce((sum, tranche) => sum + trackerCashbackTrancheValueAtPrice(tranche, absoluteAssetPrice), 0);
}

export const trackerWithdrawnCash = (position: TrackedPosition) =>
  position.reductions.reduce((sum, reduction) => sum + reduction.usdWithdrawal, 0);

export function trackerPositionCurveValues(position: TrackedPosition, absoluteAssetPrice: number, currentAssetPrice: number, wealthView: TrackerWealthView, cashbackTranches?: readonly TrackerCashbackTranche[]): TrackerPositionCurveValues {
  const baselineV4 = trackerBaselineV4AtPrice(position, absoluteAssetPrice);
  const actualV4 = trackerProjectedActualV4AtPrice(position, absoluteAssetPrice, currentAssetPrice);
  const positionTranches = cashbackTranchesForPosition(position, cashbackTranches);
  const cashback = positionTranches.reduce((sum, tranche) => sum + trackerCashbackTrancheValueAtPrice(tranche, absoluteAssetPrice), 0);
  const cashbackGenerated = positionTranches.reduce((sum, tranche) => sum + tranche.originalUsdAmount, 0);
  const cashbackDeployed = positionTranches.reduce((sum, tranche) => sum + tranche.deployedUsdAmount, 0);
  const withdrawnCash = trackerWithdrawnCash(position);
  const includedCashback = wealthView === "v4-only" ? 0 : cashback;
  const includedWithdrawn = wealthView === "total" ? withdrawnCash : 0;
  return { baselineV4, actualV4, cashback, cashbackGenerated, cashbackDeployed, withdrawnCash, baselineWealth: baselineV4 + includedCashback + includedWithdrawn, actualWealth: actualV4 + includedCashback + includedWithdrawn };
}

export function setTrackerActualObservation(position: TrackedPosition, actualCurrentValue: number | null, currentAssetPrice: number, timestamp: string): TrackedPosition {
  if (actualCurrentValue !== null && !finiteNonNegative(actualCurrentValue)) throw new RangeError("Actual V4 value cannot be negative");
  if (actualCurrentValue !== null && !finitePositive(currentAssetPrice)) throw new RangeError("Current asset price is required for an actual observation");
  return { ...position, actualCurrentValue, actualObservedAt: actualCurrentValue === null ? null : timestamp, actualObservedAssetPrice: actualCurrentValue === null ? null : currentAssetPrice, updatedAt: timestamp };
}

export function reduceTrackedPosition(position: TrackedPosition, usdWithdrawal: number, currentAssetPrice: number, id: string, timestamp: string): TrackedPosition {
  if (!finitePositive(usdWithdrawal)) throw new RangeError("Withdrawal must be greater than zero");
  const effectiveBefore = trackerEffectiveCurrentValue(position, currentAssetPrice);
  if (effectiveBefore <= 0 || usdWithdrawal > effectiveBefore + 1e-8) throw new RangeError("Withdrawal cannot exceed the effective V4 value");
  const reductionFraction = Math.min(1, usdWithdrawal / effectiveBefore);
  const remainingFraction = position.remainingFraction * (1 - reductionFraction);
  const actualCurrentValue = position.actualCurrentValue === null ? null : position.actualCurrentValue * (1 - reductionFraction);
  const reduction: TrackerReduction = { id, timestamp, assetPrice: currentAssetPrice, effectivePreReductionValue: effectiveBefore, usdWithdrawal, reductionFraction, resultingRemainingFraction: remainingFraction, resultingEffectiveValue: Math.max(0, effectiveBefore - usdWithdrawal) };
  return { ...position, remainingFraction, actualCurrentValue, reductions: [...position.reductions, reduction], updatedAt: timestamp };
}

export function buildTrackerCurve(positions: readonly TrackedPosition[], currentAssetPrice: number, wealthView: TrackerWealthView = "total", minMove = -80, maxMove = 200, sampleCount = 121, cashbackTranches?: readonly TrackerCashbackTranche[]): TrackerCurvePoint[] {
  if (!finitePositive(currentAssetPrice)) return [];
  return Array.from({ length: sampleCount }, (_, index) => {
    const move = minMove + (maxMove - minMove) * index / Math.max(1, sampleCount - 1);
    const absolutePrice = currentAssetPrice * (1 + move / 100);
    const point: TrackerCurvePoint = { move, absolutePrice, combinedBaseline: 0, combinedActual: 0, baselineV4: 0, actualV4: 0, cashback: 0, cashbackGenerated: 0, cashbackDeployed: 0, withdrawnCash: 0, positions: {} };
    for (const position of positions) {
      const values = trackerPositionCurveValues(position, absolutePrice, currentAssetPrice, wealthView, cashbackTranches);
      point.positions[position.id] = values;
      point.combinedBaseline += values.baselineWealth;
      point.combinedActual += values.actualWealth;
      point.baselineV4 += values.baselineV4;
      point.actualV4 += values.actualV4;
      point.cashback += values.cashback;
      point.cashbackGenerated += values.cashbackGenerated;
      point.cashbackDeployed += values.cashbackDeployed;
      point.withdrawnCash += values.withdrawnCash;
    }
    return point;
  });
}

function solveImpliedApy(observed: Array<{ baseline: number; actual: number; ageYears: number }>) {
  if (observed.length === 0 || observed.some((item) => item.ageYears <= 0 || item.baseline <= 0 || item.actual < 0)) return null;
  const target = observed.reduce((sum, item) => sum + item.actual, 0);
  const valueAt = (rate: number) => observed.reduce((sum, item) => sum + item.baseline * (1 + rate) ** item.ageYears, 0);
  if (Math.abs(valueAt(0) - target) < 1e-8) return 0;
  let low = -0.999999;
  let high = 1;
  while (valueAt(high) < target && high < 1_000_000) high *= 2;
  if (valueAt(low) > target || valueAt(high) < target) return null;
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const mid = (low + high) / 2;
    if (valueAt(mid) < target) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

export function trackerAssetSummary(positions: readonly TrackedPosition[], assetSymbol: TrackerAsset, currentAssetPrice: number, cashbackTranches?: readonly TrackerCashbackTranche[]): TrackerAssetSummary {
  const assetPositions = positions.filter((position) => position.assetSymbol === assetSymbol);
  const summary: TrackerAssetSummary = { assetSymbol, positionCount: assetPositions.length, baselineV4: 0, actualV4: 0, cashback: 0, cashbackGenerated: 0, cashbackDeployed: 0, withdrawnCash: 0, baselineTotalWealth: 0, actualTotalWealth: 0, observedPositionCount: 0, observedBaselineV4: 0, observedActualV4: 0, observedReturn: 0, observedReturnPercent: null, actualCoveragePercent: 0, impliedApy: null, originalCapital: 0, entryCapital: 0, freshExternalCapital: 0, recycledCashbackCapital: 0, remainingCapitalBasis: 0, hasReductions: false, longAssetSupplied: 0, longEntryValue: 0, longCurrentSpotValue: 0, recycledLongAssetEquivalent: 0, recycledLongCapital: 0, shortCapital: 0 };
  const canValue = finitePositive(currentAssetPrice);
  const annualisationSample: Array<{ baseline: number; actual: number; ageYears: number }> = [];
  let observedHasReductions = false;
  for (const position of assetPositions) {
    summary.withdrawnCash += trackerWithdrawnCash(position);
    summary.originalCapital += position.originalEntryCapital;
    summary.entryCapital += position.funding.entryCapital;
    summary.freshExternalCapital += position.funding.freshExternalCapital;
    summary.recycledCashbackCapital += position.funding.recycledCashbackCapital;
    summary.remainingCapitalBasis += position.originalEntryCapital * position.remainingFraction;
    summary.hasReductions ||= position.reductions.length > 0;
    if (position.side === "long") {
      const freshFundingShare = position.funding.entryCapital > 0 ? position.funding.freshExternalCapital / position.funding.entryCapital : 0;
      const recycledFundingShare = position.funding.entryCapital > 0 ? position.funding.recycledCashbackCapital / position.funding.entryCapital : 0;
      summary.longAssetSupplied += position.originalInputAmount * freshFundingShare;
      summary.longEntryValue += position.funding.freshExternalCapital;
      summary.recycledLongAssetEquivalent += position.originalInputAmount * recycledFundingShare;
      summary.recycledLongCapital += position.funding.recycledCashbackCapital;
    } else summary.shortCapital += position.originalInputAmount;
    if (!canValue) continue;
    const baseline = trackerBaselineV4AtPrice(position, currentAssetPrice);
    const actual = position.actualCurrentValue ?? baseline;
    summary.baselineV4 += baseline;
    summary.actualV4 += actual;
    const positionTranches = cashbackTranchesForPosition(position, cashbackTranches);
    summary.cashback += positionTranches.reduce((sum, tranche) => sum + trackerCashbackTrancheValueAtPrice(tranche, currentAssetPrice), 0);
    summary.cashbackGenerated += positionTranches.reduce((sum, tranche) => sum + tranche.originalUsdAmount, 0);
    summary.cashbackDeployed += positionTranches.reduce((sum, tranche) => sum + tranche.deployedUsdAmount, 0);
    if (position.actualCurrentValue !== null) {
      summary.observedPositionCount += 1;
      summary.observedBaselineV4 += baseline;
      summary.observedActualV4 += position.actualCurrentValue;
      observedHasReductions ||= position.reductions.length > 0;
      if (position.actualObservedAt) {
        const observedAt = new Date(position.actualObservedAt).getTime();
        const enteredAt = new Date(position.entryDateTime).getTime();
        if (Number.isFinite(observedAt) && Number.isFinite(enteredAt) && observedAt > enteredAt) annualisationSample.push({ baseline, actual: position.actualCurrentValue, ageYears: (observedAt - enteredAt) / (365.25 * 24 * 60 * 60 * 1000) });
      }
    }
  }
  summary.longCurrentSpotValue = canValue ? summary.longAssetSupplied * currentAssetPrice : 0;
  summary.baselineTotalWealth = summary.baselineV4 + summary.cashback + summary.withdrawnCash;
  summary.actualTotalWealth = summary.actualV4 + summary.cashback + summary.withdrawnCash;
  summary.observedReturn = summary.observedActualV4 - summary.observedBaselineV4;
  summary.observedReturnPercent = summary.observedBaselineV4 > 0 ? summary.observedReturn / summary.observedBaselineV4 : null;
  summary.actualCoveragePercent = summary.baselineV4 > 0 ? summary.observedBaselineV4 / summary.baselineV4 : 0;
  summary.impliedApy = !observedHasReductions && annualisationSample.length === summary.observedPositionCount ? solveImpliedApy(annualisationSample) : null;
  return summary;
}

export function trackerAllAssetsSummary(state: Pick<TrackerState, "positions" | "currentPrices"> & Partial<Pick<TrackerState, "cashbackTranches">>): TrackerAllAssetsSummary {
  const allocations = TRACKER_ASSETS.map((assetSymbol) => {
    const currentPrice = state.currentPrices[assetSymbol] ?? 0;
    const wealth = trackerAssetSummary(state.positions, assetSymbol, currentPrice, state.cashbackTranches).actualTotalWealth;
    return { assetSymbol, wealth, percentage: 0 };
  });
  const totalTrackedWealth = allocations.reduce((sum, allocation) => sum + allocation.wealth, 0);
  for (const allocation of allocations) allocation.percentage = totalTrackedWealth > 0 ? allocation.wealth / totalTrackedWealth : 0;
  return { totalTrackedWealth, totalInvested: state.positions.reduce((sum, position) => sum + position.funding.freshExternalCapital, 0), allocations };
}
