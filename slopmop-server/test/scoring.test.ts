import { describe, expect, it } from "vitest";
import { breakouts, DEFAULT_CORROBORATION, DEFAULT_ENGAGEMENT, DEFAULT_FORMULA, engagementNorm, MAX_SHIELD, scoreParts } from "../src/scoring.js";
import { DEFAULT_SCORING, DEFAULT_THRESHOLDS, modelVersion, validateScoring } from "../src/scoringStore.js";
import { applyWeights, DEFAULT_WEIGHTS, TELL_IDS } from "../src/weights.js";
import { ADAPTERS, judgeBody, makeHarness, verdictOf } from "./helpers.js";

const dims = (values: Record<string, number>) => Object.fromEntries(Object.entries(values).map(([id, value]) => [id, { value, confidence: 0.9 }]));
const admin = { headers: { authorization: "Bearer s3cret" } };

describe("reader response", () => {
  it("is 0 with no engagement and rises with more, capped at 1", () => {
    expect(engagementNorm(null)).toBe(0);
    expect(engagementNorm({ reactions: 0, comments: 0, reposts: 0 })).toBe(0);
    expect(engagementNorm({ reactions: 20, comments: 5, reposts: 1 })).toBeLessThan(engagementNorm({ reactions: 200, comments: 50, reposts: 10 }));
    expect(engagementNorm({ reactions: 1e9, comments: 1e9, reposts: 1e9 })).toBe(1);
  });
  it("counts a comment for more than a reaction and a repost for more than a comment", () => {
    const one = (k: "reactions" | "comments" | "reposts") => engagementNorm({ reactions: 0, comments: 0, reposts: 0, [k]: 100 });
    expect(one("comments")).toBeGreaterThan(one("reactions"));
    expect(one("reposts")).toBeGreaterThan(one("comments"));
  });
  it("discounts a pile of reactions with almost no comments or reposts, but not a small post", () => {
    const hollow = engagementNorm({ reactions: 2000, comments: 3, reposts: 0 });
    const real = engagementNorm({ reactions: 2000, comments: 120, reposts: 40 });
    expect(hollow).toBeLessThan(real);
    expect(hollow).toBeLessThan(engagementNorm({ reactions: 2000, comments: 3, reposts: 0 }, { ...DEFAULT_ENGAGEMENT, hollowFloor: 1 })); // the discount is what lowers it
    // Under the reaction floor there is nothing to be suspicious of.
    expect(engagementNorm({ reactions: 10, comments: 0, reposts: 0 })).toBe(engagementNorm({ reactions: 10, comments: 0, reposts: 0 }, { ...DEFAULT_ENGAGEMENT, hollowFloor: 1 }));
    // The discount never goes below the floor.
    expect(engagementNorm({ reactions: 2000, comments: 0, reposts: 0 })).toBeGreaterThan(0);
  });
  it("is monotonic in each count", () => {
    let prev = -1;
    for (const c of [0, 1, 5, 20, 100, 500]) {
      const n = engagementNorm({ reactions: 400, comments: c, reposts: 0 });
      expect(n).toBeGreaterThanOrEqual(prev);
      prev = n;
    }
  });
});

describe("scoreParts", () => {
  const base = { tellMean: 0.3, dimensions: dims({ contrastFraming: 0.6, hypeMarketing: 0.6, humanVoice: 0.5, usefulness: 1 }), engagement: { reactions: 500, comments: 40, reposts: 8 } };
  it("subtracts the human-voice offset and caps the shield", () => {
    const p = scoreParts(base, DEFAULT_WEIGHTS, DEFAULT_ENGAGEMENT);
    expect(p.slop).toBeCloseTo(0.3 * 2 - 0.15 * 0.5, 9);
    expect(p.shield).toBeLessThanOrEqual(MAX_SHIELD);
    expect(scoreParts({ ...base, engagement: { reactions: 1e7, comments: 1e7, reposts: 1e7 } }, DEFAULT_WEIGHTS, DEFAULT_ENGAGEMENT).shield).toBe(MAX_SHIELD);
  });
  it("also reports the shield from usefulness alone, which your own posts and drafts keep, and which engagement never changes", () => {
    const quiet = scoreParts({ ...base, engagement: null }, DEFAULT_WEIGHTS, DEFAULT_ENGAGEMENT);
    const loud = scoreParts(base, DEFAULT_WEIGHTS, DEFAULT_ENGAGEMENT);
    expect(quiet.usefulShield).toBeCloseTo(0.5 * 1, 9); // half of full usefulness
    expect(loud.usefulShield).toBe(quiet.usefulShield);
    expect(loud.shield).toBeGreaterThan(loud.usefulShield); // reader response is on top of it
    expect(quiet.shield).toBeCloseTo(quiet.usefulShield, 9); // with no readers the two agree
    expect(scoreParts(base, { ...DEFAULT_WEIGHTS, usefulness: 0 }, DEFAULT_ENGAGEMENT).usefulShield).toBe(0);
    expect(scoreParts(base, DEFAULT_WEIGHTS, DEFAULT_ENGAGEMENT, DEFAULT_CORROBORATION, { ...DEFAULT_FORMULA, maxShield: 0.3 }).usefulShield).toBe(0.3);
  });
  it("lets engagement raise the shield of the same text over time", () => {
    const quiet = scoreParts({ ...base, engagement: { reactions: 3, comments: 0, reposts: 0 } }, DEFAULT_WEIGHTS, DEFAULT_ENGAGEMENT);
    const loud = scoreParts(base, DEFAULT_WEIGHTS, DEFAULT_ENGAGEMENT);
    expect(loud.shield).toBeGreaterThan(quiet.shield);
    expect(loud.slop).toBe(quiet.slop);
  });
  it("scales the two counter-tells by their multipliers", () => {
    const w = (o: object) => ({ ...DEFAULT_WEIGHTS, ...o });
    expect(scoreParts(base, w({ humanVoice: 3 }), DEFAULT_ENGAGEMENT).slop).toBeLessThan(scoreParts(base, w({ humanVoice: 0 }), DEFAULT_ENGAGEMENT).slop);
    const noUse = scoreParts(base, w({ usefulness: 0 }), DEFAULT_ENGAGEMENT);
    expect(noUse.shield).toBeCloseTo(Math.min(MAX_SHIELD, noUse.engagementNorm), 9); // engagement alone
  });
});

describe("one sign is thin evidence", () => {
  const withTells = (tells: Record<string, number>, confidence = 0.9) => Object.fromEntries(Object.entries({ ...Object.fromEntries(TELL_IDS.map((id) => [id, 0])), ...tells }).map(([id, value]) => [id, { value, confidence }]));
  const parts = (tells: Record<string, number>, confidence?: number) => {
    const dimensions = withTells(tells, confidence);
    const w = applyWeights(dimensions, DEFAULT_WEIGHTS);
    return scoreParts({ tellMean: w.tellMean, dimensions, engagement: null }, DEFAULT_WEIGHTS, DEFAULT_ENGAGEMENT);
  };
  it("counts the tells that reach the breakout with enough confidence behind them", () => {
    expect(breakouts(withTells({ hypeMarketing: 0.6, manneredProse: 0.5, formulaicHook: 0.2 }))).toBe(2);
    expect(breakouts(withTells({ hypeMarketing: 0.6, manneredProse: 0.5 }, 0.1))).toBe(0); // Jev wasn't sure of either
    expect(breakouts(withTells({ hypeMarketing: 0.39 }))).toBe(0);
  });
  it("cuts the slop score when only one tell stands out, and not when two do", () => {
    const one = parts({ hypeMarketing: 0.9, contrastFraming: 0.3, formulaicHook: 0.3, manneredProse: 0.3 });
    const two = parts({ hypeMarketing: 0.9, manneredProse: 0.9, contrastFraming: 0.0, formulaicHook: 0.0 });
    expect(one.breakouts).toBe(1);
    expect(two.breakouts).toBe(2);
    const uncut = (tellMean: number) => Math.min(1, tellMean * 2);
    expect(one.slop).toBeCloseTo(uncut((0.9 + 0.9) / 9) * DEFAULT_CORROBORATION.alone, 6);
    expect(two.slop).toBeCloseTo(uncut((0.9 + 0.9) / 9), 6);
  });
  it("can be switched off (alone = 1) or made stricter, per the admin's settings", () => {
    const dimensions = withTells({ hypeMarketing: 0.9 });
    const w = applyWeights(dimensions, DEFAULT_WEIGHTS);
    const at = (alone: number) => scoreParts({ tellMean: w.tellMean, dimensions, engagement: null }, DEFAULT_WEIGHTS, DEFAULT_ENGAGEMENT, { ...DEFAULT_CORROBORATION, alone }).slop;
    expect(at(1)).toBeGreaterThan(at(0.6));
    expect(at(0.6)).toBeGreaterThan(at(0));
  });
});

describe("a tell Jev wasn't sure of", () => {
  const dim = (value: number, confidence: number) => ({ value, confidence });
  it("counts in proportion to Jev's confidence, so a guess can't pull the average up", () => {
    const dimensions = { ...Object.fromEntries(TELL_IDS.map((id) => [id, dim(0, 0.9)])), engagementBait: dim(0.54, 0), hypeMarketing: dim(0.58, 0.4) };
    const sure = { ...dimensions, engagementBait: dim(0.54, 0.9), hypeMarketing: dim(0.58, 0.9) };
    expect(applyWeights(dimensions, DEFAULT_WEIGHTS).tellMean).toBeLessThan(applyWeights(sure, DEFAULT_WEIGHTS).tellMean);
    // A confidence-0 answer has no say at all.
    expect(applyWeights({ ...dimensions, engagementBait: dim(0.54, 0) }, DEFAULT_WEIGHTS).tellMean).toBe(applyWeights({ ...dimensions, engagementBait: dim(1, 0) }, DEFAULT_WEIGHTS).tellMean);
  });
  it("gives a mean of 0 when Jev was sure of nothing", () => {
    expect(applyWeights(Object.fromEntries(TELL_IDS.map((id) => [id, dim(1, 0)])), DEFAULT_WEIGHTS).tellMean).toBe(0);
  });
});

describe("validateScoring", () => {
  it("fills in defaults and enforces ordering and ranges", () => {
    expect(validateScoring({})).toEqual(DEFAULT_SCORING);
    expect(validateScoring({ corroboration: { needed: 0 } })).toMatch(/needed/);
    expect(validateScoring({ formula: { gain: 0 } })).toMatch(/gain/);
    expect(validateScoring({ formula: { maxShield: 2 } })).toMatch(/maxShield/);
    expect(validateScoring({ recheck: { minMs: 3_600_000, initialMs: 60_000 } })).toMatch(/minMs <= initialMs/);
    expect(validateScoring({ engagement: { logScale: 0 } })).toMatch(/logScale/);
    expect(validateScoring({ formula: { gain: 3 } })).toMatchObject({ formula: { gain: 3, humanOffset: 0.15 } });
    expect(validateScoring({ corroboration: { alone: 2 } })).toMatch(/alone/);
    expect(validateScoring({ thresholds: { aggressive: 0.3, moderate: 0.2 } })).toMatch(/aggressive <= moderate/);
    expect(validateScoring({ thresholds: { mild: 2 } })).toMatch(/mild/);
    expect(validateScoring({ engagement: { comment: -1 } })).toMatch(/comment/);
    expect(validateScoring({ engagement: { reaction: 0, comment: 0, repost: 0 } })).toMatch(/above 0/);
    expect(validateScoring([1])).toMatch(/object/);
  });
  it("changes the version when the engagement model does", () => {
    expect(modelVersion("abc", DEFAULT_ENGAGEMENT)).toBe(modelVersion("abc", { ...DEFAULT_ENGAGEMENT }));
    expect(modelVersion("abc", DEFAULT_ENGAGEMENT)).not.toBe(modelVersion("abc", { ...DEFAULT_ENGAGEMENT, repost: 20 }));
  });
});

describe("every number in the formula is adjustable", () => {
  const dimensions = dims({ contrastFraming: 0.55, hypeMarketing: 0.55, humanVoice: 0.5, usefulness: 0.5 });
  const run = (formula: object, weights = DEFAULT_WEIGHTS) => {
    const w = applyWeights(dimensions, weights);
    return scoreParts({ tellMean: w.tellMean, dimensions, engagement: { reactions: 200, comments: 10, reposts: 2 } }, weights, DEFAULT_ENGAGEMENT, DEFAULT_CORROBORATION, { ...DEFAULT_FORMULA, ...formula });
  };
  it("moves slop with the gain and the human-voice offset, and the shield with its share and its cap", () => {
    expect(run({ gain: 1.5 }).slop).toBeGreaterThan(run({ gain: 1 }).slop);
    expect(run({ gain: 1, humanOffset: 0.4 }).slop).toBeLessThan(run({ gain: 1, humanOffset: 0.15 }).slop);
    expect(run({ maxShield: 0.2 }).shield).toBe(0.2);
    expect(run({ usefulShare: 1 }).shield).not.toBe(run({ usefulShare: 0 }).shield);
  });
  it("moves the tell mean with the confidence power", () => {
    const dims2 = { contrastFraming: { value: 0.2, confidence: 0.9 }, hypeMarketing: { value: 0.8, confidence: 0.1 } };
    const at = (power: number) => applyWeights(dims2, DEFAULT_WEIGHTS, power).tellMean;
    expect(at(0)).toBeGreaterThan(at(2)); // power 0 ignores confidence; a higher power trusts the unsure tell less
  });
  it("moves reader response with the log scale", () => {
    const e = { reactions: 500, comments: 20, reposts: 5 };
    expect(engagementNorm(e, { ...DEFAULT_ENGAGEMENT, logScale: 6 })).toBeLessThan(engagementNorm(e, DEFAULT_ENGAGEMENT));
  });
});

describe.each(ADAPTERS)("scoring over HTTP (%s)", (kind) => {
  const H = () => makeHarness(kind, { ADMIN_TOKEN: "s3cret" });
  const withDims = (h: Awaited<ReturnType<typeof makeHarness>>) => {
    h.ctx.jev!.score = async () => ({ ...verdictOf(0), dimensions: { ...verdictOf(0).dimensions, ...dims({ formulaicHook: 1, usefulness: 0.5 }) } });
  };

  it("sends slop, shield, reader response and thresholds with a verdict, and recomputes the shield when engagement changes", async () => {
    const h = await H();
    withDims(h);
    const first = await h.call("judge", { ...judgeBody(), engagement: { reactions: 2, comments: 0, reposts: 0 } });
    expect(first.body.manifestVersion).toMatch(/^[0-9a-f]{12}$/);
    expect(typeof first.body.usefulShield).toBe("number");
    expect(first.body.thresholds).toBeUndefined(); // they come in the manifest, not with every answer
    expect(typeof first.body.slop).toBe("number");
    const later = await h.call("judge", { ...judgeBody(), engagement: { reactions: 900, comments: 60, reposts: 20 } }, { install: "install-bbbbbbbb" });
    expect(later.body.cached).toBe(true); // Jev is not asked again
    expect(later.body.shield).toBeGreaterThan(first.body.shield);
    expect(later.body.engagementNorm).toBeGreaterThan(first.body.engagementNorm);
    expect(later.body.slop).toBe(first.body.slop);
  });

  it("serves the manifest version with usage, and the thresholds in the manifest", async () => {
    const h = await H();
    const version = (await h.call("usage")).body.manifestVersion;
    const manifest = (await h.call("manifest")).body;
    expect(manifest).toMatchObject({ version, ttlSeconds: 86400, thresholds: DEFAULT_THRESHOLDS });
  });

  it("is admin only, saves an edit live, validates, and resets", async () => {
    const h = await H();
    expect((await h.call("scoring")).status).toBe(401);
    const saved = await h.call("scoring", { thresholds: { aggressive: 0.15, moderate: 0.2, mild: 0.3 }, engagement: { repost: 20 } }, { method: "POST", ...admin });
    expect(saved.body.effective.thresholds.mild).toBe(0.3);
    expect(saved.body.effective.engagement.repost).toBe(20);
    expect((await h.call("manifest")).body.thresholds.mild).toBe(0.3);
    const bad = await h.call("scoring", { thresholds: { aggressive: 0.5, moderate: 0.2 } }, { method: "POST", ...admin });
    expect(bad.status).toBe(422);
    expect((await h.call("scoring", undefined, admin)).body.effective.thresholds.mild).toBe(0.3); // unchanged
    const changed = (await h.call("manifest")).body.version;
    const reset = await h.call("scoring", { reset: true }, { method: "POST", ...admin });
    expect((await h.call("manifest")).body.version).not.toBe(changed); // a threshold change is a new manifest version
    expect(reset.body.effective.thresholds).toEqual(DEFAULT_THRESHOLDS);
  });

  it("changing the engagement model changes the weights version, so clients re-fetch", async () => {
    const h = await H();
    const before = (await h.call("judge", judgeBody())).body.weightsVersion;
    await h.call("scoring", { engagement: { comment: 9 } }, { method: "POST", ...admin });
    const after = (await h.call("judge", judgeBody(), { install: "install-bbbbbbbb" })).body.weightsVersion;
    expect(after).not.toBe(before);
  });
});
