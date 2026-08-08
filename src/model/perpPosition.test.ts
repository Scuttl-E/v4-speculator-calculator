import { describe, expect, it } from "vitest";
import {
  isPerpPositionLiquidated,
  perpPositionReturn,
  perpPositionSummary,
  perpPositionValue,
} from "./perpPosition";

describe("perp position", () => {
  it("models a long position from its average entry price", () => {
    const long = { assetPrice: 1900, averageEntryPrice: 1500, positionSize: 20, margin: 10000, liquidationPrice: 1100, side: "long" as const };
    expect(perpPositionSummary(long).notional).toBe(38000);
    expect(perpPositionSummary(long).unrealisedPnl).toBe(8000);
    expect(perpPositionSummary(long).currentEquity).toBe(18000);
    expect(perpPositionSummary(long).effectiveExposure).toBeCloseTo(38_000 / 18_000);
    expect(perpPositionSummary(long).liquidationAssetMove).toBeCloseTo(-42.10526316);
    expect(perpPositionValue(1, long)).toBe(18000);
    expect(perpPositionReturn(1, long)).toBe(0);
    expect(perpPositionValue(2400 / 1900, long)).toBe(28000);
    expect(perpPositionReturn(2400 / 1900, long)).toBeCloseTo(0.5555556);
    expect(isPerpPositionLiquidated(0.55, long)).toBe(true);
    expect(isPerpPositionLiquidated(0.58, long)).toBe(false);
  });

  it("models a short position from its average entry price", () => {
    const short = { assetPrice: 1900, averageEntryPrice: 2300, positionSize: 20, margin: 10000, liquidationPrice: 3000, side: "short" as const };
    expect(perpPositionReturn(1, short)).toBe(0);
    expect(perpPositionSummary(short).unrealisedPnl).toBe(8000);
    expect(perpPositionSummary(short).currentEquity).toBe(18000);
    expect(perpPositionValue(1400 / 1900, short)).toBe(28000);
    expect(perpPositionReturn(1400 / 1900, short)).toBeCloseTo(0.5555556);
    expect(perpPositionSummary(short).liquidationAssetMove).toBeCloseTo(57.89473684);
    expect(isPerpPositionLiquidated(3000 / 1900, short)).toBe(true);
    expect(isPerpPositionLiquidated(1.57, short)).toBe(false);
  });
});
