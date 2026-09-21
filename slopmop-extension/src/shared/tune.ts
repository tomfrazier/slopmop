import { decide, DEFAULT_PARAMS, type Params } from "./decide";
import { DEFAULT_ENGAGEMENT, engagementNorm, type EngagementModel } from "./engagement";
import type { LabelRecord, Sensitivity, TellRow, Vote } from "./types";

/**
 * Offline tuning over hand-labeled posts. Because the raw Jev answers are stored with every label,
 * any change to weights or thresholds can be re-scored here without calling Jev again.
 */

export interface Scored {
  urn: string;
  label: Vote;
  /** Score used for flagging: 0 when the confidence gate would stop it anyway. */
  effective: number;
  raw: number;
  aiLikelihood: number;
  gated: boolean;
  top: TellRow[];
  text: string;
}

export function scoreAll(labels: LabelRecord[], params: Partial<Params> = {}): Scored[] {
  return labels.map((l) => {
    const d = decide(l.verdict, l.engagement, "hide", "moderate", { params, shield: !l.own });
    const e = d.explain;
    const gated = !e || e.lowConfidence;
    return {
      urn: l.urn,
      label: l.label,
      effective: gated ? 0 : d.score,
      raw: d.score,
      aiLikelihood: d.aiLikelihood,
      gated,
      top: e?.tells.slice(0, 3) ?? [],
      text: l.text,
    };
  });
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

/** "probably" counts as slop, "no" as not slop. "maybe" is a genuine gray zone, so it is left out of the accuracy math. */
export function confusion(scored: Scored[], threshold: number): Confusion {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const s of scored) {
    if (s.label === "maybe") continue;
    const flagged = s.effective >= threshold;
    if (s.label === "probably") flagged ? tp++ : fn++;
    else flagged ? fp++ : tn++;
  }
  const precision = tp + fp ? tp / (tp + fp) : 1;
  const recall = tp + fn ? tp / (tp + fn) : 1;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { threshold, tp, fp, fn, tn, precision, recall, f1 };
}

/** Thresholds are tried from `from` to `to` in steps, and kept to two decimals so they read cleanly in the config. */
const SWEEP = { from: 0.04, to: 0.5, step: 0.01 };
const roundThreshold = (t: number) => Math.round(t * 100) / 100;
const FLOAT_SLACK = 1e-9;
/** Aggressive still requires at least this share of what it flags to really be slop. */
const AGGRESSIVE_MIN_PRECISION = 0.6;

export function sweep(scored: Scored[], from = SWEEP.from, to = SWEEP.to, step = SWEEP.step): Confusion[] {
  const out: Confusion[] = [];
  for (let t = from; t <= to + FLOAT_SLACK; t += step) out.push(confusion(scored, roundThreshold(t)));
  return out;
}

export interface Suggestion {
  sensitivity: Sensitivity;
  threshold: number;
  why: string;
  at: Confusion;
}

/** Of two equally good rows, the higher (safer) threshold. */
const saferOnTie = (a: Confusion, b: Confusion) => a.threshold > b.threshold;

/** Mild: the lowest threshold that flags no one you labeled "not slop". */
function pickMild(rows: Confusion[]): Confusion {
  return rows.find((r) => r.fp === 0) ?? rows[rows.length - 1];
}

/** Moderate: best F1 (ties go to the higher, safer threshold). */
function pickModerate(rows: Confusion[]): Confusion {
  return rows.reduce((best, r) => (r.f1 > best.f1 || (r.f1 === best.f1 && saferOnTie(r, best)) ? r : best));
}

/** Aggressive: catch as much slop as possible while at least 60% of what it flags really is slop. */
function pickAggressive(rows: Confusion[]): Confusion {
  const precise = rows.filter((r) => r.precision >= AGGRESSIVE_MIN_PRECISION);
  return (precise.length ? precise : rows).reduce((best, r) => (r.recall > best.recall || (r.recall === best.recall && saferOnTie(r, best)) ? r : best));
}

/** Proposes thresholds for the three sensitivity levels from the labels. Needs both classes to mean anything. */
export function suggest(scored: Scored[]): Suggestion[] | null {
  const hasBoth = scored.some((s) => s.label === "probably") && scored.some((s) => s.label === "no");
  if (!hasBoth) return null;
  const rows = sweep(scored);
  const [aggressive, moderate, mild] = [pickAggressive(rows), pickModerate(rows), pickMild(rows)];

  // Sensitivity must stay ordered (aggressive <= moderate <= mild); independent picks can cross on small data.
  const aggressiveT = Math.min(aggressive.threshold, moderate.threshold);
  const mildT = Math.max(mild.threshold, moderate.threshold);
  const at = (t: number, fallback: Confusion) => (t === fallback.threshold ? fallback : confusion(scored, t));
  return [
    { sensitivity: "aggressive", threshold: aggressiveT, why: "most slop caught with >=60% precision", at: at(aggressiveT, aggressive) },
    { sensitivity: "moderate", threshold: moderate.threshold, why: "best balance (F1)", at: moderate },
    { sensitivity: "mild", threshold: mildT, why: "lowest threshold with no false positives", at: at(mildT, mild) },
  ];
}

export function mistakes(scored: Scored[], threshold: number) {
  return {
    falsePositives: scored.filter((s) => s.label === "no" && s.effective >= threshold).sort((a, b) => b.effective - a.effective),
    falseNegatives: scored.filter((s) => s.label === "probably" && s.effective < threshold).sort((a, b) => b.raw - a.raw),
    /** Gray-zone votes, highest score first, with whether they would be flagged at this threshold. */
    maybes: scored.filter((s) => s.label === "maybe").sort((a, b) => b.effective - a.effective).map((s) => ({ ...s, flagged: s.effective >= threshold })),
  };
}

/** Candidate strengths for the human-written dampener; 0 is "off" (what the old hard gate approximated, minus its veto). */
export const DAMPEN_CANDIDATES = [0, 0.15, 0.25, 0.35, 0.5];

/** The old rule: a post under this AI-likelihood was never flagged, whatever its tells. */
const OLD_GUARD = 0.5;

export interface DampenFit {
  aiDampen: number;
  moderate: Suggestion;
}

/** For each candidate dampener strength, the moderate threshold that fits best and how well it does. Best F1 first, then the smaller dampener. */
export function fitDampen(labels: LabelRecord[], params: Partial<Params> = {}): DampenFit[] {
  return DAMPEN_CANDIDATES.flatMap((aiDampen) => {
    const sug = suggest(scoreAll(labels, { ...params, aiDampen }));
    const moderate = sug?.find((s) => s.sensitivity === "moderate");
    return moderate ? [{ aiDampen, moderate }] : [];
  }).sort((a, b) => b.moderate.at.f1 - a.moderate.at.f1 || a.aiDampen - b.aiDampen);
}

export type Outcome = "flagged" | "not flagged";
export interface Change {
  urn: string;
  label: Vote;
  aiLikelihood: number;
  before: Outcome;
  after: Outcome;
  text: string;
}

/**
 * Old rule (a hard human guard: nothing under 0.5 AI-likelihood is ever flagged) against the new one (the dampener), at
 * the given thresholds for each. Returns every post whose outcome changed, and both confusion matrices.
 */
export function compareToGuard(labels: LabelRecord[], oldThreshold: number, newThreshold: number, newParams: Partial<Params> = {}) {
  const before = scoreAll(labels, { aiDampen: 0 }).map((s) => ({ ...s, effective: s.aiLikelihood < OLD_GUARD ? 0 : s.effective }));
  const after = scoreAll(labels, newParams);
  const outcome = (s: Scored, threshold: number): Outcome => (s.effective >= threshold ? "flagged" : "not flagged");
  const changes = after.flatMap((a, i): Change[] => {
    const was = outcome(before[i], oldThreshold);
    const now = outcome(a, newThreshold);
    return was === now ? [] : [{ urn: a.urn, label: a.label, aiLikelihood: a.aiLikelihood, before: was, after: now, text: a.text }];
  });
  return { before: confusion(before, oldThreshold), after: confusion(after, newThreshold), changes };
}

/** Weightings of reactions : comments : reposts worth comparing (the default first). */
export const ENGAGEMENT_CANDIDATES: { name: string; model: EngagementModel }[] = [
  { name: "1 : 3 : 5 (the old ratio)", model: { ...DEFAULT_ENGAGEMENT, comment: 3, repost: 5, hollowFloor: 1 } },
  { name: "1 : 5 : 12 (default)", model: DEFAULT_ENGAGEMENT },
  { name: "1 : 5 : 12, no hollow check", model: { ...DEFAULT_ENGAGEMENT, hollowFloor: 1 } },
  { name: "1 : 8 : 20", model: { ...DEFAULT_ENGAGEMENT, comment: 8, repost: 20 } },
];

/**
 * How well reader response alone separates "no" votes (not slop) from "probably" votes (slop), for each candidate weighting:
 * the chance a random "no" post scores higher than a random "probably" one (0.5 = no signal). Only votes with any engagement
 * count, and there are few of them, so this is a sanity check and not a fit.
 */
export function engagementAuc(labels: LabelRecord[], model: EngagementModel): { auc: number | null; n: number } {
  const seen = labels.filter((l) => l.engagement.reactions + l.engagement.comments + l.engagement.reposts > 0);
  const no = seen.filter((l) => l.label === "no").map((l) => engagementNorm(l.engagement, model));
  const slop = seen.filter((l) => l.label === "probably").map((l) => engagementNorm(l.engagement, model));
  if (!no.length || !slop.length) return { auc: null, n: no.length + slop.length };
  let wins = 0;
  for (const a of no) for (const b of slop) wins += a > b ? 1 : a === b ? 0.5 : 0;
  return { auc: wins / (no.length * slop.length), n: no.length + slop.length };
}

export { DEFAULT_PARAMS };
