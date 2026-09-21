import type { SurfaceStats } from "./types";

const CONTRACTION = /\b\w+['’](?:t|s|re|ve|ll|d|m)\b/gi;

/** Cheap, deterministic surface features. Known calculations stay in code; Jev gets them as facts. */
export function surfaceStats(text: string): SurfaceStats {
  const words = text.match(/[\p{L}\p{N}'’-]+/gu) ?? [];
  const wordCount = words.length;
  const sentences = text
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const lengths = sentences.map((s) => (s.match(/[\p{L}\p{N}'’-]+/gu) ?? []).length);
  const mean = lengths.reduce((a, b) => a + b, 0) / (lengths.length || 1);
  const variance = lengths.reduce((a, b) => a + (b - mean) ** 2, 0) / (lengths.length || 1);
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    wordCount,
    sentenceCount: sentences.length,
    sentenceLengthStdDev: round(Math.sqrt(variance)),
    contractionsPer100Words: round(((text.match(CONTRACTION) ?? []).length / (wordCount || 1)) * 100),
    exclamationCount: (text.match(/!/g) ?? []).length,
    emDashesPer1000Words: round(((text.match(/—/g) ?? []).length / (wordCount || 1)) * 1000),
  };
}
