import type { Sensitivity } from "./types";

/**
 * Public defaults: every tell counts equally. The weights actually used in production are a private tuning result kept on
 * the server (TELL_WEIGHTS); it applies them and sends back `tellMean` / `tellRank`, so the extension never sees them.
 * These defaults are only used when a response has no server composite (answers saved by an older version) and as the
 * baseline for offline tuning, where you can pass your own weights (see `npm run tune`).
 */
export const WEIGHTS: Record<string, number> = {
  contrastFraming: 1,
  emptyEvaluation: 1,
  tradeoffFreePromises: 1,
  formalHedging: 1,
  hypeMarketing: 1,
  manneredProse: 1,
  formulaicHook: 1,
  manufacturedNarrative: 1,
  engagementBait: 1,
};

/**
 * PROVISIONAL, refitted on 2026-09-21 on the same 27 hand votes (7 probably / 11 maybe / 9 no) after the score changed: each
 * tell now counts for less the less sure Jev was of it, and a post needs two tells standing out (0.5 or more, Jev at least 0.5
 * sure) to be scored in full. That lowers scores, so the thresholds fell with them. Aggressive 0.10 catches 6 of 7 "probably"
 * votes for 1 false positive; Moderate 0.18 and Mild 0.22 flag no "no" vote (3 and 2 of 7 caught). Only 16 votes are decisive
 * and the fit has a cliff between 0.09 and 0.10, so treat these as a starting point: the live values are set on the server.
 */
export const THRESHOLDS: Record<Sensitivity, number> = {
  aggressive: 0.1,
  moderate: 0.18,
  mild: 0.22,
};

export const SLOP_GAIN = 2.0;
export const HUMAN_OFFSET = 0.15;
/**
 * How much a post that reads fully human-written has its score reduced (score x (1 - AI_DAMPEN x (1 - aiLikelihood)), so
 * 0.65 to 1). 0 = no effect, 1 = human writing could never be flagged. It is a tiebreaker, not a veto: hand-typed slop is
 * still slop, and a post Jev is sure a model wrote is not dampened at all.
 */
export const AI_DAMPEN = 0.35;
export const MAX_SHIELD = 0.6;
/**
 * One sign of slop on its own is thin evidence (people write with a single over-the-top habit, sincerely), so a post counts in
 * full only when `needed` tells each reach `breakout` with Jev at least `minConfidence` sure of them; with fewer, its slop
 * score is multiplied by `alone`. The server does this for real answers; these are its public defaults.
 */
export const CORROBORATION = { breakout: 0.5, minConfidence: 0.5, needed: 2, alone: 0.6 };
export const YELLOW_FRACTION = 0.6;
export const MIN_MEAN_CONFIDENCE = 0.25;

export interface Params {
  weights: Record<string, number>;
  thresholds: Record<Sensitivity, number>;
  gain: number;
  humanOffset: number;
  aiDampen: number;
  maxShield: number;
  corroboration: typeof CORROBORATION;
  yellowFraction: number;
  minMeanConfidence: number;
}

export const DEFAULT_PARAMS: Params = {
  weights: WEIGHTS,
  thresholds: THRESHOLDS,
  gain: SLOP_GAIN,
  humanOffset: HUMAN_OFFSET,
  aiDampen: AI_DAMPEN,
  maxShield: MAX_SHIELD,
  corroboration: CORROBORATION,
  yellowFraction: YELLOW_FRACTION,
  minMeanConfidence: MIN_MEAN_CONFIDENCE,
};
