import { AuthenticationError } from "@typesafe-ai/sdk";
import { describe, expect, it } from "vitest";
import { ADAPTERS, judgeBody, makeHarness, POST, verdictOf } from "./helpers.js";

const admin = { headers: { authorization: "Bearer s3cret" } };
const OTHER = "A completely different post about hiring: we opened three roles this quarter and I would love referrals from people I know.";

describe.each(ADAPTERS)("GET /api/v1/admin/stats (%s)", (kind) => {
  it("is hidden without an admin token configured, and rejects a wrong or missing one", async () => {
    expect((await (await makeHarness(kind)).call("stats", undefined, admin)).status).toBe(404);
    const h = await makeHarness(kind, { ADMIN_TOKEN: "s3cret" });
    expect((await h.call("stats")).status).toBe(401);
    expect((await h.call("stats", undefined, { headers: { authorization: "Bearer nope" } })).status).toBe(401);
    expect((await h.call("stats", undefined, { headers: { authorization: "s3cret" } })).status).toBe(401);
    expect((await h.call("stats", undefined, admin)).status).toBe(200);
  });

  it("validates the range and network", async () => {
    const h = await makeHarness(kind, { ADMIN_TOKEN: "s3cret" });
    expect((await h.call("stats", undefined, { ...admin, query: "?range=1y" })).status).toBe(400);
    expect((await h.call("stats", undefined, { ...admin, query: "?network=myspace" })).status).toBe(400);
  });

  it("is empty but well formed on a fresh database", async () => {
    const h = await makeHarness(kind, { ADMIN_TOKEN: "s3cret" });
    const { body } = await h.call("stats", undefined, admin);
    expect(body.summary).toMatchObject({ checks: 0, jevCalls: 0, cacheHitPct: null, costUsd: 0 });
    expect(body.installs.total).toBe(0);
    expect(body.series.length).toBeGreaterThan(24);
    expect(body.hourOfDay).toHaveLength(24);
    expect(body.aiHistogram).toHaveLength(10);
    expect(body.devices).toEqual([]);
  });

  it("counts checks, cache hits, tokens, cost, installs, votes and errors", async () => {
    const h = await makeHarness(kind, { ADMIN_TOKEN: "s3cret" });
    const a = await h.call("judge", judgeBody(), { install: "install-aaaaaaaa" });
    await h.call("judge", judgeBody(), { install: "install-bbbbbbbb" }); // cached
    await h.call("judge", judgeBody({ postText: OTHER }), { install: "install-bbbbbbbb" });
    await h.call("vote", { network: "linkedin", contentId: a.body.contentId, vote: "probably" }, { install: "install-aaaaaaaa" });
    await h.call("vote", { network: "linkedin", contentId: a.body.contentId, vote: "no" }, { install: "install-bbbbbbbb" });
    h.failNext.error = new AuthenticationError(401, { message: "bad key" }, new Headers());
    await h.call("judge", judgeBody({ postText: OTHER + " (edited)" }), { install: "install-cccccccc" });

    const { body } = await h.call("stats", undefined, { ...admin, query: "?range=24h" });
    expect(body.summary).toMatchObject({ checks: 3, jevCalls: 2, errors: 1, limitHits: 0, inputTokens: 8000, outputTokens: 40 });
    expect(body.summary.cacheHitPct).toBeCloseTo(1 / 3, 3);
    expect(body.summary.costUsd).toBeCloseTo((8000 * 0.042) / 1e6, 6);
    expect(body.summary.latencyMs.p50).not.toBeNull();
    expect(body.installs).toMatchObject({ total: 3, active24h: 3, newInRange: 3 });
    expect(body.community).toMatchObject({ votesTotal: 2, voters: 2, probably: 1, no: 1 });
    expect(body.networks[0]).toMatchObject({ network: "linkedin", postsTotal: 2, postsSeen: 2, checks: 3, jevCalls: 2, aiLikelyPct: 1 });
    expect(body.series.reduce((n: number, b: any) => n + b.scored + b.cached, 0)).toBe(3);
    expect(body.series.reduce((n: number, b: any) => n + b.votes.probably, 0)).toBe(1);
    expect(body.tells.find((t: any) => t.id === "contrastFraming").avg).toBeCloseTo(0.5, 3);
    expect(body.aiHistogram[9].posts).toBe(2); // ai 0.9 -> top bucket
    expect(body.hourOfDay[15].checks).toBe(3); // the test clock is 15:00 UTC
    expect(body.problems).toEqual([expect.objectContaining({ kind: "error", detail: "AuthenticationError" })]);
    const b = body.devices.find((d: any) => d.checks === 2);
    expect(b).toMatchObject({ scored: 1, votes: 1 });
    expect(body.posts.mostFlagged[0]).toMatchObject({ contentId: a.body.contentId, votes: { probably: 1, no: 1 } });
  });

  it("records daily-limit hits, and surfaces devices at the cap", async () => {
    const h = await makeHarness(kind, { ADMIN_TOKEN: "s3cret", DAILY_CHECK_LIMIT: "2" });
    for (let i = 0; i < 3; i++) await h.call("judge", judgeBody());
    const { body } = await h.call("stats", undefined, admin);
    expect(body.summary).toMatchObject({ checks: 2, limitHits: 1 });
    expect(body.installs).toMatchObject({ todayAtCap: 1, todayActive: 1 });
    expect(body.devices[0]).toMatchObject({ checks: 2, limitHits: 1 });
  });

  it("shows where Jev and voters disagree, and filters by network and range", async () => {
    const h = await makeHarness(kind, { ADMIN_TOKEN: "s3cret" });
    const a = await h.call("judge", judgeBody()); // ai 0.9
    await h.call("vote", { network: "linkedin", contentId: a.body.contentId, vote: "no" });
    const { body } = await h.call("stats", undefined, { ...admin, query: "?range=30d&network=linkedin" });
    expect(body.bucketMs).toBe(86400_000);
    expect(body.posts.jevOverreached).toHaveLength(1);
    expect(body.community.calibration).toEqual([expect.objectContaining({ vote: "no", jevAgreesPct: 0 })]);
    h.clock.t += 40 * 86400_000; // everything is now outside a 24h window
    const later = await h.call("stats", undefined, { ...admin, query: "?range=24h" });
    expect(later.body.summary.checks).toBe(0);
    expect(later.body.networks[0].postsSeen).toBe(0);
  });

  it("never exposes raw install ids or post text", async () => {
    const h = await makeHarness(kind, { ADMIN_TOKEN: "s3cret", STORE_CONTENT_TEXT: "true" });
    await h.call("judge", judgeBody(), { install: "install-secret-id-1234" });
    const text = JSON.stringify((await h.call("stats", undefined, admin)).body);
    expect(text).not.toContain("install-secret-id-1234");
    expect(text).not.toContain(POST.slice(0, 30));
  });

  it("reports where the time went, and counts calls that needed a second Jev request", async () => {
    const h = await makeHarness(kind, { ADMIN_TOKEN: "s3cret" });
    const r = await h.call("judge", judgeBody());
    for (const phase of ["cap", "lookup", "jev", "write", "total"]) expect(r.res.headers.get("server-timing")).toMatch(new RegExp(`${phase};dur=\\d+`));
    const cached = await h.call("judge", judgeBody(), { install: "install-bbbbbbbb" });
    expect(cached.res.headers.get("server-timing")).not.toMatch(/jev;/); // nothing to wait for on a cache hit
    h.ctx.jev!.score = async () => ({ ...verdictOf(), attempts: 2 });
    await h.call("judge", judgeBody({ postText: OTHER }));
    const { body } = await h.call("stats", undefined, admin);
    expect(body.summary.hedged).toBe(1);
  });
});
