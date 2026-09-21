import { PALETTE } from "../shared/palette";
import { h } from "../shared/dom";
import type { Decision, Explain } from "../shared/types";
import { bar, f2, nameOf, pct } from "./inspectorFormat";

/** Tell bars turn amber and red at these values. */
const AMBER_TELL = 0.33;
const RED_TELL = 0.66;

/** The colour of a tell's bar: quiet, amber or red by how strong it is. */
const tellColor = (value: number) => (value >= RED_TELL ? PALETTE.red500 : value >= AMBER_TELL ? PALETTE.mop500 : PALETTE.ink300);

/** Numbers for tuning: only in developer builds (the popup's Debug switch). Never shows weights. */
export function developerDetails(d: Decision, e: Explain) {
  const eng = e.engagement;
  const shieldLine = !e.shieldOn ? `${pct(d.shield)} off from usefulness alone (${f2(e.usefulness)}); your own posts don't count reader response` : `${pct(d.shield)} off (useful ${f2(e.usefulness)}, reader response ${f2(eng.norm)}${e.source === "server" ? "; worked out on the server" : ""})`;
  const row = (label: string, ...cells: (string | HTMLElement)[]) => h("tr", {}, h("td", {}, label), h("td", {}, ...cells));
  return [
    h("h4", {}, "Developer details"),
    h(
      "table",
      { class: "math" },
      row("AI-drafted?", h("b", {}, f2(e.aiLikelihood)), ` → score ×${f2(e.aiDampen)}`),
      row("Signs standing out", h("b", {}, String(e.breakouts)), e.breakouts < 2 ? " (fewer than two: the slop score is cut)" : " (enough to count in full)"),
      row("Tell slop", h("b", {}, f2(d.slop)), e.source === "server" ? ` = tell mean ${f2(e.mean)}, less the human-voice offset (worked out on the server)` : ` = mean ${f2(e.mean)} × ${e.gain} − ${e.humanOffset} × voice ${f2(e.humanVoice)}`),
      row("Shield", shieldLine, h("br"), h("span", { class: "dim" }, `${eng.reactions} reactions · ${eng.comments} comments · ${eng.reposts} reposts`)),
      row("Score", h("b", {}, f2(d.score)), ` = slop × (1 − shield) × ${f2(e.aiDampen)} · ${e.sensitivity}: possibly ≥ ${f2(e.yellowAt)}, likely ≥ ${f2(e.threshold)}`),
      row("Confidence", h("b", {}, f2(e.meanConfidence)), " avg ", h("span", { class: e.lowConfidence ? "no" : "dim" }, e.lowConfidence ? `(below ${f2(e.minMeanConfidence)}: not trusted)` : "(fine)")),
    ),
    h("div", { class: "rows" }, ...e.tells.flatMap((t) => [h("span", { class: "n", title: t.id }, nameOf(t.id)), bar(t.value, tellColor(t.value)), h("span", { class: "num" }, f2(t.value))])),
  ];
}
