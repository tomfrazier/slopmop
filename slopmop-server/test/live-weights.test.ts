import { describe, expect, it, vi } from "vitest";
import { ADAPTERS, judgeBody, makeHarness, verdictOf } from "./helpers.js";
import { TELLS } from "../src/traits.js";
import { WeightStore } from "../src/weightStore.js";

const admin = { headers: { authorization: "Bearer s3cret" } };
const H = async (kind: (typeof ADAPTERS)[number], env: Record<string, string> = {}) => makeHarness(kind, { ADMIN_TOKEN: "s3cret", ...env });
const dims = (values: Record<string, number>) => Object.fromEntries(Object.entries(values).map(([id, value]) => [id, { value, confidence: 0.9 }]));
const withDims = (h: Awaited<ReturnType<typeof makeHarness>>, values: Record<string, number>) => {
  h.ctx.jev!.score = async () => ({ ...verdictOf(0), dimensions: { ...verdictOf(0).dimensions, ...dims(values) } });
};
const save = (h: Awaited<ReturnType<typeof makeHarness>>, body: unknown) => h.call("weights", body, { method: "POST", ...admin });

describe.each(ADAPTERS)("live-edited weights (%s)", (kind) => {
  it("is admin only", async () => {
    const h = await H(kind);
    expect((await h.call("weights")).status).toBe(401);
    expect((await h.call("weights", { reset: true }, { method: "POST" })).status).toBe(401);
    expect((await (await makeHarness(kind)).call("weights", undefined, admin)).status).toBe(404);
  });

  it("starts from the environment (or all 1) and reports where the weights come from", async () => {
    const h = await H(kind, { TELL_WEIGHTS: '{"formulaicHook":0.731}' });
    const { body } = await h.call("weights", undefined, admin);
    expect(body.effective).toMatchObject({ source: "env", weights: { formulaicHook: 0.731, contrastFraming: 1 } });
    expect(body.baseline.source).toBe("env");
    expect(body.history).toEqual([]);
    expect((await (await H(kind)).call("weights", undefined, admin)).body.effective.source).toBe("default");
  });

  it("applies an edit to the very next check, with a new version, and logs it", async () => {
    const h = await H(kind);
    withDims(h, { formulaicHook: 1 });
    const before = await h.call("judge", judgeBody());
    expect(before.body.tellMean).toBeCloseTo(1 / 9, 6);

    const saved = await save(h, { weights: { formulaicHook: 3 }, note: "trying a heavier hook" });
    expect(saved.status).toBe(200);
    expect(saved.body.effective).toMatchObject({ source: "live", weights: { formulaicHook: 3, contrastFraming: 1 } });
    expect(saved.body.history[0]).toMatchObject({ note: "trying a heavier hook", source: "admin" });

    const after = await h.call("judge", judgeBody(), { install: "install-bbbbbbbb" }); // answered from the registry, re-weighted
    expect(after.body.cached).toBe(true);
    expect(after.body.tellMean).toBeCloseTo(3 / 11, 6);
    expect(after.body.weightsVersion).toMatch(/^[0-9a-f]{12}$/);
    expect(after.body.weightsVersion).not.toBe(before.body.weightsVersion);
    expect((await h.call("health")).body.weights).toBe("live");
  });

  it("applies the counter-tells on the server: they move slop and shield, never the tell mean, and are never sent", async () => {
    const h = await H(kind);
    withDims(h, { formulaicHook: 1, humanVoice: 1, usefulness: 1 });
    const before = await h.call("judge", judgeBody());
    expect(before.body.counters).toBeUndefined();
    await save(h, { weights: { humanVoice: 2, usefulness: 0 } });
    const after = await h.call("judge", judgeBody(), { install: "install-bbbbbbbb" });
    expect(after.body.counters).toBeUndefined();
    expect(after.body.tellMean).toBeCloseTo(before.body.tellMean, 9);
    expect(after.body.slop).toBeLessThan(before.body.slop); // a stronger human-voice counter
    expect(after.body.shield).toBeLessThan(before.body.shield); // usefulness no longer counts, and there is no engagement
    expect(after.body.weightsVersion).not.toBe(before.body.weightsVersion);
  });

  it("needs at least one tell above 0, whatever the counter-tells are", async () => {
    const h = await H(kind);
    const zeroTells = Object.fromEntries(TELLS.map((t) => [t.id, 0]));
    expect((await save(h, { weights: { ...zeroTells, humanVoice: 1, usefulness: 1 } })).status).toBe(422);
  });

  it("gives the same version for the same weights, however they were set", async () => {
    const a = await H(kind, { TELL_WEIGHTS: '{"formulaicHook":2}' });
    const b = await H(kind);
    await save(b, { weights: { formulaicHook: 2 } });
    const va = (await a.call("judge", judgeBody())).body.weightsVersion;
    const vb = (await b.call("judge", judgeBody())).body.weightsVersion;
    expect(va).toBe(vb);
  });

  it("validates what it is given and changes nothing when it is bad", async () => {
    const h = await H(kind);
    for (const weights of [{ nonsense: 1 }, { formulaicHook: -1 }, { formulaicHook: 101 }, { formulaicHook: "2" }, [1, 2], null, { contrastFraming: 0, emptyEvaluation: 0, tradeoffFreePromises: 0, formalHedging: 0, hypeMarketing: 0, manneredProse: 0, formulaicHook: 0, manufacturedNarrative: 0, engagementBait: 0 }]) {
      expect((await save(h, { weights })).status).toBe(422);
    }
    expect((await h.call("weights", undefined, admin)).body.history).toEqual([]);
    expect((await h.call("health")).body.weights).toBe("default");
  });

  it("resets to the environment's weights, and keeps the history so an edit can be restored", async () => {
    const h = await H(kind, { TELL_WEIGHTS: '{"formulaicHook":0.731}' });
    await save(h, { weights: { formulaicHook: 5 }, note: "experiment" });
    const reset = await save(h, { reset: true, note: "back to baseline" });
    expect(reset.body.effective).toMatchObject({ source: "env", weights: { formulaicHook: 0.731 } });
    expect(reset.body.history.map((c: any) => [c.source, c.note])).toEqual([["reset", "back to baseline"], ["admin", "experiment"]]);
    expect(reset.body.history[1].weights.formulaicHook).toBe(5); // the earlier edit is still there to restore
  });

  it("is shared by every server instance, picked up within the cache window", async () => {
    const h = await H(kind);
    const other = new WeightStore(h.db, h.ctx.weights.baseline() ? { weights: h.ctx.weights.baseline().weights, custom: false } : { weights: {}, custom: false }, () => h.clock.t);
    expect((await other.current()).source).toBe("default"); // now cached in the other instance
    await save(h, { weights: { formulaicHook: 4 } }); // this instance saves
    expect((await other.current()).source).toBe("default"); // still inside its cache window
    h.clock.t += 11_000;
    expect(await other.current()).toMatchObject({ source: "live", weights: { formulaicHook: 4 } });
  });

  it("never fails scoring because the weights can't be read: it uses the last known ones", async () => {
    const h = await H(kind);
    await save(h, { weights: { formulaicHook: 4 } });
    await h.ctx.weights.current(); // cached
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const real = h.db.execute.bind(h.db);
    h.db.execute = (async (sql: string, args?: any) => {
      if (/FROM settings/.test(sql)) throw new Error("database is down");
      return real(sql, args);
    }) as typeof h.db.execute;
    h.clock.t += 60_000; // cache expired, read fails
    expect(await h.ctx.weights.current()).toMatchObject({ source: "live", weights: { formulaicHook: 4 } });
    expect((await h.call("judge", judgeBody())).status).toBe(200);
    log.mockRestore();
  });

  it("falls back to the environment if the stored weights are corrupt", async () => {
    const h = await H(kind);
    await h.db.execute(`INSERT INTO settings (key, value, updated_at) VALUES ('tell_weights', '{"formulaicHook":"oops"}', 1)`);
    expect((await h.ctx.weights.current()).source).toBe("default");
  });
});
