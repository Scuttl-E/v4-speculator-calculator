/**
 * Retired legacy implementation. V4 now models Looped as one protocol-native
 * 50% cash-out redeployment in v4Math; no production calculation imports this.
 */
import type { Config, DegenMode, DegenSettings } from "./types";

export const LONG_CASH_OUT_MIN_LTV = 0.75;
export const ELIGIBLE_LONG_CASH_OUT_RATE = 0.5;

type CashOutSource = Pick<Config, "cashOutEnabled" | "longAllocation" | "longLtv">;
type DegenConfig = DegenSettings & CashOutSource;

export const longCashOutRate = (longLtv: number, cashOutEnabled = true) =>
  cashOutEnabled && longLtv >= LONG_CASH_OUT_MIN_LTV
    ? ELIGIBLE_LONG_CASH_OUT_RATE
    : 0;

export const eligibleCashOutRatio = (source: CashOutSource) =>
  Math.min(1, Math.max(0, source.longAllocation)) *
  longCashOutRate(source.longLtv, source.cashOutEnabled !== false);

export interface DegenAccounting {
  initialDeposit: number;
  cashOutRatio: number;
  maximumRecycleRatio: number;
  recycleTargetRatio: number;
  recycledIntoV4: number;
  grossV4Deposited: number;
  generatedCashOut: number;
  residualCashOut: number;
}

const completeRoundTargetRatio = (cashOutRatio: number, rounds: number) => {
  let target = 0;
  let roundCashOut = cashOutRatio;
  for (let round = 0; round < rounds; round++) {
    target += roundCashOut;
    roundCashOut *= cashOutRatio;
  }
  return target;
};

export function degenRecycleTargetRatio(settings: DegenConfig): number {
  if (!settings.degenEnabled) return 0;
  const cashOutRatio = eligibleCashOutRatio(settings);
  const maximumRecycleRatio = cashOutRatio === 0 ? 0 : cashOutRatio / (1 - cashOutRatio);
  if (settings.degenMode === "custom")
    return Math.min(maximumRecycleRatio, Math.max(0, settings.customRecyclePct / 100));
  if (settings.degenMode === "max") return maximumRecycleRatio;
  return completeRoundTargetRatio(cashOutRatio, Number(settings.degenMode.slice(1)));
}

export function calculateDegenAccounting(
  initialDeposit: number,
  settings: DegenConfig,
): DegenAccounting {
  if (!Number.isFinite(initialDeposit) || initialDeposit < 0)
    throw new RangeError("Initial deposit must be a finite non-negative number");

  const cashOutRatio = eligibleCashOutRatio(settings);
  const maximumRecycleRatio = cashOutRatio === 0 ? 0 : cashOutRatio / (1 - cashOutRatio);
  const recycleTargetRatio = degenRecycleTargetRatio(settings);
  const normalise = (value: number) => Math.round(value * 1e8) / 1e8;
  const recycledIntoV4 = normalise(initialDeposit * recycleTargetRatio);
  const grossV4Deposited = normalise(initialDeposit + recycledIntoV4);
  const generatedCashOut = normalise(grossV4Deposited * cashOutRatio);
  const residualCashOut = normalise(Math.max(0, generatedCashOut - recycledIntoV4));

  return {
    initialDeposit,
    cashOutRatio,
    maximumRecycleRatio,
    recycleTargetRatio,
    recycledIntoV4,
    grossV4Deposited,
    generatedCashOut,
    residualCashOut,
  };
}
