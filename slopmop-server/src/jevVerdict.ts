import type { NoulResponse, ScoreResponse } from "@typesafe-ai/sdk";
import type { Dimension, Verdict } from "./jevTypes.js";
import type { JevResult } from "./jevRequest.js";
import { SCORE_TRAITS } from "./questions.js";

/** Jev's raw answers as a verdict: each score as 0-1 with its confidence, plus the AI-likelihood and the tokens used. */
export function toVerdict(result: JevResult, attempts: number): Verdict {
  const answers = result.answers as Record<string, ScoreResponse | NoulResponse>;
  const dimensions: Record<string, Dimension> = {};
  for (const t of SCORE_TRAITS) {
    const a = answers[t.id] as ScoreResponse;
    dimensions[t.id] = { value: a.score / (t.levels.length - 1), confidence: a.confidence };
  }
  return {
    model: result.model,
    dimensions,
    aiLikelihood: (answers.aiLikelihood as NoulResponse).noul,
    usage: result.usage ? { inputTokens: result.usage.input_tokens, outputTokens: result.usage.output_tokens } : undefined,
    attempts,
  };
}
