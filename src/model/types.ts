import type { PerpPositionInput } from "./perpPosition";
import type { OptimiserSearchDiagnostics } from "./optimiserSearch";

/** The only protocol products supported by V4.  Do not model intermediate LTVs. */
export type SupportedV4Ltv = 0.5 | 0.75;
export type LongV4Mode = "2x" | "2.5x-cashback" | "2.5x-looped";
/** @deprecated Legacy-only types retained while saved input is normalised on load. */
export type CashbackMode = "cash" | "spot";
/** @deprecated */ export type OptimiserCashbackMode = CashbackMode | "optimise";
/** @deprecated retired Degen settings are not used by production calculations. */
export type DegenMode = "x1" | "x2" | "x3" | "x4" | "custom" | "max";
/** @deprecated */ export interface DegenSettings { degenEnabled:boolean; degenMode:DegenMode; customRecyclePct:number; }
export type ComparisonMode = "base" | "lending" | "perp";
export type Objective = "bullish" | "bearish" | "spotParity" | "debtParity" | "perpParity" | "benchmarkDominance";
export interface AnalysisRange { readonly minPriceRatio: number; readonly maxPriceRatio: number; }
export interface Config extends DegenSettings {
  deposit: number;
  longAllocation: number;
  longMode?: LongV4Mode;
  shortLtv: SupportedV4Ltv | number;
  /** @deprecated normalised to longMode at the app boundary. */ longLtv: number;
  /** @deprecated normalised to longMode at the app boundary. */ cashbackMode: CashbackMode;
  /** @deprecated normalised to longMode at the app boundary. */ cashOutEnabled?: boolean;
}
export interface Trough { value: number; p: number; drawdown: number; }
export interface OptimiseOptions extends DegenSettings {
  maxDrawdown: number;
  maxLtv: SupportedV4Ltv | number;
  /** @deprecated */ longMaxLtv?: number; /** @deprecated */ shortMaxLtv?: number;
  bullishTargetPercent?: number;
  bearishTargetPercent?: number;
  analysisRange: AnalysisRange;
  searchStepPercent?: number;
  objective: Objective;
  comparisonMode?: ComparisonMode;
  baseAssetValue?: number;
  spotParityPercent: number;
  debtParityPercent: number;
  perpParityPercent: number;
  debtPosition: { assetPrice: number; assetAmount: number; usdDebt: number; liquidationLtv: number; };
  perpPosition: PerpPositionInput;
  requireBreakeven: boolean;
  downsideBreakevenPercent: number;
  upsideBreakevenPercent: number;
  deposit: number;
  /** @deprecated */ cashbackMode?: OptimiserCashbackMode; /** @deprecated */ cashOutEnabled?: boolean; /** @deprecated */ forceCashOut?: boolean;
}
export type AdverseDirection = "downside" | "upside";
export type OptimisationOutcomeStatus = "optimal" | "best-effort" | "no-valid-configuration";
export interface ParityOutcome {
  kind: "spot" | "lending" | "perp";
  targetPercent: number;
  targetValue: number;
  achievedValue: number;
  shortfall: number;
  reached: boolean;
}
export interface OptimiseOutcome {
  status: OptimisationOutcomeStatus;
  config: Config | null; requestedMaxDrawdown: number; effectiveMaxDrawdown: number | null;
  drawdownRelaxed: boolean; adverseDirection: AdverseDirection;
  downsideBreakeven: number | null; upsideBreakeven: number | null;
  debtParity: { targetPercent: number; debtValue: number; v4Value: number; secured: boolean; } | null;
  perpParity: { targetPercent: number; perpValue: number; v4Value: number; secured: boolean; } | null;
  parity: ParityOutcome | null;
  failure: string | null; diagnostics?: OptimiserSearchDiagnostics;
}
