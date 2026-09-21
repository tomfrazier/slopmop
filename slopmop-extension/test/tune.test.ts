import { describe, expect, it } from "vitest";
import { fromServerExport, parseLabels } from "../src/shared/labels";
import { compareToGuard, ENGAGEMENT_CANDIDATES, engagementAuc, confusion, DAMPEN_CANDIDATES, fitDampen, mistakes, scoreAll, suggest, sweep } from "../src/shared/tune";
import type { LabelRecord, Vote } from "../src/shared/types";

const ids = ["contrastFraming", "emptyEvaluation", "tradeoffFreePromises", "formalHedging", "hypeMarketing", "manneredProse", "formulaicHook", "manufacturedNarrative", "engagementBait"];
const rec = (label: Vote, v: number, ai = 0.9, extra: Partial<LabelRecord> = {}): LabelRecord => ({
  urn: `u${Math.random()}`,
  label,
  at: 0,
  text: "x",
  own: false,
  engagement: { reactions: 0, comments: 0, reposts: 0 },
  verdict: {
    model: "t",
    aiLikelihood: ai,
    dimensions: { ...Object.fromEntries(ids.map((k) => [k, { value: v, confidence: 0.9 }])), humanVoice: { value: 0, confidence: 0.9 }, usefulness: { value: 0, confidence: 0.9 } },
  },
  decided: { level: "none", score: 0, mode: "hide", sensitivity: "moderate" },
  ...extra,
});

const labels = [
  rec("probably", 0.9), rec("probably", 0.8), rec("probably", 0.6), rec("probably", 0.15, 0.9), // last one is a hard miss
  rec("no", 0.05), rec("no", 0.1), rec("no", 0.2), rec("no", 0.3, 0.2), // last: a marginal post that reads human-written, spared by the dampener
];

describe("tuning", () => {
  it("scores labels with the real decision logic, including the human-written dampener", () => {
    const s = scoreAll(labels);
    expect(s[7].gated).toBe(false);
    expect(s[7].effective).toBeLessThan(scoreAll([rec("no", 0.3, 1)])[0].effective); // same tells, dampened
    expect(s[0].effective).toBeGreaterThan(0.5);
  });
  it("gates a post Jev was not confident about", () => {
    const shaky = rec("probably", 0.9);
    for (const d of Object.values(shaky.verdict.dimensions)) d.confidence = 0.05;
    expect(scoreAll([shaky])[0]).toMatchObject({ gated: true, effective: 0 });
  });
  it("builds a confusion matrix per threshold", () => {
    const c = confusion(scoreAll(labels), 0.5);
    expect(c).toMatchObject({ tp: 3, fp: 0, fn: 1, tn: 4 });
    expect(c.precision).toBe(1);
    expect(c.recall).toBeCloseTo(0.75);
  });
  it("sweeps monotonically: raising the threshold never flags more", () => {
    const flagged = sweep(scoreAll(labels)).map((r) => r.tp + r.fp);
    for (let i = 1; i < flagged.length; i++) expect(flagged[i]).toBeLessThanOrEqual(flagged[i - 1]);
  });
  it("suggests thresholds ordered aggressive <= moderate <= mild, with no false positives for mild", () => {
    const sug = suggest(scoreAll(labels))!;
    const t = Object.fromEntries(sug.map((s) => [s.sensitivity, s]));
    expect(t.aggressive.threshold).toBeLessThanOrEqual(t.moderate.threshold);
    expect(t.moderate.threshold).toBeLessThanOrEqual(t.mild.threshold);
    expect(t.mild.at.fp).toBe(0);
  });
  it("keeps sensitivity ordered even when the independent picks would cross", () => {
    const crossing = [
      rec("probably", 0.9, 0.95), rec("probably", 0.8, 0.9), rec("probably", 0.65, 0.85), rec("probably", 0.5, 0.8), rec("probably", 0.2, 0.7),
      rec("no", 0.05, 0.1), rec("no", 0.15, 0.3), rec("no", 0.4, 0.8), rec("no", 0.55, 0.7), rec("no", 0.1, 0.6),
    ];
    const t = Object.fromEntries(suggest(scoreAll(crossing))!.map((s) => [s.sensitivity, s.threshold]));
    expect(t.aggressive).toBeLessThanOrEqual(t.moderate);
    expect(t.moderate).toBeLessThanOrEqual(t.mild);
  });
  it("refuses to suggest from a single class", () => {
    expect(suggest(scoreAll([rec("probably", 0.9), rec("probably", 0.8)]))).toBeNull();
  });
  it("lists false positives and misses", () => {
    const m = mistakes(scoreAll(labels), 0.5);
    expect(m.falsePositives).toHaveLength(0);
    expect(m.falseNegatives).toHaveLength(1);
  });
  it("re-scores with different weights without new Jev calls", () => {
    const heavy = scoreAll(labels, { gain: 4 });
    expect(confusion(heavy, 0.5).tp).toBeGreaterThanOrEqual(confusion(scoreAll(labels), 0.5).tp);
  });
});

describe("maybe votes", () => {
  it("are excluded from the accuracy numbers but reported", () => {
    const base = [rec("probably", 0.9), rec("no", 0.05)];
    const withMaybe = [...base, rec("maybe", 0.9), rec("maybe", 0.05)];
    expect(confusion(scoreAll(withMaybe), 0.5)).toEqual(confusion(scoreAll(base), 0.5));
    const m = mistakes(scoreAll(withMaybe), 0.5).maybes;
    expect(m).toHaveLength(2);
    expect(m[0].flagged).toBe(true);
    expect(m[1].flagged).toBe(false);
  });
  it("cannot stand in for a missing class when suggesting thresholds", () => {
    expect(suggest(scoreAll([rec("probably", 0.9), rec("maybe", 0.3), rec("maybe", 0.2)]))).toBeNull();
  });
});

describe("parseLabels", () => {
  const line = (r: LabelRecord | { urn: string; label: null; at: number }) => JSON.stringify(r);
  const a = rec("no", 0.1, 0.9, { urn: "a", at: 1 });
  it("reads JSONL, last vote per post wins, and a clear retracts a vote", () => {
    const text = [line(a), line({ ...a, label: "probably", at: 2 }), line(rec("maybe", 0.3, 0.9, { urn: "b", at: 3 })), line({ urn: "b", label: null, at: 4 })].join("\n");
    const out = parseLabels(text);
    expect(out.map((r) => [r.urn, r.label])).toEqual([["a", "probably"]]);
  });
  it("reads a popup export and maps legacy slop/not-slop votes", () => {
    const legacy = { ...a, label: "slop" } as unknown as LabelRecord;
    const out = parseLabels(JSON.stringify({ version: 1, labels: [legacy, { ...a, urn: "z", label: "not-slop" }] }));
    expect(out.map((r) => r.label).sort()).toEqual(["no", "probably"]);
  });
  it("ignores malformed records instead of crashing", () => {
    expect(parseLabels(line(a) + "\n" + JSON.stringify({ urn: "x", label: "banana" }))).toHaveLength(1);
  });
});

describe("server community export as tuning labels", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    network: "linkedin",
    contentId: "a".repeat(32),
    aiLikelihood: 0.9,
    model: "jev-1.13.0",
    dimensions: { contrastFraming: { value: 0.8, confidence: 0.9 } },
    engagement: { reactions: 5, comments: 1, reposts: 0 },
    lastSeen: 123,
    votes: { no: 0, maybe: 0, probably: 3, total: 3 },
    consensus: "probably",
    ...over,
  });
  it("turns a row with a consensus into a label the tuner can use", () => {
    const l = fromServerExport(row())!;
    // The export carries the server's weighted composite, so tuning reproduces production scoring with no weights here.
    const w = fromServerExport(row({ tellMean: 0.42, tellRank: ["formulaicHook", "emptyEvaluation"] }))!;
    expect(w.verdict).toMatchObject({ tellMean: 0.42, tellRank: ["formulaicHook", "emptyEvaluation"] });
    expect(l.verdict.tellMean).toBeUndefined();
    expect(l).toMatchObject({ label: "probably", contentId: "a".repeat(32), engagement: { reactions: 5 }, verdict: { aiLikelihood: 0.9 } });
    expect(scoreAll([l])).toHaveLength(1);
  });
  it("skips rows nobody agreed on yet, or that were never scored", () => {
    expect(fromServerExport(row({ consensus: null }))).toBeNull();
    expect(fromServerExport(row({ dimensions: null }))).toBeNull();
  });
  it("is read from an NDJSON export file by parseLabels", () => {
    const text = [row(), row({ contentId: "b".repeat(32), consensus: "no" }), row({ contentId: "c".repeat(32), consensus: null })].map((r) => JSON.stringify(r)).join("\n");
    expect(parseLabels(text).map((l) => l.label).sort()).toEqual(["no", "probably"]);
  });
  it("fits the dampener over its candidate strengths, best first", () => {
    const fits = fitDampen(labels);
    expect(fits.map((f) => f.aiDampen).sort()).toEqual([...DAMPEN_CANDIDATES].sort());
    for (let i = 1; i < fits.length; i++) expect(fits[i - 1].moderate.at.f1).toBeGreaterThanOrEqual(fits[i].moderate.at.f1);
    for (const f of fits) expect(f.aiDampen).toBeGreaterThanOrEqual(0), expect(f.aiDampen).toBeLessThanOrEqual(1);
  });
  it("reports what changed against the old hard human guard", () => {
    const withHumanSlop = [...labels, rec("probably", 0.85, 0.2)]; // typed by a person, still slop: the old guard let it through
    const cmp = compareToGuard(withHumanSlop, 0.5, 0.5);
    expect(cmp.changes.some((c) => c.label === "probably" && c.before === "not flagged" && c.after === "flagged")).toBe(true);
    expect(cmp.after.tp).toBeGreaterThan(cmp.before.tp);
  });
  it("reports how well reader response alone separates the votes, for each candidate weighting", () => {
    const withEng = (label: Vote, reactions: number, comments: number) => rec(label, 0.5, 0.9, { engagement: { reactions, comments, reposts: 0 } });
    const set = [withEng("no", 400, 30), withEng("no", 120, 9), withEng("probably", 5, 0), withEng("probably", 30, 1)];
    for (const c of ENGAGEMENT_CANDIDATES) expect(engagementAuc(set, c.model).auc).toBe(1); // every "no" out-scores every "probably"
    expect(engagementAuc([withEng("no", 1, 0)], ENGAGEMENT_CANDIDATES[0].model).auc).toBeNull(); // needs both kinds
    expect(engagementAuc([rec("no", 0.1), rec("probably", 0.9)], ENGAGEMENT_CANDIDATES[0].model).n).toBe(0); // votes with no engagement are left out
  });
});
