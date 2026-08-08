export interface DebtPositionInput {
  ethPrice: number;
  ethAmount: number;
  usdDebt: number;
  liquidationLtv?: number;
}

export interface DebtPositionSummary {
  grossCollateral: number;
  netEquity: number;
  currentLtv: number | null;
  liquidationPrice: number | null;
  liquidationPriceRatio: number | null;
  liquidationAssetMove: number | null;
}

export const LIQUIDATION_LTV = 0.9;

export function debtPositionSummary(input: DebtPositionInput): DebtPositionSummary {
  const liquidationLtv = input.liquidationLtv ?? LIQUIDATION_LTV;
  const grossCollateral = input.ethPrice * input.ethAmount;
  const currentLtv = grossCollateral > 0 ? input.usdDebt / grossCollateral : null;
  const liquidationPrice = input.ethAmount > 0 && input.usdDebt > 0
    ? input.usdDebt / (liquidationLtv * input.ethAmount)
    : null;
  const liquidationPriceRatio = liquidationPrice !== null && input.ethPrice > 0
    ? liquidationPrice / input.ethPrice
    : null;
  return {
    grossCollateral,
    netEquity: grossCollateral - input.usdDebt,
    currentLtv,
    liquidationPrice,
    liquidationPriceRatio,
    liquidationAssetMove: liquidationPriceRatio === null
      ? null
      : (liquidationPriceRatio - 1) * 100,
  };
}

export function debtPositionValue(priceRatio: number, input: DebtPositionInput) {
  return input.ethAmount * input.ethPrice * priceRatio - input.usdDebt;
}

export function debtPositionReturn(priceRatio: number, input: DebtPositionInput) {
  const initialNetEquity = debtPositionSummary(input).netEquity;
  if (initialNetEquity <= 0) return null;
  return debtPositionValue(priceRatio, input) / initialNetEquity - 1;
}

export function isDebtPositionLiquidated(priceRatio: number, input: DebtPositionInput) {
  const liquidationLtv = input.liquidationLtv ?? LIQUIDATION_LTV;
  const collateralValue = input.ethAmount * input.ethPrice * priceRatio;
  return input.usdDebt > 0 && (collateralValue <= 0 || input.usdDebt / collateralValue >= liquidationLtv);
}
