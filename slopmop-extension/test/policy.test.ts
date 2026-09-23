// @vitest-environment jsdom
// The client obeys the limits the server sends (concurrency, per-minute rate, "wait", "disabled"); it decides none of them.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (m: any, sender: any, respond: (r?: any) => void) => boolean | void;
const mem: Record<string, Record<string, any>> = { sync: {}, local: {}, session: {} };
const listeners: Listener[] = [];
const area = (name: string) => ({
  get: async (k?: string | string[] | null) => {
    if (k == null) return { ...mem[name] };
    const keys = Array.isArray(k) ? k : [k];
    return Object.fromEntries(keys.filter((x) => x in mem[name]).map((x) => [x, mem[name][x]]));
  },
  set: async (o: Record<string, any>) => void Object.assign(mem[name], o),
  remove: async (k: string | string[]) => [].concat(k as any).forEach((x) => delete mem[name][x]),
});
(globalThis as any).chrome = {
  storage: { sync: area("sync"), local: area("local"), session: area("session"), onChanged: { addListener() {} } },
  runtime: {
    getURL: (p: string) => p,
    onMessage: { addListener: (l: Listener) => listeners.push(l) },
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
    sendMessage: (m: any) => new Promise((resolve) => listeners.forEach((l) => l(m, { tab: { id: 7 } }, resolve))),
  },
  tabs: { query: async () => [{ id: 7 }], create: async () => ({}), onRemoved: { addListener() {} } },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
};

const SERVER = "http://127.0.0.1:1";
const send = (m: any) => (globalThis as any).chrome.runtime.sendMessage(m);
const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const stats = { wordCount: 20, sentenceCount: 1, sentenceLengthStdDev: 0, contractionsPer100Words: 0, exclamationCount: 0, emDashesPer1000Words: 0 };
const msg = (n: number) => ({ type: "judge", urn: `post:p${n}`, text: `We finally shipped the billing migration and I think it is the best thing our team did all year. Post ${n}.`, stats, priority: n });
const verdict = (policy?: unknown) => ({
  model: "jev", aiLikelihood: 0.9, dimensions: {}, tellMean: 0.3, tellRank: [], network: "linkedin", contentId: "c".repeat(32), cached: false,
  community: { no: 0, maybe: 0, probably: 0, total: 0 }, usage: { used: 1, limit: 250, remaining: 249, resetsAt: new Date(Date.now() + 3600_000).toISOString() }, policy,
});

let calls: { at: number; body: any }[] = [];
let answer: (n: number) => { status: number; body: unknown; headers?: Record<string, string> };
let hold: Promise<void> | null = null;

/** A fresh background worker per test, so the queue and pacing state never leak between them. */
async function boot(policyInStorage?: unknown) {
  vi.resetModules();
  listeners.length = 0;
  for (const k of Object.keys(mem)) for (const key of Object.keys(mem[k])) delete mem[k][key];
  mem.sync.settings = { enabled: true, acknowledged: true, mode: "hide", sensitivity: "moderate", debug: false };
  if (policyInStorage) mem.local.policy = policyInStorage;
  calls = [];
  hold = null;
  (globalThis as any).__SERVER_URL__ = SERVER;
  delete (globalThis as any).__COLLECTOR_URL__;
  vi.stubGlobal("fetch", async (url: string, init: any) => {
    if (!String(url).endsWith("/judge")) return new Response("{}");
    calls.push({ at: Date.now(), body: JSON.parse(init.body) });
    if (hold) await hold;
    const r = answer(calls.length);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json", ...(r.headers ?? {}) } });
  });
  await import("../src/background/index");
  await tick(20);
}
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
  answer = () => ({ status: 200, body: verdict({ maxConcurrent: 3, ratePerMinute: 100 }) });
});

describe("the client uses the server's policy", () => {
  it("is modest until the server has said anything (two at a time)", async () => {
    await boot();
    let release = () => {};
    hold = new Promise<void>((r) => (release = r));
    const replies = [0, 1, 2, 3, 4].map((n) => send(msg(n)));
    await tick(150);
    expect(calls).toHaveLength(2);
    hold = null;
    release();
    await Promise.all(replies);
  });

  it("takes its concurrency from the server's answer, and raises it at once", async () => {
    await boot();
    await send(msg(0)); // answers with maxConcurrent 3
    expect(mem.local.policy).toEqual({ maxConcurrent: 3, ratePerMinute: 100 }); // remembered for next time
    calls.length = 0;
    let release = () => {};
    hold = new Promise<void>((r) => (release = r));
    const replies = [1, 2, 3, 4, 5, 6].map((n) => send(msg(n)));
    await tick(150);
    expect(calls).toHaveLength(3);
    hold = null;
    release();
    await Promise.all(replies);
  });

  it("uses the policy it remembered from the last session before the server has answered", async () => {
    await boot({ maxConcurrent: 5, ratePerMinute: 100 });
    let release = () => {};
    hold = new Promise<void>((r) => (release = r));
    const replies = [0, 1, 2, 3, 4, 5, 6].map((n) => send(msg(n)));
    await tick(150);
    expect(calls).toHaveLength(5);
    hold = null;
    release();
    await Promise.all(replies);
  });

  it("ignores a nonsensical policy", async () => {
    await boot({ maxConcurrent: 5, ratePerMinute: 100 });
    answer = () => ({ status: 200, body: verdict({ maxConcurrent: -3, ratePerMinute: "lots" }) });
    await send(msg(0));
    expect(mem.local.policy).toEqual({ maxConcurrent: 5, ratePerMinute: 100 });
  });

  it("stays under the server's per-minute limit by holding requests back, not by asking and being refused", async () => {
    await boot({ maxConcurrent: 4, ratePerMinute: 2 });
    answer = () => ({ status: 200, body: verdict({ maxConcurrent: 4, ratePerMinute: 2 }) });
    // Which two of the three reach the server first depends on how their (async) cache keys finish hashing, so the test doesn't
    // name them: it only checks that two are sent and the other is held back for the minute window rather than sent and refused.
    const all = [send(msg(0)), send(msg(1)), send(msg(2))];
    await tick(400);
    expect(calls).toHaveLength(2);
    void all; // the held one is released when the window frees; left pending on purpose
  });
});

describe("when the server says to wait or refuses", () => {
  it("pauses the whole queue for the server's Retry-After on a rate limit, then carries on without failing the post", async () => {
    await boot({ maxConcurrent: 4, ratePerMinute: 100 });
    answer = (n) => (n === 1 ? { status: 429, body: { error: "rate_limited", message: "slow down", policy: { maxConcurrent: 4, ratePerMinute: 100 } }, headers: { "retry-after": "1" } } : { status: 200, body: verdict({ maxConcurrent: 4, ratePerMinute: 100 }) });
    const r = await send(msg(0));
    expect(r).toMatchObject({ contentId: "c".repeat(32) }); // not a failure
    expect(calls).toHaveLength(2);
    expect(calls[1].at - calls[0].at).toBeGreaterThanOrEqual(950); // waited as long as the server asked
  }, 10_000);

  it("stops asking, and says why, once the admin has disabled this install", async () => {
    await boot({ maxConcurrent: 4, ratePerMinute: 100 });
    answer = () => ({ status: 403, body: { error: "client_disabled", message: "This install has been disabled by the Slop Mop server." } });
    expect(await send(msg(0))).toBeNull();
    expect(calls).toHaveLength(1);
    expect(mem.local.blocked).toMatchObject({ message: "This install has been disabled by the Slop Mop server." });
    expect(mem.local.blocked.until).toBeGreaterThan(Date.now() + 3000_000); // looks again in about an hour
    expect(await send(msg(1))).toBeNull();
    expect(calls).toHaveLength(1); // no more requests while blocked
    const dbg = await send({ type: "myDebug" });
    expect(dbg.lastError).toMatch(/disabled/);
  });
});
