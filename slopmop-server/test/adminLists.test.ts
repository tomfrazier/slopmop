import { describe, expect, it } from "vitest";
import { ADAPTERS, judgeBody, makeHarness } from "./helpers.js";

const admin = { headers: { authorization: "Bearer s3cret" } };
const get = { ...admin, method: "GET" as const };
const post = (n: number) => judgeBody({ postText: `Post number ${n}, long enough to be judged normally by the server here for tests.` });

describe.each(ADAPTERS)("device aliases (%s)", (kind) => {
  const env = { ADMIN_TOKEN: "s3cret", DAILY_CHECK_LIMIT: "50" };
  const setup = async () => {
    const h = await makeHarness(kind, env);
    const a = (await h.call("judge", post(1), { install: "install-aaaaaaaa" })).body.usage.device as string;
    const b = (await h.call("judge", post(2), { install: "install-bbbbbbbb" })).body.usage.device as string;
    return { h, a, b };
  };

  it("names a device, shows the name in the list, finds it by any part of the name, and can remove it", async () => {
    const { h, a, b } = await setup();
    const set = await h.call("clients", { device: a, alias: "  My laptop  " }, { ...admin, method: "POST" });
    expect(set.body).toMatchObject({ device: a, alias: "My laptop" });
    const list = (await h.call("devices", undefined, get)).body.devices;
    expect(list.find((d: { device: string }) => d.device === a).alias).toBe("My laptop");
    expect(list.find((d: { device: string }) => d.device === b).alias).toBeNull();
    const found = (await h.call("devices", undefined, { ...get, query: "?q=LAPTOP" })).body;
    expect(found.devices.map((d: { device: string }) => d.device)).toEqual([a]);
    expect((await h.call("devices", undefined, { ...get, query: `?q=${b.slice(1, 5)}` })).body.devices.map((d: { device: string }) => d.device)).toContain(b);
    await h.call("clients", { device: a, alias: null }, { ...admin, method: "POST" });
    expect((await h.call("devices", undefined, { ...get, query: "?q=laptop" })).body.total).toBe(0);
  });

  it("treats % and _ in a search literally, and refuses a name that is too long", async () => {
    const { h, a } = await setup();
    await h.call("clients", { device: a, alias: "a_b" }, { ...admin, method: "POST" });
    expect((await h.call("devices", undefined, { ...get, query: "?q=a_b" })).body.total).toBe(1);
    expect((await h.call("devices", undefined, { ...get, query: "?q=%25" })).body.total).toBe(0);
    expect((await h.call("clients", { device: a, alias: "x".repeat(41) }, { ...admin, method: "POST" })).status).toBe(422);
  });

  it("puts the name on the overview's busiest devices and recent errors too", async () => {
    const { h, a } = await setup();
    await h.call("clients", { device: a, alias: "Test rig" }, { ...admin, method: "POST" });
    h.failNext.error = new TypeError("boom");
    await h.call("judge", post(3), { install: "install-aaaaaaaa" });
    const stats = (await h.call("stats", undefined, get)).body;
    expect(stats.devices.find((d: { device: string }) => d.device === a)).toMatchObject({ alias: "Test rig" });
    expect(stats.problems[0]).toMatchObject({ device: a, alias: "Test rig" });
  });
});

describe.each(ADAPTERS)("analytics follow the limits (%s)", (kind) => {
  const env = { ADMIN_TOKEN: "s3cret", DAILY_CHECK_LIMIT: "3" };

  it("measures a device against its own limit, and reports the default limit that is live now", async () => {
    const h = await makeHarness(kind, env);
    let device = "";
    for (let i = 1; i <= 3; i++) device = (await h.call("judge", post(i), { install: "install-aaaaaaaa" })).body.usage.device;
    for (let i = 1; i <= 3; i++) await h.call("judge", post(i), { install: "install-bbbbbbbb" });
    let stats = (await h.call("stats", undefined, get)).body;
    expect(stats.installs).toMatchObject({ todayAtCap: 2, todayActive: 2 });
    expect(stats.limits.dailyLimit).toBe(3);
    await h.call("clients", { device, dailyLimit: 2000 }, { ...admin, method: "POST" }); // give one device a big allowance
    await h.call("limits", { dailyLimit: 10 }, { ...admin, method: "POST" }); // and raise everyone else's default
    stats = (await h.call("stats", undefined, get)).body;
    expect(stats.limits.dailyLimit).toBe(10);
    expect(stats.installs).toMatchObject({ todayAtCap: 0, todayNearCap: 0 }); // 3 of 10 and 3 of 2000: nobody is near a cap any more
    const own = stats.devices.find((d: { device: string }) => d.device === device);
    expect(own).toMatchObject({ dailyLimit: 2000, ownLimit: true });
    expect(stats.devices.find((d: { device: string }) => d.device !== device)).toMatchObject({ dailyLimit: 10, ownLimit: false });
  });
});

describe.each(ADAPTERS)("the paged error list (%s)", (kind) => {
  const env = { ADMIN_TOKEN: "s3cret", DAILY_CHECK_LIMIT: "2" };
  const seed = async () => {
    const h = await makeHarness(kind, { ...env, DAILY_CHECK_LIMIT: "100" });
    h.failNext.error = new TypeError("first");
    await h.call("judge", post(1), { install: "install-aaaaaaaa" });
    h.failNext.error = new RangeError("second");
    await h.call("judge", post(2), { install: "install-bbbbbbbb" });
    h.failNext.error = new TypeError("third");
    await h.call("judge", post(3), { install: "install-aaaaaaaa" });
    return h;
  };
  const events = (h: Awaited<ReturnType<typeof makeHarness>>, query = "") => h.call("events", undefined, { ...get, query });

  it("lists every error newest first, pages, and counts what happened", async () => {
    const h = await seed();
    const all = (await events(h)).body;
    expect(all.total).toBe(3);
    expect(all.rows.map((r: { detail: string }) => r.detail)).toEqual(["TypeError", "RangeError", "TypeError"]);
    expect(all.facets[0]).toMatchObject({ kind: "error", detail: "TypeError", n: 2 });
    const page = (await events(h, "?limit=2&offset=2")).body;
    expect(page).toMatchObject({ total: 3, offset: 2 });
    expect(page.rows).toHaveLength(1);
  });

  it("filters by what happened, by the text in it, by device and by name", async () => {
    const h = await seed();
    expect((await events(h, "?detail=RangeError")).body.total).toBe(1);
    expect((await events(h, "?q=typee")).body.total).toBe(2);
    const dev = (await h.call("usage", undefined, { install: "install-bbbbbbbb" })).body.device;
    expect((await events(h, `?device=${dev}`)).body.rows.map((r: { detail: string }) => r.detail)).toEqual(["RangeError"]);
    await h.call("clients", { device: dev, alias: "Beta box" }, { ...admin, method: "POST" });
    const named = (await events(h, "?device=beta")).body;
    expect(named.rows).toHaveLength(1);
    expect(named.rows[0].alias).toBe("Beta box");
    // the facet counts ignore the detail filter, so the other causes stay visible while one is selected
    expect((await events(h, "?detail=RangeError")).body.facets.map((f: { detail: string }) => f.detail).sort()).toEqual(["RangeError", "TypeError"]);
  });

  it("separates refused requests from errors, including the daily limit", async () => {
    const h = await makeHarness(kind, env);
    for (let i = 1; i <= 3; i++) await h.call("judge", post(i), { install: "install-aaaaaaaa" });
    expect((await events(h, "?kind=limited")).body).toMatchObject({ total: 1 });
    expect((await events(h, "?kind=error")).body.total).toBe(0);
    expect((await events(h, "?detail=daily_limit")).body.total).toBe(1);
  });

  it("stays behind the admin key", async () => {
    const h = await seed();
    expect((await h.call("events", undefined, { method: "GET" })).status).toBe(401);
    expect((await h.call("posts", undefined, { method: "GET" })).status).toBe(401);
  });
});

describe.each(ADAPTERS)("the paged voted-post lists (%s)", (kind) => {
  it("pages the most-flagged posts and says how many there are; unknown lists are refused", async () => {
    const h = await makeHarness(kind, { ADMIN_TOKEN: "s3cret", DAILY_CHECK_LIMIT: "100" });
    for (let i = 1; i <= 5; i++) {
      const r = await h.call("judge", post(i), { install: "install-aaaaaaaa" });
      await h.call("vote", { network: "linkedin", contentId: r.body.contentId, vote: "probably" }, { install: `install-voter${i}xx` });
    }
    const first = (await h.call("posts", undefined, { ...get, query: "?list=flagged&limit=2" })).body;
    expect(first).toMatchObject({ list: "flagged", total: 5, offset: 0 });
    expect(first.rows).toHaveLength(2);
    const last = (await h.call("posts", undefined, { ...get, query: "?list=flagged&limit=2&offset=4" })).body;
    expect(last.rows).toHaveLength(1);
    const ids = new Set([...first.rows, ...(await h.call("posts", undefined, { ...get, query: "?list=flagged&limit=2&offset=2" })).body.rows, ...last.rows].map((r: { contentId: string }) => r.contentId));
    expect(ids.size).toBe(5); // pages don't overlap
    expect((await h.call("posts", undefined, { ...get, query: "?list=overreached" })).body).toMatchObject({ total: 0, rows: [] });
    expect((await h.call("posts", undefined, { ...get, query: "?list=nope" })).status).toBe(400);
  });
});

describe.each(ADAPTERS)("DAU and MAU (%s)", (kind) => {
  it("counts installs that made a check per UTC day, over 30 days, with stickiness", async () => {
    const h = await makeHarness(kind, { ADMIN_TOKEN: "s3cret" });
    const admin = { headers: { authorization: "Bearer s3cret" }, query: "?range=30d" };
    const post = (n: number) => judgeBody({ postText: `A distinct post number ${n} with enough words in it to be judged as usual, again and again.` });
    let n = 0;
    const day = async (who: string[]) => { for (const w of who) await h.call("judge", post(n++), { install: `install-${w}-xxxxxxxx` }); };
    h.clock.t -= 40 * 86_400_000;
    await day(["old1", "old2"]); // 40 days ago: outside the 30-day window
    h.clock.t += 20 * 86_400_000;
    await day(["a", "b"]);
    h.clock.t += 19 * 86_400_000; // yesterday
    await day(["a", "b", "c"]);
    h.clock.t += 86_400_000; // today
    await day(["a"]);
    const { body } = await h.call("stats", undefined, admin);
    expect(body.installs).toMatchObject({ dau: 1, dauYesterday: 3, mau: 3 });
    expect(body.installs.avgDau30).toBeCloseTo(6 / 30, 1);
    expect(body.installs.stickinessPct).toBeCloseTo(((6 / 30) / 3) * 100, 0);
  });
});
