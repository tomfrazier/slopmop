import type { VerdictTone } from "./verdict";

/**
 * The design system's "verdict scale" (guidelines/color-signals.card.html): each of the four words is a wash background,
 * coloured text and a thin border of the same colour — never colour alone. Used for the chip and the vote row's selected segment.
 */
export interface ToneStyle {
  bg: string;
  text: string;
  border: string;
}

export const TONE_STYLE: Record<VerdictTone, ToneStyle> = {
  red: { bg: "var(--red-100)", text: "var(--red-700)", border: "var(--red-500)" },
  yellow: { bg: "var(--mop-100)", text: "var(--mop-900)", border: "var(--mop-500)" },
  grey: { bg: "var(--flag-unsure-wash)", text: "var(--ink-700)", border: "var(--ink-300)" },
  green: { bg: "var(--blue-100)", text: "var(--blue-700)", border: "var(--blue-200)" },
};

/** The single bright accent for each tone: the mop icon at rest, the vote row's selected fill, the range-bar dot at rest. */
export const TONE_ACCENT: Record<VerdictTone, string> = {
  red: "var(--red-500)",
  yellow: "var(--mop-500)",
  grey: "var(--ink-400)",
  green: "var(--blue-500)",
};

/** A darker shade of each tone's accent: the range-bar dot once a vote has picked a zone (same shade as the chip's text). */
export const TONE_DARK: Record<VerdictTone, string> = {
  red: "var(--red-700)",
  yellow: "var(--mop-900)",
  grey: "var(--ink-700)",
  green: "var(--blue-700)",
};
