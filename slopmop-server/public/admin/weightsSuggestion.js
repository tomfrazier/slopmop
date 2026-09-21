// "Suggest from community votes": a suggestion is never applied automatically, only loaded into the editor.
import { el } from "./dom.js";
import { fmt } from "./format.js";
import { hooks } from "./hooks.js";
import { W, loadIntoEditor, loadWeights } from "./weightsState.js";
import { table } from "./widgets.js";

const MIN_VOTES_CHOICES = [1, 2, 3, 5];

// ---- suggestion from community votes ----
function suggestionHeader() {
  const minVotes = el("select", { "aria-label": "Votes needed per post", onchange: (e) => (W.minVotes = Number(e.target.value)) }, MIN_VOTES_CHOICES.map((n) => el("option", { value: String(n), selected: n === W.minVotes }, `${n}+ vote${n > 1 ? "s" : ""} per post`)));
  const run = el(
    "button",
    {
      type: "button",
      onclick: async () => {
        try {
          await loadWeights(true);
          await hooks.refresh(false);
        } catch (e) {
          alert(e.message);
        }
      },
    },
    "Suggest from community votes",
  );
  return el("div", { class: "tools suggest-bar" }, run, minVotes, el("span", { class: "sub" }, "A suggestion is never applied automatically."));
}

function suggestionSummary(s) {
  const cv = s.cv ? `held-out votes ${s.cv.current} → ${s.cv.suggested}` : "held-out check unavailable";
  return `Based on ${s.counts.probably} posts the community called "probably" and ${s.counts.no} it called "no". How well the score separates them (0.5 = chance, 1 = perfect): ${s.auc.current} → ${s.auc.suggested} on these votes; ${cv}. The held-out number is the one to trust.`;
}

const suggestionTable = (s) =>
  table(
    [
      { h: "Tell", v: (t) => fmt.human(t.id) },
      { h: "Separates flagged from cleared", v: (t) => el("div", { class: "bar", title: `${Math.round(t.power * 100)}%` }, el("span", { style: `width:${Math.round(t.power * 100)}%` })) },
      { h: "Current", r: 1, v: (t) => String(t.current) },
      { h: "Suggested", r: 1, v: (t) => el("b", null, String(t.suggested)) },
    ],
    s.perTell,
  );

export function suggestionBlock() {
  const s = W.suggestion;
  const head = suggestionHeader();
  if (!s) return head;
  if (!s.ready) return el("div", null, head, el("p", { class: "sub note-top" }, s.reason));
  return el(
    "div",
    null,
    head,
    el("p", { class: "sub note-y" }, suggestionSummary(s)),
    suggestionTable(s),
    el("div", { class: "mt-10" }, el("button", { type: "button", onclick: () => loadIntoEditor(s.suggested, false) }, "Load suggestion into the editor")),
  );
}
