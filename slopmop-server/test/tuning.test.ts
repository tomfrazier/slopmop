import { describe, expect, it } from "vitest";
import { auc, MIN_PER_CLASS, suggestWeights, type Example } from "../src/tuning.js";
import { ADAPTERS, judgeBody, makeHarness, verdictOf } from "./helpers.js";
import { DEFAULT_WEIGHTS, TELL_IDS } from "../src/weights.js";

/** Deterministic pseudo-random numbers, so the suite never flakes. */
const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);

/** Slop posts have a high `formulaicHook`; every other tell is noise unrelated to the label. */
function examples(n: number, seed = 1): Example[] {
  const r = rng(seed);
  const out: Example[] = [];
  for (let i = 0; i < n; i++) {
    const slop = i % 2 === 0;
    const dimensions = Object.fromEntries(Object.keys(DEFAULT_WEIGHTS).map((id) => [id, { value: id === "formulaicHook" ? (slop ? 0.6 + r() * 0.4 : r() * 0.4) : r(), confidence: 0.9 }]));
    out.push({ dimensions, slop });
  }
  return out;
}

describe("auc", () => {
  it("is 1 when the groups are perfectly separated, 0.5 for chance and ties, 0 when reversed", () => {
    expect(auc([0.9, 0.8], [0.1, 0.2])).toBe(1);
    expect(auc([0.5], [0.5])).toBe(0.5);
    expect(auc([0.1], [0.9])).toBe(0);
    expect(auc([], [1])).toBeNull();
  });
});

describe("suggestWeights", () => {
  it("won't suggest anything from too few votes, and says how many it needs", () => {
    const s = suggestWeights(examples(2 * MIN_PER_CLASS - 2), DEFAULT_WEIGHTS);
    expect(s.ready).toBe(false);
    expect(s.reason).toMatch(/at least 15/);
    expect(s.suggested).toBeUndefined();
  });

  it("gives more weight to the tell that actually separates flagged from cleared posts", () => {
    const s = suggestWeights(examples(400), DEFAULT_WEIGHTS);
    expect(s.ready).toBe(true);
    const by = Object.fromEntries(s.perTell!.map((t) => [t.id, t]));
    expect(by.formulaicHook.suggested).toBeGreaterThan(1);
    expect(by.formulaicHook.power).toBeGreaterThan(by.contrastFraming.power);
    for (const id of TELL_IDS.filter((i) => i !== "formulaicHook")) expect(by[id].suggested).toBeLessThan(by.formulaicHook.suggested);
    expect(s.auc!.suggested).toBeGreaterThan(s.auc!.current);
    expect(s.cv!.suggested).toBeGreaterThanOrEqual(s.cv!.current); // and it holds on votes it wasn't fitted to
  });

  it("moves only part of the way toward the data, and less the fewer votes there are", () => {
    const few = suggestWeights(examples(2 * MIN_PER_CLASS), DEFAULT_WEIGHTS).suggested!.formulaicHook;
    const many = suggestWeights(examples(2000), DEFAULT_WEIGHTS).suggested!.formulaicHook;
    expect(few).toBeGreaterThan(1);
    expect(many).toBeGreaterThan(few);
    expect(few).toBeLessThan(1.5);
  });

  it("starts from the current weights, not from scratch", () => {
    const current = { ...DEFAULT_WEIGHTS, engagementBait: 0.5 };
    const s = suggestWeights(examples(2 * MIN_PER_CLASS), current);
    expect(s.perTell!.find((t) => t.id === "engagementBait")!.current).toBe(0.5);
    expect(s.suggested!.engagementBait).toBeLessThan(1); // pulled only slightly from 0.5 with this little data
  });

  it("is deterministic and leaves the current weights alone", () => {
    const cur = { ...DEFAULT_WEIGHTS };
    const a = suggestWeights(examples(200), cur);
    const b = suggestWeights(examples(200), cur);
    expect(a).toEqual(b);
    expect(cur).toEqual(DEFAULT_WEIGHTS);
  });

  it("suggests no change when no tell tells the groups apart", () => {
    const r = rng(9);
    const flat = Array.from({ length: 80 }, (_, i): Example => ({ slop: i % 2 === 0, dimensions: Object.fromEntries(Object.keys(DEFAULT_WEIGHTS).map((id) => [id, { value: 0.5, confidence: 0.9 }])) }));
    void r;
    expect(suggestWeights(flat, DEFAULT_WEIGHTS).suggested).toEqual(DEFAULT_WEIGHTS);
  });
});

describe.each(ADAPTERS)("GET /admin/weights?suggest=1 (%s)", (kind) => {
  const admin = { headers: { authorization: "Bearer s3cret" } };
  async function seed(h: Awaited<ReturnType<typeof makeHarness>>, n: number) {
    const ex = examples(n);
    for (let i = 0; i < n; i++) {
      h.ctx.jev!.score = async () => ({ ...verdictOf(0), dimensions: { ...verdictOf(0).dimensions, ...ex[i].dimensions } });
      const j = await h.call("judge", judgeBody({ postText: `Seeded post number ${i}: the quick brown fox jumps over the lazy dog again and again.` }), { install: `install-seed-${i}` });
      await h.call("vote", { network: "linkedin", contentId: j.body.contentId, vote: ex[i].slop ? "probably" : "no" }, { install: `install-seed-${i}` });
    }
  }

  it("says it isn't ready with few votes", async () => {
    const h = await makeHarness(kind, { ADMIN_TOKEN: "s3cret", DAILY_CHECK_LIMIT: "1000" });
    await seed(h, 6);
    const { body } = await h.call("weights", undefined, { ...admin, query: "?suggest=1&minVotes=1" });
    expect(body.suggestion).toMatchObject({ ready: false, minPerClass: MIN_PER_CLASS });
  });

  it("suggests from what the community voted, without changing the live weights", async () => {
    const h = await makeHarness(kind, { ADMIN_TOKEN: "s3cret", DAILY_CHECK_LIMIT: "1000" });
    await seed(h, 60);
    const { body } = await h.call("weights", undefined, { ...admin, query: "?suggest=1&minVotes=1" });
    expect(body.suggestion.ready).toBe(true);
    expect(body.suggestion.counts).toEqual({ probably: 30, no: 30 });
    expect(body.suggestion.suggested.formulaicHook).toBeGreaterThan(body.suggestion.suggested.contrastFraming);
    expect(body.effective.source).toBe("default"); // a suggestion is not applied
    expect((await h.call("weights", undefined, admin)).body.suggestion).toBeUndefined(); // and it is only computed when asked for
  });
});
