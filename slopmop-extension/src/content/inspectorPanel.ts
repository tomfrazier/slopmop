import { h } from "../shared/dom";
import type { Decision, OwnLevel } from "../shared/types";
import { verdictLabel } from "../shared/verdict";
import type { InspectData } from "./inspectData";
import { developerDetails } from "./inspectorDeveloper";
import { TONE_COLOR } from "./inspectorFormat";
import { radarChart } from "./inspectorRadar";
import { personBar, scoreZones, strongestSigns, verdictHeader } from "./inspectorSections";
import { TELL_AXES } from "./labels";

/** The whole Details panel for one post. */
export function buildPanel(data: InspectData): HTMLElement {
  const d = data.decision;
  const e = d.explain!;
  const verdict = verdictLabel(d as Decision & { ownLevel?: OwnLevel }, data.own);
  const axes = TELL_AXES.map((a) => ({ label: a.label, value: e.tells.find((t) => t.id === a.id)?.value ?? 0 }));
  return h(
    "div",
    { class: "panel", role: "tooltip", "aria-label": "Slop Mop breakdown" },
    ...verdictHeader(data, e, verdict),
    ...scoreZones(data, e, d.score),
    strongestSigns(data, e),
    h("h4", { class: "sloppr" }, h("span", { class: "kicker" }, "The Slopprint"), "What Jev noticed"),
    radarChart(axes, TONE_COLOR[verdict.tone]) as unknown as HTMLElement,
    h("p", { class: "cap" }, "Further from the centre = a stronger sign of AI writing"),
    h("div", { class: "rows" }, ...personBar("Sounds like a person", e.humanVoice), ...personBar("Useful to readers", e.usefulness), ...personBar("Reader response", e.engagement.norm)),
    ...(data.advanced ? developerDetails(d, e) : []),
    h("p", { class: "note" }, "Vote with the mop icon beside the post’s “…” menu."),
  );
}
