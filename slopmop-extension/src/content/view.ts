import { voteHides } from "../shared/vote";
import type { Decision, Mode, OwnLevel, Vote } from "../shared/types";

/**
 * What should be drawn on a post, decided without touching the page. `outline.key` says what tone the mop icon shows, so it
 * is redrawn when (and only when) that changes: a vote, a colour, or a different kind of tone.
 */
export interface DesiredView {
  /** The folded strip that replaces the post. */
  fold: boolean;
  /** True once a post that should be hidden has been unfolded, so the panel can offer "Hide post again". */
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
 * Your own posts: always a coloured icon (by your vote, else by score), never hidden.
 * Someone else's post you voted on: the vote replaces the score for the icon in both modes; in Hide mode "probably" also hides it.
 * A post nobody voted on: the icon always shows the score's colour (in both modes); in Hide mode a red one is also hidden.
 * The icon is a small tint on the mop button, not a page-wide border, so unlike the old border it is never mode-gated:
 * a post that doesn't meet the hide bar still deserves a quiet, unobtrusive sign it was noticed.
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
      outline: { key: `vote:${f.vote}`, kind: "vote", vote: f.vote },
    };
  }
  if (f.inspectOnly) return null;
  const d = f.decision;
  return {
    ...foldOrRing(d.hide, f.restored),
    outline: d.level !== "none" ? { key: `score:${d.level}`, kind: "score", decision: d } : null,
  };
}
