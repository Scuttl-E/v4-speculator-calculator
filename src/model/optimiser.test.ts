import { describe, expect, it } from "vitest";
import {
  optimisePortfolio,
  optimisePortfolioWithCashbackFrontier,
  optimisePortfolioWithOutcome,
  supportedOptimiserMaxLtv,
  targetPercentToPrice,
} from "./optimiser";
import {
  findWorstDrawdown,
  dollarValue,
  portfolioValue,
} from "./v4Math";
import { debtPositionValue } from "./debtPosition";
import { perpPositionValue } from "./perpPosition";
import type {
  CashbackMode,
  Config,
  Objective,
  OptimiseOptions,
} from "./types";

const base: OptimiseOptions = {
  maxDrawdown: 0.5,
  maxLtv: 0.51,
  objective: "bullish",
  spotParityPercent: 100,
  debtParityPercent: 50,
  perpParityPercent: 50,
  debtPosition: { assetPrice: 4000, assetAmount: 20, usdDebt: 15000, liquidationLtv: 0.9 },
  perpPosition: {
    assetPrice: 1900,
    averageEntryPrice: 1500,
    positionSize: 20,
    margin: 10000,
    liquidationPrice: 1100,
    side: "long",
  },
  cashbackMode: "spot",
  requireBreakeven: false,
  downsideBreakevenPercent: -80,
  upsideBreakevenPercent: 400,
  deposit: 10000,
};

function bestFeasibleValue(
  objective: Exclude<Objective, "spotParity" | "debtParity">,
  cashbackMode: CashbackMode = "spot",
) {
  const p = targetPercentToPrice(objective === "bullish" ? 200 : -75);
  let best = -Infinity;
  for (let allocation = 0; allocation <= 100; allocation++)
    for (const longLtv of [0.5, 0.51])
      for (const shortLtv of [0.5, 0.51]) {
        const config: Config = {
          deposit: 10000,
          longAllocation: allocation / 100,
          longLtv,
          shortLtv,
          cashbackMode,
        };
        if (
          findWorstDrawdown(config).drawdown >=
          -base.maxDrawdown - 1e-5
        )
          best = Math.max(best, portfolioValue(p, config));
      }
  const result = optimisePortfolio({
    ...base,
    objective,
    cashbackMode,
  });
  expect(portfolioValue(p, result)).toBeCloseTo(best, 10);
  return result;
}

describe("optimiser", () => {
  it("never exceeds the active drawdown and LTV constraints", () => {
    const result = optimisePortfolio({
      ...base,
      maxDrawdown: 0.1,
      maxLtv: 0.75,
    });
    expect(findWorstDrawdown(result).drawdown).toBeGreaterThanOrEqual(-0.10001);
    expect(result.longLtv).toBeLessThanOrEqual(0.75);
    expect(result.shortLtv).toBeLessThanOrEqual(0.75);
  });

  it("caps optimiser LTVs at the supported 80% maximum", () => {
    expect(supportedOptimiserMaxLtv(0.95)).toBe(0.8);
    expect(supportedOptimiserMaxLtv(0.75)).toBe(0.75);
  });

  it("respects independent long and short leverage limits", () => {
    const result = optimisePortfolio({
      ...base,
      maxLtv: 0.8,
      longMaxLtv: 0.55,
      shortMaxLtv: 0.65,
    });
    expect(result.longLtv).toBeLessThanOrEqual(0.55);
    expect(result.shortLtv).toBeLessThanOrEqual(0.65);
  });

  it("includes a fractional LTV terminal stop in the optimiser grid", () => {
    const fractionalMaxLtv = 0.5033;
    const result = optimisePortfolio({
      ...base,
      maxDrawdown: 1,
      maxLtv: fractionalMaxLtv,
      objective: "bullish",
    });
    expect(result.longLtv).toBe(fractionalMaxLtv);
  });

  it("maximises bullish exposure at the +200% scenario extreme", () => {
    bestFeasibleValue("bullish");
  });

  it("maximises bearish exposure at the -75% scenario extreme", () => {
    bestFeasibleValue("bearish");
  });

  it("minimises downside drawdown while matching spot at the parity target", () => {
    const downsideP = targetPercentToPrice(-75),
      parityP = targetPercentToPrice(100),
      impossibleDrawdownCap = 0;
    let bestDrawdown = -Infinity,
      bestDownsideValue = -Infinity;
    for (let allocation = 0; allocation <= 100; allocation++)
      for (const longLtv of [0.5, 0.51])
        for (const shortLtv of [0.5, 0.51]) {
          const config: Config = {
            deposit: 10000,
            longAllocation: allocation / 100,
            longLtv,
            shortLtv,
            cashbackMode: "spot",
          };
          const trough = findWorstDrawdown(config);
          if (portfolioValue(parityP, config) < parityP - 1e-10)
            continue;
          const downsideValue = portfolioValue(downsideP, config);
          if (
            trough.drawdown > bestDrawdown + 1e-12 ||
            (Math.abs(trough.drawdown - bestDrawdown) <= 1e-12 &&
              downsideValue > bestDownsideValue)
          ) {
            bestDrawdown = trough.drawdown;
            bestDownsideValue = downsideValue;
          }
        }
    const result = optimisePortfolio({
      ...base,
      objective: "spotParity",
      maxDrawdown: impossibleDrawdownCap,
    });
    expect(portfolioValue(parityP, result)).toBeGreaterThanOrEqual(
      parityP - 1e-10,
    );
    expect(findWorstDrawdown(result).drawdown).toBeCloseTo(bestDrawdown, 10);
    expect(portfolioValue(downsideP, result)).toBeCloseTo(
      bestDownsideValue,
      10,
    );
    expect(findWorstDrawdown(result).drawdown).toBeLessThan(0);
  });

  it("minimises drawdown while securing lending parity at the selected target", () => {
    const options = {
      ...base,
      objective: "debtParity" as const,
      debtParityPercent: 50,
      maxLtv: 0.75,
      deposit: 65000,
    };
    const outcome = optimisePortfolioWithOutcome(options);
    expect(outcome.config).not.toBeNull();
    expect(outcome.debtParity?.secured).toBe(true);
    const p = targetPercentToPrice(options.debtParityPercent);
    expect(dollarValue(p, outcome.config!)).toBeGreaterThanOrEqual(
      debtPositionValue(p, options.debtPosition),
    );
  });

  it("chooses the better cashback treatment when requested", () => {
    const options = {
      ...base,
      objective: "bullish" as const,
    };
    const result = optimisePortfolio({ ...options, cashbackMode: "optimise" });
    const cash = optimisePortfolio({ ...options, cashbackMode: "cash" });
    const spot = optimisePortfolio({ ...options, cashbackMode: "spot" });
    const p = targetPercentToPrice(200);
    expect(portfolioValue(p, result)).toBeCloseTo(
      Math.max(portfolioValue(p, cash), portfolioValue(p, spot)),
      10,
    );
    expect(["cash", "spot"]).toContain(result.cashbackMode);
  });

  it("minimises drawdown while securing perp parity at its independent target", () => {
    const options = {
      ...base,
      objective: "perpParity" as const,
      perpParityPercent: 25,
      maxLtv: 0.75,
      perpPosition: {
        ...base.perpPosition,
        positionSize: 5,
      },
      deposit: 12000,
    };
    const outcome = optimisePortfolioWithOutcome(options);
    expect(outcome.config).not.toBeNull();
    expect(outcome.perpParity?.secured).toBe(true);
    const p = targetPercentToPrice(options.perpParityPercent);
    expect(dollarValue(p, outcome.config!)).toBeGreaterThanOrEqual(
      perpPositionValue(p, options.perpPosition),
    );
  });

  it("builds both cashback frontiers without changing a forced cashback result", () => {
    const options = {
      ...base,
      objective: "bullish" as const,
      cashbackMode: "cash" as const,
    };
    const expected = optimisePortfolioWithOutcome(options);
    const analysed = optimisePortfolioWithCashbackFrontier(options);

    expect(analysed.outcome).toEqual(expected);
    expect(new Set(analysed.candidates.map(({ cashbackMode }) => cashbackMode)))
      .toEqual(new Set(["cash", "spot"]));
    expect(analysed.candidates.every(({ requiredDrawdown, targetPayoff }) =>
      Number.isFinite(requiredDrawdown) && Number.isFinite(targetPayoff)
    )).toBe(true);
  });

  it("relaxes drawdown to the smallest whole-percent limit for breakeven", () => {
    const outcome = optimisePortfolioWithOutcome({
      ...base,
      maxDrawdown: 0,
      requireBreakeven: true,
      downsideBreakevenPercent: -99,
    });
    expect(outcome.config).not.toBeNull();
    expect(outcome.drawdownRelaxed).toBe(true);
    expect(outcome.effectiveMaxDrawdown).toBeGreaterThan(0);
    expect(outcome.downsideBreakeven).not.toBeNull();
    expect((outcome.effectiveMaxDrawdown! * 100) % 1).toBeCloseTo(0, 10);
  });

  it("returns a clear outcome when breakeven cannot be found", () => {
    const outcome = optimisePortfolioWithOutcome({
      ...base,
      maxLtv: 0.49,
      requireBreakeven: true,
    });
    expect(outcome.config).toBeNull();
    expect(outcome.failure).toMatch(/No configuration/);
  });

  it("requires downside breakeven within the selected recovery horizon", () => {
    const withinSixty = optimisePortfolioWithOutcome({
      ...base,
      requireBreakeven: true,
      downsideBreakevenPercent: -60,
    });
    expect(withinSixty.config).not.toBeNull();
    expect(withinSixty.downsideBreakeven).toBeGreaterThanOrEqual(0.4);

    const withinForty = optimisePortfolioWithOutcome({
      ...base,
      requireBreakeven: true,
      downsideBreakevenPercent: -40,
    });
    expect(withinForty.config).toBeNull();
    expect(withinForty.failure).toMatch(/selected breakeven horizon/);
  });

  it("converts arbitrary targets to valid price ratios", () => {
    expect(targetPercentToPrice(400)).toBe(5);
    expect(targetPercentToPrice(-75)).toBe(0.25);
  });

  it("rejects targets that imply p <= 0", () => {
    expect(() => targetPercentToPrice(-100)).toThrow(/greater than -100/);
    expect(() => targetPercentToPrice(-125)).toThrow(/greater than -100/);
  });

  it("rejects invalid breakeven horizons", () => {
    expect(() =>
      optimisePortfolioWithOutcome({
        ...base,
        downsideBreakevenPercent: -100,
      }),
    ).toThrow(/Downside breakeven limit/);
    expect(() =>
      optimisePortfolioWithOutcome({ ...base, upsideBreakevenPercent: 0 }),
    ).toThrow(/Upside breakeven limit/);
    expect(() =>
      optimisePortfolioWithOutcome({ ...base, spotParityPercent: 0 }),
    ).toThrow(/Spot parity target/);
  });
});
