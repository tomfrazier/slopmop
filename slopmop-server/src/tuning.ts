import { applyWeights, TELL_IDS, type Weights } from "./weights.js";
import type { Dimension } from "./jev.js";
import { auc, fit, round2 } from "./tuningFit.js";

export { auc } from "./tuningFit.js";

/**
 * Suggests tell weights from what the community said. This only ever *suggests*: nothing here changes the live weights.
 * For each tell it measures how well that tell alone separates posts people flagged ("probably") from ones they cleared
 * ("no") (an AUC), turns that into a target weight, and moves the current weights only part of the way toward it, more
 * as evidence accumulates. Honest limits: votes are noisy, installs are free to create, and the composite is later used
 * with thresholds fitted to the same votes, so treat a suggestion as a nudge to review, not an answer.
 */

export interface Example {
  dimensions: Record<string, Dimension>;
  /** true = the community's consensus is "probably" (slop); false = "no". */
  slop: boolean;
}

export interface Suggestion {
  ready: boolean;
  reason?: string;
  counts: { probably: number; no: number };
  perTell?: { id: string; /** 0-1, how well this tell alone separates slop from not slop */ power: number; current: number; suggested: number }[];
  suggested?: Weights;
  /** How well the whole composite separates the two groups, 0.5 = chance, 1 = perfect. */
  auc?: { current: number; suggested: number };
  /** The same measured on held-out votes (5-fold), which is the number to trust. */
  cv?: { current: number; suggested: number } | null;
}

/** Enough of each kind that a suggestion means something. */
export const MIN_PER_CLASS = 15;
/** Held-out check: fit on all folds but one, score the one left out. */
const CV_FOLDS = 5;

const compositeAuc = (examples: Example[], w: Weights) =>
  auc(examples.filter((x) => x.slop).map((x) => applyWeights(x.dimensions, w).tellMean), examples.filter((x) => !x.slop).map((x) => applyWeights(x.dimensions, w).tellMean));

export function suggestWeights(examples: Example[], current: Weights): Suggestion {
  const counts = { probably: examples.filter((x) => x.slop).length, no: examples.filter((x) => !x.slop).length };
  if (counts.probably < MIN_PER_CLASS || counts.no < MIN_PER_CLASS) {
    return { ready: false, counts, reason: `Not enough votes yet: need at least ${MIN_PER_CLASS} posts the community called "probably" and ${MIN_PER_CLASS} it called "no" (have ${counts.probably} and ${counts.no}).` };
  }
  const { suggested, power } = fit(examples, current);

  const folds = CV_FOLDS;
  const cur: number[] = [];
  const sug: number[] = [];
  for (let f = 0; f < folds; f++) {
    const train = examples.filter((_, i) => i % folds !== f);
    const test = examples.filter((_, i) => i % folds === f);
    const a = compositeAuc(test, current);
    const b = compositeAuc(test, fit(train, current).suggested);
    if (a !== null && b !== null) (cur.push(a), sug.push(b));
  }
  const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;

  return {
    ready: true,
    counts,
    suggested,
    perTell: TELL_IDS.map((id) => ({ id, power: round2(power[id]), current: current[id] ?? 1, suggested: suggested[id] })),
    auc: { current: round2(compositeAuc(examples, current) ?? 0.5), suggested: round2(compositeAuc(examples, suggested) ?? 0.5) },
    cv: cur.length ? { current: round2(mean(cur)), suggested: round2(mean(sug)) } : null,
  };
}
