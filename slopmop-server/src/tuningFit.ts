import type { Example } from "./tuning.js";
import { TELL_IDS, type Weights } from "./weights.js";

/** A tell's target weight is kept within this range, however strongly (or weakly) it separates the groups. */
const MIN_TARGET_WEIGHT = 0.3;
const MAX_TARGET_WEIGHT = 2;
/** The current weights count as this many "votes" of prior belief when blending with what the data says. */
const PRIOR_STRENGTH = 100;

/** Probability that a random slop post scores above a random non-slop one (ties count half). Null if either group is empty. */
export function auc(pos: number[], neg: number[]): number | null {
  if (!pos.length || !neg.length) return null;
  let wins = 0;
  for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
const values = (xs: Example[], id: string) => xs.filter((x) => x.dimensions[id]).map((x) => x.dimensions[id].value);

/** Target weights from how well each tell separates the groups, blended with the current weights by how much data there is. */
export function fit(examples: Example[], current: Weights): { suggested: Weights; power: Record<string, number> } {
  const slop = examples.filter((x) => x.slop);
  const clean = examples.filter((x) => !x.slop);
  const power: Record<string, number> = {};
  for (const id of TELL_IDS) power[id] = Math.max(0, 2 * ((auc(values(slop, id), values(clean, id)) ?? 0.5) - 0.5));
  const mean = Object.values(power).reduce((s, v) => s + v, 0) / TELL_IDS.length;
  if (mean === 0) return { suggested: { ...current }, power };
  const lambda = examples.length / (examples.length + PRIOR_STRENGTH);
  const suggested: Weights = { ...current }; // the counter-tells aren't fitted from votes: they stay as set
  for (const id of TELL_IDS) {
    const target = Math.min(MAX_TARGET_WEIGHT, Math.max(MIN_TARGET_WEIGHT, power[id] / mean));
    suggested[id] = round2((1 - lambda) * (current[id] ?? 1) + lambda * target);
  }
  return { suggested, power };
}
