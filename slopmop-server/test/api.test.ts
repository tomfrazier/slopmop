import { AuthenticationError, RateLimitError } from "@typesafe-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { contentIdFor } from "../src/content-id.js";
import { ADAPTERS, judgeBody, makeHarness, POST, stats } from "./helpers.js";

describe.each(ADAPTERS)("POST /api/v1/judge (%s)", (kind) => {
  it("scores a post and returns the verdict, its content id, community votes and usage", async () => {
    const h = await makeHarness(kind);
    const { status, body } = await h.call("judge", judgeBody());
    expect(status).toBe(200);
    expect(body).toMatchObject({
      model: "test-jev",
      aiLikelihood: 0.9,
      network: "linkedin",
      contentId: contentIdFor("linkedin", POST),
      cached: false,
      community: { no: 0, maybe: 0, probably: 0, total: 0 },
      usage: { used: 1, limit: 250, remaining: 249 },
    });
    expect(body.dimensions.contrastFraming).toEqual({ value: 0.5, confidence: 0.9 });
    expect(h.calls.n).toBe(1);
  });

  it("answers repeat content from the registry without calling Jev again (but still counts the check)", async () => {
    const h = await makeHarness(kind);
    await h.call("judge", judgeBody());
    const other = await h.call("judge", judgeBody({ postText: `  ${POST.toUpperCase()}  ` }), { install: "install-bbbbbbbb" });
    expect(other.body).toMatchObject({ cached: true, usage: { used: 1 } });
    expect(h.calls.n).toBe(1);
    const row = (await h.db.execute("SELECT checks FROM content")).rows[0];
    expect(row.checks).toBe(2);
  });

  it("re-scores when the criteria version changed", async () => {
    const h = await makeHarness(kind);
    await h.call("judge", judgeBody());
    h.ctx.criteriaVersion = "changed";
    const r = await h.call("judge", judgeBody());
    expect(r.body.cached).toBe(false);
    expect(h.calls.n).toBe(2);
  });

  it("shows what the community has already said about the content", async () => {
    const h = await makeHarness(kind);
    const first = await h.call("judge", judgeBody());
    const contentId = first.body.contentId;
    await h.call("vote", { network: "linkedin", contentId, vote: "probably" }, { install: "install-bbbbbbbb" });
    await h.call("vote", { network: "linkedin", contentId, vote: "probably" }, { install: "install-cccccccc" });
    await h.call("vote", { network: "linkedin", contentId, vote: "no" }, { install: "install-dddddddd" });
    const again = await h.call("judge", judgeBody());
    expect(again.body.community).toEqual({ no: 1, maybe: 0, probably: 2, total: 3 });
  });

  it("enforces the daily limit per install, with a 429, Retry-After and the reset time", async () => {
    const h = await makeHarness(kind, { DAILY_CHECK_LIMIT: "3" });
    for (let i = 0; i < 3; i++) expect((await h.call("judge", judgeBody({ postText: `${POST} ${i}` }))).status).toBe(200);
    const blocked = await h.call("judge", judgeBody({ postText: `${POST} 99` }));
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ error: "daily_limit", usage: { used: 3, limit: 3, remaining: 0, resetsAt: "2026-09-20T00:00:00.000Z" } });
    expect(Number(blocked.res.headers.get("retry-after"))).toBe(9 * 3600); // 15:00 -> midnight UTC
    expect(h.calls.n).toBe(3); // the blocked request never reached Jev
    expect((await h.call("judge", judgeBody(), { install: "install-otherxxx" })).status).toBe(200); // another install is unaffected
    h.clock.t = Date.UTC(2026, 8, 20, 0, 0, 5);
    expect((await h.call("judge", judgeBody({ postText: `${POST} next day` }))).status).toBe(200);
  });

  it("the default limit is 250", async () => {
    const h = await makeHarness(kind);
    await h.ctx.store.db.execute("INSERT INTO usage (install_hash, day, checks) VALUES (?, ?, 249)", [h.ctx.store.hashInstall("install-aaaaaaaa"), "2026-09-19"]);
    expect((await h.call("judge", judgeBody())).status).toBe(200);
    const over = await h.call("judge", judgeBody({ postText: `${POST} again` }));
    expect(over.status).toBe(429);
    expect(over.body.usage.limit).toBe(250);
  });

  it("gives the check back when Jev fails", async () => {
    const h = await makeHarness(kind, { DAILY_CHECK_LIMIT: "2" });
    h.failNext.error = new Error("boom");
    const r = await h.call("judge", judgeBody());
    expect(r.status).toBe(502);
    expect(r.body.error).toBe("upstream_error");
    expect((await h.ctx.store.caps.usage("install-aaaaaaaa")).used).toBe(0);
    expect((await h.db.execute("SELECT COUNT(*) AS n FROM content")).rows[0].n).toBe(0); // nothing recorded for a failed check
  });

  it("maps Jev rate limits and rejected credentials to distinct, useful errors", async () => {
    const h = await makeHarness(kind);
    h.failNext.error = new RateLimitError(429, { message: "slow down" }, new Headers());
    expect(await h.call("judge", judgeBody())).toMatchObject({ status: 503, body: { error: "upstream_busy" } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    h.failNext.error = new AuthenticationError(401, { message: "bad key" }, new Headers());
    expect(await h.call("judge", judgeBody())).toMatchObject({ status: 500, body: { error: "server_misconfigured" } });
    spy.mockRestore();
  });

  it("never logs post text when something fails", async () => {
    const h = await makeHarness(kind);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    h.failNext.error = new Error("upstream exploded");
    await h.call("judge", judgeBody({ postText: "TOP SECRET POST BODY that must not appear in logs " + "x".repeat(20) }));
    expect(JSON.stringify(spy.mock.calls)).not.toContain("TOP SECRET");
    spy.mockRestore();
  });

  it("keeps only a hash, scores and counts by default, and the text only when STORE_CONTENT_TEXT is on", async () => {
    const off = await makeHarness(kind);
    await off.call("judge", judgeBody());
    const rowOff = (await off.db.execute("SELECT * FROM content")).rows[0];
    expect(rowOff.text).toBeNull();
    expect(JSON.stringify(rowOff)).not.toContain("billing migration");
    expect(rowOff.text_len).toBe(POST.length);

    const on = await makeHarness(kind, { STORE_CONTENT_TEXT: "true" });
    await on.call("judge", judgeBody());
    expect((await on.db.execute("SELECT text FROM content")).rows[0].text).toBe(POST);
  });

  it("stores the network's own id only when it is a canonical one, and the engagement it was given", async () => {
    const h = await makeHarness(kind);
    await h.call("judge", judgeBody({ nativeId: "urn:li:activity:7506917720538558465", engagement: { reactions: 12, comments: 3, reposts: 1 } }));
    let row = (await h.db.execute("SELECT native_id, engagement FROM content")).rows[0];
    expect(row.native_id).toBe("urn:li:activity:7506917720538558465");
    expect(JSON.parse(row.engagement as string)).toEqual({ reactions: 12, comments: 3, reposts: 1 });

    const h2 = await makeHarness(kind);
    await h2.call("judge", judgeBody({ nativeId: "post:x9OjjcYm1BTrE2H9U6tyq_Q2F8Mz" })); // a viewer-specific card key: not kept
    row = (await h2.db.execute("SELECT native_id FROM content")).rows[0];
    expect(row.native_id).toBeNull();
  });

  describe("rejects bad requests without spending a check", () => {
    it.each([
      ["missing install id", judgeBody(), { install: null }, 400, "missing_install_id"],
      ["unsupported network", judgeBody({ network: "myspace" }), {}, 400, "unsupported_network"],
      ["no network", { postText: POST, surfaceStats: stats }, {}, 400, "unsupported_network"],
      ["text too short", judgeBody({ postText: "hi" }), {}, 422, "invalid_input"],
      ["text too long", judgeBody({ postText: "x".repeat(6001) }), {}, 422, "invalid_input"],
      ["bad stats", judgeBody({ surfaceStats: { wordCount: 1 } }), {}, 422, "invalid_input"],
      ["not json", "nope{", {}, 400, "bad_json"],
    ])("%s", async (_n, body, opts, status, code) => {
      const h = await makeHarness(kind);
      const r = await h.call("judge", body, opts as never);
      expect(r).toMatchObject({ status, body: { error: code } });
      expect((await h.ctx.store.caps.usage("install-aaaaaaaa")).used).toBe(0);
      expect(h.calls.n).toBe(0);
    });
    it("wrong method", async () => {
      const h = await makeHarness(kind);
      expect((await h.call("judge", undefined, { method: "GET" })).status).toBe(405);
    });
  });

  it("reports a clear error when no Jev key is configured", async () => {
    const h = await makeHarness(kind);
    h.ctx.jev = null;
    expect(await h.call("judge", judgeBody())).toMatchObject({ status: 503, body: { error: "server_misconfigured" } });
    expect((await h.ctx.store.caps.usage("install-aaaaaaaa")).used).toBe(0);
  });
});

describe.each(ADAPTERS)("POST /api/v1/vote (%s)", (kind) => {
  it("records, changes and clears a vote and returns the community counts", async () => {
    const h = await makeHarness(kind);
    const { contentId } = (await h.call("judge", judgeBody())).body;
    expect((await h.call("vote", { network: "linkedin", contentId, vote: "probably" })).body).toEqual({ community: { no: 0, maybe: 0, probably: 1, total: 1 }, yourVote: "probably" });
    expect((await h.call("vote", { network: "linkedin", contentId, vote: "no" })).body.community).toMatchObject({ no: 1, probably: 0 });
    expect((await h.call("vote", { network: "linkedin", contentId, vote: null })).body.community.total).toBe(0);
  });
  it("does not use up checks", async () => {
    const h = await makeHarness(kind, { DAILY_CHECK_LIMIT: "1" });
    const { contentId } = (await h.call("judge", judgeBody())).body;
    for (const v of ["no", "maybe", "probably"]) expect((await h.call("vote", { network: "linkedin", contentId, vote: v })).status).toBe(200);
    expect((await h.ctx.store.caps.usage("install-aaaaaaaa")).used).toBe(1);
  });
  it("only attaches to content the server has checked", async () => {
    const h = await makeHarness(kind);
    expect((await h.call("vote", { network: "linkedin", contentId: "f".repeat(32), vote: "no" })).status).toBe(404);
  });
  it.each([
    [{ network: "linkedin", contentId: "zz", vote: "no" }],
    [{ network: "linkedin", contentId: "a".repeat(32), vote: "spam" }],
    [{ network: "nope", contentId: "a".repeat(32), vote: "no" }],
  ])("rejects malformed votes %#", async (body) => {
    const h = await makeHarness(kind);
    expect((await h.call("vote", body)).status).toBeGreaterThanOrEqual(400);
  });
});

describe.each(ADAPTERS)("GET /api/v1/usage and /health (%s)", (kind) => {
  it("reports this install's usage", async () => {
    const h = await makeHarness(kind);
    await h.call("judge", judgeBody());
    expect((await h.call("usage")).body).toMatchObject({ used: 1, limit: 250, remaining: 249, resetsAt: "2026-09-20T00:00:00.000Z" });
    expect((await h.call("usage", undefined, { install: "install-neverused" })).body.used).toBe(0);
  });
  it("health describes the setup without exposing secrets", async () => {
    const h = await makeHarness(kind, { INSTALL_ID_SALT: "supersecret-salt" });
    const { status, body, res } = await h.call("health", undefined, { install: null });
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, storage: kind === "sqlite" ? "memory" : "libsql", jev: { via: "direct", model: "test-jev" }, networks: ["linkedin"], dailyLimit: 250, storesText: false });
    expect(await res.clone().text()).not.toContain("supersecret");
  });
});

describe.each(ADAPTERS)("GET /api/v1/admin/export (%s)", (kind) => {
  it("does not exist unless an admin token is configured", async () => {
    const h = await makeHarness(kind);
    expect((await h.call("export", undefined, { headers: { authorization: "Bearer anything" } })).status).toBe(404);
  });
  it("requires the token", async () => {
    const h = await makeHarness(kind, { ADMIN_TOKEN: "s3cret" });
    expect((await h.call("export")).status).toBe(401);
    expect((await h.call("export", undefined, { headers: { authorization: "Bearer wrong" } })).status).toBe(401);
  });
  it("streams scores and votes as NDJSON for tuning", async () => {
    const h = await makeHarness(kind, { ADMIN_TOKEN: "s3cret" });
    const { contentId } = (await h.call("judge", judgeBody())).body;
    await h.call("vote", { network: "linkedin", contentId, vote: "probably" }, { install: "install-bbbbbbbb" });
    await h.call("vote", { network: "linkedin", contentId, vote: "probably" }, { install: "install-cccccccc" });
    const r = await h.call("export", undefined, { headers: { authorization: "Bearer s3cret" }, query: "?network=linkedin&minVotes=2" });
    expect(r.status).toBe(200);
    expect(r.res.headers.get("content-type")).toContain("ndjson");
    const lines = (await r.res.clone().text()).trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ contentId, votes: { probably: 2, total: 2 }, consensus: "probably", aiLikelihood: 0.9 });
    expect(lines[0].text).toBeNull();
  });
});

describe("CORS and origins", () => {
  it("allows extension origins, refuses arbitrary web pages, and answers preflights", async () => {
    const h = await makeHarness("sqlite");
    const ext = await h.call("judge", judgeBody(), { headers: { origin: "chrome-extension://abcdefghijklmnop" } });
    expect(ext.status).toBe(200);
    expect(ext.res.headers.get("access-control-allow-origin")).toBe("chrome-extension://abcdefghijklmnop");
    const web = await h.call("judge", judgeBody(), { headers: { origin: "https://evil.example" } });
    expect(web.status).toBe(403);
    expect(web.res.headers.get("access-control-allow-origin")).toBeNull();
    const pre = await h.call("judge", undefined, { method: "OPTIONS", headers: { origin: "chrome-extension://abc" } });
    expect(pre.status).toBe(204);
  });
  it("can be told about extra origins", async () => {
    const h = await makeHarness("sqlite", { ALLOWED_ORIGINS: "https://app.example, https://other.example" });
    expect((await h.call("judge", judgeBody(), { headers: { origin: "https://app.example" } })).status).toBe(200);
  });
  it("errors carry CORS headers too, so the extension can read them", async () => {
    const h = await makeHarness("sqlite");
    const r = await h.call("judge", judgeBody({ network: "x" }), { headers: { origin: "chrome-extension://abc" } });
    expect(r.status).toBe(400);
    expect(r.res.headers.get("access-control-allow-origin")).toBe("chrome-extension://abc");
  });
});
