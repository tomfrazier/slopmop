import type { Decision, OwnLevel } from "./types";

export type VerdictTone = "green" | "yellow" | "red" | "grey";

/**
 * The words a person sees for a decision, in one place so the menu and the Details panel always agree.
 * Consumer language: "Possibly" and "Likely" (the colours are yellow and red, but the words describe how sure we are).
 */
export function verdictLabel(d: Decision & { ownLevel?: OwnLevel }, own: boolean): { text: string; tone: VerdictTone } {
  if (own) return d.ownLevel === "red" ? { text: "Likely slop", tone: "red" } : d.ownLevel === "yellow" ? { text: "Possibly slop", tone: "yellow" } : { text: "Reads clean", tone: "green" };
  if (d.level === "red") return { text: "Likely slop", tone: "red" };
  if (d.level === "yellow") return { text: "Possibly slop", tone: "yellow" };
  const e = d.explain;
  if (e?.lowConfidence) return { text: "Not sure", tone: "grey" };
  return { text: "Looks fine", tone: "grey" };
}
