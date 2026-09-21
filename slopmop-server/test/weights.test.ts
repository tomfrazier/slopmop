import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { applyWeights, DEFAULT_WEIGHTS, parseWeights } from "../src/weights.js";
import { TELLS } from "../src/traits.js";
import { ADAPTERS, judgeBody, makeHarness, verdictOf } from "./helpers.js";

const dims = (values: Record<string, number>) => Object.fromEntries(Object.entries(values).map(([id, value]) => [id, { value, confidence: 0.9 }]));

describe("parseWeights", () => {
  it("defaults to every tell counting 1, which is what the public repo ships", () => {
    const { weights, custom } = parseWeights(undefined);
    expect(custom).toBe(false);
    expect(Object.keys(weights).sort()).toEqual([...TELLS.map((t) => t.id), "humanVoice", "usefulness"].sort()); // nine tells and two counter-tells
    expect(Object.values(weights).every((w) => w === 1)).toBe(true);
    expect(parseWeights("").custom).toBe(false);
  });

  it("overrides only the tells listed; the rest stay 1", () => {
    const { weights, custom } = parseWeights('{"formulaicHook":0.731,"emptyEvaluation":1.317}');
    expect(custom).toBe(true);
    expect(weights.formulaicHook).toBe(0.731);
    expect(weights.emptyEvaluation).toBe(1.317);
    expect(weights.contrastFraming).toBe(1);
  });

  it("ignores bad input without ever logging a value", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(parseWeights("not json").custom).toBe(false);
    expect(parseWeights("[1,2]").custom).toBe(false);
    const r = parseWeights('{"formulaicHook":"secret-9.9","nonsense":2,"hypeMarketing":-1,"manneredProse":1000}');
    expect(r.custom).toBe(false);
    expect(r.weights).toEqual(DEFAULT_WEIGHTS);
    const logged = log.mock.calls.flat().join(" ");
    expect(logged).not.toContain("secret-9.9");
    expect(logged).toMatch(/unknown tell "nonsense"/i);
    log.mockRestore();
  });
});

describe("applyWeights", () => {
  const d = dims({ contrastFraming: 0.2, emptyEvaluation: 0.8, formulaicHook: 0.5 });
  it("is the plain mean when every weight is 1, over the tells present", () => {
    expect(applyWeights(d, DEFAULT_WEIGHTS).tellMean).toBeCloseTo(0.5, 6);
  });
  it("shifts the mean toward heavier tells, and ranks by weighted contribution", () => {
    const w = { ...DEFAULT_WEIGHTS, emptyEvaluation: 2, formulaicHook: 0.5 };
    const r = applyWeights(d, w);
    expect(r.tellMean).toBeCloseTo((0.2 + 1.6 + 0.25) / 3.5, 6);
    expect(r.tellRank).toEqual(["emptyEvaluation", "formulaicHook", "contrastFraming"]);
  });
  it("copes with an empty or zero-weight verdict", () => {
    expect(applyWeights({}, DEFAULT_WEIGHTS)).toEqual({ tellMean: 0, tellRank: [] });
    expect(applyWeights(d, { contrastFraming: 0, emptyEvaluation: 0, formulaicHook: 0 }).tellMean).toBe(0);
  });
});

const SECRET = '{"formulaicHook":0.731,"emptyEvaluation":1.317,"contrastFraming":1.234}';
const withDims = (h: Awaited<ReturnType<typeof makeHarness>>, values: Record<string, number>) => {
  h.ctx.jev!.score = async () => ({ ...verdictOf(0), dimensions: { ...verdictOf(0).dimensions, ...dims(values) } });
};

describe.each(ADAPTERS)("weights over the API (%s)", (kind) => {
  it("returns the weighted composite and rank, using the private weights", async () => {
    const h = await makeHarness(kind, { TELL_WEIGHTS: SECRET });
    withDims(h, { formulaicHook: 1, emptyEvaluation: 1 });
    const { body } = await h.call("judge", judgeBody());
    // Two tells at 1.0, the rest 0. Total weight: contrastFraming 1.234, emptyEvaluation 1.317, formulaicHook 0.731, six tells at 1.
    const total = 1.234 + 1.317 + 6 + 0.731;
    expect(body.tellMean).toBeCloseTo((0.731 + 1.317) / total, 6);
    expect(body.tellRank.slice(0, 2)).toEqual(["emptyEvaluation", "formulaicHook"]);
    expect(body.dimensions.formulaicHook.value).toBe(1); // raw values are untouched
  });

  it("uses equal weights when none are configured", async () => {
    const h = await makeHarness(kind);
    withDims(h, { formulaicHook: 0.9 });
    const { body } = await h.call("judge", judgeBody());
    expect(body.tellMean).toBeCloseTo(0.9 / 9, 6);
  });

  it("re-weights a stored verdict on the next request, so changing the weights needs no re-scoring", async () => {
    const h = await makeHarness(kind);
    withDims(h, { formulaicHook: 1 });
    const first = await h.call("judge", judgeBody());
    await h.ctx.weights.save({ ...h.ctx.weights.baseline().weights, formulaicHook: 3 }, null);
    const second = await h.call("judge", judgeBody(), { install: "install-bbbbbbbb" });
    expect(second.body.cached).toBe(true);
    expect(second.body.tellMean).toBeGreaterThan(first.body.tellMean);
  });

  it("never reveals the weights: not in judge, health, stats or export output", async () => {
    const h = await makeHarness(kind, { TELL_WEIGHTS: SECRET, ADMIN_TOKEN: "s3cret" });
    const admin = { headers: { authorization: "Bearer s3cret" } };
    const all = [
      (await h.call("judge", judgeBody())).res,
      (await h.call("health")).res,
      (await h.call("stats", undefined, admin)).res,
      (await h.call("export", undefined, { ...admin, query: "?minVotes=1" })).res,
    ];
    for (const res of all) {
      const text = await res.clone().text();
      for (const secret of ["0.731", "1.234", "1.317"]) expect(text).not.toContain(`:${secret}`);
      expect(text).not.toMatch(/tellWeights|TELL_WEIGHTS/);
    }
    const health = await (await h.call("health")).body;
    expect(health.weights).toBe("env"); // says where the weights come from, never what they are
    expect((await (await makeHarness(kind)).call("health")).body.weights).toBe("default");
  });

  it("adds the weighted composite to the admin export, so tuning needs no weights in the client", async () => {
    const h = await makeHarness(kind, { TELL_WEIGHTS: SECRET, ADMIN_TOKEN: "s3cret" });
    withDims(h, { formulaicHook: 1 });
    await h.call("judge", judgeBody());
    const res = await h.call("export", undefined, { headers: { authorization: "Bearer s3cret" }, query: "?minVotes=1" });
    const row = JSON.parse((await res.res.text()).trim().split("\n")[0]);
    expect(row.tellMean).toBeCloseTo(0.731 / (1.234 + 1.317 + 6 + 0.731), 6);
    expect(row.tellRank[0]).toBe("formulaicHook");
  });
});

describe("config", () => {
  it("loads weights from the environment and flags that they are custom", () => {
    expect(loadConfig({ TELL_WEIGHTS: '{"formulaicHook":0.731}' }).customWeights).toBe(true);
    expect(loadConfig({}).customWeights).toBe(false);
  });
});
