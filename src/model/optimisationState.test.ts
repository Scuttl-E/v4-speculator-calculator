import { describe, expect, it } from "vitest";
import {
  createOptimisationSignature,
  OPTIMISER_STATE_MODEL_VERSION,
  restorePassivePresetResult,
  type SuccessfulOptimisationResult,
} from "./optimisationState";
import { analysisRangeFromPercent } from "./v4Math";
import type { OptimiseOptions } from "./types";
const options: OptimiseOptions = { maxDrawdown:.15,maxLtv:.75,analysisRange:analysisRangeFromPercent(-80,200),objective:"bullish",spotParityPercent:50,debtParityPercent:50,perpParityPercent:50,debtPosition:{assetPrice:2000,assetAmount:20,usdDebt:15000,liquidationLtv:.85},perpPosition:{assetPrice:2000,averageEntryPrice:2500,positionSize:15,margin:25000,liquidationPrice:1200,side:"long"},requireBreakeven:false,downsideBreakevenPercent:-80,upsideBreakevenPercent:200,deposit:10000,degenEnabled:false,degenMode:"x1",customRecyclePct:0 };
describe("optimiser result state",()=>{it("versions the discrete product model and ignores retired Degen controls",()=>{expect(OPTIMISER_STATE_MODEL_VERSION).toContain("discrete-products");expect(createOptimisationSignature(options)).toBe(createOptimisationSignature({...options,degenEnabled:true,degenMode:"max",customRecyclePct:99}));});it("invalidates results for Cashback policy, routing and leverage changes",()=>{const signature=createOptimisationSignature({...options,cashbackPolicy:"auto",cashbackRouting:"auto",longMaxLtv:.75,shortMaxLtv:.75});expect(createOptimisationSignature({...options,cashbackPolicy:"forced",cashbackRouting:"auto",longMaxLtv:.75,shortMaxLtv:.75})).not.toBe(signature);expect(createOptimisationSignature({...options,cashbackPolicy:"auto",cashbackRouting:"cash",longMaxLtv:.75,shortMaxLtv:.75})).not.toBe(signature);expect(createOptimisationSignature({...options,cashbackPolicy:"auto",cashbackRouting:"auto",longMaxLtv:.5,shortMaxLtv:.75})).not.toBe(signature);expect(createOptimisationSignature({...options,cashbackPolicy:"auto",cashbackRouting:"auto",longMaxLtv:.75,shortMaxLtv:.5})).not.toBe(signature);});});

const snapshot = (snapshotOptions: OptimiseOptions): SuccessfulOptimisationResult => ({
  signature: createOptimisationSignature(snapshotOptions),
  options: snapshotOptions,
  inputs: {},
  result: {} as SuccessfulOptimisationResult["result"],
  outcome: {} as SuccessfulOptimisationResult["outcome"],
  productRoutingDecision: null,
  objectiveAnalysis: null,
  baseAssetValue: 0,
});

describe("passive preset restoration", () => {
  it("switches to an exact shipped objective preset", () => {
    const bullish = snapshot(options);
    const bearishOptions = { ...options, objective: "bearish" as const };
    const bearish = snapshot(bearishOptions);
    const cache = new Map([
      [bullish.signature, bullish],
      [bearish.signature, bearish],
    ]);
    const presetSignatures = new Set(cache.keys());

    expect(restorePassivePresetResult(
      bullish,
      cache,
      presetSignatures,
      bearish.signature,
      "base",
    )).toBe(bearish);
  });

  it("keeps the current chart stale for an ordinary cached control change", () => {
    const bullish = snapshot(options);
    const changed = snapshot({ ...options, maxDrawdown: 0.2 });
    const cache = new Map([
      [bullish.signature, bullish],
      [changed.signature, changed],
    ]);

    expect(restorePassivePresetResult(
      bullish,
      cache,
      new Set([bullish.signature]),
      changed.signature,
      "base",
    )).toBe(bullish);
  });

  it("becomes current again when controls return to the displayed signature", () => {
    const bullish = snapshot(options);

    expect(restorePassivePresetResult(
      bullish,
      new Map([[bullish.signature, bullish]]),
      new Set(),
      bullish.signature,
      "base",
    )).toBe(bullish);
  });
});
