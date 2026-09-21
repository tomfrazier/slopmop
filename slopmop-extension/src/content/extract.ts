import { authorOf, countFor, getUrn, isAd, saysYou } from "./extractSignals";
import { firstMatch, SEL } from "./selectors";
import { live } from "../shared/manifest";
import type { Engagement } from "../shared/types";

export { authorOf, findOwnName, getUrn, isAd, parseCount } from "./extractSignals";


/** Debug "label every post" mode: the smallest text the server accepts (it rejects < 20 chars). */
export const MIN_LENIENT_CHARS = 20;

export type Inspected =
  | { status: "ok"; post: ExtractedPost }
  | { status: "ad" | "noId" | "short" | "notEnglish" };

export interface ExtractedPost {
  urn: string;
  text: string;
  engagement: Engagement;
  /** Written by the signed-in user. */
  own: boolean;
  /** Only in lenient (debug) mode: too short or not English to act on, analysed so it can still be inspected and voted on. */
  inspectOnly?: boolean;
}

/** The reaction, comment and repost counts a post shows right now. */
export const readEngagement = (el: Element): Engagement => ({ reactions: countFor(el, "reaction"), comments: countFor(el, "comment"), reposts: countFor(el, "repost") });

/**
 * `lenient` (debug only) lets short and non-English posts through as `inspectOnly`, so every post can be
 * inspected and voted on. They are never hidden or outlined: the normal thresholds still apply to everything else.
 */
export function inspectPost(el: Element, ownName: string | null = null, lenient = false): Inspected {
  const urn = getUrn(el);
  if (!urn) return { status: "noId" };
  if (isAd(el)) return { status: "ad" };
  const author = authorOf(el);
  const own = (!!ownName && author === ownName) || saysYou(el);
  const textEl = firstMatch(el, SEL.text) as HTMLElement | null;
  const raw = textEl?.innerText ?? textEl?.textContent ?? "";
  const text = raw.replace(SEL.moreSuffix, "").replace(/[ \t]+\n/g, "\n").trim();
  const tooShort = text.length < (own ? live.values.minOwnChars : live.values.minChars);
  const notEnglish = !tooShort && !looksEnglish(text);
  const inspectOnly = tooShort || notEnglish;
  if (inspectOnly && !(lenient && text.length >= MIN_LENIENT_CHARS)) return { status: tooShort ? "short" : "notEnglish" };
  return {
    status: "ok",
    post: {
      urn,
      text,
      own,
      inspectOnly: inspectOnly || undefined,
      engagement: readEngagement(el),
    },
  };
}

/** Back-compat wrapper: the post, or null if it should be left alone. */
export function extractPost(el: Element, ownName: string | null = null): ExtractedPost | null {
  const r = inspectPost(el, ownName);
  return r.status === "ok" ? r.post : null;
}

/** Cheap check: Jev is strongest in English, so skip posts that are mostly non-Latin or non-English function words. */
export function looksEnglish(text: string): boolean {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (!letters.length) return false;
  const latin = text.match(/\p{Script=Latin}/gu) ?? [];
  if (latin.length / letters.length < 0.9) return false;
  const hits = text.toLowerCase().match(/\b(the|and|to|of|is|in|that|it|for|you|with|on|are|this|we|i)\b/g) ?? [];
  const words = text.split(/\s+/).length;
  return hits.length / words > 0.12;
}
