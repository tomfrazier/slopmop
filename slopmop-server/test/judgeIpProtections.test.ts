import { describe, expect, it } from "vitest";
import { ADAPTERS, judgeBody, makeHarness } from "./helpers.js";

const fromIp = (ip: string) => ({ headers: { "x-forwarded-for": ip } });

describe.each(ADAPTERS)("the datacenter IP block (%s)", (kind) => {
  it("rejects a request from a known datacenter range before spending any check", async () => {
    const h = await makeHarness(kind, { DATACENTER_CIDR_EXTRA: "203.0.113.0/24" });
    const res = await h.call("judge", judgeBody(), { ...fromIp("203.0.113.5"), install: "install-aaaaaaaa" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("datacenter_ip");
    expect((await h.call("usage", undefined, { install: "install-aaaaaaaa" })).body.used).toBe(0); // nothing spent
    expect(h.calls.n).toBe(0); // Jev was never called
  });
  it("does not reject an IP outside the configured ranges", async () => {
    const h = await makeHarness(kind, { DATACENTER_CIDR_EXTRA: "203.0.113.0/24" });
    const res = await h.call("judge", judgeBody(), fromIp("198.51.100.5"));
    expect(res.status).toBe(200);
  });
  it("can be turned off", async () => {
    const h = await makeHarness(kind, { DATACENTER_CIDR_EXTRA: "203.0.113.0/24", BLOCK_DATACENTER_IPS: "false" });
    const res = await h.call("judge", judgeBody(), fromIp("203.0.113.5"));
    expect(res.status).toBe(200);
  });
  it("is on by default (no environment variable needed)", async () => {
    const h = await makeHarness(kind, { DATACENTER_CIDR_EXTRA: "203.0.113.0/24" });
    expect((await h.call("judge", judgeBody(), fromIp("203.0.113.5"))).status).toBe(403);
  });
  it("does nothing when the platform sends no IP at all (never breaks local dev or a misconfigured proxy)", async () => {
    const h = await makeHarness(kind, { DATACENTER_CIDR_EXTRA: "0.0.0.0/0" }); // would match literally everything
    expect((await h.call("judge", judgeBody(), { install: "install-aaaaaaaa" })).status).toBe(200);
  });
  it("logs the rejection as a 'limited' event, distinct from a normal refusal", async () => {
    const h = await makeHarness(kind, { DATACENTER_CIDR_EXTRA: "203.0.113.0/24", ADMIN_TOKEN: "s3cret" });
    await h.call("judge", judgeBody(), fromIp("203.0.113.5"));
    const stats = await h.call("stats", undefined, { headers: { authorization: "Bearer s3cret" }, method: "GET" });
    expect(stats.body.problems.some((p: { detail: string }) => p.detail === "datacenter_ip")).toBe(true);
  });
});

describe.each(ADAPTERS)("the per-IP hourly cap (%s)", (kind) => {
  it("refuses once the IP's hourly limit is reached, even for a brand-new install id", async () => {
    const h = await makeHarness(kind, { IP_HOURLY_LIMIT: "2" });
    const ok1 = await h.call("judge", judgeBody({ postText: "First post text, long enough to be judged normally here." }), { ...fromIp("198.51.100.1"), install: "install-aaaaaaaa" });
    const ok2 = await h.call("judge", judgeBody({ postText: "Second post text, long enough to be judged normally here." }), { ...fromIp("198.51.100.1"), install: "install-bbbbbbbb" });
    const blocked = await h.call("judge", judgeBody({ postText: "Third post text, long enough to be judged normally here." }), { ...fromIp("198.51.100.1"), install: "install-cccccccc" });
    expect([ok1.status, ok2.status]).toEqual([200, 200]);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe("ip_rate_limited");
    expect(blocked.res.headers.get("Retry-After")).toBe("3600");
    // The refused request's own (fresh) install id was never charged for it.
    expect((await h.call("usage", undefined, { install: "install-cccccccc" })).body.used).toBe(0);
  });
  it("does not limit two different IPs, each within their own allowance", async () => {
    const h = await makeHarness(kind, { IP_HOURLY_LIMIT: "1" });
    expect((await h.call("judge", judgeBody(), fromIp("198.51.100.1"))).status).toBe(200);
    expect((await h.call("judge", judgeBody(), fromIp("198.51.100.2"))).status).toBe(200);
  });
  it("resets on the UTC hour, independent of the per-install daily reset", async () => {
    const h = await makeHarness(kind, { IP_HOURLY_LIMIT: "1" });
    await h.call("judge", judgeBody(), fromIp("198.51.100.1"));
    expect((await h.call("judge", judgeBody({ postText: "A different post, still long enough to be judged here." }), fromIp("198.51.100.1"))).status).toBe(429);
    h.clock.t += 61 * 60_000;
    expect((await h.call("judge", judgeBody({ postText: "Yet another distinct post, long enough to be judged here." }), fromIp("198.51.100.1"))).status).toBe(200);
  });
  it("refunds the IP's check when the request is refused for an unrelated reason (a disabled install)", async () => {
    const h = await makeHarness(kind, { IP_HOURLY_LIMIT: "1" });
    const r = await h.call("judge", judgeBody(), { install: "install-aaaaaaaa" });
    await h.ctx.store.clients.setDisabled(h.ctx.store.hashInstall("install-aaaaaaaa"), true, "test");
    const denied = await h.call("judge", judgeBody(), { ...fromIp("198.51.100.1"), install: "install-aaaaaaaa" });
    expect(denied.status).toBe(403); // disabled, not the IP cap
    void r;
    // The IP cap slot the disabled attempt would have used was refunded, so a fresh install from the same IP still gets in.
    expect((await h.call("judge", judgeBody({ postText: "Fresh post text, long enough to be judged normally here." }), { ...fromIp("198.51.100.1"), install: "install-bbbbbbbb" })).status).toBe(200);
  });
  it("does nothing when the platform sends no IP (an install can still be limited by its own daily cap as before)", async () => {
    const h = await makeHarness(kind, { IP_HOURLY_LIMIT: "1", DAILY_CHECK_LIMIT: "5" });
    for (let i = 0; i < 3; i++) expect((await h.call("judge", judgeBody({ postText: `Post number ${i}, long enough to be judged normally here.` }))).status).toBe(200);
  });
});
