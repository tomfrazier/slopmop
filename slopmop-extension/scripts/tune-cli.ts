import { readFileSync } from "node:fs";
import { parseLabels } from "../src/shared/labels";
import { DEFAULT_PARAMS } from "../src/shared/decide";
import { compareToGuard, confusion, ENGAGEMENT_CANDIDATES, engagementAuc, fitDampen, mistakes, scoreAll, suggest, sweep } from "../src/shared/tune";

const file = process.argv[2];
if (!file) {
  console.error("usage: npm run tune -- <labels.jsonl | export.json>   (default file from `npm run collect`: labels/labels.jsonl)");
  process.exit(1);
}
const labels = parseLabels(readFileSync(file, "utf8")); // JSONL from the collector, or a popup export; last vote per post wins
// Each label carries the server's weighted composite (production weights), so by default tuning reproduces production. To
// try different weights, set TELL_WEIGHTS='{"formulaicHook":0.7}' (unlisted tells count 1): the composite is then recomputed here.
const tryWeights = process.env.TELL_WEIGHTS ? { ...DEFAULT_PARAMS.weights, ...(JSON.parse(process.env.TELL_WEIGHTS) as Record<string, number>) } : undefined;
if (tryWeights) console.log("Using TELL_WEIGHTS from the environment instead of the server's weighting.");
const scored = scoreAll(labels, tryWeights ? { weights: tryWeights } : {});
const pos = scored.filter((s) => s.label === "probably").length;
const neg = scored.filter((s) => s.label === "no").length;
const maybe = scored.length - pos - neg;
const pct = (n: number) => `${Math.round(n * 100)}%`;
const snip = (t: string) => t.replace(/\s+/g, " ").slice(0, 90);

console.log(`\n${labels.length} voted posts: ${pos} probably, ${maybe} maybe, ${neg} no`);
console.log("(\"probably\" counts as slop, \"no\" as not slop; \"maybe\" is left out of the accuracy numbers and listed below)");
if (labels.length < 20 || pos < 5 || neg < 5) console.log("(too few votes of one kind for the suggestions to be trustworthy; aim for 20+ with 5+ of each)");

console.log("\nCurrent thresholds:");
for (const [name, t] of Object.entries(DEFAULT_PARAMS.thresholds)) {
  const c = confusion(scored, t);
  console.log(`  ${name.padEnd(10)} T=${t.toFixed(2)}  caught ${c.tp}/${c.tp + c.fn} slop (recall ${pct(c.recall)}), ${c.fp} false positive${c.fp === 1 ? "" : "s"} (precision ${pct(c.precision)})`);
}

console.log("\nThreshold sweep (T: TP FP FN TN | precision recall):");
for (const c of sweep(scored)) console.log(`  ${c.threshold.toFixed(2)}: ${String(c.tp).padStart(3)} ${String(c.fp).padStart(3)} ${String(c.fn).padStart(3)} ${String(c.tn).padStart(3)} | ${pct(c.precision).padStart(4)} ${pct(c.recall).padStart(4)}`);

const sug = suggest(scored);
if (sug) {
  console.log("\nSuggested thresholds:");
  for (const s of sug) console.log(`  ${s.sensitivity.padEnd(10)} ${s.threshold.toFixed(2)}  (${s.why}; ${s.at.fp} FP, ${s.at.fn} FN)`);
}

const T = DEFAULT_PARAMS.thresholds.moderate;
const m = mistakes(scored, T);
console.log(`\nMistakes at the moderate threshold (${T.toFixed(2)}):`);
console.log(`  Voted "no" but flagged (${m.falsePositives.length}):`);
for (const s of m.falsePositives) console.log(`    ${s.effective.toFixed(2)}  ${s.top.map((t) => `${t.id}=${t.value.toFixed(2)}`).join(" ")}\n      "${snip(s.text)}"`);
console.log(`  Voted "probably" but missed (${m.falseNegatives.length}):`);
for (const s of m.falseNegatives) console.log(`    raw ${s.raw.toFixed(2)}${s.gated ? " (stopped by the confidence gate)" : ""}  ${s.top.map((t) => `${t.id}=${t.value.toFixed(2)}`).join(" ")}\n      "${snip(s.text)}"`);
if (m.maybes.length) {
  console.log(`\n"Maybe" votes (${m.maybes.length}), highest score first; ${m.maybes.filter((x) => x.flagged).length} would be flagged at ${T.toFixed(2)}:`);
  for (const s of m.maybes) console.log(`    ${s.effective.toFixed(2)} ${s.flagged ? "flagged " : "not flagged"}  "${snip(s.text)}"`);
}

const fits = fitDampen(labels, tryWeights ? { weights: tryWeights } : {});
console.log(`\nHuman-written dampener (now ${DEFAULT_PARAMS.aiDampen}); best moderate threshold and F1 for each strength:`);
for (const f of fits) console.log(`  dampen ${f.aiDampen.toFixed(2)}  T=${f.moderate.threshold.toFixed(2)}  F1 ${f.moderate.at.f1.toFixed(2)}  (${f.moderate.at.tp} caught, ${f.moderate.at.fp} FP, ${f.moderate.at.fn} FN)`);

// Before/after against the old hard guard. OLD_T is the moderate threshold the old rule shipped with.
const OLD_T = Number(process.env.OLD_T ?? 0.25);
const cmp = compareToGuard(labels, OLD_T, T, tryWeights ? { weights: tryWeights } : {});
const cell = (c: typeof cmp.before) => `caught ${c.tp}/${c.tp + c.fn} probably, ${c.fp}/${c.fp + c.tn} no flagged`;
console.log(`\nBefore (hard human guard, T=${OLD_T.toFixed(2)}): ${cell(cmp.before)}`);
console.log(`After  (dampener, T=${T.toFixed(2)}):        ${cell(cmp.after)}`);
console.log(`Outcome changes (${cmp.changes.length}):`);
for (const c of cmp.changes) console.log(`  voted ${c.label.padEnd(8)} AI ${c.aiLikelihood.toFixed(2)}  ${c.before} -> ${c.after}  "${snip(c.text)}"`);

console.log("Reader response alone: chance a \"no\" post out-scores a \"probably\" post (0.50 = no signal), by weighting of reactions : comments : reposts:");
for (const c of ENGAGEMENT_CANDIDATES) {
  const { auc, n } = engagementAuc(labels, c.model);
  console.log(`  ${c.name.padEnd(30)} ${auc === null ? "not enough votes" : auc.toFixed(2)}  (${n} votes with engagement)`);
}
console.log("");
