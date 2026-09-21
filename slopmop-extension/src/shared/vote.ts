import { PALETTE } from "./palette";
import type { OwnLevel, Vote } from "./types";

/** A vote drives the same three colours as your own-post scores: no = blue, maybe = yellow, probably = red. */
export const voteLevel = (v: Vote): OwnLevel => (v === "no" ? "green" : v === "maybe" ? "yellow" : "red");

export const VOTE_NAME: Record<Vote, string> = { no: "No", maybe: "Maybe", probably: "Probably" };
export const VOTE_HINT: Record<Vote, string> = { no: "not slop", maybe: "borderline", probably: "slop" };
export const VOTE_COLOR: Record<Vote, string> = { no: PALETTE.blue500, maybe: PALETTE.mop500, probably: PALETTE.red500 };

/** In Hide mode only "probably" hides a post; "no" and "maybe" always leave it visible, overriding the score. */
export const voteHides = (v: Vote): boolean => v === "probably";
