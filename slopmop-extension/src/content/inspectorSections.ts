import { displayScore, displayZones } from "../shared/display";
import { live } from "../shared/manifest";
import { PALETTE } from "../shared/palette";
import { h } from "../shared/dom";
import type { Explain } from "../shared/types";
import type { VerdictTone } from "../shared/verdict";
import { VOTE_COLOR, VOTE_NAME } from "../shared/vote";
import type { InspectData } from "./inspectData";
import { bar, pct, tellLabel, TONE_COLOR } from "./inspectorFormat";

// ---- what counts as strong ----
/** A tell at or above this is a "strong sign". Lower for a post that was flagged anyway. */
const MAX_NAMED_SIGNS = 3;

/** A full bar, as a percentage. */
const FULL_BAR_PCT = 100;
/** The plain verdict and the one sentence that says why. */
export function verdictHeader(data: InspectData, e: Explain, verdict: { text: string; tone: VerdictTone }) {
  const draftNote = data.draft
    ? h("div", { class: "banner" }, h("b", {}, "Draft. "), "Not posted yet, so it's scored on the writing alone, with no reader response.", typeof data.draft === "object" ? ` This used one check (${data.draft.used} of ${data.draft.limit} today).` : "")
    : null;
  const banner = data.vote
    ? h("div", { class: "banner" }, "You voted ", h("b", { style: `color:${VOTE_COLOR[data.vote]}` }, VOTE_NAME[data.vote]), " on this post. Your vote overrides the score for what is shown; use the mop icon to change it.")
    : null;
  return [draftNote, banner, h("div", { class: "head" }, h("span", { class: "pill", style: `background:${TONE_COLOR[verdict.tone]}` }, verdict.text), h("p", { class: "outcome" }, e.outcome))];
}

/**
 * Looks fine / Possibly / Likely, with the post's place on it. The three zones are the same in both modes; in Hide mode a
 * line marks where posts get hidden. If the post sits past a line but wasn't flagged (it reads as person-written, or Jev
 * wasn't sure), the bar is dimmed and says so, so the marker isn't read as a verdict.
 */
export function scoreZones(data: InspectData, e: Explain, score: number) {
  // The bar is the shown 0-100 scale. Its lines are this sensitivity's cutoffs, drawn where they fall on that scale, so the
  // post's number is the same at every sensitivity and only the cutoffs move.
  const zone = displayZones(e);
  const possibly = `${zone.possibly}%`;
  const likely = `${zone.likely}%`;
  const pos = (raw: number) => `${Math.min(FULL_BAR_PCT, displayScore(raw))}%`;
  const hides = data.mode === "hide" && !data.own;
  const blocked = data.decision.level === "none" && score >= e.yellowAt;
  const zones = h(
    "div",
    { class: blocked ? "zones blocked" : "zones" },
    h("i", { style: `width:${possibly};background:${PALETTE.blue200}` }),
    h("i", { style: `width:calc(${likely} - ${possibly});background:${PALETTE.mop200}` }),
    h("i", { style: `flex:1;background:${PALETTE.red200}` }),
    ...(hides ? [h("div", { class: "cut", style: `left:${likely}`, title: "Posts past this line are hidden" })] : []),
    h("div", { class: "dot", style: `left:${pos(score)}` }),
  );
  const labels = h(
    "div",
    { class: "zlabels" },
    h("span", { style: `width:${possibly}` }, "Looks fine"),
    h("span", { style: `width:calc(${likely} - ${possibly})` }, "Possibly"),
    h("span", { style: "flex:1" }, hides ? "Likely (hidden)" : "Likely"),
  );
  return [zones, labels, ...(blocked ? [h("p", { class: "note" }, "The score is past a line, but this post isn't flagged: see the note above.")] : [])];
}

/** "Strongest signs: …". A flagged post always names what pushed it there; an unflagged one only mentions strong ones. */
export function strongestSigns(data: InspectData, e: Explain) {
  const flagged = data.decision.level !== "none" || data.own;
  let named = e.tells.filter((t) => t.value >= (flagged ? live.values.flaggedSign : live.values.strongSign)).slice(0, MAX_NAMED_SIGNS).map((t) => tellLabel(t.id));
  if (flagged && !named.length) named = e.tells.slice(0, 2).map((t) => tellLabel(t.id)); // many mild tells added up: still say which led
  return named.length ? h("p", { class: "signals" }, "Strongest signs: ", h("b", {}, named.join(", "))) : h("p", { class: "signals" }, "No strong signs of AI writing.");
}

export const personBar = (label: string, val: number) => [h("span", { class: "n" }, label), bar(val, PALETTE.blue500), h("span", { class: "num" }, pct(val))];
