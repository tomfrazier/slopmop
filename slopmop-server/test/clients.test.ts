import { describe, expect, it } from "vitest";
import { ADAPTERS, judgeBody, makeHarness } from "./helpers.js";

const admin = { headers: { authorization: "Bearer s3cret" } };
const A = "install-aaaaaaaa";
const B = "install-bbbbbbbb";
const POST_B = "A second, different post about hiring: we opened three roles this quarter and I would love referrals from people I know.";

describe.each(ADAPTERS)("server-decided client policy (%s)", (kind) => {
  it("tells the client how to behave: concurrency and rate come from the server's configuration", async () => {
    const h = await makeHarness(kind, { CLIENT_MAX_CONCURRENT: "7", CLIENT_RATE_PER_MINUTE: "33" });
    const judged = await h.call("judge", judgeBody());
    expect(judged.body.policy).toEqual({ maxConcurrent: 7, ratePerMinute: 33 });
    expect((await h.call("usage")).body.policy).toEqual({ maxConcurrent: 7, ratePerMinute: 33 });
    expect((await (await makeHarness(kind)).call("judge", judgeBody())).body.policy).toEqual({ maxConcurrent: 4, ratePerMinute: 120 });
  });

  it("enforces the per-install rate limit itself, without spending a check, and reopens as the window moves", async () => {
    const h = await makeHarness(kind, { CLIENT_RATE_PER_MINUTE: "3" });
    for (let i = 0; i < 3; i++) expect((await h.call("judge", judgeBody())).status).toBe(200);
    const blocked = await h.call("judge", judgeBody());
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ error: "rate_limited", policy: { ratePerMinute: 3 } });
    expect(Number(blocked.res.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect((await h.call("usage")).body.used).toBe(3); // the rejected request did not cost a check
    expect((await h.call("judge", judgeBody(), { install: B })).status).toBe(200); // it is per install
    h.clock.t += 61_000;
    expect((await h.call("judge", judgeBody())).status).toBe(200);
  });

  it("does not let rejected requests keep the window full", async () => {
    const h = await makeHarness(kind, { CLIENT_RATE_PER_MINUTE: "2" });
    await h.call("judge", judgeBody());
    await h.call("judge", judgeBody());
    for (let i = 0; i < 5; i++) expect((await h.call("judge", judgeBody())).status).toBe(429);
    h.clock.t += 61_000; // only the two real requests counted, so one minute later it is open again
    expect((await h.call("judge", judgeBody())).status).toBe(200);
  });
});

describe.each(ADAPTERS)("admin kill switch (%s)", (kind) => {
  const deviceOf = (h: Awaited<ReturnType<typeof makeHarness>>, install = A) => h.ctx.store.hashInstall(install).slice(0, 8);
  const set = (h: Awaited<ReturnType<typeof makeHarness>>, body: unknown, headers: Record<string, string> = admin.headers) => h.call("clients", body, { method: "POST", headers });

  it("is admin only", async () => {
    const h = await makeHarness(kind, { ADMIN_TOKEN: "s3cret" });
    expect((await h.call("clients")).status).toBe(401);
    expect((await set(h, { device: "abcdef12", disabled: true }, {})).status).toBe(401);
    expect((await (await makeHarness(kind)).call("clients", undefined, admin)).status).toBe(404); // off without ADMIN_TOKEN
    expect((await h.call("clients", undefined, admin)).body).toEqual({ disabled: [] });
  });

  it("accepts the dashboard's own same-origin POST, but still refuses other sites", async () => {
    const h = await makeHarness(kind, { ADMIN_TOKEN: "s3cret" });
    await h.call("judge", judgeBody(), { install: A });
    const device = deviceOf(h);
    const own = await h.call("clients", { device, disabled: true }, { method: "POST", headers: { ...admin.headers, origin: "http://test" } }); // the harness serves http://test
    expect(own.status).toBe(200);
    const foreign = await h.call("clients", { device, disabled: false }, { method: "POST", headers: { ...admin.headers, origin: "https://evil.example" } });
    expect(foreign.status).toBe(403);
  });

  it("disables a client by the short device id, and every endpoint then refuses it without spending a check", async () => {
    const h = await makeHarness(kind, { ADMIN_TOKEN: "s3cret" });
    const first = await h.call("judge", judgeBody(), { install: A });
    const device = deviceOf(h);
    expect(await set(h, { device, disabled: true, reason: "abuse" })).toMatchObject({ status: 200, body: { device, disabled: true } });

    const j = await h.call("judge", judgeBody({ postText: POST_B }), { install: A });
    expect(j).toMatchObject({ status: 403, body: { error: "client_disabled" } });
    expect((await h.call("vote", { network: "linkedin", contentId: first.body.contentId, vote: "no" }, { install: A })).status).toBe(403);
    expect((await h.call("usage", undefined, { install: A })).status).toBe(403);
    // Not a check spent, and not counted as an error: it shows up as "blocked".
    const other = await h.call("usage", undefined, { install: B });
    expect(other.status).toBe(200); // other clients are unaffected
    const stats = (await h.call("stats", undefined, admin)).body;
    expect(stats.summary).toMatchObject({ blocked: 1, errors: 0 });
    expect(stats.devices.find((d: any) => d.device === device).disabled).toBe(true);
    expect(stats.disabledClients).toEqual([expect.objectContaining({ device, reason: "abuse", checks: 1 })]);
  });

  it("re-enables a client, restoring access", async () => {
    const h = await makeHarness(kind, { ADMIN_TOKEN: "s3cret" });
    await h.call("judge", judgeBody(), { install: A });
    const device = deviceOf(h);
    await set(h, { device, disabled: true });
    expect((await h.call("judge", judgeBody(), { install: A })).status).toBe(403);
    await set(h, { device, disabled: false });
    expect((await h.call("judge", judgeBody(), { install: A })).status).toBe(200);
    expect((await h.call("clients", undefined, admin)).body.disabled).toEqual([]);
  });

  it("validates the request, and reports unknown or ambiguous devices", async () => {
    const h = await makeHarness(kind, { ADMIN_TOKEN: "s3cret" });
    expect((await set(h, { disabled: true })).status).toBe(422);
    expect((await set(h, { device: "abcdef12" })).status).toBe(422);
    expect((await set(h, { device: "abcdef12", disabled: true })).status).toBe(404);
    expect((await set(h, { device: "not-hex!", disabled: true })).status).toBe(404);
    await h.db.execute(`INSERT INTO installs (install_hash, first_seen, last_seen) VALUES ('deadbeef00000000000000000000aaaa', 1, 1), ('deadbeef00000000000000000000bbbb', 1, 1)`);
    expect((await set(h, { device: "deadbeef", disabled: true })).status).toBe(409);
    expect((await set(h, { device: "deadbeef00000000000000000000aaaa", disabled: true })).status).toBe(200);
  });

  it("stops a disabled client's votes counting toward what the community has said", async () => {
    const h = await makeHarness(kind, { ADMIN_TOKEN: "s3cret" });
    const a = await h.call("judge", judgeBody(), { install: A });
    await h.call("judge", judgeBody(), { install: B });
    const id = a.body.contentId;
    await h.call("vote", { network: "linkedin", contentId: id, vote: "probably" }, { install: A });
    await h.call("vote", { network: "linkedin", contentId: id, vote: "no" }, { install: B });
    expect((await h.call("judge", judgeBody(), { install: B })).body.community).toMatchObject({ probably: 1, no: 1, total: 2 });
    await set(h, { device: deviceOf(h, A), disabled: true });
    expect((await h.call("judge", judgeBody(), { install: B })).body.community).toMatchObject({ probably: 0, no: 1, total: 1 });
    const exported = await h.call("export", undefined, { ...admin, query: "?minVotes=1" });
    expect(JSON.parse(exported.res.headers ? await exported.res.text().then((t) => t.trim().split("\n")[0]) : "{}")).toMatchObject({ votes: { probably: 0, no: 1 }, consensus: "no" });
  });
});
