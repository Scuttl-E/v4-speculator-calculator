import type { CashbackMode, LongV4Mode, ShortV4Mode } from "./types";
export interface SearchCandidate { longAllocation:number; longMode:LongV4Mode; shortMode:ShortV4Mode; cashbackMode:CashbackMode; }
export interface SearchAssessment { eligible:boolean; quality:readonly number[]; boundaryDistances:readonly number[]; }
export interface OptimiserPassDiagnostics { resolutionPercent:number; candidatesConsidered:number; candidatesEvaluated:number; candidatesRejected:number; regionsAvailable:number; regionsRetained:number; regionsPruned:number; durationMs:number; }
export interface OptimiserSearchDiagnostics { strategy:"exhaustive"|"exhaustive-reference"; passes:OptimiserPassDiagnostics[]; candidatesConsidered:number; candidatesEvaluated:number; candidatesRejected:number; regionsPruned:number; durationMs:number; }
interface SearchInput { finalResolutionPercent:number; longModes?:readonly LongV4Mode[]; shortModes?:readonly ShortV4Mode[]; cashbackModes?:readonly CashbackMode[]; assess:(candidate:SearchCandidate)=>SearchAssessment; }
const now=()=>typeof performance==="undefined"?Date.now():performance.now();
const modes:LongV4Mode[]=["2x","2.5x-cashback","2.5x-looped"];
const shorts:ShortV4Mode[]=["2x","2.5x-cashback","2.5x-looped"];
export const allocationGrid = (step:number) => {
  const values = new Set<number>([0, 1]);
  for (let percent = step; percent < 100; percent += step)
    values.add(+Math.min(1, percent / 100).toFixed(10));
  return [...values].sort((a, b) => a - b);
};
function run(input:SearchInput, reference:boolean):OptimiserSearchDiagnostics {
  const started=now(), at=now();
  let considered=0,rejected=0;
  for(const longAllocation of allocationGrid(input.finalResolutionPercent))
    for(const longMode of input.longModes ?? modes)
      for(const shortMode of input.shortModes ?? shorts)
        for(const cashbackMode of input.cashbackModes ?? ["cash"] as const){
          considered++;
          if(!input.assess({longAllocation,longMode,shortMode,cashbackMode}).eligible)rejected++;
        }
  const pass={resolutionPercent:input.finalResolutionPercent,candidatesConsidered:considered,candidatesEvaluated:considered,candidatesRejected:rejected,regionsAvailable:considered,regionsRetained:considered-rejected,regionsPruned:0,durationMs:now()-at};
  return {strategy:reference?"exhaustive-reference":"exhaustive",passes:[pass],candidatesConsidered:considered,candidatesEvaluated:considered,candidatesRejected:rejected,regionsPruned:0,durationMs:now()-started};
}
export const runExhaustiveSearch=(input:SearchInput)=>run(input,false);
export const runExhaustiveReferenceSearch=(input:SearchInput)=>run(input,true);
