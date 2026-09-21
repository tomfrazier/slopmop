export interface Dimension {
  /** Normalized 0-1 (score / max level). */
  value: number;
  confidence: number;
}

export interface Verdict {
  model: string;
  dimensions: Record<string, Dimension>;
  /** Probability 0-1 that the post was LLM-drafted. */
  aiLikelihood: number;
  /** Tokens this call used, when the backend reports them (for the dashboard's cost figures). */
  usage?: { inputTokens: number; outputTokens: number };
  /** How many requests it took (more than 1 means a slow first attempt was hedged). */
  attempts?: number;
}
