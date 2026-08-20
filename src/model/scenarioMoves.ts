const SCENARIO_ROW_COUNT = 9;
const SCENARIO_SIDE_COUNT = 4;
const ZERO_EPSILON = 1e-9;

function isZeroMove(move: number) {
  return Math.abs(move) < ZERO_EPSILON;
}

function evenMoves(from: number, to: number, count: number) {
  if (count <= 1) return [isZeroMove(from) ? 0 : from];
  const span = to - from;
  if (Math.abs(span) < ZERO_EPSILON) return [isZeroMove(from) ? 0 : from];
  return Array.from({ length: count }, (_, index) => {
    const move = from + (span * index) / (count - 1);
    return isZeroMove(move) ? 0 : move;
  });
}

function uniqueMoves(moves: number[]) {
  const seen = new Set<string>();
  const unique: number[] = [];
  for (const move of moves) {
    const normalised = isZeroMove(move) ? 0 : move;
    const key = normalised.toFixed(8);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(normalised);
  }
  return unique;
}

export function scenarioMoves(minMove: number, maxMove: number): number[] {
  const lo = Math.min(minMove, maxMove);
  const hi = Math.max(minMove, maxMove);
  const hasDownside = lo < -ZERO_EPSILON;
  const hasUpside = hi > ZERO_EPSILON;

  const moves = hasDownside && hasUpside
    ? [
        ...evenMoves(lo, 0, SCENARIO_SIDE_COUNT + 1).slice(0, SCENARIO_SIDE_COUNT),
        0,
        ...evenMoves(0, hi, SCENARIO_SIDE_COUNT + 1).slice(1),
      ]
    : evenMoves(lo, hi, SCENARIO_ROW_COUNT);

  return uniqueMoves(moves);
}

export function scenarioPriceRatios(minMove: number, maxMove: number): number[] {
  return scenarioMoves(minMove, maxMove).map((move) => 1 + move / 100);
}
