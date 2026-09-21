import { live } from "./manifest";
import type { Engagement } from "./types";

export const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Reader response, the way the server measures it by default (see the server's scoring.ts). The extension only uses this for
 * answers saved before the server sent its own, and for offline tuning; the live model is the server's and can be edited there.
 */
export interface EngagementModel {
  reaction: number;
  comment: number;
  repost: number;
  /** Reactions a post needs before a lack of comments and reposts looks hollow, the comment-plus-repost rate that counts as hollow, and the most credit that costs. */
  hollowFrom: number;
  hollowRatio: number;
  hollowFloor: number;
}
export const DEFAULT_ENGAGEMENT: EngagementModel = { reaction: 1, comment: 5, repost: 12, hollowFrom: 50, hollowRatio: 0.02, hollowFloor: 0.4 };
const ENGAGEMENT_LOG_SCALE = 4;
/** The shield is half "useful to a reader" and half "people engaged with it". */
export const SHIELD_USEFUL_SHARE = 0.5;

export function engagementNorm(e: Engagement, m: EngagementModel = DEFAULT_ENGAGEMENT): number {
  const weighted = m.reaction * e.reactions + m.comment * e.comments + m.repost * e.reposts;
  const depth = e.reactions > 0 ? (e.comments + e.reposts) / e.reactions : 1;
  const credit = e.reactions >= m.hollowFrom && depth < m.hollowRatio ? Math.max(m.hollowFloor, depth / m.hollowRatio) : 1;
  return clamp01(Math.log10(1 + weighted * credit) / ENGAGEMENT_LOG_SCALE);
}

/** Each step up in this is about 25% more (the manifest's engagementBandGrowth) reactions, comments and reposts together: a post is worth asking the server about again when its step changes. */
export const engagementBand = (e: Engagement): number => Math.round(Math.log1p(e.reactions + e.comments + e.reposts) / Math.log(live.values.engagementBandGrowth));
