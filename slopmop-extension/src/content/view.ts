import { voteHides } from "../shared/vote";
import type { Decision, Mode, OwnLevel, Vote } from "../shared/types";

/**
 * What should be drawn on a post, decided without touching the page. `outline.key` says what the border shows, so it is
 * redrawn when (and only when) that changes: a vote, a colour, or a different kind of border.
 */
export interface DesiredView {
  /** The folded strip that replaces the post. */
  fold: boolean;
  /** The red ring kept on a post the user unfolded. */
  refold: boolean;
  outline: { key: string; kind: "own" | "vote" | "score"; level?: OwnLevel; vote?: Vote; decision?: Decision } | null;
}

interface Facts {
  decision: Decision;
  mode: Mode;
  vote: Vote | null;
  /** The user unfolded this post (until they choose "Hide post again"). */
  restored: boolean;
  own: boolean;
  /** Too short / not English: never hidden or outlined by its score. */
  inspectOnly: boolean;
  scored: boolean;
  ownLevel?: OwnLevel;
}

/** Hidden when it should be hidden and hasn't been unfolded; ringed when it should be hidden and has been. */
const foldOrRing = (hide: boolean, restored: boolean) => ({ fold: hide && !restored, refold: hide && restored });

/**
 * Your own posts: always a coloured border (by your vote, else by score), never hidden.
 * Someone else's post you voted on: the vote replaces the score (Highlight: coloured border; Hide: "probably" hides it).
 * A post nobody voted on: hidden, outlined or left alone by its score and the mode.
 * Null means "leave what is there alone".
 */
export function desiredView(f: Facts): DesiredView | null {
  const none = { fold: false, refold: false };
  if (f.own) {
    if (!f.scored && !f.vote) return { ...none, outline: null };
    if (f.vote) return { ...none, outline: { key: `vote:${f.vote}`, kind: "vote", vote: f.vote } };
    return { ...none, outline: { key: `own:${f.ownLevel}`, kind: "own", level: f.ownLevel } };
  }
  if (f.vote) {
    return {
      ...foldOrRing(f.mode === "hide" && voteHides(f.vote), f.restored),
      outline: f.mode === "highlight" ? { key: `vote:${f.vote}`, kind: "vote", vote: f.vote } : null,
    };
  }
  if (f.inspectOnly) return null;
  const d = f.decision;
  return {
    ...foldOrRing(d.hide, f.restored),
    outline: d.level !== "none" && f.mode === "highlight" ? { key: `score:${d.level}`, kind: "score", decision: d } : null,
  };
}
