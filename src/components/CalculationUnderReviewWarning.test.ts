import { describe, expect, it } from "vitest";
import { isShortCashbackUnderReview } from "./CalculationUnderReviewWarning";

describe("Short Cashback review warning", () => {
  it("only marks the Short Cashback product as under review", () => {
    expect(isShortCashbackUnderReview("2.5x-cashback")).toBe(true);
    expect(isShortCashbackUnderReview("2x")).toBe(false);
    expect(isShortCashbackUnderReview("2.5x-looped")).toBe(false);
    expect(isShortCashbackUnderReview()).toBe(false);
  });
});
