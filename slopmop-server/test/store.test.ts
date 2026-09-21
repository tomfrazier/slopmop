import { describe, expect, it } from "vitest";
import { consensus } from "../src/store.js";
import { ADAPTERS, makeHarness, verdictOf } from "./helpers.js";

describe.each(ADAPTERS)("daily cap (%s)", (kind) => {
  it("allows exactly the daily limit, then refuses, and reports usage", async () => {
    const h = await makeHarness(kind, { DAILY_CHECK_LIMIT: "3" });
    const { store } = h.ctx;
    const seen = [];
    for (let i = 0; i < 4; i++) seen.push(await store.caps.consume("install-aaaaaaaa"));
    expect(seen.map((s) => s.ok)).toEqual([true, true, true, false]);
    expect(seen[2].usage).toMatchObject({ used: 3, limit: 3, remaining: 0 });
    expect(seen[3].usage).toMatchObject({ used: 3, remaining: 0 });
  });
  it("is per install", async () => {
    const h = await makeHarness(kind, { DAILY_CHECK_LIMIT: "1" });
    expect((await h.ctx.store.caps.consume("install-aaaaaaaa")).ok).toBe(true);
    expect((await h.ctx.store.caps.consume("install-aaaaaaaa")).ok).toBe(false);
    expect((await h.ctx.store.caps.consume("install-bbbbbbbb")).ok).toBe(true);
  });
  it("resets at the next UTC midnight", async () => {
    const h = await makeHarness(kind, { DAILY_CHECK_LIMIT: "1" });
    await h.ctx.store.caps.consume("install-aaaaaaaa");
    expect((await h.ctx.store.caps.consume("install-aaaaaaaa")).ok).toBe(false);
    expect((await h.ctx.store.caps.usage("install-aaaaaaaa")).resetsAt).toBe("2026-09-20T00:00:00.000Z");
    h.clock.t = Date.UTC(2026, 8, 19, 23, 59, 59);
    expect((await h.ctx.store.caps.consume("install-aaaaaaaa")).ok).toBe(false);
    h.clock.t = Date.UTC(2026, 8, 20, 0, 0, 1);
    const next = await h.ctx.store.caps.consume("install-aaaaaaaa");
    expect(next.ok).toBe(true);
    expect(next.usage.used).toBe(1);
  });
  it("cannot be overshot by concurrent requests", async () => {
    const h = await makeHarness(kind, { DAILY_CHECK_LIMIT: "5" });
    const results = await Promise.all(Array.from({ length: 20 }, () => h.ctx.store.caps.consume("install-aaaaaaaa")));
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    expect((await h.ctx.store.caps.usage("install-aaaaaaaa")).used).toBe(5);
  });
  it("can give a check back, but never below zero", async () => {
    const h = await makeHarness(kind, { DAILY_CHECK_LIMIT: "2" });
    await h.ctx.store.caps.consume("install-aaaaaaaa");
    await h.ctx.store.caps.refund("install-aaaaaaaa");
    await h.ctx.store.caps.refund("install-aaaaaaaa");
    expect((await h.ctx.store.caps.usage("install-aaaaaaaa")).used).toBe(0);
  });
  it("defaults to 250 a day", async () => {
    const h = await makeHarness(kind);
    expect(h.ctx.config.dailyLimit).toBe(250);
    expect((await h.ctx.store.caps.usage("install-aaaaaaaa")).limit).toBe(250);
  });
  it("stores only a salted hash of the install id, never the id", async () => {
    const h = await makeHarness(kind);
    const id = "install-SECRETSECRET";
    await h.ctx.store.caps.consume(id);
    await h.call("judge", { network: "linkedin", postText: "x".repeat(40), surfaceStats: { wordCount: 1, sentenceCount: 1, sentenceLengthStdDev: 0, contractionsPer100Words: 0, exclamationCount: 0, emDashesPer1000Words: 0 } }, { install: id });
    const cid = (await h.db.execute("SELECT content_id FROM content")).rows[0].content_id as string;
    await h.call("vote", { network: "linkedin", contentId: cid, vote: "probably" }, { install: id });
    for (const table of ["usage", "votes", "content"]) {
      const dump = JSON.stringify((await h.db.execute(`SELECT * FROM ${table}`)).rows);
      expect(dump).not.toContain("SECRETSECRET");
    }
  });
});

describe.each(ADAPTERS)("verdict reuse (%s)", (kind) => {
  const write = (h: Awaited<ReturnType<typeof makeHarness>>, criteria = "v1") =>
    h.ctx.store.content.record({ network: "linkedin", contentId: "a".repeat(32), nativeId: null, text: null, textLen: 50, surface: {}, engagement: null, scored: { verdict: verdictOf(0.3), criteriaVersion: criteria } });
  it("reuses a verdict made with the same criteria", async () => {
    const h = await makeHarness(kind);
    await write(h);
    expect(await h.ctx.store.content.reusableVerdict("linkedin", "a".repeat(32), "v1")).toMatchObject({ aiLikelihood: 0.9, model: "test-jev" });
  });
  it("does not reuse it when the criteria changed, when it is too old, or when nothing was ever scored", async () => {
    const h = await makeHarness(kind, { VERDICT_MAX_AGE_DAYS: "30" });
    await write(h);
    expect(await h.ctx.store.content.reusableVerdict("linkedin", "a".repeat(32), "v2")).toBeNull();
    h.clock.t += 31 * 86400_000;
    expect(await h.ctx.store.content.reusableVerdict("linkedin", "a".repeat(32), "v1")).toBeNull();
    expect(await h.ctx.store.content.reusableVerdict("linkedin", "b".repeat(32), "v1")).toBeNull();
  });
  it("a check that reused a verdict counts the check but leaves the stored verdict alone", async () => {
    const h = await makeHarness(kind);
    await write(h);
    await h.ctx.store.content.record({ network: "linkedin", contentId: "a".repeat(32), nativeId: "urn:li:activity:7000000000000000000", text: null, textLen: 50, surface: {}, engagement: { reactions: 5, comments: 1, reposts: 0 }, scored: null });
    const row = (await h.db.execute("SELECT * FROM content")).rows[0];
    expect(row.checks).toBe(2);
    expect(row.native_id).toBe("urn:li:activity:7000000000000000000");
    expect(row.ai_likelihood).toBe(0.9);
    expect(JSON.parse(row.engagement as string)).toEqual({ reactions: 5, comments: 1, reposts: 0 });
  });
});

describe.each(ADAPTERS)("votes and export (%s)", (kind) => {
  const seed = async () => {
    const h = await makeHarness(kind);
    await h.ctx.store.content.record({ network: "linkedin", contentId: "a".repeat(32), nativeId: null, text: null, textLen: 50, surface: {}, engagement: null, scored: { verdict: verdictOf(), criteriaVersion: "v1" } });
    return h;
  };
  it("counts one vote per install, lets it change, and lets it be cleared", async () => {
    const h = await seed();
    const s = h.ctx.store;
    expect(await s.votes.set("linkedin", "a".repeat(32), "install-aaaaaaaa", "probably")).toEqual({ no: 0, maybe: 0, probably: 1, total: 1 });
    expect(await s.votes.set("linkedin", "a".repeat(32), "install-aaaaaaaa", "probably")).toMatchObject({ probably: 1, total: 1 }); // not counted twice
    expect(await s.votes.set("linkedin", "a".repeat(32), "install-bbbbbbbb", "no")).toEqual({ no: 1, maybe: 0, probably: 1, total: 2 });
    expect(await s.votes.set("linkedin", "a".repeat(32), "install-aaaaaaaa", "maybe")).toEqual({ no: 1, maybe: 1, probably: 0, total: 2 });
    expect(await s.votes.mine("linkedin", "a".repeat(32), "install-aaaaaaaa")).toBe("maybe");
    expect(await s.votes.set("linkedin", "a".repeat(32), "install-aaaaaaaa", null)).toEqual({ no: 1, maybe: 0, probably: 0, total: 1 });
    expect(await s.votes.mine("linkedin", "a".repeat(32), "install-aaaaaaaa")).toBeNull();
  });
  it("exports scores with vote counts and a consensus", async () => {
    const h = await seed();
    for (const [i, v] of (["probably", "probably", "no"] as const).entries()) await h.ctx.store.votes.set("linkedin", "a".repeat(32), `install-${i}${i}${i}${i}${i}${i}${i}${i}`, v);
    const [row] = await h.ctx.store.exports.rows({ network: "linkedin" });
    expect(row).toMatchObject({ contentId: "a".repeat(32), aiLikelihood: 0.9, votes: { no: 1, maybe: 0, probably: 2, total: 3 }, consensus: "probably", checks: 1, text: null });
    expect(Object.keys(row.dimensions!)).toContain("contrastFraming");
  });
  it("filters by network and time, and respects the limit", async () => {
    const h = await seed();
    expect(await h.ctx.store.exports.rows({ network: "reddit" })).toHaveLength(0);
    expect(await h.ctx.store.exports.rows({ network: "linkedin", since: h.clock.t + 1 })).toHaveLength(0);
    expect(await h.ctx.store.exports.rows({ network: "linkedin", limit: 1 })).toHaveLength(1);
  });
});

describe("consensus", () => {
  it("needs enough votes, takes the plurality, and calls a tie 'maybe'", () => {
    expect(consensus({ no: 0, maybe: 0, probably: 1, total: 1 }, 2)).toBeNull();
    expect(consensus({ no: 1, maybe: 0, probably: 2, total: 3 }, 2)).toBe("probably");
    expect(consensus({ no: 2, maybe: 0, probably: 2, total: 4 }, 2)).toBe("maybe");
  });
});
