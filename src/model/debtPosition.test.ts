import { describe, expect, it } from "vitest";
import {
  debtPositionReturn,
  debtPositionSummary,
  debtPositionValue,
  isDebtPositionLiquidated,
} from "./debtPosition";

const position = { assetPrice: 4000, assetAmount: 20, usdDebt: 15000 };

describe("lending position", () => {
  it("derives collateral, net equity, LTV and liquidation threshold", () => {
    const summary = debtPositionSummary(position);
    expect(summary.grossCollateral).toBe(80000);
    expect(summary.netEquity).toBe(65000);
    expect(summary.currentLtv).toBeCloseTo(0.1875);
    expect(summary.liquidationPrice).toBeCloseTo(833.3333333);
    expect(summary.liquidationPriceRatio).toBeCloseTo(0.2083333333);
    expect(summary.liquidationAssetMove).toBeCloseTo(-79.16666667);
  });

  it("normalises debt equity returns to starting net equity", () => {
    expect(debtPositionValue(1, position)).toBe(65000);
    expect(debtPositionReturn(1, position)).toBe(0);
    expect(debtPositionValue(2, position)).toBe(145000);
    expect(debtPositionReturn(2, position)).toBeCloseTo(1.2307692308);
    expect(debtPositionValue(0.5, position)).toBe(25000);
    expect(debtPositionReturn(0.5, position)).toBeCloseTo(-0.6153846154);
  });

  it("liquidates at and below the 90% LTV threshold", () => {
    expect(isDebtPositionLiquidated(0.2083333333, position)).toBe(true);
    expect(isDebtPositionLiquidated(0.21, position)).toBe(false);
  });

  it("uses a user-supplied liquidation LTV", () => {
    const summary = debtPositionSummary({ ...position, liquidationLtv: 0.8 });
    expect(summary.liquidationPrice).toBeCloseTo(937.5);
    expect(isDebtPositionLiquidated(0.23, { ...position, liquidationLtv: 0.8 })).toBe(true);
  });
});
