import { PALETTE } from "../shared/palette";
import { voteLevel } from "../shared/vote";
import type { Decision, OwnLevel, Vote } from "../shared/types";

const COLORS = { green: PALETTE.blue500, yellow: PALETTE.mop500, red: PALETTE.red500 } as const;

export interface Outline {
  remove(): void;
}

/** A 3px coloured border round the post. Nothing else is added to the post: the score and details live in the mop menu. */
function ring(post: HTMLElement, color: string): Outline {
  const prev = { shadow: post.style.boxShadow, radius: post.style.borderRadius };
  post.style.boxShadow = `0 0 0 3px ${color}`;
  post.style.borderRadius ||= "8px";
  return {
    remove() {
      post.style.boxShadow = prev.shadow;
      post.style.borderRadius = prev.radius;
    },
  };
}

/** Highlight mode: yellow/red border for other people's posts. */
export const outline = (post: HTMLElement, d: Decision): Outline => ring(post, d.level === "red" ? COLORS.red : COLORS.yellow);

/** Your own posts: always blue (clean), yellow or red. */
export const ownOutline = (post: HTMLElement, level: OwnLevel): Outline => ring(post, COLORS[level]);

/** Your vote: blue = no, yellow = maybe, red = probably. */
export const voteOutline = (post: HTMLElement, vote: Vote): Outline => ring(post, COLORS[voteLevel(vote)]);

/** A post you unfolded keeps its red border; "Hide post again" is in the mop menu. */
export const refoldRing = (post: HTMLElement): Outline => ring(post, COLORS.red);
