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
    expect(body.series).toHaveLength(8); // 7 days by day: a partial first day, six whole ones, and today so far
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
    expect(body.problems).toEqual([expect.objectContaining({ kind: "error", detail: "AuthenticationError 401 - 401 bad key" })]);
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
    expect(body).toMatchObject({ unit: "week", units: ["day", "week"], tz: "UTC" });
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

describe.each(ADAPTERS)("stats in the admin's timezone (%s)", (kind) => {
  const PT = "America/Los_Angeles";
  const q = (query: string) => ({ headers: { authorization: "Bearer s3cret" }, query });
  const post = (n: number) => judgeBody({ postText: `A distinct post number ${n} with enough words in it to be judged as usual, again and again.` });

  it("rejects an unknown timezone or unit", async () => {
    const h = await makeHarness(kind, { ADMIN_TOKEN: "s3cret" });
    expect((await h.call("stats", undefined, q("?tz=Mars/Base"))).status).toBe(400);
    expect((await h.call("stats", undefined, q("?unit=fortnight"))).status).toBe(400);
  });

  it("charts by the unit asked for, or the range's default, with days starting at the zone's midnight", async () => {
    const h = await makeHarness(kind, { ADMIN_TOKEN: "s3cret" }); // the clock is 2026-09-19 15:00 UTC = 08:00 PDT
    const byDefault = (await h.call("stats", undefined, q(`?range=7d&tz=${encodeURIComponent(PT)}`))).body;
    expect(byDefault.unit).toBe("day");
    expect(byDefault.series).toHaveLength(8); // a partial first day, six whole days, and today so far
    for (const b of byDefault.series.slice(1)) expect(new Date(b.t).getUTCHours()).toBe(7); // PDT midnight is 07:00 UTC
    const hourly = (await h.call("stats", undefined, q(`?range=7d&unit=hour&tz=${encodeURIComponent(PT)}`))).body;
    expect(hourly.unit).toBe("hour");
    expect(hourly.series.length).toBeGreaterThan(24 * 7 - 1);
    const unsuited = (await h.call("stats", undefined, q("?range=24h&unit=month"))).body;
    expect(unsuited.unit).toBe("hour"); // a month bucket makes no sense for a day: the range's default is used
    const monthly = (await h.call("stats", undefined, q(`?range=90d&tz=${encodeURIComponent(PT)}`))).body;
    expect(monthly.series.map((b: any) => b.t).slice(1).map((t: number) => new Date(t - 7 * 3600_000).getUTCDate())).toEqual([1, 1, 1]); // Jul, Aug, Sep 1 (all PDT)
  });

  it("counts DAU by the zone's day, and puts hour of day in the zone", async () => {
    const h = await makeHarness(kind, { ADMIN_TOKEN: "s3cret" });
    h.clock.t = Date.UTC(2026, 8, 19, 3, 0); // 20:00 PDT on the 18th
    await h.call("judge", post(1), { install: "install-early-xxxxxxx" });
    h.clock.t = Date.UTC(2026, 8, 19, 15, 0); // 08:00 PDT on the 19th
    await h.call("judge", post(2), { install: "install-later-xxxxxxx" });
    const utc = (await h.call("stats", undefined, q("?range=7d"))).body;
    expect(utc.installs).toMatchObject({ dau: 2, dauYesterday: 0 }); // both on the 19th in UTC
    const pt = (await h.call("stats", undefined, q(`?range=7d&tz=${encodeURIComponent(PT)}`))).body;
    expect(pt.installs).toMatchObject({ dau: 1, dauYesterday: 1 });
    expect(pt.installs.dayStart).toBe(Date.UTC(2026, 8, 19, 7, 0));
    expect(pt.installs.limitResetsAt).toBe(Date.UTC(2026, 8, 20)); // the daily limit still resets at UTC midnight
    expect(pt.hourOfDay[20].checks).toBe(1);
    expect(pt.hourOfDay[8].checks).toBe(1);
    expect(pt.series.reduce((n: number, b: any) => n + b.scored + b.cached, 0)).toBe(2);
  });
});

describe.each(ADAPTERS)("refusals in the stats (%s)", (kind) => {
  it("counts only daily-limit refusals as daily-limit hits, and the rest by kind", async () => {
    const h = await makeHarness(kind, { ADMIN_TOKEN: "s3cret", DAILY_CHECK_LIMIT: "1" });
    await h.call("judge", judgeBody());
    await h.call("judge", judgeBody()); // over the daily limit
    const events = h.ctx.store.events;
    for (const detail of ["datacenter_ip", "datacenter_ip", "ip_rate_limit", "rate_limit", "disabled"]) await events.record({ network: "linkedin", installId: "install-other-xxxxxxx", kind: "limited", detail });
    const { body } = await h.call("stats", undefined, { headers: { authorization: "Bearer s3cret" }, query: "?range=24h" });
    expect(body.summary).toMatchObject({ limitHits: 1, datacenterRefused: 2, ipLimited: 1, rateLimited: 1, blocked: 1 });
    expect(body.series.reduce((n: number, b: any) => n + b.limited, 0)).toBe(1);
  });
});
