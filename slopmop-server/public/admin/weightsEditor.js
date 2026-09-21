// The tell-weights editor: sliders per tell, save/reset, and the change history.
import { el } from "./dom.js";
import { fmt } from "./format.js";
import { hooks } from "./hooks.js";
import { suggestionBlock } from "./weightsSuggestion.js";
import { W, loadIntoEditor, saveWeights } from "./weightsState.js";
import { table } from "./widgets.js";

const SLIDER_MAX = 3;
/** The two counter-tells: they work against the score, so they sit under their own heading. */
const COUNTER_IDS = ["humanVoice", "usefulness"];
const COUNTER_NOTES = {
  humanVoice: "How much a personal, human voice takes off the slop score. 1 is as designed, 0 ignores it.",
  usefulness: "How much of the shield comes from Jev's usefulness answer (the rest is engagement). 1 is as designed, 0 uses engagement only.",
};
const SLIDER_STEP = 0.05;

// ---- one slider row ----
function weightRow(id, current, onEdit) {
  const range = el("input", { type: "range", min: "0", max: String(SLIDER_MAX), step: String(SLIDER_STEP), value: String(W.draft[id]), "aria-label": `${fmt.human(id)} weight` });
  const num = el("input", { type: "number", min: "0", max: "100", step: String(SLIDER_STEP), value: String(W.draft[id]), class: "field field-num", "aria-label": `${fmt.human(id)} weight value` });
  const flag = el("span", { class: "sub was" }, "");
  const paint = () => (flag.textContent = Math.abs(Number(W.draft[id]) - current[id]) > 1e-9 ? `was ${current[id]}` : "");
  const set = (v) => {
    W.draft[id] = Number.isFinite(v) ? v : 0;
    W.dirty = true;
    range.value = String(Math.min(SLIDER_MAX, W.draft[id]));
    num.value = String(W.draft[id]);
    paint();
    onEdit();
  };
  range.addEventListener("input", () => set(Number(range.value)));
  num.addEventListener("input", () => set(Number(num.value)));
  paint();
  return el("div", { class: "wrow" }, el("span", { title: id }, fmt.human(id)), range, num, flag);
}

// ---- buttons and note ----
function editorControls(d) {
  const note = el("input", { type: "text", placeholder: "Note (optional): why this change", maxlength: "200", value: W.note, class: "field field-note", "aria-label": "Note for this change" });
  note.addEventListener("input", () => (W.note = note.value));
  const save = el("button", { class: "primary", type: "button", disabled: !W.dirty, onclick: () => saveWeights({ weights: W.draft, note: W.note }) }, "Save weights");
  const baseline = d.baseline.source === "env" ? "TELL_WEIGHTS" : "the defaults (all 1)";
  const controls = el(
    "div",
    { class: "tools editor-actions" },
    save,
    el("button", { type: "button", onclick: () => ((W.dirty = false), (W.draft = { ...d.effective.weights }), hooks.refresh()) }, "Discard changes"),
    el("button", { type: "button", onclick: () => confirm(`Drop the live edit and go back to ${baseline}?`) && void saveWeights({ reset: true, note: W.note }) }, "Reset to baseline"),
    note,
  );
  return { controls, enableSave: () => (save.disabled = false) };
}

// ---- change history ----
const historyTable = (d) =>
  table(
    [
      { h: "When", v: (c) => fmt.time(c.at) },
      { h: "What", v: (c) => (c.source === "reset" ? "reset to baseline" : "edit") },
      { h: "Note", v: (c) => c.note || "-" },
      { h: "", v: (c) => el("button", { type: "button", onclick: () => loadIntoEditor(c.weights), title: "Load these weights into the editor (not saved until you press Save)" }, "Load") },
    ],
    d.history,
    "No changes yet.",
  );

/** The whole editor card. */
export function weightsCard() {
  const d = W.data;
  if (!d) return el("div", { class: "empty" }, "Loading weights…");
  const eff = d.effective;
  const sourceText = { live: "Live edit", env: "From TELL_WEIGHTS", default: "Defaults (all 1)" }[eff.source];
  const { controls, enableSave } = editorControls(d);
  return el(
    "div",
    null,
    el("div", { class: "tools source-line" }, el("span", { class: "pill" }, sourceText), el("span", { class: "sub" }, `version ${eff.version} · applies to every client within about 10 seconds`)),
    ...Object.keys(d.defaults).filter((id) => !COUNTER_IDS.includes(id)).map((id) => weightRow(id, eff.weights, enableSave)),
    el("h2", { class: "history-title" }, "Counter-tells"),
    el("p", { class: "sub card-sub" }, "These count against a post, and unlike the tell weights they are sent to the extension with each verdict."),
    ...COUNTER_IDS.filter((id) => id in d.defaults).flatMap((id) => [weightRow(id, eff.weights, enableSave), el("p", { class: "sub card-sub" }, COUNTER_NOTES[id])]),
    controls,
    el("p", { class: "sub hint" }, "Answers an extension already saved are refreshed the next time those posts are checked (each refresh uses one of that person's daily checks)."),
    suggestionBlock(d),
    el("h2", { class: "history-title" }, "Change history"),
    historyTable(d),
  );
}
