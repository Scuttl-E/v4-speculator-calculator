import type { LongV4Mode, SupportedV4Ltv } from "./types";
export interface SearchCandidate { longAllocation:number; longMode:LongV4Mode; shortLtv:SupportedV4Ltv; }
export interface SearchAssessment { eligible:boolean; quality:readonly number[]; boundaryDistances:readonly number[]; }
export interface OptimiserPassDiagnostics { resolutionPercent:number; candidatesConsidered:number; candidatesEvaluated:number; candidatesRejected:number; regionsAvailable:number; regionsRetained:number; regionsPruned:number; durationMs:number; }
export interface OptimiserSearchDiagnostics { strategy:"exhaustive"|"exhaustive-reference"; passes:OptimiserPassDiagnostics[]; candidatesConsidered:number; candidatesEvaluated:number; candidatesRejected:number; regionsPruned:number; durationMs:number; }
interface SearchInput { finalResolutionPercent:number; longModes?:readonly LongV4Mode[]; shortLtvs?:readonly SupportedV4Ltv[]; assess:(candidate:SearchCandidate)=>SearchAssessment; }
const now=()=>typeof performance==="undefined"?Date.now():performance.now();
const modes:LongV4Mode[]=["2x","2.5x-cashback","2.5x-looped"];
const shorts:SupportedV4Ltv[]=[0.5,0.75];
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
      for(const shortLtv of input.shortLtvs ?? shorts){
        considered++;
        if(!input.assess({longAllocation,longMode,shortLtv}).eligible)rejected++;
      }
  const pass={resolutionPercent:input.finalResolutionPercent,candidatesConsidered:considered,candidatesEvaluated:considered,candidatesRejected:rejected,regionsAvailable:considered,regionsRetained:considered-rejected,regionsPruned:0,durationMs:now()-at};
  return {strategy:reference?"exhaustive-reference":"exhaustive",passes:[pass],candidatesConsidered:considered,candidatesEvaluated:considered,candidatesRejected:rejected,regionsPruned:0,durationMs:now()-started};
}
export const runExhaustiveSearch=(input:SearchInput)=>run(input,false);
export const runExhaustiveReferenceSearch=(input:SearchInput)=>run(input,true);
