import { describe, expect, it } from "vitest";
import { displayScore } from "../src/display.js";
import { DEFAULT_SCORING } from "../src/scoringStore.js";
import { simulate, type SimLive } from "../src/simulate.js";
import { scoreOf } from "../src/tuner.js";
import { DEFAULT_WEIGHTS, TELL_IDS } from "../src/weights.js";
import { ADAPTERS, judgeBody, makeHarness, verdictOf } from "./helpers.js";

const admin = { headers: { authorization: "Bearer s3cret" } };
const live: SimLive = { weights: DEFAULT_WEIGHTS, scoring: DEFAULT_SCORING, aiDampen: 0.35, minMeanConfidence: 0.25, yellowFraction: 0.6, displayPossibly: 40, displayLikely: 70, displayFullMultiple: 2 };
const dims = (tells: Record<string, number>, conf = 0.9, extra: Record<string, number> = { humanVoice: 0.2, usefulness: 0.2 }) => Object.fromEntries(Object.entries({ ...Object.fromEntries(TELL_IDS.map((id) => [id, 0])), ...tells, ...extra }).map(([id, value]) => [id, { value, confidence: conf }]));

describe("the simulator", () => {
  it("gives the score production gives, and every step that led to it", () => {
    const input = { dimensions: dims({ hypeMarketing: 0.8, manneredProse: 0.7, formulaicHook: 0.6 }), aiLikelihood: 0.9, engagement: { reactions: 40, comments: 3, reposts: 0 } };
    const r = simulate(input, live);
    expect(r.score).toBeCloseTo(scoreOf({ label: "probably", ...input }, { weights: DEFAULT_WEIGHTS, scoring: DEFAULT_SCORING, aiDampen: 0.35, minMeanConfidence: 0.25 }), 12);
    expect(r.score).toBeCloseTo(r.steps.slop * (1 - r.steps.shield) * r.dampener, 12);
    expect(r.steps.breakouts).toBe(3);
    expect(r.steps.cutAlone).toBe(false);
    expect(r.tells).toHaveLength(9);
    expect(r.shown).toBeCloseTo(displayScore(r.score, { moderate: 0.18, yellowFraction: 0.6, possibly: 40, likely: 70, fullMultiple: 2 }), 12);
  });
  it("says what happens at each sensitivity, and leaves a post alone when Jev wasn't sure", () => {
    const blatant = simulate({ dimensions: dims(Object.fromEntries(TELL_IDS.map((id) => [id, 0.9]))), aiLikelihood: 1, engagement: null }, live);
    expect(Object.values(blatant.verdicts).map((v) => v.word)).toEqual(["Likely slop", "Likely slop", "Likely slop"]);
    const unsure = simulate({ dimensions: dims(Object.fromEntries(TELL_IDS.map((id) => [id, 0.9])), 0.05), aiLikelihood: 1, engagement: null }, live);
    expect(unsure.gated).toBe(true);
    expect(unsure.shown).toBe(0);
    expect(unsure.verdicts.moderate.word).toBe("Not sure");
  });
  it("shows a lone tell being cut, and readers shielding a post", () => {
    const lone = simulate({ dimensions: dims({ hypeMarketing: 0.9 }), aiLikelihood: 1, engagement: null }, live);
    expect(lone.steps.cutAlone).toBe(true);
    expect(lone.steps.slop).toBeCloseTo(lone.steps.rawSlop * 0.6, 12);
    const loud = simulate({ dimensions: dims({ hypeMarketing: 0.9, manneredProse: 0.9 }), aiLikelihood: 1, engagement: { reactions: 900, comments: 60, reposts: 20 } }, live);
    const quiet = simulate({ dimensions: dims({ hypeMarketing: 0.9, manneredProse: 0.9 }), aiLikelihood: 1, engagement: null }, live);
    expect(loud.score).toBeLessThan(quiet.score);
    expect(loud.steps.shield).toBeGreaterThan(quiet.steps.shield);
  });
  it("places the zone lines lower for Aggressive than Moderate than Mild", () => {
    const r = simulate({ dimensions: dims({}), aiLikelihood: 1, engagement: null }, live);
    expect(r.zones.aggressive.likely).toBeLessThan(r.zones.moderate.likely);
    expect(r.zones.moderate.likely).toBeLessThan(r.zones.mild.likely);
    expect(r.zones.moderate).toEqual({ possibly: 40, likely: 70 });
  });
});

describe.each(ADAPTERS)("the simulator over HTTP (%s)", (kind) => {
  const H = () => makeHarness(kind, { ADMIN_TOKEN: "s3cret" });
  const body = (over: object = {}) => ({ dimensions: dims({ hypeMarketing: 0.8, manneredProse: 0.7 }), aiLikelihood: 0.9, engagement: { reactions: 10, comments: 1, reposts: 0 }, ...over });

  it("is admin only and uses no check", async () => {
    const h = await H();
    expect((await h.call("simulate", body(), { method: "POST" })).status).toBe(401);
    const r = await h.call("simulate", body(), { method: "POST", ...admin });
    expect(r.status).toBe(200);
    expect((await h.call("usage")).body.used).toBe(0);
  });

  it("matches what /judge returns for the same answers", async () => {
    const h = await H();
    const answers = dims({ hypeMarketing: 0.8, manneredProse: 0.7, formulaicHook: 0.55 });
    h.ctx.jev!.score = async () => ({ ...verdictOf(0), dimensions: answers, aiLikelihood: 0.9 });
    const engagement = { reactions: 200, comments: 12, reposts: 3 };
    const j = (await h.call("judge", judgeBody({ engagement }))).body;
    const s = (await h.call("simulate", { dimensions: answers, aiLikelihood: 0.9, engagement }, { method: "POST", ...admin })).body.result;
    expect(s.steps.slop).toBeCloseTo(j.slop, 12);
    expect(s.steps.shield).toBeCloseTo(j.shield, 12);
    expect(s.steps.tellMean).toBeCloseTo(j.tellMean, 12);
  });

  it("previews unsaved edits without saving them, and rejects bad ones", async () => {
    const h = await H();
    const plain = (await h.call("simulate", body(), { method: "POST", ...admin })).body;
    const edited = (await h.call("simulate", body({ draft: { scoring: { ...DEFAULT_SCORING, formula: { ...DEFAULT_SCORING.formula, gain: 4 } } } }), { method: "POST", ...admin })).body;
    expect(edited.used).toEqual({ weights: false, scoring: true, manifest: false });
    expect(edited.result.steps.rawSlop).toBeGreaterThan(plain.result.steps.rawSlop);
    expect((await h.call("scoring", undefined, admin)).body.effective.formula.gain).toBe(2); // nothing was saved
    const weighted = (await h.call("simulate", body({ draft: { weights: { hypeMarketing: 5 } } }), { method: "POST", ...admin })).body.result;
    expect(weighted.steps.tellMean).toBeGreaterThan(plain.result.steps.tellMean);
    const manifest = (await h.call("simulate", body({ draft: { manifest: { aiDampen: 0.9 } } }), { method: "POST", ...admin })).body.result;
    expect(manifest.dampener).toBeLessThan(plain.result.dampener);
    expect((await h.call("simulate", body({ draft: { scoring: { formula: { gain: 0 } } } }), { method: "POST", ...admin })).status).toBe(422);
    expect((await h.call("simulate", body({ aiLikelihood: 2 }), { method: "POST", ...admin })).status).toBe(422);
    expect((await h.call("simulate", body({ engagement: { reactions: -1 } }), { method: "POST", ...admin })).status).toBe(422);
  });
});

describe.each(ADAPTERS)("change history for the scoring settings and the client manifest (%s)", (kind) => {
  const H = () => makeHarness(kind, { ADMIN_TOKEN: "s3cret" });
  it("logs each save and reset of scoring with its note, newest first, and can restore an earlier one", async () => {
    const h = await H();
    expect((await h.call("scoring", undefined, admin)).body.history).toEqual([]);
    await h.call("scoring", { formula: { gain: 3 }, note: "raise the gain" }, { method: "POST", ...admin });
    await h.call("scoring", { thresholds: { aggressive: 0.08, moderate: 0.15, mild: 0.3 }, note: "stricter" }, { method: "POST", ...admin });
    const hist = (await h.call("scoring", { reset: true, note: "back to defaults" }, { method: "POST", ...admin })).body.history;
    expect(hist.map((c: any) => [c.source, c.note])).toEqual([["reset", "back to defaults"], ["admin", "stricter"], ["admin", "raise the gain"]]);
    expect(hist[2].value.formula.gain).toBe(3);
    expect(hist[1].value.thresholds.mild).toBe(0.3);
    expect(hist[0].value).toEqual(DEFAULT_SCORING);
    // A bad save is not logged.
    await h.call("scoring", { formula: { gain: 0 } }, { method: "POST", ...admin });
    expect((await h.call("scoring", undefined, admin)).body.history).toHaveLength(3);
    // Loading an old entry back and saving it restores it.
    await h.call("scoring", hist[2].value, { method: "POST", ...admin });
    expect((await h.call("scoring", undefined, admin)).body.effective.formula.gain).toBe(3);
  });
  it("does the same for the client manifest, and keeps the two groups apart", async () => {
    const h = await H();
    await h.call("adminManifest", { values: { minChars: 250 }, note: "longer posts only" }, { method: "POST", ...admin });
    await h.call("scoring", { formula: { gain: 3 } }, { method: "POST", ...admin });
    const m = (await h.call("adminManifest", undefined, admin)).body.history;
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ note: "longer posts only", source: "admin", value: { minChars: 250 } });
    expect((await h.call("scoring", undefined, admin)).body.history).toHaveLength(1);
  });
});
