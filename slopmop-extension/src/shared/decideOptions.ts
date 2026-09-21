import type { Params } from "./decideParams";

export interface DecideOpts {
  /** false = the shield keeps only its usefulness half, with no reader response (used for your own posts and drafts). */
  shield?: boolean;
  params?: Partial<Params>;
}
