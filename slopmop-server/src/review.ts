import type { Dimension } from "./jev.js";
import { simulate, type SimInput, type SimLive, type Verdict } from "./simulate.js";
import { TELL_IDS } from "./weights.js";

/**
 * "Why was this post marked that way, and what would change it?" Every setting that could move a post's verdict is a *lever*:
 * a number, where it lives in the admin, and how to change a copy of the live settings. For one post, each lever is solved
 * for the value that would make it leave "Likely slop" (and the value for "Looks fine"), and for what that same change
 * would do to every other stored post, so a setting isn't changed for one post without knowing what else it moves.
 */
export interface Lever {
  id: string;
  label: string;
  /** Where to change it in the admin. */
  where: string;
  min: number;
  max: number;
  integer?: boolean;
  get(l: SimLive): number;
  set(l: SimLive, v: number): SimLive;
}

type Group = "formula" | "engagement" | "corroboration";
const inScoring = (l: SimLive, group: Group, key: string, v: number): SimLive => ({ ...l, scoring: { ...l.scoring, [group]: { ...l.scoring[group], [key]: v } } });
const scalar = (id: string, label: string, where: string, min: number, max: number, group: Group, key: string, integer = false): Lever => ({
  id,
  label,
  where,
  min,
  max,
  integer,
  get: (l) => (l.scoring[group] as unknown as Record<string, number>)[key],
  set: (l, v) => inScoring(l, group, key, v),
});
const weight = (id: string, label: string, where: string, max: number): Lever => ({
  id: `weight:${id}`,
  label,
  where,
  min: 0,
  max,
  get: (l) => l.weights[id] ?? 1,
  set: (l, v) => ({ ...l, weights: { ...l.weights, [id]: v } }),
});

export const LEVERS: Lever[] = [
  scalar("maxShield", "Largest shield", "Scoring → Slop formula", 0, 1, "formula", "maxShield"),
  scalar("usefulShare", "Usefulness share of the shield", "Scoring → Slop formula", 0, 1, "formula", "usefulShare"),
  weight("usefulness", "Useful to readers weight", "Tell weights → counter-tells", 5),
  scalar("logScale", "Reader response reaches 100% at 10 to the power", "Scoring → Reader response", 1, 10, "engagement", "logScale"),
  scalar("gain", "Slop gain", "Scoring → Slop formula", 0.1, 10, "formula", "gain"),
  scalar("humanOffset", "Human-voice offset", "Scoring → Slop formula", 0, 1, "formula", "humanOffset"),
  weight("humanVoice", "Sounds like a person weight", "Tell weights → counter-tells", 5),
  scalar("alone", "Cut when only one tell stands out", "Scoring → Corroboration", 0, 1, "corroboration", "alone"),
  scalar("needed", "Tells that must stand out", "Scoring → Corroboration", 1, 9, "corroboration", "needed", true),
  scalar("breakout", "A tell stands out from", "Scoring → Corroboration", 0, 1, "corroboration", "breakout"),
  {
    id: "aiDampen",
    label: "Score reduction for posts that read human-written",
    where: "Defaults → Client settings",
    min: 0,
    max: 1,
    get: (l) => l.aiDampen,
    set: (l, v) => ({ ...l, aiDampen: v }),
  },
  {
    id: "moderate",
    label: "Moderate threshold (likely slop)",
    where: "Scoring → Thresholds",
    min: 0.01,
    max: 1,
    get: (l) => l.scoring.thresholds.moderate,
    set: (l, v) => ({ ...l, scoring: { ...l.scoring, thresholds: { ...l.scoring.thresholds, moderate: v } } }),
  },
  {
    id: "minMeanConfidence",
    label: "Lowest average Jev confidence to act on",
    where: "Defaults → Client settings",
    min: 0,
    max: 1,
    get: (l) => l.minMeanConfidence,
    set: (l, v) => ({ ...l, minMeanConfidence: v }),
  },
  ...TELL_IDS.map((id) => weight(id, `Tell weight: ${id}`, "Tell weights", 5)),
];

export type Fix = { status: "already" } | { status: "unreachable" } | { status: "needed"; value: number; direction: "up" | "down"; corpus: Impact };
export interface Impact {
  total: number;
  /** Stored posts marked Likely slop at Moderate sensitivity, before and after the change. */
  likelyBefore: number;
  likelyAfter: number;
  /** ...and Likely or Possibly. */
  flaggedBefore: number;
  flaggedAfter: number;
}
export interface LeverResult {
  id: string;
  label: string;
  where: string;
  current: number;
  min: number;
  max: number;
  notLikely: Fix;
  looksFine: Fix;
}
export interface CorpusRow {
  dimensions: Record<string, Dimension>;
  aiLikelihood: number;
  engagement: { reactions: number; comments: number; reposts: number } | null;
}

const STEPS = 80;
const BISECTIONS = 34;
const DECIMALS = 1000;

const moderate = (input: SimInput, l: SimLive): Verdict => simulate(input, l).verdicts.moderate;
const notLikely = (v: Verdict) => v.level !== "red";
const looksFine = (v: Verdict) => v.word === "Looks fine";

/** The value nearest the current one, in either direction, at which `pass` first holds; null when no value in range does. */
function solve(lever: Lever, input: SimInput, live: SimLive, pass: (v: Verdict) => boolean): { value: number; direction: "up" | "down" } | null {
  const cur = lever.get(live);
  const ok = (v: number) => pass(moderate(input, lever.set(live, v)));
  let best: { value: number; direction: "up" | "down" } | null = null;
  for (const end of [lever.min, lever.max]) {
    if (end === cur) continue;
    const dir = end > cur ? "up" : "down";
    let prev = cur;
    for (let i = 1; i <= STEPS; i++) {
      let v = cur + ((end - cur) * i) / STEPS;
      if (lever.integer) v = Math.round(v);
      if (v === prev) continue;
      if (ok(v)) {
        let lo = prev;
        let hi = v;
        if (!lever.integer) for (let k = 0; k < BISECTIONS; k++) ((m) => (ok(m) ? (hi = m) : (lo = m)))((lo + hi) / 2);
        else hi = v;
        // Round away from the current value, so the rounded figure still passes.
        let out = lever.integer ? hi : dir === "up" ? Math.ceil(hi * DECIMALS) / DECIMALS : Math.floor(hi * DECIMALS) / DECIMALS;
        if (!lever.integer && !ok(out)) out = hi;
        const candidate = { value: out, direction: dir } as const;
        if (!best || Math.abs(out - cur) < Math.abs(best.value - cur)) best = candidate;
        break;
      }
      prev = v;
    }
  }
  return best;
}

function impact(corpus: CorpusRow[], live: SimLive, changed: SimLive): Impact {
  let likelyBefore = 0, likelyAfter = 0, flaggedBefore = 0, flaggedAfter = 0;
  for (const r of corpus) {
    const input: SimInput = { dimensions: r.dimensions, aiLikelihood: r.aiLikelihood, engagement: r.engagement };
    const a = moderate(input, live).level;
    const b = moderate(input, changed).level;
    if (a === "red") likelyBefore++;
    if (b === "red") likelyAfter++;
    if (a !== "none") flaggedBefore++;
    if (b !== "none") flaggedAfter++;
  }
  return { total: corpus.length, likelyBefore, likelyAfter, flaggedBefore, flaggedAfter };
}

/** Every lever, solved for this post against the live settings, with what each fix would do to the stored posts. */
export function solveLevers(input: SimInput, live: SimLive, corpus: CorpusRow[]): LeverResult[] {
  const fix = (lever: Lever, pass: (v: Verdict) => boolean): Fix => {
    if (pass(moderate(input, live))) return { status: "already" };
    const found = solve(lever, input, live, pass);
    return found ? { status: "needed", ...found, corpus: impact(corpus, live, lever.set(live, found.value)) } : { status: "unreachable" };
  };
  return LEVERS.map((lever) => ({ id: lever.id, label: lever.label, where: lever.where, current: lever.get(live), min: lever.min, max: lever.max, notLikely: fix(lever, notLikely), looksFine: fix(lever, looksFine) }));
}

/** One way of leaning on reader response: how the shield is split, and how fast reader response saturates. */
export interface Recipe {
  usefulShare: number;
  logScale: number;
  /** The largest shield that makes this post leave Likely slop with those two set, or null when no cap is enough. */
  maxShield: number | null;
  /** Already not likely without raising the cap. */
  already: boolean;
  corpus: Impact | null;
}

const SHARES = [0.5, 0.35, 0.2, 0.1, 0];
const SCALES = [4, 3.5, 3, 2.5];

/**
 * A single setting often can't rescue a well-engaged post: the shield is capped, and usefulness takes a share of it. So this
 * tries the combinations that lean on reader response (a smaller usefulness share, a lower log scale so engagement saturates
 * sooner) and, for each, the cap needed. Every row is a global change; the corpus figures say what it does to the other posts.
 */
export function shieldRecipes(input: SimInput, live: SimLive, corpus: CorpusRow[]): Recipe[] {
  const cap = LEVERS.find((l) => l.id === "maxShield")!;
  const out: Recipe[] = [];
  const seen = new Set<string>();
  for (const share of [live.scoring.formula.usefulShare, ...SHARES]) {
    for (const scale of [live.scoring.engagement.logScale, ...SCALES]) {
      const key = `${share}/${scale}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (share > live.scoring.formula.usefulShare && share !== SHARES[0]) continue;
      const base = { ...live, scoring: { ...live.scoring, formula: { ...live.scoring.formula, usefulShare: share }, engagement: { ...live.scoring.engagement, logScale: scale } } };
      if (notLikely(moderate(input, base))) {
        out.push({ usefulShare: share, logScale: scale, maxShield: base.scoring.formula.maxShield, already: true, corpus: impact(corpus, live, base) });
        continue;
      }
      const found = solve(cap, input, base, notLikely);
      out.push({ usefulShare: share, logScale: scale, maxShield: found && found.direction === "up" ? found.value : null, already: false, corpus: found && found.direction === "up" ? impact(corpus, live, cap.set(base, found.value)) : null });
    }
  }
  return out;
}
