import type { Dimension } from "../jev.js";

export type Vote = "no" | "maybe" | "probably";
export const VOTES: readonly Vote[] = ["no", "maybe", "probably"];

export interface Community {
  no: number;
  maybe: number;
  /** "Probably" = people who flagged this as slop/spam. */
  probably: number;
  total: number;
}

export interface Usage {
  used: number;
  limit: number;
  remaining: number;
  /** ISO time the counter resets (next UTC midnight). */
  resetsAt: string;
  /** The short id the admin dashboard shows for this install, so a user can quote it in a support request. */
  device: string;
}

export interface StoredVerdict {
  model: string;
  aiLikelihood: number;
  dimensions: Record<string, Dimension>;
}

/** A stored verdict with when it is next due to be redone. */
export interface ReusableVerdict extends StoredVerdict {
  /** How the last score was made; null for rows that predate re-scoring. */
  schedule: { total: number; at: number; intervalMs: number; nextAt: number | null } | null;
}

export interface ContentWrite {
  network: string;
  contentId: string;
  nativeId: string | null;
  text: string | null;
  textLen: number;
  surface: unknown;
  engagement: unknown | null;
  /** Present only when this check actually called Jev; a reused verdict leaves the stored one untouched. */
  scored: { verdict: StoredVerdict; criteriaVersion: string; engagementTotal?: number; intervalMs?: number } | null;
}

export type EventKind = "scored" | "cached" | "limited" | "error";

export interface CheckEvent {
  network: string;
  installId: string;
  contentId?: string | null;
  kind: EventKind;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number | null;
  aiLikelihood?: number | null;
  /** Short machine-readable reason (an error class name, or why a request was refused). Never request content. */
  detail?: string | null;
}

export interface ExportRow {
  network: string;
  contentId: string;
  nativeId: string | null;
  textLen: number;
  text: string | null;
  model: string | null;
  criteriaVersion: string | null;
  aiLikelihood: number | null;
  dimensions: Record<string, Dimension> | null;
  surface: unknown;
  engagement: unknown;
  scoredAt: number | null;
  firstSeen: number;
  lastSeen: number;
  checks: number;
  votes: Community;
  /** Majority opinion once enough people have voted; null when there isn't one yet. Handy as a tuning label. */
  consensus: Vote | null;
}

export interface DisabledClient {
  device: string;
  disabledAt: number | null;
  reason: string | null;
  checks: number;
  lastSeen: number;
}
