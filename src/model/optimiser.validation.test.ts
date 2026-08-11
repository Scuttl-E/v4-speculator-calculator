import { describe, expect, it } from "vitest";
import { optimisePortfolioExhaustiveReference, optimisePortfolioWithOutcome } from "./optimiser";
import { allocationGrid } from "./optimiserSearch";
import { analysisRangeFromPercent } from "./v4Math";
import type { OptimiseOptions } from "./types";
const options: OptimiseOptions = { maxDrawdown:.15,maxLtv:.75,analysisRange:analysisRangeFromPercent(-80,200),objective:"bullish",spotParityPercent:50,debtParityPercent:50,perpParityPercent:50,debtPosition:{assetPrice:2000,assetAmount:20,usdDebt:15000,liquidationLtv:.85},perpPosition:{assetPrice:2000,averageEntryPrice:2500,positionSize:15,margin:25000,liquidationPrice:1200,side:"long"},requireBreakeven:false,downsideBreakevenPercent:-80,upsideBreakevenPercent:200,deposit:10000,degenEnabled:false,degenMode:"x1",customRecyclePct:0 };
describe("discrete optimiser verification",()=>{
  it("matches its exhaustive discrete reference",()=>expect(optimisePortfolioWithOutcome(options).config).toEqual(optimisePortfolioExhaustiveReference(options).config));
  it("always includes both allocation endpoints",()=>expect(allocationGrid(3)).toEqual(expect.arrayContaining([0,1])));
  it("is deterministic across repeated runs",()=>{
    const first=optimisePortfolioWithOutcome(options), second=optimisePortfolioWithOutcome(options);
    expect({status:first.status,config:first.config,parity:first.parity}).toEqual({status:second.status,config:second.config,parity:second.parity});
  });
});
