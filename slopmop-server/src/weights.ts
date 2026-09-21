import { WEIGHT_MAX, WEIGHT_MIN } from "./constants.js";
import type { Dimension } from "./jev.js";
import { TELLS } from "./traits.js";

/**
 * How much each tell counts toward the slop score. The public defaults are all 1 (every tell counts equally). The values
 * actually used in production are a private tuning result: they are read from the TELL_WEIGHTS environment variable, a JSON
 * object such as {"formulaicHook":0.9,"emptyEvaluation":1.3}, and never leave the server. Clients only receive the
 * weighted result (`tellMean`, `tellRank`), so the weights themselves can stay out of the open-source repo and the extension.
 */
export type Weights = Record<string, number>;

/** The tells, which are averaged into the slop score. */
export const TELL_IDS: readonly string[] = TELLS.map((t) => t.id);
/**
 * The two counter-tells, which work against the score instead of adding to it. Their weight is a multiplier on the built-in
 * strength (1 = as designed): `humanVoice` scales how much a personal voice takes off the slop score, `usefulness` scales
 * how much of the shield comes from Jev's usefulness answer rather than from engagement.
 */
export const COUNTER_IDS = ["humanVoice", "usefulness"] as const;

export const DEFAULT_WEIGHTS: Weights = Object.fromEntries([...TELL_IDS, ...COUNTER_IDS].map((id) => [id, 1]));

/** Why a weight can't be used, or null when it can. Never includes the value itself (these may be secrets). */
function weightProblem(id: string, w: unknown): string | null {
  if (!(id in DEFAULT_WEIGHTS)) return `Unknown tell "${id}".`;
  if (typeof w !== "number" || !Number.isFinite(w) || w < WEIGHT_MIN || w > WEIGHT_MAX) return `Weight for "${id}" must be a number from ${WEIGHT_MIN} to ${WEIGHT_MAX}.`;
  return null;
}

/** Applies `input` over the defaults (unlisted tells count 1), collecting a problem for each entry that can't be used. */
function overlay(input: object): { weights: Weights; problems: string[]; changed: boolean } {
  const weights: Weights = { ...DEFAULT_WEIGHTS };
  const problems: string[] = [];
  let changed = false;
  for (const [id, w] of Object.entries(input)) {
    const problem = weightProblem(id, w);
    if (problem) problems.push(problem);
    else {
      weights[id] = w as number;
      changed ||= w !== 1;
    }
  }
  return { weights, problems, changed };
}

const isPlainObject = (v: unknown): v is object => typeof v === "object" && v !== null && !Array.isArray(v);

/** The weights from TELL_WEIGHTS. A bad value or unknown tell is ignored (and the problem logged, never the value). */
export function parseWeights(raw: string | undefined): { weights: Weights; custom: boolean } {
  const equal = { weights: { ...DEFAULT_WEIGHTS }, custom: false };
  if (!raw?.trim()) return equal;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error("[slopmop] TELL_WEIGHTS is not valid JSON; using equal weights.");
    return equal;
  }
  if (!isPlainObject(parsed)) {
    console.error("[slopmop] TELL_WEIGHTS must be a JSON object; using equal weights.");
    return equal;
  }
  const { weights, problems, changed } = overlay(parsed);
  for (const problem of problems) console.error(`[slopmop] TELL_WEIGHTS: ${problem} Ignored.`);
  return { weights, custom: changed };
}

/** A full weight map from admin input (missing tells count 1), or a message saying what is wrong. */
export function validateWeights(input: unknown): Weights | string {
  if (!isPlainObject(input)) return "weights must be an object of tell id to number.";
  const { weights, problems } = overlay(input);
  if (problems.length) return problems[0];
  return TELL_IDS.some((id) => weights[id] > 0) ? weights : "At least one tell weight must be above 0.";
}

export interface Weighted {
  /** Weighted mean of the tell dimensions, 0-1. */
  tellMean: number;
  /** Tell ids, biggest contribution first. Reveals order only, not weights. */
  tellRank: string[];
}

/** How much Jev's confidence counts toward a tell's weight: weight x confidence^0.5. A guess counts for less, not for nothing. */
export const CONFIDENCE_POWER = 0.5;
export const confidenceFactor = (confidence: number, power: number = CONFIDENCE_POWER) => Math.max(0, confidence) ** power;

/**
 * The weighted composite of a verdict's tell dimensions (human voice and usefulness are separate signals, not tells). A tell
 * also counts for less the less confident Jev was in it (see CONFIDENCE_POWER): one it wasn't sure of shouldn't pull the
 * average up as if it were certain, and one it had no confidence in has no say.
 */
export function applyWeights(dimensions: Record<string, Dimension>, weights: Weights, confidencePower: number = CONFIDENCE_POWER): Weighted {
  const present = TELL_IDS.filter((id) => dimensions[id]).map((id): [string, number] => [id, (weights[id] ?? 1) * confidenceFactor(dimensions[id].confidence, confidencePower)]);
  const total = present.reduce((s, [, w]) => s + w, 0);
  if (present.length === 0 || total === 0) return { tellMean: 0, tellRank: present.map(([id]) => id) };
  const tellMean = present.reduce((s, [id, w]) => s + w * dimensions[id].value, 0) / total;
  const tellRank = present
    .map(([id, w]) => ({ id, c: w * dimensions[id].value }))
    .sort((a, b) => b.c - a.c || a.id.localeCompare(b.id))
    .map((x) => x.id);
  return { tellMean, tellRank };
}
