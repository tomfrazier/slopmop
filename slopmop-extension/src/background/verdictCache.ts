import { live } from "../shared/manifest";
import { normalizeText } from "../shared/text";
import type { JudgeResponse } from "../shared/types";
import { NETWORK } from "../shared/config";

interface Cached {
  at: number;
  response: JudgeResponse;
  /** The engagement step (see engagementBand) the post was at when the answer was saved. */
  band?: number;
}

async function hash(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Keyed by the post's text, not the view-specific id, so the same post in another LinkedIn view is a cache hit. */
export const cacheKey = (text: string) => hash(`${NETWORK}\n${normalizeText(text)}`);

// The server can change its tell weights at any time (the admin edits them live). Answers saved under older weights are
// stale: refetch them, so a change reaches posts already seen. Only the server knows the current version; it arrives with answers.
let weightsVersion: string | null = null;
const versionLoaded = chrome.storage.local.get("weightsVersion").then((r) => {
  if (typeof r.weightsVersion === "string") weightsVersion = r.weightsVersion;
});

export function learnWeightsVersion(v: unknown) {
  if (typeof v !== "string" || v === weightsVersion) return;
  weightsVersion = v;
  void chrome.storage.local.set({ weightsVersion: v });
}

/**
 * A saved answer we can still use, or null. Refetch entries that predate the content registry (no contentId) or the private
 * tell weights (no tellMean), ones scored under weights the server has since changed, ones past their time, and ones whose
 * post has since gained enough engagement (`band`, the post's current step) that the server's shield would now differ.
 */
export async function readCached(key: string, band?: number): Promise<JudgeResponse | null> {
  const got = (await chrome.storage.local.get(`v:${key}`))[`v:${key}`] as Cached | undefined;
  await versionLoaded;
  if (!got) return null;
  const sameWeights = weightsVersion === null || got.response.weightsVersion === weightsVersion;
  const complete = !!got.response.contentId && got.response.tellMean !== undefined;
  const age = Date.now() - got.at;
  const grown = band !== undefined && got.band !== undefined && band > got.band; // only growth: the server decides whether Jev is asked again
  return sameWeights && complete && !grown && age < live.values.cacheTtlMs ? got.response : null;
}

/** Saves an answer (raw Jev answers only, so settings changes never re-run inference), and the usage it reported. */
export function writeCached(key: string, response: JudgeResponse, band?: number) {
  return chrome.storage.local.set({ [`v:${key}`]: { at: Date.now(), response, band } satisfies Cached, ...(response.usage ? { usage: response.usage } : {}) });
}
