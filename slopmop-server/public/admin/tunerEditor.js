// The threshold tuner: what each "likely slop" cut would catch and wrongly flag on posts that have been labelled, scored the way
// production scores right now. It only suggests; a suggestion is loaded into the Scoring card, which is where it is saved.
import { api } from "./api.js";
import { el } from "./dom.js";
import { hooks } from "./hooks.js";
import { S } from "./scoringEditor.js";
import { table } from "./widgets.js";

export const T = { set: "curated", minVotes: 3, agree: 0.67, data: null };

const SETS = [
  ["curated", "Your labelled posts"],
  ["community", "Community consensus"],
];
const pct = (n) => `${Math.round(n * 100)}%`;
const SENS = { aggressive: "Aggressive", moderate: "Moderate", mild: "Mild" };

export async function loadTuner(body = null) {
  T.data = await api("/tuner", { set: T.set, minVotes: String(T.minVotes), agree: String(T.agree) }, false, body);
}

async function act(body) {
  try {
    await loadTuner(body);
    await hooks.refresh(false);
  } catch (e) {
    alert(e.message);
  }
}

/** Puts the suggested thresholds in the Scoring card's draft. They apply only when that card is saved. */
function useSuggestion(pick) {
  if (!S.draft) return;
  for (const p of pick) S.draft.thresholds[p.sensitivity] = p.threshold;
  S.dirty = true;
  hooks.refresh(false);
}

const catches = (c) => `${c.tp} of ${c.tp + c.fn} slop caught, ${c.fp} of ${c.fp + c.tn} clean flagged`;

function controls() {
  const set = el("div", { class: "seg" }, SETS.map(([id, label]) => el("button", { type: "button", "aria-pressed": String(T.set === id), onclick: () => { T.set = id; void act(null); } }, label)));
  const tools = [set];
  if (T.set === "community") {
    const minVotes = el("input", { type: "number", min: "1", step: "1", value: String(T.minVotes), class: "field field-num", "aria-label": "Voters needed per post" });
    const agree = el("input", { type: "number", min: "0.34", max: "1", step: "0.01", value: String(T.agree), class: "field field-num", "aria-label": "Share that must agree" });
    const apply = el("button", { type: "button", onclick: () => { T.minVotes = Number(minVotes.value) || 3; T.agree = Number(agree.value) || 0.67; void act(null); } }, "Apply");
    tools.push(el("label", null, "Voters needed", minVotes), el("label", null, "Share that agree", agree), apply);
  } else {
    const file = el("input", { type: "file", accept: ".json,.jsonl,.txt", "aria-label": "Labelled posts file" });
    file.addEventListener("change", async () => {
      const f = file.files?.[0];
      if (f) await act({ import: await f.text() });
    });
    tools.push(el("label", null, "Import the extension's saved votes", file), el("button", { type: "button", onclick: () => confirm("Remove all of your labelled posts from the server?") && void act({ clear: true }) }, "Clear"));
  }
  return el("div", { class: "tools" }, tools);
}

function summary(d) {
  const a = d.analysis;
  const bits = [`${a.counts.probably} "probably"`, `${a.counts.no} "no"`, `${a.counts.maybe} "maybe" (left out of the numbers)`];
  const who = d.dataset.voters !== undefined ? ` ${d.dataset.voters} install(s) voted.` : "";
  return el("p", { class: "sub card-sub" }, `${d.dataset.posts} posts: ${bits.join(", ")}.${who}`);
}

function currentTable(a) {
  return table(
    [
      { h: "Sensitivity", v: (r) => SENS[r.sensitivity] },
      { h: "Threshold now", r: 1, v: (r) => String(r.threshold) },
      { h: "On these posts", v: (r) => catches(r.at) },
    ],
    a.current,
  );
}

function suggestionBlock(a) {
  if (!a.suggestion) return el("p", { class: "sub hint" }, "Needs at least one \"probably\" and one \"no\" before it can suggest thresholds.");
  const st = a.stability;
  const line = st
    ? `Moderate would sit around ${st.median} if these posts were drawn again (the middle 80% of ${st.resamples} redraws: ${st.p10} to ${st.p90}). ${st.stable ? "That's stable." : "That's a wide spread: the suggestion is fragile, so treat it lightly."}`
    : "Too few decisive posts to measure how stable this is.";
  return el(
    "div",
    null,
    el("h2", { class: "history-title" }, "Suggested thresholds"),
    table(
      [
        { h: "Sensitivity", v: (r) => SENS[r.sensitivity] },
        { h: "Suggested", r: 1, v: (r) => el("b", null, String(r.threshold)) },
        { h: "On these posts", v: (r) => catches(r.at) },
        { h: "Why", v: (r) => el("span", { class: "sub" }, r.why) },
      ],
      a.suggestion,
    ),
    el("p", { class: `sub hint${st && !st.stable ? " was" : ""}` }, line),
    el("div", { class: "tools editor-actions" }, el("button", { class: "primary", type: "button", onclick: () => useSuggestion(a.suggestion) }, "Load into the Scoring card"), el("span", { class: "sub" }, "Nothing is saved until you press Save in the Scoring card.")),
  );
}

const sweepTable = (a) =>
  el(
    "details",
    null,
    el("summary", null, "Every threshold from 0.02 to 0.50"),
    table(
      [
        { h: "Threshold", r: 1, v: (r) => String(r.threshold) },
        { h: "Slop caught", r: 1, v: (r) => `${r.tp} of ${r.tp + r.fn}` },
        { h: "Clean flagged", r: 1, v: (r) => `${r.fp} of ${r.fp + r.tn}` },
        { h: "Precision", r: 1, v: (r) => pct(r.precision) },
      ],
      a.sweep,
    ),
  );

/** The whole tuner card. */
export function tunerCard() {
  const d = T.data;
  if (!d) return el("div", { class: "empty" }, "Loading the tuner…");
  const a = d.analysis;
  const notes = [...(d.dataset.warnings ?? []), ...a.warnings].map((w) => el("p", { class: "sub hint was" }, w));
  return el(
    "div",
    null,
    el("p", { class: "sub card-sub" }, "Scores every labelled post the way production scores it now (live weights, formula, engagement model and dampener), and shows what each cut would catch and wrongly flag. Your own labelled posts are the ground truth; community consensus is for comparison and never changes anything on its own."),
    controls(),
    summary(d),
    ...notes,
    a.counts.probably + a.counts.no + a.counts.maybe === 0 ? el("p", { class: "sub hint" }, T.set === "curated" ? "No labelled posts yet. Import the extension's saved votes (settings page, Export JSON)." : "No posts have enough agreeing votes yet.") : el("div", null, currentTable(a), suggestionBlock(a), sweepTable(a)),
  );
}
