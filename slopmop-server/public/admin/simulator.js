// "How a score is made": the formula in plain words with the numbers as they are now (including edits you haven't saved), and a
// simulator that runs the real scoring code on made-up Jev answers and shows every step. Nothing here is saved or uses a check.
import { api } from "./api.js";
import { el } from "./dom.js";
import { fmt } from "./format.js";
import { LABELS } from "./labels.js";
import { M } from "./manifestEditor.js";
import { S } from "./scoringEditor.js";
import { W } from "./weightsState.js";
import { table } from "./widgets.js";

const TELLS = ["formulaicHook", "engagementBait", "hypeMarketing", "emptyEvaluation", "tradeoffFreePromises", "contrastFraming", "manneredProse", "formalHedging", "manufacturedNarrative"];
const PRESETS = {
  "Blatant AI slop": { tells: 0.8, human: 0.1, useful: 0.1, ai: 0.95, r: 3, c: 0, p: 0 },
  "Sincere human post": { tells: 0.1, human: 0.8, useful: 0.6, ai: 0.2, r: 40, c: 6, p: 0 },
  "One over-the-top habit": { tells: 0.05, only: { hypeMarketing: 0.9 }, human: 0.5, useful: 0.4, ai: 0.5, r: 12, c: 1, p: 0 },
  "A joke that took off": { tells: 0.15, only: { hypeMarketing: 0.58, manneredProse: 0.52, engagementBait: 0.54, formulaicHook: 0.2 }, human: 0.59, useful: 0.12, ai: 0.46, r: 752, c: 57, p: 18 },
};

const SIM = { tells: Object.fromEntries(TELLS.map((t) => [t, 0.1])), confidence: 0.9, human: 0.3, useful: 0.3, ai: 0.8, r: 20, c: 2, p: 0, result: null, error: null, used: null, timer: 0 };

const n2 = (n) => (Math.round(n * 100) / 100).toString();
const n3 = (n) => (Math.round(n * 1000) / 1000).toString();

function applyPreset(name) {
  const p = PRESETS[name];
  for (const t of TELLS) SIM.tells[t] = p.only?.[t] ?? (p.only ? p.tells : p.tells);
  Object.assign(SIM, { human: p.human, useful: p.useful, ai: p.ai, r: p.r, c: p.c, p: p.p });
}

/** Asks the server to score the inputs, using any unsaved edits from the other cards so a change can be previewed. */
async function run(repaint) {
  const draft = {};
  if (W.dirty && W.draft) draft.weights = W.draft;
  if (S.dirty && S.draft) draft.scoring = S.draft;
  if (M.dirty && M.draft) draft.manifest = M.draft;
  const dimensions = Object.fromEntries(TELLS.map((t) => [t, { value: SIM.tells[t], confidence: SIM.confidence }]));
  dimensions.humanVoice = { value: SIM.human, confidence: SIM.confidence };
  dimensions.usefulness = { value: SIM.useful, confidence: SIM.confidence };
  try {
    const r = await api("/simulate", {}, false, { dimensions, aiLikelihood: SIM.ai, engagement: { reactions: SIM.r, comments: SIM.c, reposts: SIM.p }, draft });
    Object.assign(SIM, { result: r.result, used: r.used, error: null });
  } catch (e) {
    Object.assign(SIM, { error: e.message, used: null });
  }
  repaint();
}

const later = (repaint) => {
  clearTimeout(SIM.timer);
  SIM.timer = setTimeout(() => void run(repaint), 150);
};

function slider(label, get, set, repaint, max = 1, step = 0.05) {
  const range = el("input", { type: "range", min: "0", max: String(max), step: String(step), value: String(get()), "aria-label": label });
  const out = el("span", { class: "sub sim-val" }, n2(get()));
  range.addEventListener("input", () => {
    set(Number(range.value));
    out.textContent = n2(get());
    later(repaint);
  });
  return el("div", { class: "sim-row" }, el("span", null, label), range, out);
}

function number(label, get, set, repaint) {
  const input = el("input", { type: "number", min: "0", step: "1", value: String(get()), class: "field field-num", "aria-label": label });
  input.addEventListener("input", () => {
    set(Math.max(0, Number(input.value) || 0));
    later(repaint);
  });
  return el("label", null, label, input);
}

// ---- the formula, in words, with the numbers as they are now ----
function formulaLines() {
  const f = S.draft?.formula, c = S.draft?.corroboration, e = S.draft?.engagement, t = S.draft?.thresholds;
  const mv = M.draft ?? {}, wt = W.draft ?? {};
  if (!f || !c || !e || !t) return [];
  const pct = (x) => `${Math.round(x * 100)}%`;
  return [
    ["1", "Tell average", `Jev scores the nine tells from 0 to 1. Each counts by its weight (your tell weights) times its confidence to the power ${n2(f.confidencePower)}, so a tell Jev wasn't sure of counts for less.`],
    ["2", "Slop", `Tell average × ${n2(f.gain)}, minus ${n2(f.humanOffset)} × ${n2(wt.humanVoice ?? 1)} × how personal the voice is. If only one tell stands out (${n2(c.breakout)}+ with Jev ${n2(c.minConfidence)}+ sure) instead of ${c.needed}, keep just ${pct(c.alone)} of it.`],
    ["3", "Shield", `${pct(f.usefulShare * (wt.usefulness ?? 1))} of it from how useful Jev thinks the post is, the rest from reader response: log10(1 + reactions×${n2(e.reaction)} + comments×${n2(e.comment)} + reposts×${n2(e.repost)}) ÷ ${n2(e.logScale)}, cut to as little as ${pct(e.hollowFloor)} when a pile of reactions has almost no comments or reposts behind it. Never more than ${pct(f.maxShield)}.`],
    ["4", "AI dampener", `Score × (1 − ${n2(mv.aiDampen ?? 0.35)} × (1 − how likely Jev thinks a model wrote it)). It only softens writing that reads as human-typed, and never flags anything by itself.`],
    ["5", "Score", "Slop × (1 − shield) × dampener. Left alone entirely if Jev's average confidence is under " + n2(mv.minMeanConfidence ?? 0.25) + "."],
    ["6", "What you see", `The 0-100 number is that score stretched so "possibly slop" starts at ${n2(mv.displayPossibly ?? 40)} and the Moderate "likely slop" line is ${n2(mv.displayLikely ?? 70)}. Likely slop starts at ${n3(t.aggressive)} (Aggressive), ${n3(t.moderate)} (Moderate) or ${n3(t.mild)} (Mild); possibly slop at ${pct(mv.yellowFraction ?? 0.6)} of those.`],
  ];
}

const formulaBlock = () => el("div", { class: "wrap-table" }, table([{ h: "", v: (r) => el("b", null, r[0]) }, { h: "Step", v: (r) => r[1] }, { h: "How it works, with today's numbers", v: (r) => el("span", { class: "sub" }, r[2]) }], formulaLines(), "Loading the settings…"));

// ---- the simulator ----
function inputs(repaint) {
  const presets = el("div", { class: "tools" }, Object.keys(PRESETS).map((name) => el("button", { type: "button", onclick: () => { applyPreset(name); repaint(true); } }, name)));
  return el(
    "div",
    null,
    el("p", { class: "sub card-sub" }, "Try a post. These are Jev's answers to the twelve questions; the settings are the live ones, plus any edits you haven't saved in the cards below."),
    presets,
    el("div", { class: "sim-grid" }, [
      el("div", null, el("h2", { class: "history-title" }, "The nine tells"), ...TELLS.map((t) => slider(LABELS[t], () => SIM.tells[t], (v) => (SIM.tells[t] = v), repaint)), slider("Jev's confidence in each answer", () => SIM.confidence, (v) => (SIM.confidence = v), repaint)),
      el("div", null, el("h2", { class: "history-title" }, "Counter-signs"), slider(LABELS.humanVoice, () => SIM.human, (v) => (SIM.human = v), repaint), slider(LABELS.usefulness, () => SIM.useful, (v) => (SIM.useful = v), repaint), slider("Likely drafted by a model", () => SIM.ai, (v) => (SIM.ai = v), repaint), el("h2", { class: "history-title" }, "Reader response"), el("div", { class: "tools" }, number("Reactions", () => SIM.r, (v) => (SIM.r = v), repaint), number("Comments", () => SIM.c, (v) => (SIM.c = v), repaint), number("Reposts", () => SIM.p, (v) => (SIM.p = v), repaint))),
    ]),
  );
}

const WORD_CLASS = { "Likely slop": "c-red", "Possibly slop": "c-amber", "Looks fine": "c-green", "Not sure": "muted" };

function outcome() {
  if (SIM.error) return el("p", { class: "err" }, SIM.error);
  const r = SIM.result;
  if (!r) return el("p", { class: "sub hint" }, "Working out the first score…");
  const s = r.steps;
  const edits = SIM.used && Object.entries(SIM.used).filter(([, v]) => v).map(([k]) => ({ weights: "tell weights", scoring: "scoring", manifest: "client settings" })[k]);
  const rows = [
    ["1  Tell average", `${r.tells.length} tells, weighted`, n3(s.tellMean)],
    ["2  Slop", `${n3(s.tellMean)} × gain − human-voice offset × ${n2(s.humanVoice)}${s.cutAlone ? `, then cut because only ${s.breakouts} tell stands out` : ""}`, n3(s.slop)],
    ["3  Shield", `useful ${n2(s.usefulness)} × ${n2(s.share)} + reader response ${n2(s.readerResponse)} × ${n2(1 - s.share)}${s.shieldUncapped > s.shield + 1e-9 ? ", capped" : ""}`, n3(s.shield)],
    ["4  AI dampener", `likely drafted by a model: ${n2(r.aiLikelihood)}`, n3(r.dampener)],
    ["5  Score", r.gated ? `Jev's average confidence (${n2(r.meanConfidence)}) is too low, so it is left alone` : `${n3(s.slop)} × (1 − ${n3(s.shield)}) × ${n3(r.dampener)}`, n3(r.score)],
    ["6  Shown", "the score stretched onto 0-100", el("b", null, `${Math.round(r.shown)} / 100`)],
  ];
  const verdicts = ["aggressive", "moderate", "mild"].map((k) => ({ k, v: r.verdicts[k], z: r.zones[k] }));
  return el(
    "div",
    null,
    edits?.length ? el("p", { class: "sub hint was" }, `Using your unsaved edits to: ${edits.join(", ")}.`) : null,
    el("div", { class: "wrap-table" }, table([{ h: "Step", v: (x) => x[0] }, { h: "What happened", v: (x) => el("span", { class: "sub" }, x[1]) }, { h: "Value", r: 1, v: (x) => x[2] }], rows)),
    el("h2", { class: "history-title" }, "What each sensitivity does with it"),
    table(
      [
        { h: "Sensitivity", v: (x) => x.k[0].toUpperCase() + x.k.slice(1) },
        { h: "Verdict", v: (x) => el("b", { class: WORD_CLASS[x.v.word] }, x.v.word) },
        { h: "Zone lines on the 0-100 scale", v: (x) => el("span", { class: "sub" }, `possibly from ${Math.round(x.z.possibly)}, likely from ${Math.round(x.z.likely)}`) },
      ],
      verdicts,
    ),
  );
}

let first = true;
/** The whole card. `repaint(true)` redraws the inputs too (after a preset); otherwise only the outcome. */
export function simulatorCard() {
  const box = el("div", null);
  const result = el("div", { class: "sim-result" });
  const paint = (all) => {
    if (all) box.replaceChildren(inputs(paint));
    result.replaceChildren(outcome());
    if (all) later(paint);
  };
  box.append(inputs(paint));
  result.append(outcome());
  if (first || !SIM.result) {
    first = false;
    later(paint);
  }
  return el("div", null, el("h2", null, "The formula"), formulaBlock(), el("h2", { class: "history-title" }, "Try a post"), box, result);
}
