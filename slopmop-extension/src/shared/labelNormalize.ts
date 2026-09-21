import type { LabelRecord, Vote } from "./types";

/** Earlier builds stored "slop" / "not-slop"; map them onto the three-way vote. */
export function normalizeVote(v: unknown): Vote | null {
  if (v === "no" || v === "maybe" || v === "probably") return v;
  if (v === "slop") return "probably";
  if (v === "not-slop") return "no";
  return null;
}

export function normalizeRecord(r: unknown): LabelRecord | null {
  const rec = r as Partial<LabelRecord> | null;
  const label = normalizeVote(rec?.label);
  if (!rec || !label || typeof rec.urn !== "string" || !rec.verdict) return null;
  return { ...(rec as LabelRecord), label };
}
