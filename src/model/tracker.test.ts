import { describe, expect, it } from "vitest";
import {
  addTrackedPosition,
  buildTrackerCurve,
  correctTrackedPosition,
  createEmptyTrackerState,
  createTrackedPosition,
  deleteTrackedPosition,
  normaliseTrackerState,
  reduceTrackedPosition,
  setTrackerActualObservation,
  trackerAllAssetsSummary,
  trackerAssetSummary,
  trackerBaselineV4AtPrice,
  trackerCashbackAtPrice,
  trackerEffectiveCurrentValue,
  trackerPositionCurveValues,
  trackerProjectedActualV4AtPrice,
  trackerWithdrawnCash,
  type TrackerAsset,
} from "./tracker";

const makePosition = (overrides: Partial<Parameters<typeof createTrackedPosition>[0]> = {}) => createTrackedPosition({
  id: "position-1",
  assetSymbol: "ETH",
  side: "long",
  product: "2x",
  entryDateTime: "2026-01-01T12:00",
  entryAssetPrice: 2_000,
  amount: 5,
  timestamp: "2026-01-01T12:00:00.000Z",
  ...overrides,
});

describe("position tracker accounting", () => {
  it("derives Long entry capital from supplied asset and keeps Short quote capital direct", () => {
    const long = makePosition();
    const short = makePosition({ side: "short", amount: 12_000 });
    expect(long.originalAssetQuantity).toBe(5);
    expect(long.originalEntryCapital).toBe(10_000);
    expect(short.originalAssetQuantity).toBeNull();
    expect(short.originalEntryCapital).toBe(12_000);
  });

  it("keeps Cashback outside displayed Baseline and Actual V4 values", () => {
    const position = makePosition({ product: "2.5x-cashback", amount: 10 });
    expect(trackerBaselineV4AtPrice(position, 2_000)).toBeCloseTo(10_000, 10);
    expect(trackerCashbackAtPrice(position, 2_000)).toBeCloseTo(10_000, 10);
    expect(trackerEffectiveCurrentValue(position, 2_000)).toBeCloseTo(10_000, 10);
  });

  it("compounds Actual V4 from effective capital instead of adding a flat offset", () => {
    const position = setTrackerActualObservation(makePosition({ amount: 10 }), 22_000, 2_000, "2026-02-01T12:00:00.000Z");
    expect(trackerBaselineV4AtPrice(position, 2_000)).toBe(20_000);
    expect(trackerBaselineV4AtPrice(position, 3_000)).toBe(30_000);
    expect(trackerProjectedActualV4AtPrice(position, 3_000, 2_000)).toBeCloseTo(33_000, 10);
  });

  it("uses Baseline V4 as the Actual curve fallback", () => {
    const position = makePosition();
    expect(trackerProjectedActualV4AtPrice(position, 3_000, 2_000)).toBe(trackerBaselineV4AtPrice(position, 3_000));
  });

  it("records Actual observation context without following later current-price changes", () => {
    const observed = setTrackerActualObservation(makePosition(), 12_000, 2_500, "2026-02-01T12:00:00.000Z");
    expect(observed.actualObservedAssetPrice).toBe(2_500);
    expect(observed.actualObservedAt).toBe("2026-02-01T12:00:00.000Z");
    expect(trackerEffectiveCurrentValue(observed, 4_000)).toBe(12_000);
  });

  it("externalises withdrawals and proportionally reduces only active V4", () => {
    const position = makePosition({ product: "2.5x-cashback", amount: 10 });
    const reduced = reduceTrackedPosition(position, 2_000, 2_000, "r1", "2026-02-01T12:00:00.000Z");
    expect(reduced.remainingFraction).toBeCloseTo(.8, 10);
    expect(trackerBaselineV4AtPrice(reduced, 2_000)).toBeCloseTo(8_000, 10);
    expect(trackerCashbackAtPrice(reduced, 2_000)).toBeCloseTo(10_000, 10);
    expect(trackerWithdrawnCash(reduced)).toBe(2_000);
  });

  it("applies Wealth View V4 ONLY, V4 + CB, and TOTAL independently", () => {
    const reduced = reduceTrackedPosition(makePosition({ product: "2.5x-cashback", amount: 10 }), 2_000, 2_000, "r1", "2026-02-01T12:00:00.000Z");
    expect(trackerPositionCurveValues(reduced, 2_000, 2_000, "v4-only").baselineWealth).toBeCloseTo(8_000, 10);
    expect(trackerPositionCurveValues(reduced, 2_000, 2_000, "v4-cb").baselineWealth).toBeCloseTo(18_000, 10);
    expect(trackerPositionCurveValues(reduced, 2_000, 2_000, "total").baselineWealth).toBeCloseTo(20_000, 10);
    expect(trackerPositionCurveValues(reduced, 3_000, 2_000, "total").withdrawnCash).toBe(2_000);
  });

  it("keeps cash-routed Cashback fixed and moves spot-routed Cashback with price", () => {
    const cash = makePosition({ id: "cash", product: "2.5x-cashback", amount: 10, cashbackRouting: "cash" });
    const spot = makePosition({ id: "spot", product: "2.5x-cashback", amount: 10, cashbackRouting: "spot" });
    expect(trackerCashbackAtPrice(cash, 3_000)).toBe(10_000);
    expect(trackerCashbackAtPrice(spot, 3_000)).toBe(15_000);
  });

  it("sums independently scaled position Actual curves", () => {
    const first = setTrackerActualObservation(makePosition({ id: "first", amount: 10 }), 22_000, 2_000, "2026-02-01T12:00:00.000Z");
    const second = makePosition({ id: "second", entryAssetPrice: 1_000, amount: 10 });
    const point = buildTrackerCurve([first, second], 2_000, "v4-only", 50, 50, 1)[0];
    expect(point.positions.first.actualV4).toBeCloseTo(33_000, 10);
    expect(point.combinedActual).toBeCloseTo(63_000, 10);
  });

  it("defaults new and legacy tracker persistence to TOTAL with individual curves off", () => {
    expect(createEmptyTrackerState().wealthView).toBe("total");
    const position = makePosition();
    const { chartVisible: _chartVisible, ...legacyPosition } = position;
    const loaded = normaliseTrackerState({ ...createEmptyTrackerState(), positions: [{ ...legacyPosition, active: true }], wealthView: undefined });
    expect(loaded.wealthView).toBe("total");
    expect(loaded.positions[0].chartVisible).toBe(false);
  });

  it("keeps missing Actual-observation metadata compatible", () => {
    const position = makePosition({ actualCurrentValue: 12_000 });
    const { actualObservedAt: _observedAt, actualObservedAssetPrice: _observedPrice, ...legacyPosition } = position;
    const loaded = normaliseTrackerState({ ...createEmptyTrackerState(), positions: [legacyPosition] });
    expect(loaded.positions[0].actualCurrentValue).toBe(12_000);
    expect(loaded.positions[0].actualObservedAt).toBeNull();
  });

  it("builds current-asset Baseline and Actual totals from V4, Cashback, and withdrawn cash", () => {
    const observed = setTrackerActualObservation(makePosition({ product: "2.5x-cashback", amount: 10 }), 11_000, 2_000, "2026-02-01T12:00:00.000Z");
    const reduced = reduceTrackedPosition(observed, 1_000, 2_000, "r1", "2026-03-01T12:00:00.000Z");
    const summary = trackerAssetSummary([reduced], "ETH", 2_000);
    expect(summary.baselineTotalWealth).toBeCloseTo(summary.baselineV4 + summary.cashback + summary.withdrawnCash, 10);
    expect(summary.actualTotalWealth).toBeCloseTo(summary.actualV4 + summary.cashback + summary.withdrawnCash, 10);
  });

  it("calculates Observed Return and coverage only from genuine Actual V4 observations", () => {
    const observed = setTrackerActualObservation(makePosition({ id: "observed", product: "2.5x-cashback", amount: 10 }), 12_000, 2_000, "2026-02-01T12:00:00.000Z");
    const fallback = makePosition({ id: "fallback", amount: 5 });
    const summary = trackerAssetSummary([observed, fallback], "ETH", 2_000);
    expect(summary.observedReturn).toBe(2_000);
    expect(summary.observedReturnPercent).toBeCloseTo(.2, 10);
    expect(summary.observedPositionCount).toBe(1);
    expect(summary.actualCoveragePercent).toBeCloseTo(.5, 10);
  });

  it("solves current-asset implied APY from each observed position's own age", () => {
    const observed = setTrackerActualObservation(makePosition({
      amount: 10,
      entryDateTime: "2025-01-01T00:00:00.000Z",
      timestamp: "2025-01-01T00:00:00.000Z",
    }), 22_000, 2_000, "2026-01-01T06:00:00.000Z");
    expect(trackerAssetSummary([observed], "ETH", 2_000).impliedApy).toBeCloseTo(.1, 8);
  });

  it("reports invested Long and Short context without averaging entry prices", () => {
    const first = makePosition({ id: "first", amount: 5, entryAssetPrice: 2_000 });
    const second = makePosition({ id: "second", amount: 3.4, entryAssetPrice: 1_447.0588235294 });
    const short = makePosition({ id: "short", side: "short", amount: 12_000 });
    const summary = trackerAssetSummary([first, second, short], "ETH", 2_500);
    expect(summary.longAssetSupplied).toBeCloseTo(8.4, 10);
    expect(summary.longEntryValue).toBeCloseTo(14_920, 6);
    expect(summary.longCurrentSpotValue).toBeCloseTo(21_000, 10);
    expect(summary.shortCapital).toBe(12_000);
    expect(summary.originalCapital).toBeCloseTo(26_920, 6);
  });

  it("excludes Cashback-funded Long quantities from externally supplied assets", () => {
    let state = addTrackedPosition(createEmptyTrackerState(), {
      id: "original", assetSymbol: "ETH", side: "long", product: "2.5x-cashback",
      entryDateTime: "2026-01-01T00:00", entryAssetPrice: 2_000, amount: 5, timestamp: "2026-01-01T00:00:00.000Z",
    }).state;
    state = addTrackedPosition(state, {
      id: "recycled-child", assetSymbol: "ETH", side: "long", product: "2.5x-cashback",
      entryDateTime: "2026-02-01T00:00", entryAssetPrice: 2_000, amount: 2.5, timestamp: "2026-02-01T00:00:00.000Z",
    }, [{ sourcePositionId: "original" }]).state;
    state = addTrackedPosition(state, {
      id: "recycled-grandchild", assetSymbol: "ETH", side: "long", product: "2x",
      entryDateTime: "2026-03-01T00:00", entryAssetPrice: 2_000, amount: 1.25, timestamp: "2026-03-01T00:00:00.000Z",
    }, [{ sourcePositionId: "recycled-child" }]).state;
    const summary = trackerAssetSummary(state.positions, "ETH", 2_000, state.cashbackTranches);
    expect(summary.longAssetSupplied).toBe(5);
    expect(summary.longEntryValue).toBe(10_000);
    expect(summary.longCurrentSpotValue).toBe(10_000);
    expect(summary.entryCapital).toBe(17_500);
    expect(summary.freshExternalCapital).toBe(10_000);
    expect(summary.recycledCashbackCapital).toBe(7_500);
    expect(summary.recycledLongAssetEquivalent).toBe(3.75);
    expect(summary.recycledLongCapital).toBe(7_500);
  });

  it("sums all-assets tracked wealth and dollar invested capital without combining quantities", () => {
    const positions = [
      makePosition({ id: "eth" }),
      makePosition({ id: "btc", assetSymbol: "BTC", amount: 1, entryAssetPrice: 30_000 }),
      makePosition({ id: "peas", assetSymbol: "PEAS", side: "short", amount: 1_000, entryAssetPrice: 1 }),
    ];
    const summary = trackerAllAssetsSummary({ positions, currentPrices: { ETH: 2_000, BTC: 60_000, PEAS: 1 } });
    expect(summary.totalTrackedWealth).toBeCloseTo(71_000, 10);
    expect(summary.totalInvested).toBeCloseTo(41_000, 10);
    expect(summary.allocations.reduce((sum, allocation) => sum + allocation.percentage, 0)).toBeCloseTo(1, 10);
  });

  it("supports only ETH, BTC, and PEAS assets", () => {
    const assets: TrackerAsset[] = ["ETH", "BTC", "PEAS"];
    expect(assets).toHaveLength(3);
    expect(normaliseTrackerState({ ...createEmptyTrackerState(), selectedAsset: "DOGE" }).selectedAsset).toBe("ETH");
  });

  it("recycles Cashback into a child without duplicating portfolio wealth", () => {
    const parent = addTrackedPosition(createEmptyTrackerState(), {
      id: "parent", assetSymbol: "ETH", side: "long", product: "2.5x-cashback",
      entryDateTime: "2026-01-01T00:00", entryAssetPrice: 2_000, amount: 5, timestamp: "2026-01-01T00:00:00.000Z",
    }).state;
    const result = addTrackedPosition(parent, {
      id: "child", assetSymbol: "ETH", side: "long", product: "2x",
      entryDateTime: "2026-02-01T00:00", entryAssetPrice: 2_000, amount: 2.5, timestamp: "2026-02-01T00:00:00.000Z",
    }, [{ sourcePositionId: "parent" }]);
    const summary = trackerAssetSummary(result.state.positions, "ETH", 2_000, result.state.cashbackTranches);
    expect(result.cashbackConsumed).toBe(5_000);
    expect(result.freshExternalCapital).toBe(0);
    expect(summary.actualTotalWealth).toBeCloseTo(10_000, 10);
    expect(summary.cashback).toBe(0);
    expect(trackerAllAssetsSummary(result.state).totalInvested).toBe(10_000);
  });

  it("uses fresh capital only for the remainder of a partially funded child", () => {
    const parent = addTrackedPosition(createEmptyTrackerState(), {
      id: "parent", assetSymbol: "ETH", side: "long", product: "2.5x-cashback",
      entryDateTime: "2026-01-01T00:00", entryAssetPrice: 2_000, amount: 5, timestamp: "2026-01-01T00:00:00.000Z",
    }).state;
    const result = addTrackedPosition(parent, {
      id: "child", assetSymbol: "ETH", side: "short", product: "2x",
      entryDateTime: "2026-02-01T00:00", entryAssetPrice: 2_000, amount: 8_000, timestamp: "2026-02-01T00:00:00.000Z",
    }, [{ sourcePositionId: "parent" }]);
    expect(result.position.funding).toMatchObject({ entryCapital: 8_000, recycledCashbackCapital: 5_000, freshExternalCapital: 3_000 });
    expect(trackerAllAssetsSummary(result.state).totalInvested).toBe(13_000);
    expect(trackerAssetSummary(result.state.positions, "ETH", 2_000, result.state.cashbackTranches).actualTotalWealth).toBe(13_000);
  });

  it("leaves excess Cashback available after funding only the required capital", () => {
    const parent = addTrackedPosition(createEmptyTrackerState(), {
      id: "parent", assetSymbol: "ETH", side: "long", product: "2.5x-cashback",
      entryDateTime: "2026-01-01T00:00", entryAssetPrice: 2_000, amount: 10, timestamp: "2026-01-01T00:00:00.000Z",
    }).state;
    const result = addTrackedPosition(parent, {
      id: "child", assetSymbol: "ETH", side: "short", product: "2x",
      entryDateTime: "2026-02-01T00:00", entryAssetPrice: 2_000, amount: 4_000, timestamp: "2026-02-01T00:00:00.000Z",
    }, [{ sourcePositionId: "parent" }]);
    expect(result.cashbackConsumed).toBe(4_000);
    expect(result.state.cashbackTranches[0].remainingNativeAmount).toBe(6_000);
    expect(trackerAssetSummary(result.state.positions, "ETH", 2_000, result.state.cashbackTranches).actualTotalWealth).toBe(20_000);
  });

  it("keeps spot Cashback in native units after partial deployment", () => {
    const parent = addTrackedPosition(createEmptyTrackerState(), {
      id: "spot-parent", assetSymbol: "ETH", side: "long", product: "2.5x-cashback", cashbackRouting: "spot",
      entryDateTime: "2026-01-01T00:00", entryAssetPrice: 1_000, amount: 4, timestamp: "2026-01-01T00:00:00.000Z",
    }).state;
    const result = addTrackedPosition(parent, {
      id: "child", assetSymbol: "ETH", side: "short", product: "2x",
      entryDateTime: "2026-02-01T00:00", entryAssetPrice: 1_000, amount: 500, timestamp: "2026-02-01T00:00:00.000Z",
    }, [{ sourcePositionId: "spot-parent", spotAssetPrice: 1_000 }]);
    expect(result.state.cashbackTranches[0]).toMatchObject({ originalNativeAmount: 2, deployedNativeAmount: .5, remainingNativeAmount: 1.5 });
    expect(trackerCashbackAtPrice(result.state.positions[0], 3_000, result.state.cashbackTranches)).toBe(4_500);
  });

  it("supports recursive Cashback funding but never lets a position fund itself", () => {
    let state = addTrackedPosition(createEmptyTrackerState(), {
      id: "a", assetSymbol: "ETH", side: "short", product: "2.5x-cashback",
      entryDateTime: "2026-01-01T00:00", entryAssetPrice: 2_000, amount: 10_000, timestamp: "2026-01-01T00:00:00.000Z",
    }).state;
    expect(state.positions[0].funding.freshExternalCapital).toBe(10_000);
    expect(state.cashbackTranches[0].remainingNativeAmount).toBe(5_000);
    state = addTrackedPosition(state, {
      id: "b", assetSymbol: "ETH", side: "short", product: "2.5x-cashback",
      entryDateTime: "2026-02-01T00:00", entryAssetPrice: 2_000, amount: 5_000, timestamp: "2026-02-01T00:00:00.000Z",
    }, [{ sourcePositionId: "a" }]).state;
    const result = addTrackedPosition(state, {
      id: "c", assetSymbol: "ETH", side: "short", product: "2x",
      entryDateTime: "2026-03-01T00:00", entryAssetPrice: 2_000, amount: 2_500, timestamp: "2026-03-01T00:00:00.000Z",
    }, [{ sourcePositionId: "b" }]);
    expect(result.transactions[0].sourcePositionId).toBe("b");
    expect(trackerAllAssetsSummary(result.state).totalInvested).toBe(10_000);
    expect(trackerAssetSummary(result.state.positions, "ETH", 2_000, result.state.cashbackTranches).actualTotalWealth).toBe(10_000);
  });

  it("uses selected Cashback sources in the exact order supplied", () => {
    let state = createEmptyTrackerState();
    state = addTrackedPosition(state, {
      id: "other", assetSymbol: "BTC", side: "short", product: "2.5x-cashback", cashbackRouting: "spot",
      entryDateTime: "2026-01-01T00:00", entryAssetPrice: 40_000, amount: 4_000, timestamp: "2026-01-01T00:00:00.000Z",
    }).state;
    state = addTrackedPosition(state, {
      id: "cash", assetSymbol: "ETH", side: "short", product: "2.5x-cashback", cashbackRouting: "cash",
      entryDateTime: "2026-01-02T00:00", entryAssetPrice: 2_000, amount: 4_000, timestamp: "2026-01-02T00:00:00.000Z",
    }).state;
    state = addTrackedPosition(state, {
      id: "same", assetSymbol: "ETH", side: "short", product: "2.5x-cashback", cashbackRouting: "spot",
      entryDateTime: "2026-01-03T00:00", entryAssetPrice: 2_000, amount: 4_000, timestamp: "2026-01-03T00:00:00.000Z",
    }).state;
    state = { ...state, currentPrices: { BTC: 40_000, ETH: 2_000 } };
    const result = addTrackedPosition(state, {
      id: "target", assetSymbol: "ETH", side: "long", product: "2x",
      entryDateTime: "2026-02-01T00:00", entryAssetPrice: 2_000, amount: 1.5, timestamp: "2026-02-01T00:00:00.000Z",
    }, [{ sourcePositionId: "same", spotAssetPrice: 2_000 }, { sourcePositionId: "cash" }]);
    expect(result.transactions.map((transaction) => transaction.sourcePositionId)).toEqual(["same", "cash"]);
    expect(result.transactions.map((transaction) => transaction.usdValue)).toEqual([2_000, 1_000]);
  });

  it("charges multiple Cashback sources to their own curves without duplicating combined wealth", () => {
    let state = createEmptyTrackerState();
    state = addTrackedPosition(state, {
      id: "cash-source", assetSymbol: "ETH", side: "short", product: "2.5x-cashback", cashbackRouting: "cash",
      entryDateTime: "2026-01-01T00:00", entryAssetPrice: 1_000, amount: 4_000, timestamp: "2026-01-01T00:00:00.000Z",
    }).state;
    state = addTrackedPosition(state, {
      id: "spot-source", assetSymbol: "ETH", side: "short", product: "2.5x-cashback", cashbackRouting: "spot",
      entryDateTime: "2026-01-02T00:00", entryAssetPrice: 1_000, amount: 4_000, timestamp: "2026-01-02T00:00:00.000Z",
    }).state;
    const funded = addTrackedPosition(state, {
      id: "funded", assetSymbol: "ETH", side: "short", product: "2x",
      entryDateTime: "2026-02-01T00:00", entryAssetPrice: 1_000, amount: 3_000, timestamp: "2026-02-01T00:00:00.000Z",
    }, [{ sourcePositionId: "cash-source" }, { sourcePositionId: "spot-source", spotAssetPrice: 1_000 }]);

    expect(funded.transactions.map((transaction) => transaction.sourcePositionId)).toEqual(["cash-source", "spot-source"]);
    expect(funded.transactions.map((transaction) => transaction.nativeAmountConsumed)).toEqual([2_000, 1]);
    expect(funded.transactions.map((transaction) => transaction.sourceAssetPrice)).toEqual([null, 1_000]);
    const current = buildTrackerCurve(funded.state.positions, 1_000, "total", 0, 0, 1, funded.state.cashbackTranches)[0];
    expect(current.positions["cash-source"].cashback).toBe(0);
    expect(current.positions["spot-source"].cashback).toBe(1_000);
    expect(current.positions.funded.cashback).toBe(0);
    expect(current.cashback).toBe(1_000);
    expect(current.actualV4).toBe(7_000);
    expect(current.combinedActual).toBe(8_000);
    expect(trackerAllAssetsSummary(funded.state).totalInvested).toBe(8_000);

    const triplePrice = buildTrackerCurve(funded.state.positions, 1_000, "total", 200, 200, 1, funded.state.cashbackTranches)[0];
    expect(triplePrice.positions["cash-source"].cashback).toBe(0);
    expect(triplePrice.positions["spot-source"].cashback).toBe(3_000);

    const refunded = deleteTrackedPosition(funded.state, "funded");
    const refundedTriplePrice = buildTrackerCurve(refunded.positions, 1_000, "total", 200, 200, 1, refunded.cashbackTranches)[0];
    expect(refundedTriplePrice.positions["cash-source"].cashback).toBe(2_000);
    expect(refundedTriplePrice.positions["spot-source"].cashback).toBe(6_000);
    expect(refundedTriplePrice.cashback).toBe(8_000);
  });

  it("requires an explicit sale price for selected Spot Cashback", () => {
    const state = addTrackedPosition(createEmptyTrackerState(), {
      id: "btc", assetSymbol: "BTC", side: "short", product: "2.5x-cashback", cashbackRouting: "spot",
      entryDateTime: "2026-01-01T00:00", entryAssetPrice: 40_000, amount: 4_000, timestamp: "2026-01-01T00:00:00.000Z",
    }).state;
    expect(() => addTrackedPosition(state, {
      id: "eth", assetSymbol: "ETH", side: "long", product: "2x",
      entryDateTime: "2026-02-01T00:00", entryAssetPrice: 2_000, amount: 1, timestamp: "2026-02-01T00:00:00.000Z",
    }, [{ sourcePositionId: "btc" }])).toThrow(/BTC sale price/);
  });

  it("persists the selected Spot Cashback execution price and native balance", () => {
    const parent = addTrackedPosition(createEmptyTrackerState(), {
      id: "spot-parent", assetSymbol: "ETH", side: "short", product: "2.5x-cashback", cashbackRouting: "spot",
      entryDateTime: "2026-01-01T00:00", entryAssetPrice: 1_000, amount: 4_000, timestamp: "2026-01-01T00:00:00.000Z",
    }).state;
    const funded = addTrackedPosition(parent, {
      id: "child", assetSymbol: "ETH", side: "short", product: "2x",
      entryDateTime: "2026-02-01T00:00", entryAssetPrice: 1_250, amount: 625, timestamp: "2026-02-01T00:00:00.000Z",
    }, [{ sourcePositionId: "spot-parent", spotAssetPrice: 1_250 }]).state;
    const loaded = normaliseTrackerState(JSON.parse(JSON.stringify(funded)));
    expect(loaded.fundingTransactions[0]).toMatchObject({ sourcePositionId: "spot-parent", nativeAmountConsumed: .5, usdValue: 625, sourceAssetPrice: 1_250 });
    expect(loaded.cashbackTranches[0]).toMatchObject({ originalNativeAmount: 2, remainingNativeAmount: 1.5, deployedNativeAmount: .5 });
  });

  it("returns consumed Cashback to the source when a funded position is deleted", () => {
    let state = addTrackedPosition(createEmptyTrackerState(), {
      id: "parent", assetSymbol: "ETH", side: "short", product: "2.5x-cashback",
      entryDateTime: "2026-01-01T00:00", entryAssetPrice: 2_000, amount: 10_000, timestamp: "2026-01-01T00:00:00.000Z",
    }).state;
    state = addTrackedPosition(state, {
      id: "child", assetSymbol: "ETH", side: "short", product: "2x",
      entryDateTime: "2026-02-01T00:00", entryAssetPrice: 2_000, amount: 5_000, timestamp: "2026-02-01T00:00:00.000Z",
    }, [{ sourcePositionId: "parent" }]).state;
    const deleted = deleteTrackedPosition(state, "child");
    expect(deleted.positions.map((position) => position.id)).toEqual(["parent"]);
    expect(deleted.cashbackTranches[0]).toMatchObject({ remainingNativeAmount: 5_000, deployedNativeAmount: 0, deployedUsdAmount: 0 });
    expect(deleted.fundingTransactions).toEqual([]);
    expect(trackerAllAssetsSummary(deleted).totalInvested).toBe(10_000);
  });

  it("keeps a funded position valid by replacing deleted source Cashback with fresh capital", () => {
    let state = addTrackedPosition(createEmptyTrackerState(), {
      id: "parent", assetSymbol: "ETH", side: "short", product: "2.5x-cashback",
      entryDateTime: "2026-01-01T00:00", entryAssetPrice: 2_000, amount: 10_000, timestamp: "2026-01-01T00:00:00.000Z",
    }).state;
    state = addTrackedPosition(state, {
      id: "child", assetSymbol: "ETH", side: "short", product: "2x",
      entryDateTime: "2026-02-01T00:00", entryAssetPrice: 2_000, amount: 5_000, timestamp: "2026-02-01T00:00:00.000Z",
    }, [{ sourcePositionId: "parent" }]).state;
    const deleted = deleteTrackedPosition(state, "parent");
    expect(deleted.positions).toHaveLength(1);
    expect(deleted.positions[0]).toMatchObject({ id: "child", funding: { entryCapital: 5_000, recycledCashbackCapital: 0, freshExternalCapital: 5_000 } });
    expect(deleted.cashbackTranches).toEqual([]);
    expect(deleted.fundingTransactions).toEqual([]);
    expect(trackerAllAssetsSummary(deleted).totalInvested).toBe(5_000);
  });

  it("refunds spot Cashback in native units so the remaining curve stays price-sensitive", () => {
    let state = addTrackedPosition(createEmptyTrackerState(), {
      id: "parent", assetSymbol: "ETH", side: "long", product: "2.5x-cashback", cashbackRouting: "spot",
      entryDateTime: "2026-01-01T00:00", entryAssetPrice: 1_000, amount: 4, timestamp: "2026-01-01T00:00:00.000Z",
    }).state;
    state = addTrackedPosition(state, {
      id: "child", assetSymbol: "ETH", side: "short", product: "2x",
      entryDateTime: "2026-02-01T00:00", entryAssetPrice: 1_000, amount: 500, timestamp: "2026-02-01T00:00:00.000Z",
    }, [{ sourcePositionId: "parent", spotAssetPrice: 1_000 }]).state;
    const deleted = deleteTrackedPosition(state, "child");
    expect(deleted.cashbackTranches[0]).toMatchObject({ originalNativeAmount: 2, remainingNativeAmount: 2, deployedNativeAmount: 0 });
    expect(trackerCashbackAtPrice(deleted.positions[0], 3_000, deleted.cashbackTranches)).toBe(6_000);
  });

  it("detaches Cashback links before an economic correction", () => {
    let state = addTrackedPosition(createEmptyTrackerState(), {
      id: "parent", assetSymbol: "ETH", side: "short", product: "2.5x-cashback",
      entryDateTime: "2026-01-01T00:00", entryAssetPrice: 2_000, amount: 10_000, timestamp: "2026-01-01T00:00:00.000Z",
    }).state;
    state = addTrackedPosition(state, {
      id: "child", assetSymbol: "ETH", side: "short", product: "2x",
      entryDateTime: "2026-02-01T00:00", entryAssetPrice: 2_000, amount: 5_000, timestamp: "2026-02-01T00:00:00.000Z",
    }, [{ sourcePositionId: "parent" }]).state;
    const corrected = correctTrackedPosition(state, "parent", { side: "short", product: "2.5x-cashback", cashbackRouting: "cash", entryDateTime: "2026-01-01T00:00", entryAssetPrice: 2_000, amount: 9_000 }, "2026-04-01T00:00:00.000Z");
    expect(corrected.positions.find((position) => position.id === "child")?.funding).toMatchObject({ recycledCashbackCapital: 0, freshExternalCapital: 5_000 });
    expect(corrected.cashbackTranches).toHaveLength(1);
    expect(corrected.cashbackTranches[0]).toMatchObject({ sourcePositionId: "parent", remainingNativeAmount: 4_500, deployedUsdAmount: 0 });
    expect(corrected.fundingTransactions).toEqual([]);
  });
});
