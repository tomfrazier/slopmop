import type { Decision, Engagement, JudgeResponse, Mode, Sensitivity, Vote } from "../shared/types";

/** Everything the breakdown panel needs about one post, gathered fresh at hover time. */
export interface InspectData {
  urn: string;
  text: string;
  own: boolean;
  engagement: Engagement;
  response: JudgeResponse;
  decision: Decision;
  mode: Mode;
  sensitivity: Sensitivity;
  /** Your vote on this post, if any. It overrides the score for what is shown. */
  vote: Vote | null;
  /** Show the numbers behind the score (developer builds only). */
  advanced?: boolean;
  /** A draft in the composer: not posted yet, scored on the writing alone. */
  draft?: { used: number; limit: number } | boolean;
}
