import type { Dimension } from "./jev.js";
import { TELL_IDS, type Weights } from "./weights.js";

/**
 * The parts of the slop score that depend on more than Jev's tell answers: how much a personal voice takes off, and how much
 * the shield (usefulness plus reader response) takes off. The server works these out, so the multipliers on the two
 * counter-tells and the engagement model stay private, and a change to any of them reaches every client.
 */

/**
 * The arithmetic of the slop score, every number of it editable from the admin dashboard.
 * slop = tell mean x gain, less the human-voice offset x the human-voice counter-tell weight.
 * shield = usefulShare x usefulness (Jev) + the rest x reader response, never more than maxShield.
 * confidencePower: how much Jev's confidence in a tell counts toward that tell's weight (weight x confidence^power).
 */
export interface Formula {
  gain: number;
  humanOffset: number;
  usefulShare: number;
  maxShield: number;
  confidencePower: number;
}
export const DEFAULT_FORMULA: Formula = { gain: 2, humanOffset: 0.15, usefulShare: 0.5, maxShield: 0.6, confidencePower: 0.5 };
export const MAX_SHIELD = DEFAULT_FORMULA.maxShield;

/**
 * One sign of slop on its own is thin evidence: people write with a single over-the-top habit, on purpose and sincerely.
 * Slop shows as several signs at once. So a post is counted as corroborated only when at least `needed` tells each reach
 * `breakout` (with Jev at least `minConfidence` sure of them); with fewer, the slop score is multiplied by `alone`. Only a post
 * with some tell standing out but fewer than `needed` is cut: a post with none standing out is broad and mild, which is a
 * different (and legitimate) shape of slop, so it is left as it is.
 */
export interface Corroboration {
  breakout: number;
  minConfidence: number;
  needed: number;
  alone: number;
}

export const DEFAULT_CORROBORATION: Corroboration = { breakout: 0.5, minConfidence: 0.5, needed: 2, alone: 0.6 };

/** True when some tell stands out but too few to corroborate each other. */
export const alone = (standing: number, c: Corroboration): boolean => standing > 0 && standing < c.needed;

/** How many tells stand out (reach the breakout value with enough confidence behind them). */
export const breakouts = (dimensions: Record<string, Dimension>, c: Corroboration = DEFAULT_CORROBORATION): number =>
  TELL_IDS.filter((id) => dimensions[id] && dimensions[id].value >= c.breakout && dimensions[id].confidence >= c.minConfidence).length;

export interface EngagementCounts {
  reactions: number;
  comments: number;
  reposts: number;
}

/**
 * How reader response is measured. A comment costs a person minutes and a repost puts the post in front of the reposter's
 * whole network, so both count for far more than a one-tap reaction. Lots of reactions with almost no comments or reposts
 * is the shape of a pod or a cheap hook, so once a post has `hollowFrom` reactions, a comment-plus-repost rate under
 * `hollowRatio` scales its credit down, to no less than `hollowFloor`.
 */
export interface EngagementModel {
  reaction: number;
  comment: number;
  repost: number;
  hollowFrom: number;
  hollowRatio: number;
  hollowFloor: number;
  /** The weighted total at which reader response reaches 100% is 10 to this power. */
  logScale: number;
}

export const DEFAULT_ENGAGEMENT: EngagementModel = { reaction: 1, comment: 5, repost: 12, hollowFrom: 50, hollowRatio: 0.02, hollowFloor: 0.4, logScale: 4 };

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** 0-1: how strongly readers responded, with the hollow-engagement discount applied. */
export function engagementNorm(e: EngagementCounts | null, m: EngagementModel = DEFAULT_ENGAGEMENT): number {
  if (!e) return 0;
  const weighted = m.reaction * e.reactions + m.comment * e.comments + m.repost * e.reposts;
  const depth = e.reactions > 0 ? (e.comments + e.reposts) / e.reactions : 1;
  const credit = e.reactions >= m.hollowFrom && depth < m.hollowRatio ? Math.max(m.hollowFloor, depth / m.hollowRatio) : 1;
  return clamp01(Math.log10(1 + weighted * credit) / m.logScale);
}

export interface ScoreParts {
  /** Tell mean x gain minus the human-voice offset, 0-1. */
  slop: number;
  /** How much of the slop score the post's usefulness and reader response take off, 0 to MAX_SHIELD. */
  shield: number;
  /** The same from usefulness alone, for your own posts and drafts, which have no reader response to count. */
  usefulShield: number;
  /** Reader response, 0-1 (shown to the reader). */
  engagementNorm: number;
  /** How many tells stand out; fewer than `needed` (but at least one) and the slop score was cut by `alone`. */
  breakouts: number;
}

/** Every step of the server's half of the decision, so the admin can see how the pieces fit. `scoreParts` is the same, trimmed. */
export interface ScoreSteps {
  tellMean: number;
  /** tell mean x gain, less the human-voice offset x the human-voice counter-tell weight, kept between 0 and 1. */
  rawSlop: number;
  humanVoice: number;
  humanVoiceWeight: number;
  breakouts: number;
  /** True when some tell stood out but too few, so the slop score was cut. */
  cutAlone: boolean;
  slop: number;
  usefulness: number;
  usefulnessWeight: number;
  /** The usefulness share of the shield after the counter-tell weight (the rest is reader response). */
  share: number;
  readerResponse: number;
  /** Before the cap. */
  shieldUncapped: number;
  shield: number;
  /** The part of the shield that comes from usefulness alone (what your own post keeps, since nobody has reacted to a draft). */
  usefulShield: number;
}

/** The server's half of the decision, step by step. The counter-tell weights (1 = as designed) are read from `weights`. */
export function scoreSteps(input: { tellMean: number; dimensions: Record<string, Dimension>; engagement: EngagementCounts | null }, weights: Weights, model: EngagementModel, corroboration: Corroboration = DEFAULT_CORROBORATION, formula: Formula = DEFAULT_FORMULA): ScoreSteps {
  const human = input.dimensions.humanVoice?.value ?? 0;
  const useful = input.dimensions.usefulness?.value ?? 0;
  const humanWeight = weights.humanVoice ?? 1;
  const usefulWeight = weights.usefulness ?? 1;
  const standing = breakouts(input.dimensions, corroboration);
  const rawSlop = clamp01(input.tellMean * formula.gain - formula.humanOffset * humanWeight * human);
  const cut = alone(standing, corroboration);
  const share = clamp01(formula.usefulShare * usefulWeight);
  const reader = engagementNorm(input.engagement, model);
  const shieldUncapped = share * useful + (1 - share) * reader;
  return {
    tellMean: input.tellMean,
    rawSlop,
    humanVoice: human,
    humanVoiceWeight: humanWeight,
    breakouts: standing,
    cutAlone: cut,
    slop: cut ? rawSlop * corroboration.alone : rawSlop,
    usefulness: useful,
    usefulnessWeight: usefulWeight,
    share,
    readerResponse: reader,
    shieldUncapped,
    shield: Math.min(formula.maxShield, shieldUncapped),
    usefulShield: Math.min(formula.maxShield, share * useful),
  };
}

/** The server's half of the decision. The multipliers are the counter-tell weights (1 = as designed). */
export function scoreParts(input: { tellMean: number; dimensions: Record<string, Dimension>; engagement: EngagementCounts | null }, weights: Weights, model: EngagementModel, corroboration: Corroboration = DEFAULT_CORROBORATION, formula: Formula = DEFAULT_FORMULA): ScoreParts {
  const s = scoreSteps(input, weights, model, corroboration, formula);
  return { slop: s.slop, shield: s.shield, usefulShield: s.usefulShield, engagementNorm: s.readerResponse, breakouts: s.breakouts };
}
