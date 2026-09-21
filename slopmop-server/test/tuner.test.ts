import { describe, expect, it } from "vitest";
import { parseCurated } from "../src/routes/tunerRoute.js";
import { DEFAULT_SCORING } from "../src/scoringStore.js";
import { analyse, confusion, scoreOf, stability, suggest, type Example, type Label } from "../src/tuner.js";
import { TELL_IDS, DEFAULT_WEIGHTS } from "../src/weights.js";
import { ADAPTERS, judgeBody, makeHarness, verdictOf } from "./helpers.js";

const admin = { headers: { authorization: "Bearer s3cret" } };
const live = { weights: DEFAULT_WEIGHTS, scoring: DEFAULT_SCORING, aiDampen: 0.35, minMeanConfidence: 0.25 };
const dims = (v: number, conf = 0.9) => ({ ...Object.fromEntries(TELL_IDS.map((id) => [id, { value: v, confidence: conf }])), humanVoice: { value: 0.2, confidence: conf }, usefulness: { value: 0.2, confidence: conf } });
const ex = (label: Label, v: number, ai = 0.95, engagement = { reactions: 0, comments: 0, reposts: 0 }): Example => ({ label, dimensions: dims(v), aiLikelihood: ai, engagement });

/** Slop posts score higher than clean ones, with a clear gap. */
const separable = (n: number) => [...Array.from({ length: n }, (_, i) => ex("probably", 0.35 + (i % 5) * 0.05)), ...Array.from({ length: n }, (_, i) => ex("no", 0.02 + (i % 5) * 0.01)), ex("maybe", 0.15)];

describe("scoring for the tuner is the production score", () => {
  it("gives the score production gives, and 0 when Jev wasn't confident enough", () => {
    const e = ex("probably", 0.4);
    expect(scoreOf(e, live)).toBeGreaterThan(0);
    expect(scoreOf({ ...e, dimensions: dims(0.4, 0.1) }, live)).toBe(0); // mean confidence under 0.25: left alone
  });
  it("shields a post with readers behind it, and dampens one that reads human-written", () => {
    const base = ex("probably", 0.4);
    expect(scoreOf({ ...base, engagement: { reactions: 900, comments: 60, reposts: 20 } }, live)).toBeLessThan(scoreOf(base, live));
    expect(scoreOf({ ...base, aiLikelihood: 0.1 }, live)).toBeLessThan(scoreOf({ ...base, aiLikelihood: 1 }, live));
  });
});

describe.each(ADAPTERS)("the tuner matches what /judge returns (%s)", (kind) => {
  it("scores a verdict exactly as the judge's slop x (1 - shield) x dampener", async () => {
    const h = await makeHarness(kind, { ADMIN_TOKEN: "s3cret" });
    h.ctx.jev!.score = async () => ({ ...verdictOf(0), dimensions: { ...verdictOf(0).dimensions, ...dims(0.6) }, aiLikelihood: 0.7 });
    const engagement = { reactions: 300, comments: 20, reposts: 4 };
    const r = (await h.call("judge", judgeBody({ engagement }))).body;
    const fromJudge = r.slop * (1 - r.shield) * (1 - 0.35 * (1 - r.aiLikelihood));
    expect(scoreOf({ label: "probably", dimensions: r.dimensions, aiLikelihood: r.aiLikelihood, engagement }, live)).toBeCloseTo(fromJudge, 9);
  });
});

describe("thresholds from labelled posts", () => {
  it("counts the labels, keeps maybes out of the accuracy numbers, and suggests ordered thresholds", () => {
    const a = analyse(separable(20), live);
    expect(a.counts).toEqual({ probably: 20, no: 20, maybe: 1 });
    const s = a.suggestion!;
    expect(s.map((x) => x.sensitivity)).toEqual(["aggressive", "moderate", "mild"]);
    expect(s[0].threshold).toBeLessThanOrEqual(s[1].threshold);
    expect(s[1].threshold).toBeLessThanOrEqual(s[2].threshold);
    expect(s[2].at.fp).toBe(0); // mild flags none of the "no" posts
    expect(a.sweep.length).toBeGreaterThan(40);
    const c = confusion(a.sweep.map((r) => ({ label: "maybe" as Label, score: r.threshold })), 0.1);
    expect(c.tp + c.fp + c.fn + c.tn).toBe(0); // maybes never count
  });
  it("warns when there are too few labels, and won't suggest with only one kind", () => {
    expect(analyse(separable(3), live).warnings.join(" ")).toMatch(/Aim for at least 15/);
    expect(analyse([ex("no", 0.1), ex("no", 0.2)], live).suggestion).toBeNull();
    expect(suggest([])).toBeNull();
  });
  it("warns when no post has engagement counts", () => {
    expect(analyse(separable(20), live).warnings.join(" ")).toMatch(/engagement/);
    expect(analyse(separable(20).map((e) => ({ ...e, engagement: { reactions: 40, comments: 3, reposts: 1 } })), live).warnings.join(" ")).not.toMatch(/engagement counts/);
  });
  it("reports how stable the suggestion is, the same way every time, and calls a clean split stable", () => {
    const scored = separable(20).map((e) => ({ label: e.label, score: scoreOf(e, live) }));
    const one = stability(scored)!;
    expect(stability(scored)).toEqual(one);
    expect(one.p10).toBeLessThanOrEqual(one.median);
    expect(one.median).toBeLessThanOrEqual(one.p90);
    expect(one.stable).toBe(true);
    expect(stability([{ label: "no", score: 0.1 }])).toBeNull();
  });
  it("calls a suggestion unstable when the labels overlap", () => {
    const messy = Array.from({ length: 24 }, (_, i) => ex(i % 2 ? "probably" : "no", 0.05 + ((i * 7) % 11) * 0.03));
    const st = stability(messy.map((e) => ({ label: e.label, score: scoreOf(e, live) })))!;
    expect(st.p90 - st.p10).toBeGreaterThan(0.04);
    expect(st.stable).toBe(false);
  });
  it("shows where the current thresholds land on the labelled posts", () => {
    const a = analyse(separable(20), { ...live, scoring: { ...DEFAULT_SCORING, thresholds: { aggressive: 0.05, moderate: 0.1, mild: 0.9 } } });
    expect(a.current.map((c) => c.threshold)).toEqual([0.05, 0.1, 0.9]);
    expect(a.current[2].at.tp).toBe(0); // 0.9 flags nothing
  });
});

describe("importing the admin's own labelled posts", () => {
  const rec = (label: string | null, key = "u1", v = 0.5) => ({ urn: key, label, at: 1, text: "SHOULD NEVER BE STORED", verdict: { model: "j", aiLikelihood: 0.8, dimensions: dims(v) }, engagement: { reactions: 5, comments: 1, reposts: 0 } });
  it("reads JSON lines, an array, or {labels}, and the last vote per post wins", () => {
    const lines = [rec("no", "a"), rec("probably", "a"), rec("maybe", "b")].map((r) => JSON.stringify(r)).join("\n");
    expect(parseCurated(lines).map((l) => [l.key, l.label]).sort()).toEqual([["a", "probably"], ["b", "maybe"]]);
    expect(parseCurated(JSON.stringify({ labels: [rec("no", "a")] }))).toHaveLength(1);
    expect(parseCurated([rec("no", "a"), rec("probably", "b")])).toHaveLength(2);
  });
  it("lets a clear remove a post, ignores rows with no id, and rejects rows it can't use", () => {
    expect(parseCurated([rec("no", "a"), { urn: "a", label: null }])).toEqual([]);
    expect(parseCurated([{ label: "no", verdict: { dimensions: {}, aiLikelihood: 0.5 } }])).toEqual([]);
    expect(() => parseCurated([{ urn: "x", label: "definitely", verdict: { dimensions: dims(0.1), aiLikelihood: 0.5 } }])).toThrow(/needs a label/);
    expect(() => parseCurated([{ urn: "x", label: "no", verdict: { dimensions: dims(0.1) } }])).toThrow(/aiLikelihood/);
  });
  it("keeps the answers and counts and never the text", () => {
    const [l] = parseCurated([rec("no", "a")]);
    expect(JSON.stringify(l)).not.toContain("SHOULD NEVER BE STORED");
    expect(l.engagement).toEqual({ reactions: 5, comments: 1, reposts: 0 });
  });
});

describe.each(ADAPTERS)("the tuner over HTTP (%s)", (kind) => {
  const H = () => makeHarness(kind, { ADMIN_TOKEN: "s3cret" });
  const labels = (n: number) => [...Array.from({ length: n }, (_, i) => ({ urn: `p${i}`, label: "probably", verdict: { model: "j", aiLikelihood: 0.9, dimensions: dims(0.35 + (i % 5) * 0.05) } })), ...Array.from({ length: n }, (_, i) => ({ urn: `n${i}`, label: "no", verdict: { model: "j", aiLikelihood: 0.9, dimensions: dims(0.02 + (i % 5) * 0.01) } }))];

  it("is admin only", async () => {
    const h = await H();
    expect((await h.call("tuner")).status).toBe(401);
    expect((await h.call("tuner", { clear: true }, { method: "POST" })).status).toBe(401);
  });

  it("imports the admin's labels, analyses them, and clears them", async () => {
    const h = await H();
    const empty = await h.call("tuner", undefined, admin);
    expect(empty.body.analysis.counts).toEqual({ probably: 0, no: 0, maybe: 0 });
    const imported = await h.call("tuner", { import: labels(16) }, { method: "POST", ...admin });
    expect(imported.body.curatedCount).toBe(32);
    expect(imported.body.analysis.suggestion).toHaveLength(3);
    expect(imported.body.analysis.warnings.join(" ")).not.toMatch(/Aim for at least/);
    await h.call("tuner", { import: labels(16) }, { method: "POST", ...admin }); // again: same posts, not doubled
    expect((await h.call("tuner", undefined, admin)).body.curatedCount).toBe(32);
    expect((await h.call("tuner", { clear: true }, { method: "POST", ...admin })).body.curatedCount).toBe(0);
    expect((await h.call("tuner", { nonsense: 1 }, { method: "POST", ...admin })).status).toBe(422);
  });

  it("applies nothing: thresholds, weights and the manifest are untouched by any tuner call", async () => {
    const h = await H();
    const before = [(await h.call("manifest")).body.version, JSON.stringify((await h.call("weights", undefined, admin)).body.effective), JSON.stringify((await h.call("scoring", undefined, admin)).body.effective)];
    await h.call("tuner", { import: labels(16) }, { method: "POST", ...admin });
    await h.call("tuner", undefined, admin);
    await h.call("tuner", undefined, { ...admin, query: "?set=community" });
    const after = [(await h.call("manifest")).body.version, JSON.stringify((await h.call("weights", undefined, admin)).body.effective), JSON.stringify((await h.call("scoring", undefined, admin)).body.effective)];
    expect(after).toEqual(before);
  });

  it("uses community votes only for the comparison set, and only where enough people agree", async () => {
    const h = await H();
    h.ctx.jev!.score = async (input) => ({ ...verdictOf(0), dimensions: { ...verdictOf(0).dimensions, ...dims(input.postText.includes("slop") ? 0.5 : 0.05) } });
    const post = async (text: string, votes: string[]) => {
      const r = await h.call("judge", judgeBody({ postText: `${text} `.repeat(30) }), { install: "install-judge0000" });
      for (const [i, v] of votes.entries()) await h.call("vote", { network: "linkedin", contentId: r.body.contentId, vote: v }, { install: `install-voter${i}xxxx` });
    };
    await post("clear slop slop slop", ["probably", "probably", "probably"]); // agreed
    await post("a plain honest note", ["no", "no", "no"]); // agreed
    await post("contested one", ["probably", "no", "maybe"]); // no agreement
    await post("a single vote only", ["probably"]); // too few votes
    const c = (await h.call("tuner", undefined, { ...admin, query: "?set=community" })).body;
    expect(c.dataset).toMatchObject({ set: "community", posts: 2, voters: 3 });
    expect(c.analysis.counts).toEqual({ probably: 1, no: 1, maybe: 0 });
  });

  it("warns when one install cast most of the votes", async () => {
    const h = await H();
    for (let i = 0; i < 6; i++) {
      const r = await h.call("judge", judgeBody({ postText: `Post number ${i} ${"words ".repeat(40)}` }), { install: "install-judge0000" });
      await h.call("vote", { network: "linkedin", contentId: r.body.contentId, vote: "no" }, { install: "install-heavyvoter" });
      if (i === 0) await h.call("vote", { network: "linkedin", contentId: r.body.contentId, vote: "no" }, { install: "install-otheraaaaa" });
    }
    const c = (await h.call("tuner", undefined, { ...admin, query: "?set=community&minVotes=1" })).body;
    expect(c.dataset.topVoterShare).toBeGreaterThan(0.5);
    expect(c.dataset.warnings.join(" ")).toMatch(/single person can steer/);
  });
});

describe.each(ADAPTERS)("votes never move a score, a weight or a threshold (%s)", (kind) => {
  it("leaves every setting and every verdict unchanged, however many people vote", async () => {
    const h = await makeHarness(kind, { ADMIN_TOKEN: "s3cret" });
    h.ctx.jev!.score = async () => ({ ...verdictOf(0), dimensions: { ...verdictOf(0).dimensions, ...dims(0.4) } });
    const engagement = { reactions: 50, comments: 5, reposts: 1 };
    const first = (await h.call("judge", judgeBody({ engagement }))).body;
    const snapshot = async () => [(await h.call("manifest")).body.version, JSON.stringify((await h.call("weights", undefined, admin)).body.effective), JSON.stringify((await h.call("scoring", undefined, admin)).body.effective)];
    const before = await snapshot();
    for (let i = 0; i < 25; i++) await h.call("vote", { network: "linkedin", contentId: first.contentId, vote: i % 2 ? "no" : "probably" }, { install: `install-voter${i}xxxxx` });
    expect(await snapshot()).toEqual(before);
    const again = (await h.call("judge", judgeBody({ engagement }), { install: "install-otheraaaaa" })).body;
    expect([again.slop, again.shield, again.tellMean, again.weightsVersion, again.manifestVersion]).toEqual([first.slop, first.shield, first.tellMean, first.weightsVersion, first.manifestVersion]);
    expect(again.community.total).toBe(25); // votes change only the community line other people see
  });
});
