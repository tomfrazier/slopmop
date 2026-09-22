import { describe, expect, it } from "vitest";
import { ADAPTERS, makeHarness } from "./helpers.js";

describe.each(ADAPTERS)("per-IP hourly cap (%s)", (kind) => {
  it("allows exactly the limit per hour, then refuses, independent of any install id", async () => {
    const h = await makeHarness(kind);
    const { ipCaps } = h.ctx.store;
    const seen = [];
    for (let i = 0; i < 4; i++) seen.push(await ipCaps.consume("ip-aaaa", 3));
    expect(seen.map((s) => s.ok)).toEqual([true, true, true, false]);
    expect(seen[2].count).toBe(3);
  });
  it("is per IP hash", async () => {
    const h = await makeHarness(kind);
    expect((await h.ctx.store.ipCaps.consume("ip-aaaa", 1)).ok).toBe(true);
    expect((await h.ctx.store.ipCaps.consume("ip-aaaa", 1)).ok).toBe(false);
    expect((await h.ctx.store.ipCaps.consume("ip-bbbb", 1)).ok).toBe(true);
  });
  it("resets at the next UTC hour, not the next day", async () => {
    const h = await makeHarness(kind);
    const { ipCaps } = h.ctx.store;
    await ipCaps.consume("ip-aaaa", 1);
    expect((await ipCaps.consume("ip-aaaa", 1)).ok).toBe(false);
    h.clock.t += 59 * 60_000; // 59 minutes later, same UTC hour
    expect((await ipCaps.consume("ip-aaaa", 1)).ok).toBe(false);
    h.clock.t += 2 * 60_000; // now the next UTC hour
    expect((await ipCaps.consume("ip-aaaa", 1)).ok).toBe(true);
  });
  it("gives a check back on refund, for the current hour", async () => {
    const h = await makeHarness(kind);
    const { ipCaps } = h.ctx.store;
    await ipCaps.consume("ip-aaaa", 1);
    expect((await ipCaps.consume("ip-aaaa", 1)).ok).toBe(false);
    await ipCaps.refund("ip-aaaa");
    expect((await ipCaps.consume("ip-aaaa", 1)).ok).toBe(true);
  });
  it("never overshoots the limit under concurrent use", async () => {
    const h = await makeHarness(kind);
    const results = await Promise.all(Array.from({ length: 10 }, () => h.ctx.store.ipCaps.consume("ip-aaaa", 5)));
    expect(results.filter((r) => r.ok)).toHaveLength(5);
  });
});
