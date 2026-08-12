import type { AnalysisRange, CashbackMode, Config, LongV4Mode, ShortV4Mode, SupportedV4Ltv, Trough, V4ProductMode } from "./types";
export const MIN_V4_LTV = 0.5;
export const MAX_V4_LTV = 0.75;
export const peapodsLeverageFactor = (ltv: number) => 1 + 2 * ltv;
export const longLtvForMode = (mode: LongV4Mode): SupportedV4Ltv => mode === "2x" ? 0.5 : 0.75;
export const shortLtvForMode = (mode: ShortV4Mode): SupportedV4Ltv => mode === "2x" ? 0.5 : 0.75;
export const clampV4Ltv = (ltv:number) => ltv >= .625 ? .75 : .5;
export const payoffExponent = (ltv:number) => .5 / (1-ltv);
export const MAX_V4_PAYOFF_EXPONENT = payoffExponent(MAX_V4_LTV);
export const MAX_V4_LEVERAGE_FACTOR = peapodsLeverageFactor(MAX_V4_LTV);
export const longModeLabel = (mode: LongV4Mode) => mode === "2x" ? "50% LTV" : mode === "2.5x-cashback" ? "75% LTV Cashback" : "75% LTV";
export const shortModeLabel = (mode: ShortV4Mode) => longModeLabel(mode);
export const validP = (p: number) => Math.max(0.000001, p);

/**
 * A 2.5× long makes one 50% cash-out option. Cashback holds half outside the
 * rebalanced exposure; Looped retains that same half inside the protocol, so
 * the complete eligible Long follows the p² payoff. No fixed liability or
 * additional leverage layer is applied.
 */
export const longValue = (p: number, mode: LongV4Mode | number, routing: CashbackMode = "cash") => {
  if (typeof mode === "number") mode = mode >= .625 ? (routing === "spot" ? "2.5x-looped" : "2.5x-cashback") : "2x";
  p = validP(p);
  if (mode === "2x") return p;
  if (mode === "2.5x-cashback") return 0.5 * p ** 2 + 0.5 * (routing === "spot" ? p : 1);
  return p ** 2;
};
export const normaliseLongMode = (c: Config): LongV4Mode => c.longMode ?? (c.longLtv && c.longLtv >= .625 ? (c.cashOutEnabled === false || c.degenEnabled ? "2.5x-looped" : "2.5x-cashback") : "2x");
export const normaliseShortMode = (c: Config): ShortV4Mode => c.shortMode ?? (clampV4Ltv(c.shortLtv) === .75 ? "2.5x-looped" : "2x");
export const productCashOutRate = (mode: V4ProductMode) => mode === "2.5x-cashback" ? 0.5 : 0;
export const longCashOutRate = productCashOutRate;
/** Value of the capital still inside the Long product, normalised to that
 * product's own entry value. External Cashback is deliberately excluded. */
export const longPositionValue = (p: number, mode: LongV4Mode) => {
  p = validP(p);
  if (mode === "2x") return p;
  return p ** 2;
};
const shortRebalancedValue = (p: number, ltv: SupportedV4Ltv) => {
  p = validP(p); const m = 0.5 / (1 - ltv);
  return 0.5 + 0.5 * p + (0.5 * m) / p - 0.5 * m;
};
export const shortValue = (p: number, mode: ShortV4Mode | SupportedV4Ltv, routing: CashbackMode = "cash") => {
  if (typeof mode === "number") return shortRebalancedValue(p, mode);
  if (mode === "2x") return shortRebalancedValue(p, .5);
  const eligible = shortRebalancedValue(p, .75);
  if (mode === "2.5x-cashback") return .5 * eligible + .5 * (routing === "spot" ? validP(p) : 1);
  return eligible;
};
export const shortPositionValue = (p: number, mode: ShortV4Mode) => shortRebalancedValue(p, shortLtvForMode(mode));
export interface PortfolioComponents {
  long: number;
  short: number;
  cashOut: number;
  cashbackValue: number;
  insideV4: number;
  total: number;
}
export const portfolioComponents = (p: number, c: Config): PortfolioComponents => {
  p = validP(p);
  const longMode = normaliseLongMode(c);
  const shortMode = normaliseShortMode(c);
  const long = c.longAllocation * longValue(p, longMode, c.cashbackMode);
  const short = (1 - c.longAllocation) * shortValue(p, shortMode, c.cashbackMode);
  const cashOut = c.longAllocation * productCashOutRate(longMode) + (1 - c.longAllocation) * productCashOutRate(shortMode);
  const total = long + short;
  const cashbackValue = cashOut * (c.cashbackMode === "spot" ? p : 1);
  return { long, short, cashOut, cashbackValue, insideV4: total - cashbackValue, total };
};
export const portfolioValue = (p: number, c: Config) => portfolioComponents(p, c).total;
export const portfolioReturn = (p: number, c: Config) => portfolioValue(p, c) - 1;
export const dollarValue = (p: number, c: Config) => c.deposit * portfolioValue(p, c);
export const analysisRangeFromPercent = (minMovePercent: number, maxMovePercent: number): AnalysisRange => {
 const range={minPriceRatio:1+minMovePercent/100,maxPriceRatio:1+maxMovePercent/100}; assertAnalysisRange(range); return range;
};
export const analysisRangeToPercent=(range:AnalysisRange)=>({minMovePercent:(range.minPriceRatio-1)*100,maxMovePercent:(range.maxPriceRatio-1)*100});
const assertAnalysisRange=(range:AnalysisRange)=>{if(!Number.isFinite(range.minPriceRatio)||!Number.isFinite(range.maxPriceRatio))throw new RangeError("Analysis range must be finite");if(range.minPriceRatio<=0)throw new RangeError("Analysis minimum must be greater than -100%");if(range.minPriceRatio>=1||range.maxPriceRatio<=1)throw new RangeError("Analysis range must include moves below and above entry");if(range.maxPriceRatio<=range.minPriceRatio)throw new RangeError("Analysis maximum must be greater than its minimum");};
function findMinimumOnInterval(c:Config,minP:number,maxP:number):Trough { const samples:Array<{p:number;value:number}>=[];for(let i=0;i<=1200;i++){const p=minP+(maxP-minP)*i/1200;samples.push({p,value:portfolioValue(p,c)});}let best=samples.reduce((a,b)=>a.value<=b.value?a:b);for(let i=1;i<samples.length-1;i++){if(samples[i].value>samples[i-1].value||samples[i].value>samples[i+1].value)continue;let lo=samples[i-1].p,hi=samples[i+1].p;for(let j=0;j<45;j++){const a=(2*lo+hi)/3,b=(lo+2*hi)/3;if(portfolioValue(a,c)<portfolioValue(b,c))hi=b;else lo=a;}const p=(lo+hi)/2;const value=portfolioValue(p,c);if(value<best.value)best={p,value};}return {...best,drawdown:best.value-1}; }
export function findWorstDrawdown(c:Config,range:AnalysisRange):Trough {assertAnalysisRange(range);return findMinimumOnInterval(c,range.minPriceRatio,range.maxPriceRatio);}
/**
 * Risk limit for isolated V4 legs. Each active leg is assessed on its own
 * entry capital so profit in the opposing leg cannot conceal its drawdown.
 */
export function findWorstComponentDrawdown(c:Config,range:AnalysisRange):Trough {
  assertAnalysisRange(range);
  const troughs:Trough[]=[];
  if(c.longAllocation>1e-12) {
    const mode=normaliseLongMode(c);
    const p=range.minPriceRatio;
    const drawdown=c.longAllocation*(longPositionValue(p,mode)-1);
    troughs.push({p,value:1+drawdown,drawdown});
  }
  if(c.longAllocation<1-1e-12) {
    const mode=normaliseShortMode(c);
    const positionMode:ShortV4Mode=mode === "2.5x-cashback" ? "2.5x-looped" : mode;
    const shortTrough=findMinimumOnInterval({...c,longAllocation:0,shortMode:positionMode},range.minPriceRatio,range.maxPriceRatio);
    const drawdown=(1-c.longAllocation)*shortTrough.drawdown;
    troughs.push({p:shortTrough.p,value:1+drawdown,drawdown});
  }
  return troughs.reduce((worst,current)=>current.drawdown<worst.drawdown?current:worst);
}
export function findDownsideTrough(c:Config,minP=.01):Trough {if(!Number.isFinite(minP)||minP<=0||minP>=1)throw new RangeError("Downside trough minimum must be between zero and entry");return findMinimumOnInterval(c,minP,1);}
export function findDownsideBreakeven(c:Config,trough: Trough=findDownsideTrough(c)){let lastP=trough.p,last=portfolioValue(lastP,c)-1;for(let i=1;i<=4000;i++){const p=trough.p-(trough.p-.01)*i/4000,v=portfolioValue(p,c)-1;if(last<=0&&v>=0){let lo=p,hi=lastP;for(let j=0;j<40;j++){const mid=(lo+hi)/2;if(portfolioValue(mid,c)>=1)lo=mid;else hi=mid;}return(lo+hi)/2;}lastP=p;last=v;}return null;}
export function findUpsideBreakeven(c:Config,maxP=5){let lastP=1,last=0,hasDrawnDown=false;for(let i=1;i<=4000;i++){const p=1+(maxP-1)*i/4000,value=portfolioValue(p,c)-1;if(value<-1e-8)hasDrawnDown=true;if(hasDrawnDown&&last<=0&&value>=0){let lo=lastP,hi=p;for(let j=0;j<40;j++){const mid=(lo+hi)/2;if(portfolioValue(mid,c)<1)lo=mid;else hi=mid;}return(lo+hi)/2;}lastP=p;last=value;}return null;}
