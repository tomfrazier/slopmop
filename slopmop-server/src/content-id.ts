import { createHash } from "node:crypto";

/**
 * Text normalisation for identity: two views of the same post must map to the same id even when whitespace, case,
 * zero-width characters or Unicode forms differ. (LinkedIn's own ids differ between its feed, profile carousel and
 * "see all" pages, and card keys are viewer-specific, so the text is the only identity every view shares.)
 */
export function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[​-‍⁠﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Stable content id: a hash, so the registry can identify a post without having to keep its text. */
export function contentIdFor(network: string, text: string): string {
  return createHash("sha256").update(`${network}\n${normalizeText(text)}`).digest("hex").slice(0, 32);
}

export const CONTENT_ID_RE = /^[a-f0-9]{32}$/;
