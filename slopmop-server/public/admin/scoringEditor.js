// The scoring editor: the "likely" threshold for each sensitivity (clients keep them for a day) and the reader-response model.
import { api } from "./api.js";
import { el } from "./dom.js";
import { fmt } from "./format.js";
import { hooks } from "./hooks.js";
import { table } from "./widgets.js";

export const S = { data: null, draft: null, dirty: false, note: "" };

const THRESHOLD_ROWS = [
  ["aggressive", "Aggressive", "Score at which a post is likely slop (hidden in Hide mode). Lowest, so it catches the most."],
  ["moderate", "Moderate", "The default."],
  ["mild", "Mild", "Highest: only the clearest slop."],
];
const ENGAGEMENT_ROWS = [
  ["reaction", "Reaction weight", "What one reaction counts for."],
  ["comment", "Comment weight", "A comment costs a person minutes, so it counts for more."],
  ["repost", "Repost weight", "A repost puts the post in front of the reposter's network."],
  ["hollowFrom", "Check for hollow engagement from", "Reactions a post needs before a lack of comments and reposts looks suspicious."],
  ["hollowRatio", "Comments plus reposts, per reaction, below which credit is cut", "For example 0.02 = 2 per 100 reactions."],
  ["hollowFloor", "Least credit left after the cut", "0.4 = a hollow post still keeps 40% of its engagement credit."],
  ["logScale", "Reader response reaches 100% at 10 to the power", "4 = at 10,000 weighted engagements."],
];
const FORMULA_ROWS = [
  ["gain", "Slop gain", "Tell average is multiplied by this before anything is taken off."],
  ["humanOffset", "Human-voice offset", "How much a fully personal voice takes off (scaled by the human voice counter-tell weight)."],
  ["usefulShare", "Usefulness share of the shield", "The rest of the shield comes from reader response (scaled by the usefulness counter-tell weight)."],
  ["maxShield", "Largest shield", "0.6 = usefulness and reader response together can take off at most 60%."],
  ["confidencePower", "How much Jev's confidence counts", "A tell counts by confidence to this power. 0 ignores confidence; 0.5 is the square root."],
];
const RECHECK_ROWS = [
  ["initialMs", "First score is kept (ms)", "3600000 = one hour."],
  ["minMs", "Shortest wait before a re-score (ms)", "900000 = 15 minutes."],
  ["maxMs", "Longest wait before a re-score (ms)", "604800000 = 7 days."],
  ["growth", "Counts as breaking out at this growth", "A ratio: 2 = engagement has doubled since the last score."],
];

const CORROBORATION_ROWS = [
  ["breakout", "A tell stands out from", "Its score, 0-1. Slop shows as several signs at once; one over-the-top habit in an otherwise sincere post is thin evidence."],
  ["minConfidence", "...if Jev is at least this sure", "A tell Jev wasn't sure of doesn't count as standing out."],
  ["needed", "Signs needed to count in full", "Fewer than this and the slop score is cut."],
  ["alone", "Slop score kept with fewer signs", "0.6 = keeps 60%. 1 turns the check off."],
];

export async function loadScoring() {
  S.data = await api("/scoring");
  if (!S.dirty) S.draft = structuredClone(S.data.effective);
}

async function save(body) {
  try {
    S.data = await api("/scoring", {}, false, { ...body, note: S.note });
    Object.assign(S, { dirty: false, note: "", draft: structuredClone(S.data.effective) });
    await hooks.refresh(false);
  } catch (e) {
    alert(e.message);
  }
}

function noteField() {
  const note = el("input", { type: "text", placeholder: "Note (optional): why this change", maxlength: "200", value: S.note, class: "field field-note", "aria-label": "Note for this scoring change" });
  note.addEventListener("input", () => (S.note = note.value));
  return note;
}

function field(group, key, label, note, enable) {
  const input = el("input", { type: "number", step: "any", min: "0", value: String(S.draft[group][key]), class: "field field-num", "aria-label": label });
  input.addEventListener("input", () => {
    S.draft[group][key] = Number(input.value);
    S.dirty = true;
    enable();
  });
  return el("div", { class: "srow" }, el("span", { title: note }, label), input, el("span", { class: "sub" }, note));
}

/** Puts an earlier version in the editor without saving it. Anything the old version lacked keeps its default. */
function loadEarlier(value) {
  const d = S.data.defaults;
  S.draft = Object.fromEntries(Object.keys(d).map((g) => [g, { ...d[g], ...(value[g] ?? {}) }]));
  S.dirty = true;
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
    S.data.history ?? [],
    "No changes yet.",
  );

/** The whole scoring card. */
export function scoringCard() {
  if (!S.data) return el("div", { class: "empty" }, "Loading scoring…");
  const saveButton = el("button", { class: "primary", type: "button", disabled: !S.dirty, onclick: () => save(S.draft) }, "Save scoring");
  const enable = () => (saveButton.disabled = false);
  return el(
    "div",
    null,
    el("h2", null, "Thresholds"),
    el("p", { class: "sub card-sub" }, "Sent to every extension, which keeps them for 24 hours and then asks again."),
    ...THRESHOLD_ROWS.map(([k, l, n]) => field("thresholds", k, l, n, enable)),
    el("h2", { class: "history-title" }, "The formula"),
    el("p", { class: "sub card-sub" }, "The arithmetic behind every score. Saving a change makes clients refresh their saved answers as posts are seen again."),
    ...FORMULA_ROWS.map(([k, l, n]) => field("formula", k, l, n, enable)),
    el("h2", { class: "history-title" }, "Corroboration"),
    el("p", { class: "sub card-sub" }, "A post needs more than one sign to be scored in full."),
    ...CORROBORATION_ROWS.map(([k, l, n]) => field("corroboration", k, l, n, enable)),
    el("h2", { class: "history-title" }, "Reader response"),
    el("p", { class: "sub card-sub" }, "How reactions, comments and reposts add up. The result feeds the shield together with Jev's usefulness answer. Changing these re-checks saved posts as they are seen again."),
    ...ENGAGEMENT_ROWS.map(([k, l, n]) => field("engagement", k, l, n, enable)),
    el("h2", { class: "history-title" }, "Re-scoring schedule"),
    el("p", { class: "sub card-sub" }, "When Jev is asked about a post again as its engagement grows (see the README). Doesn't change any answer already given."),
    ...RECHECK_ROWS.map(([k, l, n]) => field("recheck", k, l, n, enable)),
    el(
      "div",
      { class: "tools editor-actions" },
      saveButton,
      el("button", { type: "button", onclick: () => ((S.dirty = false), (S.draft = structuredClone(S.data.effective)), hooks.refresh(false)) }, "Discard changes"),
      el("button", { type: "button", onclick: () => confirm("Go back to the default thresholds, formula and reader-response model?") && void save({ reset: true }) }, "Reset to defaults"),
      noteField(),
    ),
    el("h2", { class: "history-title" }, "Change history"),
    historyTable(),
  );
}
