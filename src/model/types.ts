import type { PerpPositionInput } from "./perpPosition";

export type CashbackMode = "cash" | "spot";
export type OptimiserCashbackMode = CashbackMode | "optimise";
export type ComparisonMode = "base" | "lending" | "perp";
export type Objective = "bullish" | "bearish" | "spotParity" | "debtParity" | "perpParity" | "benchmarkDominance";
export interface Config {
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
export interface OptimiseOptions {
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
}
