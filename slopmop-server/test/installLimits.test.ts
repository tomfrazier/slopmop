import { describe, expect, it } from "vitest";
import { ADAPTERS, judgeBody, makeHarness } from "./helpers.js";

const admin = { headers: { authorization: "Bearer s3cret" } };
const ip = (a: string) => ({ headers: { "x-forwarded-for": a } });
const post = (n: number) => judgeBody({ postText: `Post number ${n}, long enough to be judged normally by the server here.` });

describe.each(ADAPTERS)("per-install limits (%s)", (kind) => {
  const env = { ADMIN_TOKEN: "s3cret", DAILY_CHECK_LIMIT: "3", IP_HOURLY_LIMIT: "1000" };

  it("gives every new install the default daily limit, and tells it its device id", async () => {
    const h = await makeHarness(kind, env);
    const first = await h.call("judge", post(1), { install: "install-aaaaaaaa" });
    expect(first.body.usage).toMatchObject({ used: 1, limit: 3 });
    expect(first.body.usage.device).toMatch(/^[0-9a-f]{8}$/);
    await h.call("judge", post(2), { install: "install-aaaaaaaa" });
    await h.call("judge", post(3), { install: "install-aaaaaaaa" });
    expect((await h.call("judge", post(4), { install: "install-aaaaaaaa" })).status).toBe(429);
    const usage = await h.call("usage", undefined, { install: "install-aaaaaaaa" });
    expect(usage.body).toMatchObject({ limit: 3, device: first.body.usage.device });
  });

  it("lets one install have its own daily limit, higher or lower, and go back to the default", async () => {
    const h = await makeHarness(kind, env);
    const device = (await h.call("judge", post(1), { install: "install-aaaaaaaa" })).body.usage.device;
    const set = await h.call("clients", { device, dailyLimit: 10 }, { ...admin, method: "POST" });
    expect(set.status).toBe(200);
    expect(set.body).toMatchObject({ device, dailyLimit: 10 });
    for (let i = 2; i <= 6; i++) expect((await h.call("judge", post(i), { install: "install-aaaaaaaa" })).status).toBe(200); // past the default of 3
    expect((await h.call("usage", undefined, { install: "install-aaaaaaaa" })).body.limit).toBe(10);
    // another install still follows the default
    for (let i = 1; i <= 3; i++) await h.call("judge", post(i), { install: "install-bbbbbbbb" });
    expect((await h.call("judge", post(4), { install: "install-bbbbbbbb" })).status).toBe(429);
    // clearing the override puts it back on the default (it has already used 6 today, so it is over it)
    await h.call("clients", { device, dailyLimit: null }, { ...admin, method: "POST" });
    expect((await h.call("judge", post(7), { install: "install-aaaaaaaa" })).status).toBe(429);
    expect((await h.call("usage", undefined, { install: "install-aaaaaaaa" })).body.limit).toBe(3);
  });

  it("changes the default for everyone without an override, live", async () => {
    const h = await makeHarness(kind, env);
    const device = (await h.call("judge", post(1), { install: "install-aaaaaaaa" })).body.usage.device;
    await h.call("clients", { device, dailyLimit: 50 }, { ...admin, method: "POST" });
    const saved = await h.call("limits", { dailyLimit: 5 }, { ...admin, method: "POST" });
    expect(saved.body.effective).toMatchObject({ dailyLimit: 5, ipHourlyLimit: 1000 });
    expect(saved.body.defaults).toMatchObject({ dailyLimit: 3 });
    expect((await h.call("usage", undefined, { install: "install-bbbbbbbb" })).body.limit).toBe(5); // follows the new default
    expect((await h.call("usage", undefined, { install: "install-aaaaaaaa" })).body.limit).toBe(50); // keeps its own
    const back = await h.call("limits", { reset: true }, { ...admin, method: "POST" });
    expect(back.body.effective.dailyLimit).toBe(3);
  });

  it("lets one install have its own hourly (per-IP) limit", async () => {
    const h = await makeHarness(kind, { ...env, IP_HOURLY_LIMIT: "2", DAILY_CHECK_LIMIT: "50" });
    const device = (await h.call("judge", post(1), { install: "install-aaaaaaaa", ...ip("198.51.100.7") })).body.usage.device;
    expect((await h.call("judge", post(2), { install: "install-aaaaaaaa", ...ip("198.51.100.7") })).status).toBe(200);
    expect((await h.call("judge", post(3), { install: "install-aaaaaaaa", ...ip("198.51.100.7") })).status).toBe(429); // default 2/hour
    await h.call("clients", { device, hourlyLimit: 20 }, { ...admin, method: "POST" });
    for (let i = 3; i <= 8; i++) expect((await h.call("judge", post(i), { install: "install-aaaaaaaa", ...ip("198.51.100.7") })).status).toBe(200);
  });

  it("refuses a bad limit, and an unknown device", async () => {
    const h = await makeHarness(kind, env);
    const device = (await h.call("judge", post(1), { install: "install-aaaaaaaa" })).body.usage.device;
    for (const bad of [0, -1, 1.5, "10", 2_000_000]) expect((await h.call("clients", { device, dailyLimit: bad }, { ...admin, method: "POST" })).status).toBe(422);
    expect((await h.call("limits", { dailyLimit: 0 }, { ...admin, method: "POST" })).status).toBe(422);
    expect((await h.call("clients", { device: "deadbeef", dailyLimit: 5 }, { ...admin, method: "POST" })).status).toBe(404);
  });

  it("keeps both admin endpoints behind the admin key", async () => {
    const h = await makeHarness(kind, env);
    expect((await h.call("limits", undefined, { method: "GET" })).status).toBe(401);
    expect((await h.call("devices", undefined, { method: "GET" })).status).toBe(401);
  });
});

describe.each(ADAPTERS)("the admin device list (%s)", (kind) => {
  const env = { ADMIN_TOKEN: "s3cret", DAILY_CHECK_LIMIT: "50" };
  const seed = async () => {
    const h = await makeHarness(kind, env);
    const devices: string[] = [];
    for (const [i, id] of ["install-aaaaaaaa", "install-bbbbbbbb", "install-cccccccc"].entries()) {
      for (let n = 0; n <= i; n++) await h.call("judge", post(n + i * 10), { install: id });
      devices.push((await h.call("usage", undefined, { install: id })).body.device);
    }
    return { h, devices };
  };
  const list = (h: Awaited<ReturnType<typeof makeHarness>>, query: string) => h.call("devices", undefined, { ...admin, method: "GET", query });

  it("lists every install with today's checks, and pages", async () => {
    const { h, devices } = await seed();
    const all = await list(h, "");
    expect(all.body.total).toBe(3);
    expect(all.body.devices.map((d: { device: string }) => d.device).sort()).toEqual([...devices].sort());
    const c = all.body.devices.find((d: { device: string }) => d.device === devices[2]);
    expect(c).toMatchObject({ today: 3, checks: 3, disabled: false, dailyLimit: null, hourlyLimit: null });
    const page = await list(h, "?limit=2&offset=2&sort=checks&dir=desc");
    expect(page.body).toMatchObject({ total: 3, offset: 2, limit: 2 });
    expect(page.body.devices).toHaveLength(1);
    expect(page.body.devices[0].device).toBe(devices[0]); // fewest checks, last
  });

  it("finds one device by any part of its id, and by a full-hash prefix", async () => {
    const { h, devices } = await seed();
    const mid = devices[1].slice(2, 6);
    const found = await list(h, `?q=${mid}`);
    expect(found.body.devices.map((d: { device: string }) => d.device)).toContain(devices[1]);
    expect(found.body.devices.every((d: { device: string }) => d.device.includes(mid))).toBe(true);
    expect((await list(h, "?q=ffffffff")).body.total).toBe(0);
    expect((await list(h, `?q=${devices[0].toUpperCase()}`)).body.devices[0].device).toBe(devices[0]); // case-insensitive
    expect((await list(h, "?q=%27%3B%20DROP%20TABLE%20installs")).status).toBe(200); // not an injection path: only hex characters survive
  });

  it("filters to disabled devices and to ones with their own limits", async () => {
    const { h, devices } = await seed();
    await h.call("clients", { device: devices[0], disabled: true, reason: "test" }, { ...admin, method: "POST" });
    await h.call("clients", { device: devices[1], dailyLimit: 999 }, { ...admin, method: "POST" });
    expect((await list(h, "?status=disabled")).body.devices.map((d: { device: string }) => d.device)).toEqual([devices[0]]);
    const custom = await list(h, "?status=custom");
    expect(custom.body.devices.map((d: { device: string }) => d.device)).toEqual([devices[1]]);
    expect(custom.body.devices[0].dailyLimit).toBe(999);
  });
});
