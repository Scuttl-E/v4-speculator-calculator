import { describe, expect, it } from "vitest";
import { scenarioMoves, scenarioPriceRatios } from "./scenarioMoves";

describe("scenarioMoves", () => {
  it("keeps 0 in the middle with 4 values each side of a two-sided range", () => {
    expect(scenarioMoves(-80, 200)).toEqual([-80, -60, -40, -20, 0, 50, 100, 150, 200]);
  });

  it("puts 0 first and fills 8 upside values when the floor is 0", () => {
    expect(scenarioMoves(0, 200)).toEqual([0, 25, 50, 75, 100, 125, 150, 175, 200]);
  });

  it("puts 0 last and fills 8 downside values when the ceiling is 0", () => {
    expect(scenarioMoves(-80, 0)).toEqual([-80, -70, -60, -50, -40, -30, -20, -10, 0]);
  });

  it("does not inject 0 when the visible range is entirely positive", () => {
    expect(scenarioMoves(20, 200)).toHaveLength(9);
    expect(scenarioMoves(20, 200).every((move) => move >= 20)).toBe(true);
    expect(scenarioMoves(20, 200)).not.toContain(0);
  });

  it("never repeats 0 or exceeds 9 rows", () => {
    for (const [min, max] of [[0, 200], [-80, 0], [-80, 200], [0, 0], [-10, 10], [40, 80]]) {
      const moves = scenarioMoves(min, max);
      expect(moves.length).toBeLessThanOrEqual(9);
      expect(new Set(moves.map((move) => move.toFixed(8))).size).toBe(moves.length);
      expect(moves.filter((move) => move === 0).length).toBeLessThanOrEqual(1);
    }
  });

  it("maps percent moves to price ratios", () => {
    expect(scenarioPriceRatios(0, 200)).toEqual([1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3]);
  });
});
