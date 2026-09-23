import { POST_SELECTOR, SEL } from "./selectors";



export function getUrn(el: Element): string | null {
  const key = el.getAttribute("componentkey");
  if (key && SEL.componentKeyPrefix.test(key)) return `post:${key.replace(SEL.componentKeyPrefix, "")}`;
  for (const a of SEL.urnAttrs) {
    const v = el.getAttribute(a);
    if (v?.startsWith("urn:li:activity:")) return v;
  }
  return el.querySelector('[data-urn^="urn:li:activity:"]')?.getAttribute("data-urn") ?? null;
}

/** Parses "1.2K", "3,456", "12 comments" style counts. */
export function parseCount(raw: string | null | undefined): number {
  if (!raw) return 0;
  const m = raw.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*([kKmM])?/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  return Math.round(m[2] ? n * (m[2].toLowerCase() === "k" ? 1e3 : 1e6) : n);
}

/**
 * Finds a leaf element whose whole text is "<count> <word>(s)" and returns the count. Some post layouts (seen on a
 * video post 2026-09-22) render the count alone (`<span aria-hidden="true">5,543</span>`) and put the word only in an
 * ancestor's `aria-label` ("5,543 Reactions") — reactions read as 0 on such a post while comments and reposts, whose
 * layout does carry the word inline, were unaffected. So a second pass checks `aria-label`s the same way.
 */
export function countFor(el: Element, word: string): number {
  const re = new RegExp(`^\\s*(\\d[\\d,.]*\\s*[kKmM]?)\\s+${word}s?\\s*$`, "i");
  // Every match counts and the largest wins: a post card can hold other counts with the same word (the reaction count on a comment
  // in the preview, "2 reactions", was read instead of the post's own 214), and the post's own count is always the biggest.
  let best = 0;
  for (const n of el.querySelectorAll(SEL.countLeaf)) {
    if (n.childElementCount > 0) continue; // leaf text only, so comment bodies can't match
    const m = re.exec(n.textContent ?? "");
    if (m) best = Math.max(best, parseCount(m[1]));
  }
  for (const n of el.querySelectorAll("[aria-label]")) {
    const m = re.exec(n.getAttribute("aria-label") ?? "");
    if (m) best = Math.max(best, parseCount(m[1]));
  }
  return best;
}

/** An element's own text, ignoring any descendant elements' text (an icon can sit beside the word without hiding it). */
function ownText(n: Element): string {
  let text = "";
  for (const child of n.childNodes) if (child.nodeType === Node.TEXT_NODE) text += child.textContent;
  return text;
}

/**
 * True for sponsored/promoted cards. Never analysed, sent, hidden or outlined.
 * A post confirmed "Promoted" on the live feed (2026-09-22) was missed here: its permalink view (the only copy
 * later reachable for debugging) didn't reproduce the feed's ad chrome, so the exact markup that slipped through
 * is unconfirmed. Hardened defensively: the label no longer has to be a whole leaf's only content (an icon sharing
 * its container no longer hides it, via `ownText`), and a bullet/pipe joining it to the timestamp is tolerated.
 */
export function isAd(el: Element): boolean {
  for (const n of el.querySelectorAll("[aria-label]")) {
    if (SEL.adAria.test(n.getAttribute("aria-label") ?? "")) return true;
  }
  for (const n of el.querySelectorAll(SEL.promotedLeaf)) {
    for (const part of ownText(n).split(SEL.promotedSeparator)) {
      if (SEL.promotedText.test(part)) return true;
    }
  }
  return false;
}

/** True when the author line of the post says "• You": it is the signed-in user's own post. */
export function saysYou(el: Element): boolean {
  for (const scope of el.querySelectorAll(SEL.actorScope)) {
    for (const n of scope.querySelectorAll("span")) {
      if (n.childElementCount === 0 && SEL.youMarker.test(n.textContent ?? "") && /•/.test(scope.textContent ?? "")) return true;
    }
  }
  return false;
}

export function authorOf(el: Element): string | null {
  const label = el.querySelector(SEL.authorAria)?.getAttribute("aria-label");
  return label ? label.slice(SEL.authorPrefix.length).trim() : null;
}

/**
 * The signed-in user's name, read from the left-rail profile avatar (an <img alt=name> linking to /in/...),
 * ignoring avatars inside post cards. First match in document order wins.
 */
export function findOwnName(root: ParentNode = document): string | null {
  for (const img of root.querySelectorAll<HTMLImageElement>(SEL.profileImg)) {
    const alt = img.alt.trim();
    if (!alt || img.closest(POST_SELECTOR)) continue;
    const href = img.closest("a")?.getAttribute("href") ?? "";
    if (SEL.profileHref.test(href)) return alt;
  }
  return null;
}
