import { MAX_ENGAGEMENT_COUNT } from "../constants.js";
import { contentIdFor } from "../content-id.js";
import { HttpError, isNum } from "../http.js";
import type { NetworkProfile } from "../networks.js";
import type { SurfaceStats } from "../questions.js";
import { requireNetwork } from "./shared.js";

export type Engagement = { reactions: number; comments: number; reposts: number };

export interface JudgeInput {
  network: NetworkProfile;
  text: string;
  contentId: string;
  surfaceStats: SurfaceStats;
  nativeId: string | null;
  engagement: Engagement | null;
}

// ---------------------------------------------------------------- reading the request

const STAT_KEYS: (keyof SurfaceStats)[] = ["wordCount", "sentenceCount", "sentenceLengthStdDev", "contractionsPer100Words", "exclamationCount", "emDashesPer1000Words"];

function parseSurface(v: unknown): SurfaceStats {
  const s = (typeof v === "object" && v !== null ? v : {}) as Record<string, unknown>;
  if (!STAT_KEYS.every((k) => isNum(s[k]))) throw new HttpError(422, "invalid_input", "surfaceStats must contain the six numeric fields.");
  return Object.fromEntries(STAT_KEYS.map((k) => [k, s[k]])) as unknown as SurfaceStats;
}

function parseEngagement(v: unknown): Engagement | null {
  if (typeof v !== "object" || v === null) return null;
  const e = v as Record<string, unknown>;
  const ok = (n: unknown): n is number => isNum(n) && n >= 0 && n < MAX_ENGAGEMENT_COUNT;
  return ok(e.reactions) && ok(e.comments) && ok(e.reposts) ? { reactions: e.reactions, comments: e.comments, reposts: e.reposts } : null;
}

export function parseJudgeInput(body: Record<string, unknown>): JudgeInput {
  const network = requireNetwork(body.network);
  const text = body.postText;
  if (typeof text !== "string" || text.trim().length < network.minChars || text.length > network.maxChars) {
    throw new HttpError(422, "invalid_input", `postText must be ${network.minChars}-${network.maxChars} characters.`);
  }
  return {
    network,
    text,
    contentId: contentIdFor(network.id, text),
    surfaceStats: parseSurface(body.surfaceStats),
    nativeId: typeof body.nativeId === "string" && network.nativeId?.test(body.nativeId) ? body.nativeId : null,
    engagement: parseEngagement(body.engagement),
  };
}
