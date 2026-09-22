import type { InspectData } from "./inspectData";
import type { Vote } from "../shared/types";

/**
 * The click-triggered panel under the mop icon: the score, the verdict chip, a 4-state vote row, the range bar, and the
 * full Slopprint breakdown all in one place (see inspectorPanel.ts). It stays open after a vote (the row just recolours)
 * and closes on an outside press, Escape, or a second click on the icon.
 */
export interface PanelState {
  current: Vote | null;
  /** The full breakdown once scored; null while scoring or when it couldn't be. */
  inspect: InspectData | null;
  scoring: boolean;
  /** Why the post couldn't be scored, if it couldn't. */
  problem: string | null;
  /** True when the post is folded away and was unfolded by you, so it can be hidden again. */
  canRefold: boolean;
}

export interface PanelOpts {
  getState(): PanelState;
  /** Scores the post now if it hasn't been (short and non-English posts are only scored on demand). */
  ensure(): Promise<void>;
  /** Resolves to an error message to show in the panel, or null when the vote was applied. */
  onPick(v: Vote | null): Promise<string | null>;
  onRefold(): void;
}

/** Wired into the panel's vote row by openVotePanel; absent for read-only views (drafts, the fold strip's hover tooltip). */
export interface VoteCtx {
  current: Vote | null;
  onPick(v: Vote | null): void;
  canRefold: boolean;
  onRefold(): void;
  /** An error from the last pick attempt, shown under the vote row until the next one. */
  error: string | null;
}
