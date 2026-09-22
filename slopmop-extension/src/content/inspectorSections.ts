import { displayScore, displayZones } from "../shared/display";
import { live } from "../shared/manifest";
import { PALETTE } from "../shared/palette";
import { h } from "../shared/dom";
import type { Community, Explain } from "../shared/types";
import type { VerdictTone } from "../shared/verdict";
import { TONE_DARK, TONE_STYLE } from "../shared/verdictStyle";
import { VOTE_NAME, voteLevel } from "../shared/vote";
import type { Vote } from "../shared/types";
import type { InspectData } from "./inspectData";
import { bar, tellLabel } from "./inspectorFormat";
import type { VoteCtx } from "./votePanelTypes";

// ---- what counts as strong ----
/** A tell at or above this is a "strong sign". Lower for a post that was flagged anyway. */
const MAX_NAMED_SIGNS = 3;

/** A full bar, as a percentage. */
const FULL_BAR_PCT = 100;

/** "<X> / 100", above the chip and at least as prominent: the number leads the panel. */
export function scoreHeader(score: number) {
  return h("div", { class: "scorehead" }, h("span", { class: "num" }, String(Math.round(score))), h("span", { class: "of" }, " / 100"));
}

/** The verdict chip, styled per the design system's verdict scale (a wash background, coloured text, thin border — never colour alone), and the one sentence that says why. */
export function verdictHeader(data: InspectData, e: Explain, verdict: { text: string; tone: VerdictTone }) {
  const draftNote = data.draft
    ? h("div", { class: "banner" }, h("b", {}, "Draft. "), "Not posted yet, so it's scored on the writing alone, with no reader response.", typeof data.draft === "object" ? ` This used one check (${data.draft.used} of ${data.draft.limit} today).` : "")
    : null;
  const banner = data.vote
    ? h("div", { class: "banner" }, "You voted ", h("b", { style: `color:${TONE_STYLE[voteLevel(data.vote)].text}` }, VOTE_NAME[data.vote]), " on this post. Your vote overrides the score for what is shown.")
    : null;
  const st = TONE_STYLE[verdict.tone];
  return [draftNote, banner, h("div", { class: "head" }, h("span", { class: "pill", style: `background:${st.bg};color:${st.text};border:1px solid ${st.border}` }, verdict.text), h("p", { class: "outcome" }, e.outcome))];
}

const VOTE_OPTIONS: { v: Vote | null; label: string }[] = [
  { v: null, label: "Not sure" },
  { v: "no", label: "No" },
  { v: "maybe", label: "Maybe" },
  { v: "probably", label: "Probably" },
];

/** The 4-state "Is this post slop?" row: Not sure / No / Maybe / Probably, coloured to match the verdict scale once picked. */
export function voteRow(ctx: VoteCtx): HTMLElement {
  const group = h(
    "div",
    { class: "voterow", role: "radiogroup", "aria-label": "Is this post slop?" },
    ...VOTE_OPTIONS.map(({ v, label }) => {
      const on = ctx.current === v;
      const tone: VerdictTone = v ? voteLevel(v) : "grey";
      const st = TONE_STYLE[tone];
      const btn = h("button", { type: "button", role: "radio", "aria-checked": String(on), style: on ? `background:${st.bg};color:${st.text};border-color:${st.border}` : "" }, label) as HTMLButtonElement;
      btn.addEventListener("click", () => ctx.onPick(v));
      return btn;
    }),
  );
  return ctx.error ? (h("div", { class: "voterow-wrap" }, group, h("div", { class: "err" }, ctx.error)) as HTMLElement) : group;
}

/**
 * Looks fine / Possibly / Likely, with the post's place on it. The three zones are the same in both modes; in Hide mode a
 * line marks where posts get hidden. A vote moves the dot to the middle of its own zone and recolours it to match; with no
 * vote the dot sits at the raw score in the neutral colour. If the post sits past a line but wasn't flagged (it reads as
 * person-written, or Jev wasn't sure), the bar is dimmed and says so, so the marker isn't read as a verdict.
 */
export function scoreZones(data: InspectData, e: Explain, score: number, vote: Vote | null) {
  const zone = displayZones(e);
  const possibly = `${zone.possibly}%`;
  const likely = `${zone.likely}%`;
  const hides = data.mode === "hide" && !data.own;
  const blocked = data.decision.level === "none" && score >= e.yellowAt;
  const voteTone: VerdictTone | null = vote ? voteLevel(vote) : null;
  const dotLeft =
    voteTone === "green" ? zone.possibly / 2 : voteTone === "yellow" ? (zone.possibly + zone.likely) / 2 : voteTone === "red" ? (zone.likely + 100) / 2 : Math.min(FULL_BAR_PCT, displayScore(score));
  const dotColor = voteTone ? TONE_DARK[voteTone] : "var(--ink-900)";
  const zones = h(
    "div",
    { class: blocked ? "zones blocked" : "zones" },
    h("i", { style: `width:${possibly};background:${PALETTE.blue200}` }),
    h("i", { style: `width:calc(${likely} - ${possibly});background:${PALETTE.mop200}` }),
    h("i", { style: `flex:1;background:${PALETTE.red200}` }),
    ...(hides ? [h("div", { class: "cut", style: `left:${likely}`, title: "Posts past this line are hidden" })] : []),
    h("div", { class: "dot", style: `left:${Math.min(100, Math.max(0, dotLeft))}%;background:${dotColor}` }),
  );
  // Laid out as three natural-width labels (start / centre / end), never sized to their own zone's width, so a narrow
  // zone (aggressive sensitivities can squeeze "Possibly" down a great deal) never clips its label against the panel edge.
  const labels = h("div", { class: "zlabels" }, h("span", { class: "zl start" }, "Looks fine"), h("span", { class: "zl mid" }, "Possibly"), h("span", { class: "zl end" }, hides ? "Likely (hidden)" : "Likely"));
  return [zones, labels, ...(blocked ? [h("p", { class: "note" }, "The score is past a line, but this post isn't flagged: see the note above.")] : [])];
}

/** "Strongest signs: …". A flagged post always names what pushed it there; an unflagged one only mentions strong ones. */
export function strongestSigns(data: InspectData, e: Explain) {
  const flagged = data.decision.level !== "none" || data.own;
  let named = e.tells.filter((t) => t.value >= (flagged ? live.values.flaggedSign : live.values.strongSign)).slice(0, MAX_NAMED_SIGNS).map((t) => tellLabel(t.id));
  if (flagged && !named.length) named = e.tells.slice(0, 2).map((t) => tellLabel(t.id)); // many mild tells added up: still say which led
  return named.length ? h("p", { class: "signals" }, "Strongest signs: ", h("b", {}, named.join(", "))) : h("p", { class: "signals" }, "No strong signs of AI writing.");
}

/** A counter-signal bar with no trailing percentage (the bar itself is the number). */
export const personBar = (label: string, val: number) => [h("span", { class: "n" }, label), bar(val, PALETTE.blue500)];

/** "3 flagged as slop · 1 maybe · 2 no", low-priority at the very bottom (most posts have none). */
export function communityLine(c: Community | null | undefined): HTMLElement {
  if (!c || c.total === 0) return h("div", { class: "community" }, "No community votes yet");
  return h("div", { class: "community" }, `${c.probably} flagged as slop · ${c.maybe} maybe · ${c.no} no`);
}
