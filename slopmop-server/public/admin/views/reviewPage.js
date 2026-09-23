// Post review: paste a post, find its stored record, and see step by step why it scored the way it did and what would change it.
// View only: it explains and previews; every change is made in the place that owns the setting (Scoring, Defaults, Tell weights).
import { api } from "../api.js";
import { el } from "../dom.js";
import { fmt } from "../format.js";
import { LABELS } from "../labels.js";
import { card, table, votesCell } from "../widgets.js";

const SEARCH_DELAY_MS = 350;
const R = { text: "", id: "", data: null, busy: false, error: "", edits: {}, sim: null, simSeq: 0 };
let mount = () => {};

const num = (n, d = 2) => (n == null || Number.isNaN(n) ? "-" : Number(n).toFixed(d));
const nameOf = (id) => LABELS[id] ?? id;
const verdictPill = (v) => el("span", { class: `pill ${v.level === "red" ? "error" : v.level === "yellow" ? "limited" : ""}` }, v.word);

async function lookup() {
  R.busy = true;
  R.error = "";
  R.data = null;
  R.edits = {};
  R.sim = null;
  mount();
  try {
    R.data = await api("/review", {}, false, R.text.trim() ? { text: R.text } : { contentId: R.id.trim() });
  } catch (e) {
    R.error = e.message;
  }
  R.busy = false;
  mount();
}

// ---- the lookup box
function lookupCard() {
  const text = el("textarea", { rows: "8", class: "field review-text", placeholder: "Paste the post's text here, exactly as it reads. The server keeps only a hash of each post's text, so the paste is hashed the same way and matched.", "aria-label": "Post text", spellcheck: "false", oninput: (e) => (R.text = e.target.value) }, R.text);
  const id = el("input", { type: "text", class: "field field-device", placeholder: "…or a post id (8+ characters)", value: R.id, "aria-label": "Post id", spellcheck: "false", oninput: (e) => (R.id = e.target.value) });
  return card(
    "Find a post",
    el("div", null, text, el("div", { class: "tools mt-10" }, id, el("button", { class: "primary", disabled: R.busy, onclick: () => void lookup() }, R.busy ? "Looking…" : "Look up"), el("button", { onclick: () => { Object.assign(R, { text: "", id: "", data: null, error: "", edits: {}, sim: null }); mount(); } }, "Clear")), R.error ? el("div", { class: "err", role: "alert" }, R.error) : null),
    "Case, spacing and hidden characters don't matter, but the whole post does: text cut off at “…more” won't match. A short link (lnkd.in) can't be resolved here, so paste the text.",
  );
}

// ---- what was found
function summaryCard(d) {
  const r = d.result;
  const t = d.live.scoring.thresholds;
  const rec = d.record;
  const rows = [
    ["Aggressive", r.verdicts.aggressive, t.aggressive],
    ["Moderate", r.verdicts.moderate, t.moderate],
    ["Mild", r.verdicts.mild, t.mild],
  ];
  return card(
    "What it scored",
    el("div", null,
    el("div", { class: "review-head" },
      el("div", { class: "bigscore" }, el("b", null, r.gated ? "–" : String(Math.round(r.shown))), el("span", null, " / 100")),
      el("div", null,
        el("div", { class: "tools" }, rows.map(([label, v, th]) => el("span", null, label, " ", verdictPill(v), el("span", { class: "sub" }, ` (likely at ≥ ${th})`)))),
        el("div", { class: "sub mt-10" }, `Raw score ${num(r.score, 3)} · Jev thinks it is ${fmt.pct(r.aiLikelihood, 0)} likely AI-written · Jev's average confidence ${num(r.meanConfidence)}`),
      ),
    ),
    el("div", { class: "review-facts" },
      fact("Post id", el("code", null, d.contentId.slice(0, 12))),
      fact("Checked", `${fmt.n(rec.checks)} time${rec.checks === 1 ? "" : "s"}`),
      fact("Scored", fmt.time(rec.scoredAt)),
      fact("First seen", fmt.time(rec.firstSeen)),
      fact("Last seen", fmt.time(rec.lastSeen)),
      fact("Engagement stored", `${fmt.n(rec.engagement?.reactions)} reactions · ${fmt.n(rec.engagement?.comments)} comments · ${fmt.n(rec.engagement?.reposts)} reposts`),
      fact("Community votes", votesCell(d.community)),
      fact("Length", `${fmt.n(rec.textLen)} characters`),
    ),
    d.notes.length ? el("div", { class: "review-notes" }, d.notes.map((n) => el("p", { class: "note-y" }, "⚠ ", n))) : null,
    ),
  );
}
const fact = (label, value) => el("div", { class: "fact" }, el("div", { class: "sub" }, label), el("div", null, value));

// ---- the arithmetic, in order
function stepsCard(d) {
  const s = d.result.steps;
  const f = d.live.scoring.formula;
  const c = d.live.scoring.corroboration;
  const r = d.result;
  const rows = [
    ["1. Tell average", num(s.tellMean, 3), "The nine AI-writing tells, averaged. Each counts by its weight and by how sure Jev was of it.", "Tell weights (and “how much Jev's confidence counts” in Scoring)"],
    ["2. Slop", num(s.rawSlop, 3), `Tell average × ${f.gain} (gain), minus ${f.humanOffset} (offset) × ${num(s.humanVoiceWeight, 2)} (weight) × ${num(s.humanVoice)} (how personal Jev found the voice).`, "Scoring → Slop formula; the “Sounds like a person” weight"],
    ["3. Corroboration", s.cutAlone ? `cut to ${num(s.slop, 3)}` : "not cut", `${s.breakouts} tell${s.breakouts === 1 ? "" : "s"} stand out (≥ ${c.breakout} and Jev at least ${c.minConfidence} sure); ${c.needed} needed to count in full. With exactly one, slop is cut to ${Math.round(c.alone * 100)}%.`, "Scoring → Corroboration"],
    ["4. Useful to readers", `${num(s.usefulness)} × ${num(s.share)}`, `Usefulness ${num(s.usefulness)} takes a ${num(s.share)} share of the shield (${f.usefulShare} × its weight ${num(s.usefulnessWeight, 2)}).`, "Scoring → Slop formula; the “Useful to readers” weight"],
    ["5. Reader response", `${num(s.readerResponse)} × ${num(1 - s.share)}`, `How readers responded (reactions, comments and reposts, on a log scale) fills the rest of the shield.`, "Scoring → Reader response"],
    ["6. Shield", `${num(s.shieldUncapped, 3)} → ${num(s.shield, 3)}`, `The two parts added, then capped at ${f.maxShield}. This is the share taken off the slop score.`, "Scoring → Largest shield"],
    ["7. AI dampener", num(r.dampener, 3), `A post that reads human-written is reduced by up to ${Math.round(d.live.aiDampen * 100)}%. At ${fmt.pct(r.aiLikelihood, 0)} AI-likely: 1 − ${d.live.aiDampen} × (1 − ${num(r.aiLikelihood)}).`, "Defaults → Client settings"],
    ["8. Score", num(r.score, 3), `Slop ${num(s.slop, 3)} × (1 − shield ${num(s.shield, 3)}) × dampener ${num(r.dampener, 3)}. Compared with the thresholds above: likely slop at ≥ ${d.live.scoring.thresholds.moderate} (Moderate), possibly slop from ${num(d.live.yellowFraction * d.live.scoring.thresholds.moderate, 3)}.`, "Scoring → Thresholds"],
  ];
  return card("How it was scored", table([{ h: "Step", v: (r) => el("b", null, r[0]) }, { h: "Value", v: (r) => r[1] }, { h: "What happened", v: (r) => r[2], c: "detail" }, { h: "Set in", v: (r) => r[3], c: "detail" }], rows), "The same arithmetic the server ran, with today's settings.");
}

function tellsCard(d) {
  const r = d.result;
  const c = d.live.scoring.corroboration;
  const totalW = r.tells.filter((t) => !["humanVoice", "usefulness"].includes(t.id)).reduce((n, t) => n + t.effectiveWeight, 0) || 1;
  const tells = r.tells.filter((t) => !["humanVoice", "usefulness"].includes(t.id)).map((t) => ({ ...t, share: (t.effectiveWeight * t.value) / totalW }));
  tells.sort((a, b) => b.share - a.share);
  const bar = (v, color) => el("div", { class: "bar", title: num(v) }, el("span", { style: `width:${Math.round(v * 100)}%;background:${color}` }));
  const rows = [...tells, ...r.tells.filter((t) => ["humanVoice", "usefulness"].includes(t.id)).map((t) => ({ ...t, counter: true }))];
  return card(
    "What Jev found",
    table(
      [
        { h: "Signal", v: (t) => (t.counter ? el("span", null, nameOf(t.id), " ", el("span", { class: "pill" }, "counter")) : nameOf(t.id)) },
        { h: "Jev's score", v: (t) => el("div", { class: "cell-bar" }, bar(t.value, t.counter ? "var(--green)" : "var(--amber)"), num(t.value)) },
        { h: "Confidence", r: 1, v: (t) => num(t.confidence) },
        { h: "Weight × confidence", r: 1, v: (t) => num(t.effectiveWeight) },
        { h: "Pushes the average by", r: 1, v: (t) => (t.counter ? "-" : num(t.share, 3)) },
        { h: "Stands out?", v: (t) => (t.counter ? "" : t.value >= c.breakout && t.confidence >= c.minConfidence ? "yes" : "") },
      ],
      rows,
    ),
    "Sorted by how much each tell pushes the tell average. “Stands out” tells are what corroboration counts.",
  );
}

// ---- what would change it
const fixText = (f, lever, fine) => {
  if (f.status === "already") return el("span", { class: "sub" }, "already");
  if (f.status === "unreachable") return el("span", { class: "sub" }, "no value works");
  return el("span", null, el("b", null, `${f.direction === "up" ? "↑" : "↓"} ${num(f.value, lever.max <= 10 ? 3 : 1)}`), " ", el("span", { class: "sub" }, `(${f.corpus.likelyBefore}→${f.corpus.likelyAfter} likely)`));
};
const leverName = (l) => (l.id.startsWith("weight:") ? `Weight: ${nameOf(l.id.slice(7))}` : l.label);

function leversCard(d) {
  const flips = d.levers.filter((l) => l.notLikely.status === "needed");
  const never = d.levers.filter((l) => l.notLikely.status === "unreachable");
  flips.sort((a, b) => a.notLikely.corpus.likelyBefore - a.notLikely.corpus.likelyAfter - (b.notLikely.corpus.likelyBefore - b.notLikely.corpus.likelyAfter));
  const total = flips[0]?.notLikely.corpus.total ?? 0;
  const cols = [
    { h: "Setting", v: (l) => leverName(l) },
    { h: "Set in", v: (l) => l.where },
    { h: "Now", r: 1, v: (l) => num(l.current, 3) },
    { h: "To leave “Likely slop”", v: (l) => fixText(l.notLikely, l) },
    { h: "To read “Looks fine”", v: (l) => fixText(l.looksFine, l) },
  ];
  const already = d.result.verdicts.moderate.level !== "red";
  return card(
    "What would change it",
    el("div", null,
      already ? el("p", { class: "note-y" }, "At Moderate sensitivity this post is not marked Likely slop.") : null,
      flips.length ? table(cols, flips) : el("p", { class: "note-y" }, "No single setting, moved anywhere in its allowed range, takes this post out of Likely slop. See the combinations below."),
      el("p", { class: "sub hint" }, `Each row changes one setting on its own, everything else as it is. The figure in brackets is how many of the ${fmt.n(total)} stored posts are Likely slop at Moderate before → after that same change, so a setting that fixes this post by flipping most of the others is a blunt fix.`),
      never.length ? el("p", { class: "sub" }, `On their own these can't do it: ${never.map(leverName).join(", ")}.`) : null,
    ),
    "Solved against the real scoring code and today's settings. Nothing here is saved.",
  );
}

function recipesCard(d) {
  const rows = d.recipes.filter((r) => r.already || r.maxShield !== null).sort((a, b) => (b.corpus?.likelyAfter ?? 0) - (a.corpus?.likelyAfter ?? 0)).slice(0, 8);
  const cur = d.live.scoring;
  return card(
    "Leaning on reader response",
    rows.length
      ? el("div", null, table([
        { h: "Usefulness share of the shield", r: 1, v: (r) => num(r.usefulShare) },
        { h: "Reader response saturates at 10^", r: 1, v: (r) => num(r.logScale, 1) },
        { h: "Largest shield needed", r: 1, v: (r) => (r.already ? "as it is" : num(r.maxShield, 3)) },
        { h: "Stored posts Likely slop, before → after", r: 1, v: (r) => (r.corpus ? `${r.corpus.likelyBefore} → ${r.corpus.likelyAfter} of ${r.corpus.total}` : "-") },
      ], rows),
      el("p", { class: "sub hint" }, `Now: usefulness share ${cur.formula.usefulShare}, log scale ${cur.engagement.logScale}, largest shield ${cur.formula.maxShield}. Lowering the usefulness share hands more of the shield to reader response; a lower log scale makes engagement saturate sooner; the largest shield is the ceiling on both. All three are global.`))
      : el("p", { class: "note-y" }, "Even shielding as much as the formula allows can't take this post out of Likely slop: Jev's reading of the writing outweighs the engagement."),
    "Engagement alone often can't rescue a post, because the shield is capped and usefulness takes a share of it. These combinations show what it would take.",
  );
}

// ---- try it: preview unsaved settings through the real simulator
const KNOBS = [
  ["maxShield", "Largest shield", 0, 1, 0.01, (l) => l.scoring.formula.maxShield, (s, v) => (s.scoring.formula.maxShield = v)],
  ["usefulShare", "Usefulness share of the shield", 0, 1, 0.01, (l) => l.scoring.formula.usefulShare, (s, v) => (s.scoring.formula.usefulShare = v)],
  ["logScale", "Reader response saturates at 10^", 1, 10, 0.1, (l) => l.scoring.engagement.logScale, (s, v) => (s.scoring.engagement.logScale = v)],
  ["gain", "Slop gain", 0.1, 5, 0.05, (l) => l.scoring.formula.gain, (s, v) => (s.scoring.formula.gain = v)],
  ["humanOffset", "Human-voice offset", 0, 1, 0.01, (l) => l.scoring.formula.humanOffset, (s, v) => (s.scoring.formula.humanOffset = v)],
  ["aiDampen", "AI dampener", 0, 1, 0.01, (l) => l.aiDampen, (s, v) => (s.aiDampen = v)],
  ["moderate", "Moderate threshold", 0.05, 1, 0.01, (l) => l.scoring.thresholds.moderate, (s, v) => (s.scoring.thresholds.moderate = v)],
];

async function simulateWhatIf(d) {
  const seq = ++R.simSeq;
  const draft = { scoring: structuredClone(d.live.scoring), weights: { ...d.live.weights } };
  let manifest = false;
  const settings = { scoring: draft.scoring, aiDampen: d.live.aiDampen };
  for (const [id, , , , , , set] of KNOBS) if (R.edits[id] !== undefined) set(settings, R.edits[id]);
  if (R.edits.wUseful !== undefined) draft.weights.usefulness = R.edits.wUseful;
  if (R.edits.wHuman !== undefined) draft.weights.humanVoice = R.edits.wHuman;
  if (R.edits.aiDampen !== undefined) manifest = { ...d.live.manifestOverrides, aiDampen: R.edits.aiDampen };
  const e = d.input.engagement;
  const body = { dimensions: d.input.dimensions, aiLikelihood: d.input.aiLikelihood, engagement: { reactions: R.edits.reactions ?? e.reactions, comments: R.edits.comments ?? e.comments, reposts: R.edits.reposts ?? e.reposts }, draft: { scoring: draft.scoring, weights: draft.weights, ...(manifest ? { manifest } : {}) } };
  try {
    const out = await api("/simulate", {}, false, body);
    if (seq === R.simSeq) R.sim = out.result;
  } catch (err) {
    if (seq === R.simSeq) R.sim = { error: err.message };
  }
  if (seq === R.simSeq) mount();
}

let simTimer = 0;
const queueSim = (d) => {
  clearTimeout(simTimer);
  simTimer = setTimeout(() => void simulateWhatIf(d), SEARCH_DELAY_MS);
};

function whatIfCard(d) {
  const e = d.input.engagement;
  const changed = Object.keys(R.edits).length > 0;
  const slider = (id, label, min, max, step, cur) => {
    const v = R.edits[id] ?? cur;
    const out = el("span", { class: "sim-val" }, num(v, step < 0.05 ? 2 : 1));
    const input = el("input", { type: "range", min: String(min), max: String(max), step: String(step), value: String(v), "aria-label": label,
      oninput: (ev) => { R.edits[id] = Number(ev.target.value); out.textContent = num(R.edits[id], step < 0.05 ? 2 : 1); queueSim(d); } });
    return el("div", { class: "sim-row" }, el("span", null, label, R.edits[id] !== undefined && R.edits[id] !== cur ? el("span", { class: "was" }, ` (was ${num(cur, 3)})`) : null), input, out);
  };
  const count = (id, label, cur) => el("label", { class: "inline" }, label, " ", el("input", { type: "number", min: "0", class: "field field-num", value: String(R.edits[id] ?? cur), "aria-label": label, oninput: (ev) => { R.edits[id] = Math.max(0, Number(ev.target.value) || 0); queueSim(d); } }));
  const r = R.sim;
  const out = !changed ? el("p", { class: "sub" }, "Move a slider to see what this post would score. Nothing you do here is saved.") : !r ? el("p", { class: "sub" }, "Working it out…") : r.error ? el("p", { class: "err" }, r.error) : el("div", { class: "review-head" }, el("div", { class: "bigscore" }, el("b", null, r.gated ? "–" : String(Math.round(r.shown))), el("span", null, ` / 100 (was ${Math.round(d.result.shown)})`)), el("div", null, el("div", { class: "tools" }, ["aggressive", "moderate", "mild"].map((k) => el("span", null, k[0].toUpperCase() + k.slice(1), " ", verdictPill(r.verdicts[k])))), el("div", { class: "sub mt-10" }, `Raw ${num(r.score, 3)} · shield ${num(r.steps.shield, 3)} (reader response ${num(r.steps.readerResponse)}) · dampener ${num(r.dampener, 3)}`)));
  return card(
    "Try it",
    el("div", null,
      el("div", { class: "sim-grid" }, KNOBS.map(([id, label, min, max, step, get]) => slider(id, label, min, max, step, get(d.live))), slider("wUseful", "Useful to readers weight", 0, 5, 0.05, d.live.weights.usefulness ?? 1), slider("wHuman", "Sounds like a person weight", 0, 5, 0.05, d.live.weights.humanVoice ?? 1)),
      el("div", { class: "tools mt-10" }, count("reactions", "Reactions", e.reactions), count("comments", "Comments", e.comments), count("reposts", "Reposts", e.reposts), el("button", { disabled: !changed, onclick: () => { R.edits = {}; R.sim = null; mount(); } }, "Reset")),
      el("div", { class: "sim-result" }, out),
    ),
    "A preview through the real scoring code. To keep a change, make it where the setting lives (Scoring, Defaults or Tell weights).",
  );
}

function results() {
  const d = R.data;
  if (!d) return [];
  if (!d.found) {
    return [card("Not found", el("div", null, el("p", null, "No stored post matches this text."), d.contentId ? el("p", { class: "sub" }, "Its id would be ", el("code", null, d.contentId.slice(0, 12)), ".") : null, el("ul", { class: "sub" }, el("li", null, "It may simply not have been checked yet (short and non-English posts are only scored on demand)."), el("li", null, "The paste may differ from what the extension read: text cut at “…more”, or link, hashtag and mention text shown differently."), el("li", null, "Or use the post's id from the Devices or Posts pages."))))];
  }
  if (!d.scored) return [card("Found, but not scored", el("p", null, "This post is in the registry but Jev has not scored it (it was only seen)."))];
  return [summaryCard(d), stepsCard(d), tellsCard(d), leversCard(d), recipesCard(d), whatIfCard(d)];
}

/** The Post review page. */
export function reviewPage() {
  const holder = el("div", null);
  mount = () => holder.replaceChildren(lookupCard(), ...results());
  mount();
  return holder;
}
