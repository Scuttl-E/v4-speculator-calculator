import type { PerpPositionInput } from "./perpPosition";
import type { OptimiserSearchDiagnostics } from "./optimiserSearch";

export type CashbackMode = "cash" | "spot";
export type OptimiserCashbackMode = CashbackMode | "optimise";
export type DegenMode = "x1" | "x2" | "x3" | "x4" | "custom" | "max";
export interface DegenSettings {
  degenEnabled: boolean;
  degenMode: DegenMode;
  customRecyclePct: number;
}
export type ComparisonMode = "base" | "lending" | "perp";
export type Objective = "bullish" | "bearish" | "spotParity" | "debtParity" | "perpParity" | "benchmarkDominance";
export interface Config extends DegenSettings {
  deposit: number;
  longAllocation: number;
  longLtv: number;
  shortLtv: number;
  cashbackMode: CashbackMode;
}
export interface Trough {
  value: number;
  p: number;
  drawdown: number;
}
export interface OptimiseOptions extends DegenSettings {
  maxDrawdown: number;
  maxLtv: number;
  longMaxLtv?: number;
  shortMaxLtv?: number;
  bullishTargetPercent?: number;
  bearishTargetPercent?: number;
  analysisMinPercent?: number;
  analysisMaxPercent?: number;
  searchStepPercent?: number;
  objective: Objective;
  comparisonMode?: ComparisonMode;
  baseAssetValue?: number;
  spotParityPercent: number;
  debtParityPercent: number;
  perpParityPercent: number;
  debtPosition: {
    assetPrice: number;
    assetAmount: number;
    usdDebt: number;
    liquidationLtv: number;
  };
  perpPosition: PerpPositionInput;
  cashbackMode: OptimiserCashbackMode;
  requireBreakeven: boolean;
  downsideBreakevenPercent: number;
  upsideBreakevenPercent: number;
  deposit: number;
}
export type AdverseDirection = "downside" | "upside";
export interface OptimiseOutcome {
  config: Config | null;
  requestedMaxDrawdown: number;
  effectiveMaxDrawdown: number | null;
  drawdownRelaxed: boolean;
  adverseDirection: AdverseDirection;
  downsideBreakeven: number | null;
  upsideBreakeven: number | null;
  debtParity: {
    targetPercent: number;
    debtValue: number;
    v4Value: number;
    secured: boolean;
  } | null;
  perpParity: {
    targetPercent: number;
    perpValue: number;
    v4Value: number;
    secured: boolean;
  } | null;
  failure: string | null;
  diagnostics?: OptimiserSearchDiagnostics;
}
