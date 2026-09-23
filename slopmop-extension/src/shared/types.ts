export type Sensitivity = "aggressive" | "moderate" | "mild";
export type Mode = "hide" | "highlight";

export interface Settings {
  enabled: boolean;
  mode: Mode;
  sensitivity: Sensitivity;
  /** True once the user accepted the research-only notice. The master toggle can't be enabled before this. */
  acknowledged: boolean;
  /** Developer aid, set on the extension's settings page: the badge shows posts sent to the server this page load, and short or non-English posts can be inspected. */
  debug: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: false,
  mode: "hide",
  sensitivity: "moderate",
  acknowledged: false,
  debug: false,
};

/** Normalized 0-1 Jev answer for one dimension. */
export interface Dimension {
  value: number;
  confidence: number;
}

/** What other people have said about a post. "Probably" = flagged as slop. */
export interface Community {
  no: number;
  maybe: number;
  probably: number;
  total: number;
}

export interface Usage {
  used: number;
  limit: number;
  remaining: number;
  /** ISO time the daily counter resets (next UTC midnight). */
  resetsAt: string;
  /** The short id the server's admin dashboard shows for this install (absent from older servers). */
  device?: string;
}

/** Contract with slopmop-server `POST /api/v1/judge`. Hand-maintained; nothing is imported across repos. */
export interface JudgeResponse {
  model: string;
  dimensions: Record<string, Dimension>;
  aiLikelihood: number;
  /** The server's id for this content (a hash of its text), the same for everyone who sees it. */
  contentId?: string;
  network?: string;
  /** True when the server answered from its registry instead of calling Jev. */
  cached?: boolean;
  community?: Community;
  usage?: Usage;
  /**
   * The weighted composite of the tell dimensions and the tells ranked by contribution, computed on the server with weights
   * that never leave it. Absent on answers saved before the server sent them.
   */
  tellMean?: number;
  tellRank?: string[];
  /**
   * The server's half of the decision, for the engagement counts this request carried: tell mean x gain minus the human-voice
   * offset, the shield (usefulness plus reader response), and reader response on its own. Absent on older answers. The weights
   * behind them never leave the server.
   */
  slop?: number;
  shield?: number;
  /** The shield from usefulness alone: what your own posts and drafts keep. Absent on older answers. */
  usefulShield?: number;
  /** How many tells stand out; with fewer than two the server cuts the slop score. */
  breakouts?: number;
  engagementNorm?: number;
  /** Which version of the server's manifest was current when this was answered; a different one means it should be fetched again. */
  manifestVersion?: string;
  /** Identifies the server's tell weights when this was scored. When the server's weights change, saved answers with an older version are refreshed. */
  weightsVersion?: string;
}

export interface SurfaceStats {
  wordCount: number;
  sentenceCount: number;
  sentenceLengthStdDev: number;
  contractionsPer100Words: number;
  exclamationCount: number;
  emDashesPer1000Words: number;
}

export interface Engagement {
  reactions: number;
  comments: number;
  reposts: number;
}

export type Level = "none" | "yellow" | "red";
/** Own posts always get a colour: green when clean. */
export type OwnLevel = "green" | "yellow" | "red";

export interface TellRow {
  id: string;
  /** Jev's normalized 0-1 answer. */
  value: number;
  confidence: number;
  /** Only known when the extension computed the mean itself (equal public defaults, or a tuning run). The server keeps its weights private. */
  weight?: number;
  /** This tell's share of the weighted mean (weight * value / total weight); same caveat as `weight`. */
  contrib?: number;
}

/** Everything the decision used, so the UI can show exactly why a post was (or wasn't) flagged. */
export interface Explain {
  tells: TellRow[]; // sorted by contribution, biggest first
  mean: number;
  gain: number;
  humanVoice: number;
  /** What a personal voice takes off the slop score, per unit of voice. Only when this client worked it out; the server's answer keeps it private. */
  humanOffset?: number;
  /** Where slop and the shield came from: the server (the normal case) or this client's own arithmetic (older answers, offline tuning). */
  source: "server" | "local";
  usefulness: number;
  engagement: Engagement & { norm: number };
  shieldOn: boolean;
  maxShield: number;
  aiLikelihood: number;
  /** What the score was multiplied by for how human-written the post reads (1 = not at all, 0.65 = fully human). */
  aiDampen: number;
  /** How many tells stand out (reach the breakout with Jev sure of them); fewer than two and the slop score is cut. */
  breakouts: number;
  meanConfidence: number;
  minMeanConfidence: number;
  lowConfidence: boolean;
  /** Score needed for red (or hidden). */
  threshold: number;
  /** Score needed for yellow (highlight mode only). */
  yellowAt: number;
  mode: Mode;
  sensitivity: Sensitivity;
  /** One plain-English sentence: what happened and why. */
  outcome: string;
}

export interface Decision {
  level: Level;
  /** True only in hide mode when level is red. */
  hide: boolean;
  score: number;
  slop: number;
  shield: number;
  aiLikelihood: number;
  /** Top contributing tells, for the hover "why". */
  reasons: { id: string; value: number }[];
  /** Null only when there was no verdict to explain (fail open). */
  explain: Explain | null;
}

/** A hand label saved locally while tuning. Raw Jev answers are kept so decisions can be re-run offline. */
/** Your vote on "is this slop?". */
export type Vote = "no" | "maybe" | "probably";

export interface LabelRecord {
  urn: string;
  /** Which network and server-side content id this vote is about, so it can be shared with the community. */
  network?: string;
  contentId?: string;
  label: Vote;
  at: number;
  text: string;
  own: boolean;
  engagement: Engagement;
  verdict: JudgeResponse;
  /** What the extension decided when the label was given. */
  decided: { level: Level; score: number; mode: Mode; sensitivity: Sensitivity };
}

/** One line of the labels file: a vote, or a clear (label null) that retracts an earlier vote. */
export type LabelEvent = LabelRecord | { urn: string; label: null; at: number; network?: string; contentId?: string };

export interface LabelSync {
  /** Votes saved in the browser but not yet written to the file. */
  pending: number;
  lastOk: number | null;
  lastError: string | null;
  endpoint: string;
}
