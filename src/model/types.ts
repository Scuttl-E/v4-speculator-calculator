export type CashbackMode = "cash" | "spot";
export type OptimiserCashbackMode = CashbackMode | "optimise";
export type Objective = "bullish" | "bearish" | "spotParity";
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
  objective: Objective;
  spotParityPercent: number;
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
  failure: string | null;
}
