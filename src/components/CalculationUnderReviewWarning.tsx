import type { ShortV4Mode } from "../model/types";

export const isShortCashbackUnderReview = (shortMode?: ShortV4Mode) =>
  shortMode === "2.5x-cashback";

export function CalculationUnderReviewWarning({ className = "" }: { className?: string }) {
  return (
    <small className={`calculation-under-review ${className}`.trim()} role="note">
      CAUTION: Short Cashback calculation may be incorrect — under review.
    </small>
  );
}
