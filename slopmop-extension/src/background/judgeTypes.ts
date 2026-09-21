import type { JudgeResponse, SurfaceStats, Usage } from "../shared/types";

/** One post waiting for (or getting) a check. */
export interface Job {
  key: string;
  urn: string;
  text: string;
  stats: SurfaceStats;
  priority: number;
  tabId: number | undefined;
  nativeId?: string;
  engagement?: { reactions: number; comments: number; reposts: number };
  resolvers: ((r: JudgeResponse | null) => void)[];
}

/** How one HTTP attempt turned out, and what to do about it. */
export type Attempt =
  | { kind: "ok"; response: JudgeResponse }
  /** Retrying can't help (daily limit used up, install disabled, or an error that won't change). */
  | { kind: "stop"; error: string }
  /** The server's per-minute limit: pause the whole queue for `waitMs`; this try doesn't count. */
  | { kind: "rate"; error: string; waitMs: number; pauseMs: number }
  /** Transient (busy, overloaded, dropped connection): back off and try again. */
  | { kind: "retry"; error: string; pauseMs: number };

export type ServerBody = { error?: string; message?: string; usage?: Usage; policy?: unknown };
