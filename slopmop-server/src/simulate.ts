import type { Dimension } from "./jev.js";
import { displayScore, type DisplayAnchors } from "./display.js";
import { scoreSteps, type EngagementCounts, type ScoreSteps } from "./scoring.js";
import type { Scoring } from "./scoringStore.js";
import { applyWeights, confidenceFactor, TELL_IDS, type Weights } from "./weights.js";

/**
 * "What would this post score?": runs the real scoring code on made-up answers, and returns every step, so the admin can see how
 * the numbers fit together and preview a change before saving it. Nothing is stored and no check is used.
 */
export interface SimInput {
  dimensions: Record<string, Dimension>;
  aiLikelihood: number;
  engagement: EngagementCounts | null;
}

export interface SimLive {
  weights: Weights;
  scoring: Scoring;
  /** The client manifest values the decision uses. */
  aiDampen: number;
  minMeanConfidence: number;
  yellowFraction: number;
  displayPossibly: number;
  displayLikely: number;
  displayFullMultiple: number;
}

type Sensitivity = "aggressive" | "moderate" | "mild";
export interface Verdict {
  level: "none" | "yellow" | "red";
  word: "Looks fine" | "Not sure" | "Possibly slop" | "Likely slop";
}

export interface SimResult {
  tells: { id: string; value: number; confidence: number; /** weight x confidence^power: what the tell counts for in the average */ effectiveWeight: number }[];
  steps: ScoreSteps;
  meanConfidence: number;
  /** Jev's average confidence was under the minimum, so the post is left alone. */
  gated: boolean;
  aiLikelihood: number;
  dampener: number;
  /** The raw score, 0-1. */
  score: number;
  /** The 0-100 number people see. */
  shown: number;
  /** Where the zone lines fall on the shown scale, per sensitivity. */
  zones: Record<Sensitivity, { possibly: number; likely: number }>;
  verdicts: Record<Sensitivity, Verdict>;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const SENSITIVITIES: Sensitivity[] = ["aggressive", "moderate", "mild"];

export function simulate(input: SimInput, live: SimLive): SimResult {
  const { scoring } = live;
  const { confidencePower } = scoring.formula;
  const tellMean = applyWeights(input.dimensions, live.weights, confidencePower).tellMean;
  const steps = scoreSteps({ tellMean, dimensions: input.dimensions, engagement: input.engagement }, live.weights, scoring.engagement, scoring.corroboration, scoring.formula);
  const present = TELL_IDS.filter((id) => input.dimensions[id]);
  const meanConfidence = present.length ? present.reduce((s, id) => s + input.dimensions[id].confidence, 0) / present.length : 0;
  const gated = meanConfidence < live.minMeanConfidence;
  const dampener = 1 - live.aiDampen * (1 - clamp01(input.aiLikelihood));
  const score = gated ? 0 : steps.slop * (1 - steps.shield) * dampener;
  const anchors: DisplayAnchors = { moderate: scoring.thresholds.moderate, yellowFraction: live.yellowFraction, possibly: live.displayPossibly, likely: live.displayLikely, fullMultiple: live.displayFullMultiple };
  const zones = {} as SimResult["zones"];
  const verdicts = {} as SimResult["verdicts"];
  for (const s of SENSITIVITIES) {
    const t = scoring.thresholds[s];
    zones[s] = { possibly: Math.min(100, displayScore(live.yellowFraction * t, anchors)), likely: Math.min(100, displayScore(t, anchors)) };
    verdicts[s] = gated ? { level: "none", word: "Not sure" } : score >= t ? { level: "red", word: "Likely slop" } : score >= live.yellowFraction * t ? { level: "yellow", word: "Possibly slop" } : { level: "none", word: "Looks fine" };
  }
  return {
    tells: present.map((id) => ({ id, value: input.dimensions[id].value, confidence: input.dimensions[id].confidence, effectiveWeight: (live.weights[id] ?? 1) * confidenceFactor(input.dimensions[id].confidence, confidencePower) })),
    steps,
    meanConfidence,
    gated,
    aiLikelihood: input.aiLikelihood,
    dampener,
    score,
    shown: gated ? 0 : Math.min(100, displayScore(score, anchors)),
    zones,
    verdicts,
  };
}
