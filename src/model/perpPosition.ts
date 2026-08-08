export type PerpSide = "long" | "short";

export interface PerpPositionInput {
  assetPrice: number;
  averageEntryPrice: number;
  positionSize: number;
  margin: number;
  liquidationPrice: number;
  side: PerpSide;
}

export interface PerpPositionSummary {
  notional: number;
  unrealisedPnl: number;
  currentEquity: number;
  effectiveExposure: number | null;
  liquidationPriceRatio: number | null;
  liquidationAssetMove: number | null;
  liquidationOnUnexpectedSide: boolean;
}

export function perpPositionSummary(input: PerpPositionInput): PerpPositionSummary {
  const liquidationPriceRatio = input.assetPrice > 0 && input.liquidationPrice > 0
    ? input.liquidationPrice / input.assetPrice
    : null;
  const liquidationAssetMove = liquidationPriceRatio === null
    ? null
    : (liquidationPriceRatio - 1) * 100;
  const unrealisedPnl = input.side === "long"
    ? input.positionSize * (input.assetPrice - input.averageEntryPrice)
    : input.positionSize * (input.averageEntryPrice - input.assetPrice);
  const currentEquity = input.margin + unrealisedPnl;
  return {
    notional: input.assetPrice * input.positionSize,
    unrealisedPnl,
    currentEquity,
    effectiveExposure: currentEquity > 0
      ? (input.assetPrice * input.positionSize) / currentEquity
      : null,
    liquidationPriceRatio,
    liquidationAssetMove,
    liquidationOnUnexpectedSide:
      liquidationPriceRatio !== null &&
      (input.side === "long" ? liquidationPriceRatio >= 1 : liquidationPriceRatio <= 1),
  };
}

export function isPerpPositionLiquidated(priceRatio: number, input: PerpPositionInput) {
  const liquidationRatio = perpPositionSummary(input).liquidationPriceRatio;
  if (liquidationRatio === null) return false;
  return input.side === "long"
    ? priceRatio <= liquidationRatio
    : priceRatio >= liquidationRatio;
}

export function perpPositionValue(priceRatio: number, input: PerpPositionInput) {
  const futurePrice = input.assetPrice * priceRatio;
  const pnl = input.positionSize * (futurePrice - input.averageEntryPrice);
  return input.margin + (input.side === "long" ? pnl : -pnl);
}

export function perpPositionReturn(priceRatio: number, input: PerpPositionInput) {
  const { currentEquity } = perpPositionSummary(input);
  if (currentEquity <= 0) return null;
  return perpPositionValue(priceRatio, input) / currentEquity - 1;
}
