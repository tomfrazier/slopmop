import { breakouts, classify, composite, isAlone } from "./composite";
import type { DecideOpts } from "./decideOptions";
import { DEFAULT_PARAMS, type Params } from "./decideParams";
import { clamp01, engagementNorm, SHIELD_USEFUL_SHARE } from "./engagement";
import type { Decision, Engagement, Explain, JudgeResponse, Mode, OwnLevel, Sensitivity } from "./types";

// The scoring knobs live in decideParams.ts and are re-exported here, where the rest of the code has always looked for them.
export { AI_DAMPEN, CORROBORATION, DEFAULT_PARAMS, HUMAN_OFFSET, MAX_SHIELD, MIN_MEAN_CONFIDENCE, SLOP_GAIN, THRESHOLDS, WEIGHTS, YELLOW_FRACTION, type Params } from "./decideParams";
export { engagementNorm } from "./engagement";
export type { DecideOpts } from "./decideOptions";

/** The factor a post's score is multiplied by for how human-written Jev thinks it reads: 1 for a sure AI draft, 1 - dampen for a sure human one. */
export const dampenFactor = (aiLikelihood: number, dampen: number) => 1 - dampen * (1 - clamp01(aiLikelihood));

const NOT_A_DECISION = (r: JudgeResponse | null): Decision => ({
  level: "none",
  hide: false,
  score: 0,
  slop: 0,
  shield: 0,
  aiLikelihood: r?.aiLikelihood ?? 0,
  reasons: [],
  explain: null,
});

export function decide(r: JudgeResponse | null, engagement: Engagement, mode: Mode, sensitivity: Sensitivity, opts: DecideOpts = {}): Decision {
  if (!r) return NOT_A_DECISION(r); // fail open
  const P: Params = { ...DEFAULT_PARAMS, ...opts.params };
  const c = composite(r, P, opts);
  if (!c) return NOT_A_DECISION(r);

  const human = r.dimensions.humanVoice?.value ?? 0;
  const useful = r.dimensions.usefulness?.value ?? 0;
  const eNorm = engagementNorm(engagement);

  // The server works out slop and the shield (it holds the counter-tell multipliers and the reader-response model, and it sees
  // the engagement counts it was sent). This client only does that arithmetic for older answers and for offline tuning.
  const p = opts.params;
  const fromServer = r.slop !== undefined && r.shield !== undefined && p?.weights === undefined && p?.gain === undefined && p?.humanOffset === undefined && p?.maxShield === undefined && p?.corroboration === undefined;
  const readerResponse = fromServer && r.engagementNorm !== undefined ? r.engagementNorm : eNorm;
  const standing = fromServer && r.breakouts !== undefined ? r.breakouts : breakouts(c.tells, P.corroboration);
  const slop = fromServer ? r.slop! : clamp01(c.mean * P.gain - P.humanOffset * human) * (isAlone(standing, P.corroboration) ? P.corroboration.alone : 1);
  const shieldOn = opts.shield !== false;
  const localShield = Math.min(P.maxShield, SHIELD_USEFUL_SHARE * useful + (1 - SHIELD_USEFUL_SHARE) * eNorm);
  // Your own posts and drafts keep the usefulness half of the shield (Jev reads that from the text alone) but not the reader-response
  // half: nobody has reacted to a draft, and the colour on your own post should reflect the writing.
  const usefulOnly = fromServer ? (r.usefulShield ?? 0) : Math.min(P.maxShield, SHIELD_USEFUL_SHARE * useful);
  const shield = !shieldOn ? usefulOnly : fromServer ? r.shield! : localShield;
  const aiDampen = dampenFactor(r.aiLikelihood, P.aiDampen);
  const score = slop * (1 - shield) * aiDampen;

  const threshold = P.thresholds[sensitivity];
  const yellowAt = P.yellowFraction * threshold;
  const lowConfidence = c.meanConfidence < P.minMeanConfidence;
  const { level, outcome } = classify({ score, lowConfidence, threshold, yellowAt, mode });

  const explain: Explain = {
    tells: c.tells,
    mean: c.mean,
    gain: P.gain,
    humanVoice: human,
    ...(fromServer ? {} : { humanOffset: P.humanOffset }),
    source: fromServer ? ("server" as const) : ("local" as const),
    usefulness: useful,
    engagement: { ...engagement, norm: readerResponse },
    shieldOn,
    maxShield: P.maxShield,
    aiLikelihood: r.aiLikelihood,
    aiDampen,
    breakouts: standing,
    meanConfidence: c.meanConfidence,
    minMeanConfidence: P.minMeanConfidence,
    lowConfidence,
    threshold,
    yellowAt,
    mode,
    sensitivity,
    outcome,
  };

  return {
    level,
    hide: mode === "hide" && level === "red",
    score,
    slop,
    shield,
    aiLikelihood: r.aiLikelihood,
    reasons: c.tells.slice(0, 2).map(({ id, value }) => ({ id, value })),
    explain,
  };
}

/**
 * Your own posts: always coloured, never hidden. The shield keeps only its usefulness half (no reader response), so the colour
 * reflects the writing and how useful Jev finds it, not how it was received. Green = clean, yellow = some AI tells, red = likely slop.
 */
export function decideOwn(r: JudgeResponse | null, sensitivity: Sensitivity, params?: Partial<Params>): Decision & { ownLevel: OwnLevel } {
  const d = decide(r, { reactions: 0, comments: 0, reposts: 0 }, "highlight", sensitivity, { shield: false, params });
  return { ...d, ownLevel: d.level === "red" ? "red" : d.level === "yellow" ? "yellow" : "green" };
}
