import type { Zones } from "../shared/display";
import type { Community } from "../shared/types";
import type { InspectData } from "./inspectData";
import type { Vote } from "../shared/types";

/**
 * The dropdown under the mop icon, in the style of LinkedIn's own "..." menu:
 *
 *   Slop score  38 /100        <- first line: the score and what it means
 *   ---------------------
 *   Is this post slop?
 *   ● No  ● Maybe  ● Probably  (+ Clear my vote, + Hide post again when they apply)
 *   ---------------------
 *   Details                    <- hover (or focus) shows the full analysis card beside the menu
 *
 * It lives in a page-level shadow root so no ancestor's overflow can clip it.
 */
export type Tone = "green" | "yellow" | "red" | "grey";

export interface MenuState {
  current: Vote | null;
  /** 0-100, or null while unscored / when scoring failed. */
  score: number | null;
  /** Short verdict shown under the score ("Likely slop", "Not flagged", ...). */
  verdict: string;
  tone: Tone;
  /** Where the zone lines fall on the 0-100 scale for this person's sensitivity (see displayZones). */
  zones: Zones;
  scoring: boolean;
  /** Why the post couldn't be scored, if it couldn't. */
  problem: string | null;
  /** The full analysis, once scored. */
  inspect: InspectData | null;
  /** What other people have said about this post, when the server knows. */
  community: Community | null;
  /** True when the post is folded away and was unfolded by you, so it can be hidden again. */
  canRefold: boolean;
}

export interface MenuOpts {
  getState(): MenuState;
  /** Scores the post now if it hasn't been (short and non-English posts are only scored on demand). */
  ensure(): Promise<void>;
  /** Resolves to an error message to show in the menu, or null when the vote was applied. */
  onPick(v: Vote | null): Promise<string | null>;
  onRefold(): void;
}
