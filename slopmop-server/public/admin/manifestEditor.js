// The client-settings editor: every fixed value the extension runs on, grouped, with its default. Saved live; extensions pick a
// change up the next time an answer tells them there is a new version, or within a day.
import { api } from "./api.js";
import { el } from "./dom.js";
import { fmt } from "./format.js";
import { hooks } from "./hooks.js";
import { table } from "./widgets.js";

export const M = { data: null, draft: null, dirty: false, note: "" };

const GROUPS = [
  ["requests", "Requests"],
  ["cache", "Saved answers"],
  ["feed", "Watching the feed"],
  ["scoring", "Finishing a decision"],
  ["display", "Display"],
];

export async function loadManifest() {
  M.data = await api("/manifest");
  if (!M.dirty) M.draft = structuredClone(M.data.values);
}

async function save(body) {
  try {
    M.data = await api("/manifest", {}, false, { ...body, note: M.note });
    Object.assign(M, { dirty: false, note: "", draft: structuredClone(M.data.values) });
    await hooks.refresh(false);
  } catch (e) {
    alert(e.message);
  }
}

const shown = (v) => (Array.isArray(v) ? v.join(", ") : String(v));
const parse = (text, list) => (list ? text.split(",").map((s) => Number(s.trim())) : Number(text));

function noteField() {
  const note = el("input", { type: "text", placeholder: "Note (optional): why this change", maxlength: "200", value: M.note, class: "field field-note", "aria-label": "Note for this client settings change" });
  note.addEventListener("input", () => (M.note = note.value));
  return note;
}

function row(field, enable) {
  const list = Array.isArray(field.value);
  const input = el("input", { type: list ? "text" : "number", step: "any", value: shown(M.draft[field.key]), class: list ? "field" : "field field-num", "aria-label": field.label });
  input.addEventListener("input", () => {
    M.draft[field.key] = parse(input.value, list);
    M.dirty = true;
    enable();
  });
  const changed = shown(M.draft[field.key]) !== shown(field.value);
  return el("div", { class: "srow" }, el("span", { title: field.key }, field.label), input, el("span", { class: "sub" }, field.note, changed ? el("span", { class: "was" }, ` (default ${shown(field.value)})`) : null));
}

/** Puts an earlier version in the editor without saving it (what it left out is at its default). */
function loadEarlier(value) {
  M.draft = { ...structuredClone(M.data.defaults), ...structuredClone(value) };
  M.dirty = true;
  void hooks.refresh(false);
}

const historyTable = () =>
  table(
    [
      { h: "When", v: (c) => fmt.time(c.at) },
      { h: "What", v: (c) => (c.source === "reset" ? "reset to defaults" : "edit") },
      { h: "Note", v: (c) => c.note || "-" },
      { h: "", v: (c) => el("button", { type: "button", onclick: () => loadEarlier(c.value), title: "Load these settings into the editor (not saved until you press Save)" }, "Load") },
    ],
    M.data.history ?? [],
    "No changes yet.",
  );

/** The whole client-settings card. */
export function manifestCard() {
  if (!M.data) return el("div", { class: "empty" }, "Loading client settings…");
  const saveButton = el("button", { class: "primary", type: "button", disabled: !M.dirty, onclick: () => save({ values: M.draft }) }, "Save client settings");
  const enable = () => (saveButton.disabled = false);
  return el(
    "div",
    null,
    el("p", { class: "sub card-sub" }, `Manifest version ${M.data.version}. The sensitivity thresholds are in the Scoring card above and are part of the same manifest.`),
    ...GROUPS.flatMap(([group, title]) => [el("h2", { class: "history-title" }, title), ...M.data.fields.filter((f) => f.group === group).map((f) => row(f, enable))]),
    el(
      "div",
      { class: "tools editor-actions" },
      saveButton,
      el("button", { type: "button", onclick: () => ((M.dirty = false), (M.draft = structuredClone(M.data.values)), hooks.refresh(false)) }, "Discard changes"),
      el("button", { type: "button", onclick: () => confirm("Put every client setting back to its default?") && void save({ reset: true }) }, "Reset client settings"),
      noteField(),
    ),
    el("h2", { class: "history-title" }, "Change history"),
    historyTable(),
  );
}
