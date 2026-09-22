import { h } from "../shared/dom";
import { displayScore } from "../shared/display";
import type { Decision, OwnLevel } from "../shared/types";
import { verdictLabel } from "../shared/verdict";
import { TONE_ACCENT } from "../shared/verdictStyle";
import type { InspectData } from "./inspectData";
import { developerDetails } from "./inspectorDeveloper";
import { radarChart } from "./inspectorRadar";
import { communityLine, personBar, scoreHeader, scoreZones, strongestSigns, verdictHeader, voteRow } from "./inspectorSections";
import { TELL_AXES } from "./labels";
import type { PanelState, VoteCtx } from "./votePanelTypes";

/**
 * The whole panel for one post, in order: the score, the verdict chip and why, the vote row (when interactive), the range
 * bar, the Slopprint (spider chart), the three counter-signal bars, and community votes at the very bottom.
 */
export function buildPanel(data: InspectData, vote?: VoteCtx): HTMLElement {
  const d = data.decision;
  const e = d.explain!;
  const verdict = verdictLabel(d as Decision & { ownLevel?: OwnLevel }, data.own);
  const axes = TELL_AXES.map((a) => ({ label: a.label, value: e.tells.find((t) => t.id === a.id)?.value ?? 0 }));
  const refoldBtn = vote?.canRefold ? h("button", { type: "button", class: "quiet-link" }, "Hide post again") : null;
  refoldBtn?.addEventListener("click", () => vote!.onRefold());
  return h(
    "div",
    { class: "panel", role: vote ? "dialog" : "tooltip", "aria-label": "Slop Mop breakdown" },
    scoreHeader(displayScore(d.score)),
    ...verdictHeader(data, e, verdict),
    ...(vote ? [voteRow(vote), ...(refoldBtn ? [refoldBtn] : [])] : []),
    ...scoreZones(data, e, d.score, vote?.current ?? data.vote),
    h("h4", { class: "sloppr" }, h("span", { class: "kicker" }, "The Slopprint"), "What Jev noticed"),
    strongestSigns(data, e),
    radarChart(axes, TONE_ACCENT[verdict.tone]) as unknown as HTMLElement,
    h("div", { class: "counterbars" }, ...personBar("Sounds like a person", e.humanVoice), ...personBar("Useful to readers", e.usefulness), ...personBar("Reader response", e.engagement.norm)),
    ...(data.advanced ? developerDetails(d, e) : []),
    communityLine(data.community),
  );
}

/** Shown in the panel while a post is scored on demand, or when it couldn't be. */
export function buildScoringPanel(s: PanelState): HTMLElement {
  if (s.problem) return h("div", { class: "panel notice", role: "alert" }, h("h4", {}, "Couldn't score this post"), h("p", { class: "outcome" }, s.problem));
  return h(
    "div",
    { class: "panel notice", role: "status", "aria-live": "polite" },
    h("div", { class: "dots", role: "img", "aria-label": "Scoring" }, h("i", {}), h("i", {}), h("i", {})),
  );
}
