import type { DegenMode, DegenSettings } from "./types";

export const DEGEN_RECYCLE_TARGET_RATIOS: Record<Exclude<DegenMode, "custom">, number> = {
  x1: 0.5,
  x2: 0.75,
  x3: 0.875,
  x4: 0.9375,
  max: 1,
};

export interface DegenAccounting {
  initialDeposit: number;
  recycleTargetRatio: number;
  recycledIntoV4: number;
  grossV4Deposited: number;
  residualCashback: number;
}

export function degenRecycleTargetRatio(settings: DegenSettings): number {
  if (!settings.degenEnabled) return 0;
  if (settings.degenMode === "custom")
    return Math.min(1, Math.max(0, settings.customRecyclePct / 100));
  return DEGEN_RECYCLE_TARGET_RATIOS[settings.degenMode];
}

export function calculateDegenAccounting(
  initialDeposit: number,
  settings: DegenSettings,
): DegenAccounting {
  if (!Number.isFinite(initialDeposit) || initialDeposit < 0)
    throw new RangeError("Initial deposit must be a finite non-negative number");

  const recycleTargetRatio = degenRecycleTargetRatio(settings);
  const normalise = (value: number) => Math.round(value * 1e8) / 1e8;
  const rawRecycledIntoV4 = settings.degenEnabled && settings.degenMode === "custom"
    ? initialDeposit * Math.min(100, Math.max(0, settings.customRecyclePct)) / 100
    : initialDeposit * recycleTargetRatio;
  const recycledIntoV4 = normalise(rawRecycledIntoV4);
  const grossV4Deposited = normalise(initialDeposit + recycledIntoV4);

  // Every V4 deposit produces 50% cashback. Recycled capital is funded from
  // that cashback, so only the unconsumed balance remains external.
  const residualCashback = normalise(grossV4Deposited * 0.5 - recycledIntoV4);

  return {
    initialDeposit,
    recycleTargetRatio,
    recycledIntoV4,
    grossV4Deposited,
    residualCashback,
  };
}
