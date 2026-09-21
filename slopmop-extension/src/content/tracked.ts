import type { Community, Engagement, JudgeResponse } from "../shared/types";
import type { Fold } from "./fold";
import type { Outline } from "./highlight";
import type { VoteButton } from "./voteButton";

/** Everything the content script knows about one post on the page. */
export interface Tracked {
  el: HTMLElement;
  urn: string;
  engagement: Engagement;
  text: string;
  requested: boolean;
  response: JudgeResponse | null;
  restored: boolean;
  own: boolean;
  /** Too short / not English to act on: never hidden or outlined by the score. Scored only when you open the menu or vote. */
  inspectOnly: boolean;
  /** Jev was asked and did not answer. */
  done: boolean;
  /** Why the last attempt failed, for the menu. */
  failure: string | null;
  retries: number;
  /** The server's id for this post and what other people have said about it (from the last check). */
  contentId?: string;
  community?: Community;
  /** Set when the page asked the queue to drop this post because it was scrolled past; its "no answer" is then not a failure. */
  cancelled?: boolean;
  /** In-flight scoring request, so a menu/vote made mid-request waits for it instead of starting another. */
  pending?: Promise<void>;
  fold?: Fold;
  /** The coloured border (score, or your vote). */
  outline?: Outline;
  /** Identifies what `outline` shows, so a changed vote replaces it but an unchanged one is left alone. */
  outlineKey?: string;
  /** Red border kept on a post you unfolded. */
  refold?: Outline;
  vbtn?: VoteButton;
  counted?: "hidden" | "flagged";
}
