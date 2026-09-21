import { createHash } from "node:crypto";
import { noul, score } from "@typesafe-ai/sdk";
import type { Questions, ScoreQuestion } from "@typesafe-ai/sdk";
import {
  AI_LIKELIHOOD_CRITERIA,
  AI_LIKELIHOOD_QUESTION,
  HUMAN_VOICE,
  TELLS,
  USEFULNESS,
  type Trait,
} from "./traits.js";

export type SurfaceStats = {
  wordCount: number;
  sentenceCount: number;
  sentenceLengthStdDev: number;
  contractionsPer100Words: number;
  exclamationCount: number;
  emDashesPer1000Words: number;
};

export type EngagementFacts = { reactions: number; comments: number; reposts: number };

/** What Jev said the last time it scored this post, and how much engagement the post had then, so it can weigh what has changed. */
export type PreviousAssessment = {
  /** Its usefulness answer as a level, 0 (nothing a reader could use) to 3 (substantial). */
  usefulnessLevel: number;
  engagementThen: EngagementFacts | null;
};

export interface JudgeInput {
  postText: string;
  surfaceStats: SurfaceStats;
  /** What readers have done with the post so far, as observed fact. */
  engagement?: EngagementFacts | null;
  previousAssessment?: PreviousAssessment | null;
}

export const TELL_IDS = TELLS.map((t) => t.id);
/** Every Score dimension the server returns, in order. */
export const SCORE_TRAITS: readonly Trait[] = [...TELLS, HUMAN_VOICE, USEFULNESS];

function toScoreQuestion(t: Trait): ScoreQuestion {
  return score(t.question, t.levels as unknown as [string, string, ...string[]]);
}

/** Named-field state so instructions can reference `post`, `surfaceStats`, `engagement` and `previousAssessment`. */
export function buildState(input: JudgeInput) {
  return {
    post: input.postText,
    surfaceStats: input.surfaceStats,
    engagement: input.engagement ?? "not reported",
    previousAssessment: input.previousAssessment ?? "none: this is the first time this post is being scored",
  };
}

export function buildQuestions(): Questions {
  const questions: Questions = {};
  for (const t of SCORE_TRAITS) questions[t.id] = toScoreQuestion(t);
  questions.aiLikelihood = noul(AI_LIKELIHOOD_QUESTION, AI_LIKELIHOOD_CRITERIA);
  return questions;
}

/**
 * Identifies the exact criteria Jev is asked about. A stored verdict is only reused while this is unchanged, so
 * editing the tell library or a question automatically re-scores content instead of serving stale answers.
 */
export const CRITERIA_VERSION = createHash("sha256").update(JSON.stringify(buildQuestions())).digest("hex").slice(0, 12);
