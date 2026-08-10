import type { CashbackMode } from "./types";

export interface SearchCandidate {
  longAllocation: number;
  longLtv: number;
  shortLtv: number;
  cashbackMode: CashbackMode;
}

export interface SearchAssessment {
  eligible: boolean;
  /** Ordered, higher-is-better values using the objective's existing tie-breaks. */
  quality: readonly number[];
  /** Distances to active hard-constraint boundaries; lower is nearer. */
  boundaryDistances: readonly number[];
}

export interface OptimiserPassDiagnostics {
  resolutionPercent: number;
  candidatesConsidered: number;
  candidatesEvaluated: number;
  candidatesRejected: number;
  regionsAvailable: number;
  regionsRetained: number;
  regionsPruned: number;
  durationMs: number;
}

export interface OptimiserSearchDiagnostics {
  strategy: "coarse-to-fine" | "exhaustive-reference";
  passes: OptimiserPassDiagnostics[];
  candidatesConsidered: number;
  candidatesEvaluated: number;
  candidatesRejected: number;
  regionsPruned: number;
  durationMs: number;
}

interface AssessedCandidate {
  candidate: SearchCandidate;
  assessment: SearchAssessment;
}

interface SearchInput {
  longMaxLtv: number;
  shortMaxLtv: number;
  cashbackModes: readonly CashbackMode[];
  finalResolutionPercent: number;
  assess: (candidate: SearchCandidate) => SearchAssessment;
}

const now = () => typeof performance === "undefined" ? Date.now() : performance.now();

const steppedValues = (min: number, max: number, step: number) => {
  const values = Array.from(
    { length: Math.floor((max - min) / step + 1e-9) + 1 },
    (_, index) => +(min + index * step).toFixed(10),
  );
  if (Math.abs(values[values.length - 1] - max) > 1e-9) values.push(max);
  return values;
};

const stagesFor = (finalResolutionPercent: number) => {
  const stages = [5, 2, 1, finalResolutionPercent]
    .filter((step) => step + 1e-12 >= finalResolutionPercent)
    .sort((a, b) => b - a);
  return [...new Set(stages)];
};

const keyFor = (candidate: SearchCandidate) =>
  `${candidate.cashbackMode}|${candidate.longAllocation.toFixed(10)}|${candidate.longLtv.toFixed(10)}|${candidate.shortLtv.toFixed(10)}`;

const compareQuality = (a: AssessedCandidate, b: AssessedCandidate) => {
  const length = Math.max(a.assessment.quality.length, b.assessment.quality.length);
  for (let index = 0; index < length; index++) {
    const difference = (b.assessment.quality[index] ?? -Infinity) -
      (a.assessment.quality[index] ?? -Infinity);
    if (Math.abs(difference) > 1e-12) return difference;
  }
  return keyFor(a.candidate).localeCompare(keyFor(b.candidate));
};

const sameRegion = (a: SearchCandidate, b: SearchCandidate, radius: number) =>
  a.cashbackMode === b.cashbackMode &&
  Math.abs(a.longAllocation - b.longAllocation) <= radius + 1e-12 &&
  Math.abs(a.longLtv - b.longLtv) <= radius + 1e-12 &&
  Math.abs(a.shortLtv - b.shortLtv) <= radius + 1e-12;

function retainRegions(
  assessed: AssessedCandidate[],
  resolution: number,
  approximateGlobalCount: number,
  longMaxLtv: number,
  shortMaxLtv: number,
) {
  const beam = Math.min(
    48,
    Math.max(24, Math.ceil(Math.cbrt(approximateGlobalCount) * 2)),
  );
  const retained: AssessedCandidate[] = [];
  const addDistinct = (candidate: AssessedCandidate) => {
    if (!retained.some((current) =>
      sameRegion(current.candidate, candidate.candidate, resolution * 0.75)
    )) retained.push(candidate);
  };

  // Preserve several distinct objective basins for every discrete cashback mode.
  for (const cashbackMode of [...new Set(assessed.map(({ candidate }) => candidate.cashbackMode))]) {
    assessed
      .filter(({ candidate, assessment }) => candidate.cashbackMode === cashbackMode && assessment.eligible)
      .sort(compareQuality)
      .slice(0, beam)
      .forEach(addDistinct);
    // An infeasible coarse point can border a thin feasible region.
    assessed
      .filter(({ candidate, assessment }) => candidate.cashbackMode === cashbackMode && !assessment.eligible)
      .sort(compareQuality)
      .slice(0, Math.ceil(beam / 3))
      .forEach(addDistinct);
  }

  const boundaryCount = Math.max(
    0,
    ...assessed.map(({ assessment }) => assessment.boundaryDistances.length),
  );
  for (let boundary = 0; boundary < boundaryCount; boundary++) {
    assessed
      .filter(({ assessment }) => Number.isFinite(assessment.boundaryDistances[boundary]))
      .sort((a, b) => {
        const distance = a.assessment.boundaryDistances[boundary] -
          b.assessment.boundaryDistances[boundary];
        return Math.abs(distance) > 1e-12 ? distance : compareQuality(a, b);
      })
      .slice(0, Math.ceil(beam / 2))
      .forEach(addDistinct);
  }

  // Explicitly carry strong candidates from every min/max parameter-space face.
  const faces = [
    (c: SearchCandidate) => Math.abs(c.longAllocation) <= 1e-12,
    (c: SearchCandidate) => Math.abs(c.longAllocation - 1) <= 1e-12,
    (c: SearchCandidate) => Math.abs(c.longLtv - 0.5) <= 1e-12,
    (c: SearchCandidate) => Math.abs(c.longLtv - longMaxLtv) <= 1e-12,
    (c: SearchCandidate) => Math.abs(c.shortLtv - 0.5) <= 1e-12,
    (c: SearchCandidate) => Math.abs(c.shortLtv - shortMaxLtv) <= 1e-12,
  ];
  for (const cashbackMode of [...new Set(assessed.map(({ candidate }) => candidate.cashbackMode))])
    for (const onFace of faces)
      assessed
        .filter(({ candidate }) => candidate.cashbackMode === cashbackMode && onFace(candidate))
        .sort(compareQuality).slice(0, 2).forEach(addDistinct);

  return retained;
}

function runSearch(input: SearchInput, exhaustive: boolean): OptimiserSearchDiagnostics {
  const started = now();
  const stages = exhaustive ? [input.finalResolutionPercent] : stagesFor(input.finalResolutionPercent);
  const evaluatedKeys = new Set<string>();
  const passes: OptimiserPassDiagnostics[] = [];
  let regions: AssessedCandidate[] | null = null;
  let previousResolution = stages[0] / 100;

  for (let passIndex = 0; passIndex < stages.length; passIndex++) {
    const passStarted = now();
    const resolutionPercent = stages[passIndex];
    const resolution = resolutionPercent / 100;
    const allocations = steppedValues(0, 1, resolution);
    const longLtvs = steppedValues(0.5, input.longMaxLtv, resolution);
    const shortLtvs = steppedValues(0.5, input.shortMaxLtv, resolution);
    const approximateGlobalCount = allocations.length * longLtvs.length *
      shortLtvs.length * input.cashbackModes.length;
    const assessed: AssessedCandidate[] = [];
    let considered = 0;
    let rejected = 0;

    for (const cashbackMode of input.cashbackModes)
      for (const longAllocation of allocations)
        for (const longLtv of longLtvs)
          for (const shortLtv of shortLtvs) {
            const candidate = { longAllocation, longLtv, shortLtv, cashbackMode };
            if (regions && !regions.some((region) =>
              sameRegion(candidate, region.candidate, previousResolution + 1e-12)
            )) continue;
            considered++;
            const key = keyFor(candidate);
            if (evaluatedKeys.has(key)) continue;
            evaluatedKeys.add(key);
            const assessment = input.assess(candidate);
            if (!assessment.eligible) rejected++;
            assessed.push({ candidate, assessment });
          }

    const regionsAvailable = assessed.length;
    const isFinal = passIndex === stages.length - 1;
    const retained = isFinal ? [] : retainRegions(
      assessed,
      resolution,
      approximateGlobalCount,
      input.longMaxLtv,
      input.shortMaxLtv,
    );
    passes.push({
      resolutionPercent,
      candidatesConsidered: considered,
      candidatesEvaluated: assessed.length,
      candidatesRejected: rejected,
      regionsAvailable,
      regionsRetained: retained.length,
      regionsPruned: isFinal ? 0 : Math.max(0, regionsAvailable - retained.length),
      durationMs: now() - passStarted,
    });
    regions = retained;
    previousResolution = resolution;
  }

  return {
    strategy: exhaustive ? "exhaustive-reference" : "coarse-to-fine",
    passes,
    candidatesConsidered: passes.reduce((sum, pass) => sum + pass.candidatesConsidered, 0),
    candidatesEvaluated: passes.reduce((sum, pass) => sum + pass.candidatesEvaluated, 0),
    candidatesRejected: passes.reduce((sum, pass) => sum + pass.candidatesRejected, 0),
    regionsPruned: passes.reduce((sum, pass) => sum + pass.regionsPruned, 0),
    durationMs: now() - started,
  };
}

export const runCoarseToFineSearch = (input: SearchInput) => runSearch(input, false);

/** Reference-only path used by validation tests and benchmarks. */
export const runExhaustiveReferenceSearch = (input: SearchInput) => runSearch(input, true);
