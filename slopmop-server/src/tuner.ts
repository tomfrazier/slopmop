import type { Dimension } from "./jev.js";
import { engagementTotal } from "./recheck.js";
import { scoreParts, type EngagementCounts } from "./scoring.js";
import type { Scoring } from "./scoringStore.js";
import { applyWeights, TELL_IDS, type Weights } from "./weights.js";

/**
 * The admin's threshold tuner. It takes posts that have been labelled (by the admin, or the community's consensus), scores
 * each with exactly what production uses right now (the live weights, formula, engagement model, corroboration, dampener and
 * confidence gate), sweeps the "likely slop" threshold, and shows what each cut would catch and wrongly flag. It only
 * suggests. Nothing here changes a setting: the admin reads it, loads a suggestion into the Scoring card, and saves.
 */
export type Label = "no" | "maybe" | "probably";

export interface Example {
  label: Label;
  dimensions: Record<string, Dimension>;
  aiLikelihood: number;
  engagement: EngagementCounts | null;
}

/** Everything the score depends on, as production holds it. */
export interface Live {
  weights: Weights;
  scoring: Scoring;
  /** From the client manifest: the dampener strength and the average Jev confidence below which a post is left alone. */
  aiDampen: number;
  minMeanConfidence: number;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** The raw score production would give this post (0 when Jev wasn't confident enough to call it). */
export function scoreOf(ex: Example, live: Live): number {
  const { scoring } = live;
  const w = applyWeights(ex.dimensions, live.weights, scoring.formula.confidencePower);
  const present = TELL_IDS.filter((id) => ex.dimensions[id]);
  const meanConfidence = present.length ? present.reduce((s, id) => s + ex.dimensions[id].confidence, 0) / present.length : 0;
  if (meanConfidence < live.minMeanConfidence) return 0;
  const p = scoreParts({ tellMean: w.tellMean, dimensions: ex.dimensions, engagement: ex.engagement }, live.weights, scoring.engagement, scoring.corroboration, scoring.formula);
  return p.slop * (1 - p.shield) * (1 - live.aiDampen * (1 - clamp01(ex.aiLikelihood)));
}

export interface Confusion {
  threshold: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  precision: number;
  recall: number;
  f1: number;
}

interface Scored {
  label: Label;
  score: number;
}

/** "Probably" counts as slop and "no" as not slop; "maybe" is a genuine gray zone and stays out of the accuracy numbers. */
export function confusion(scored: Scored[], threshold: number): Confusion {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const s of scored) {
    if (s.label === "maybe") continue;
    const flagged = s.score >= threshold;
    if (s.label === "probably") flagged ? tp++ : fn++;
    else flagged ? fp++ : tn++;
  }
  const precision = tp + fp ? tp / (tp + fp) : 1;
  const recall = tp + fn ? tp / (tp + fn) : 1;
  return { threshold, tp, fp, fn, tn, precision, recall, f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0 };
}

export const SWEEP = { from: 0.02, to: 0.5, step: 0.01 };
const round2 = (n: number) => Math.round(n * 100) / 100;
export const sweep = (scored: Scored[]): Confusion[] => {
  const out: Confusion[] = [];
  for (let i = 0; SWEEP.from + i * SWEEP.step <= SWEEP.to + 1e-9; i++) out.push(confusion(scored, round2(SWEEP.from + i * SWEEP.step)));
  return out;
};

/** Aggressive still requires at least this share of what it flags to really be slop. */
const AGGRESSIVE_MIN_PRECISION = 0.6;
const saferOnTie = (a: Confusion, b: Confusion) => a.threshold > b.threshold;

export interface Pick {
  sensitivity: "aggressive" | "moderate" | "mild";
  threshold: number;
  why: string;
  at: Confusion;
}

/** Proposes the three thresholds. Needs both kinds of label to mean anything. */
export function suggest(scored: Scored[]): Pick[] | null {
  if (!scored.some((s) => s.label === "probably") || !scored.some((s) => s.label === "no")) return null;
  const rows = sweep(scored);
  const mild = rows.find((r) => r.fp === 0) ?? rows[rows.length - 1];
  const moderate = rows.reduce((best, r) => (r.f1 > best.f1 || (r.f1 === best.f1 && saferOnTie(r, best)) ? r : best));
  const precise = rows.filter((r) => r.precision >= AGGRESSIVE_MIN_PRECISION);
  const aggressive = (precise.length ? precise : rows).reduce((best, r) => (r.recall > best.recall || (r.recall === best.recall && saferOnTie(r, best)) ? r : best));
  // Sensitivity must stay ordered; independent picks can cross on small data.
  const aggressiveT = Math.min(aggressive.threshold, moderate.threshold);
  const mildT = Math.max(mild.threshold, moderate.threshold);
  const at = (t: number, fallback: Confusion) => (t === fallback.threshold ? fallback : confusion(scored, t));
  return [
    { sensitivity: "aggressive", threshold: aggressiveT, why: "most slop caught with at least 60% precision", at: at(aggressiveT, aggressive) },
    { sensitivity: "moderate", threshold: moderate.threshold, why: "best balance of catching slop and not flagging the rest (F1)", at: moderate },
    { sensitivity: "mild", threshold: mildT, why: "the lowest threshold that flags none of the posts labelled not slop", at: at(mildT, mild) },
  ];
}

/** A small seeded generator, so the same data always gives the same stability figures. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const BOOTSTRAP_RESAMPLES = 300;
/** A moderate threshold whose middle 80% across resamples spans no more than this is called stable. */
export const STABLE_SPREAD = 0.04;

export interface Stability {
  resamples: number;
  p10: number;
  median: number;
  p90: number;
  stable: boolean;
}

/** How much the suggested Moderate threshold would move if the labelled posts were drawn again (a bootstrap). */
export function stability(scored: Scored[], resamples = BOOTSTRAP_RESAMPLES): Stability | null {
  const decisive = scored.filter((s) => s.label !== "maybe");
  if (decisive.length < 4) return null;
  const rand = rng(decisive.length * 7919 + Math.round(decisive.reduce((s, x) => s + x.score, 0) * 1e6));
  const picks: number[] = [];
  for (let i = 0; i < resamples; i++) {
    const draw = Array.from({ length: decisive.length }, () => decisive[Math.floor(rand() * decisive.length)]);
    const s = suggest(draw);
    if (s) picks.push(s.find((p) => p.sensitivity === "moderate")!.threshold);
  }
  if (picks.length < resamples / 2) return null;
  picks.sort((a, b) => a - b);
  const q = (p: number) => picks[Math.min(picks.length - 1, Math.floor(p * picks.length))];
  const p10 = q(0.1), p90 = q(0.9);
  return { resamples: picks.length, p10, median: q(0.5), p90, stable: p90 - p10 <= STABLE_SPREAD };
}

export const MIN_PER_CLASS = 15;

export interface Analysis {
  counts: { probably: number; no: number; maybe: number };
  /** Total engagement of the labelled posts (0 means none of them had counts, so reader response wasn't exercised). */
  withEngagement: number;
  current: { sensitivity: "aggressive" | "moderate" | "mild"; threshold: number; at: Confusion }[];
  sweep: Confusion[];
  suggestion: Pick[] | null;
  stability: Stability | null;
  maybes: { total: number; flaggedAtModerate: number };
  warnings: string[];
}

/** Scores every example the way production does and analyses the thresholds. */
export function analyse(examples: Example[], live: Live): Analysis {
  const scored: Scored[] = examples.map((e) => ({ label: e.label, score: scoreOf(e, live) }));
  const count = (l: Label) => scored.filter((s) => s.label === l).length;
  const counts = { probably: count("probably"), no: count("no"), maybe: count("maybe") };
  const warnings: string[] = [];
  if (counts.probably < MIN_PER_CLASS || counts.no < MIN_PER_CLASS) warnings.push(`Only ${counts.probably} "probably" and ${counts.no} "no" labels. Aim for at least ${MIN_PER_CLASS} of each before trusting a suggestion.`);
  if (examples.every((e) => engagementTotal(e.engagement) === 0)) warnings.push("None of these posts has engagement counts, so reader response isn't being exercised.");
  const suggestion = suggest(scored);
  const moderateNow = live.scoring.thresholds.moderate;
  return {
    counts,
    withEngagement: examples.filter((e) => engagementTotal(e.engagement) > 0).length,
    current: (["aggressive", "moderate", "mild"] as const).map((s) => ({ sensitivity: s, threshold: live.scoring.thresholds[s], at: confusion(scored, live.scoring.thresholds[s]) })),
    sweep: sweep(scored),
    suggestion,
    stability: stability(scored),
    maybes: { total: counts.maybe, flaggedAtModerate: scored.filter((s) => s.label === "maybe" && s.score >= moderateNow).length },
    warnings,
  };
}
