/**
 * Same normalisation the server uses to identify content: a post is the same post whatever its whitespace, case,
 * zero-width characters or Unicode form. Used here as the local cache key, so a post scored in one LinkedIn view
 * (feed, profile carousel, "see all") is reused in the others instead of spending another daily check.
 */
export function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[​-‍⁠﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
