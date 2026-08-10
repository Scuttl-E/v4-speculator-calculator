import { describe, expect, it } from "vitest";
import {
  calculateDegenAccounting,
  degenRecycleTargetRatio,
} from "./degen";
import type { DegenMode, DegenSettings } from "./types";

const settings = (
  degenMode: DegenMode,
  customRecyclePct = 0,
  degenEnabled = true,
): DegenSettings => ({ degenEnabled, degenMode, customRecyclePct });

describe("Degen accounting", () => {
  it("leaves the pre-Degen accounting unchanged when disabled", () => {
    expect(calculateDegenAccounting(10_000, settings("max", 100, false))).toEqual({
      initialDeposit: 10_000,
      recycleTargetRatio: 0,
      recycledIntoV4: 0,
      grossV4Deposited: 10_000,
      residualCashback: 5_000,
    });
  });

  it.each([
    ["x1", 5_000, 2_500],
    ["x2", 7_500, 1_250],
    ["x3", 8_750, 625],
    ["x4", 9_375, 312.5],
    ["max", 10_000, 0],
  ] as const)("accounts for %s exactly", (mode, recycled, residual) => {
    const result = calculateDegenAccounting(10_000, settings(mode));
    expect(result.recycledIntoV4).toBe(recycled);
    expect(result.grossV4Deposited).toBe(10_000 + recycled);
    expect(result.residualCashback).toBe(residual);
  });

  it.each([
    [50, "x1"],
    [75, "x2"],
    [100, "max"],
  ] as const)("makes Custom %s%% identical to %s", (percentage, preset) => {
    expect(calculateDegenAccounting(10_000, settings("custom", percentage)))
      .toEqual(calculateDegenAccounting(10_000, settings(preset)));
  });

  it("handles a partial final cashback round without double counting", () => {
    const result = calculateDegenAccounting(10_000, settings("custom", 68));
    expect(result.recycledIntoV4).toBe(6_800);
    expect(result.grossV4Deposited).toBe(16_800);
    expect(result.residualCashback).toBe(1_600);
    expect(result.recycledIntoV4 + result.residualCashback)
      .toBe(result.grossV4Deposited * 0.5);
  });

  it("clamps Custom targets to the supported zero-to-one range", () => {
    expect(degenRecycleTargetRatio(settings("custom", -20))).toBe(0);
    expect(degenRecycleTargetRatio(settings("custom", 120))).toBe(1);
  });
});
