// @vitest-environment jsdom
// The real background worker against a programmable fake Slop Mop server, wired to a simulated chrome.* API.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
    sendMessage: (m: any) =>
      new Promise((resolve) => {
        listeners.forEach((l) => l(m, { tab: { id: 7 } }, resolve));
      }),
  },
  tabs: { query: async () => [{ id: 7 }], create: async () => ({}), onRemoved: { addListener() {} } },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
};

const SERVER = "http://127.0.0.1:1";
const COLLECTOR = "http://127.0.0.1:2";

interface Req { url: string; method: string; headers: Record<string, string>; body: any; signal?: AbortSignal }
const requests: Req[] = [];
/** What the fake server answers, per path. */
let respond: (req: Req) => { status: number; body: unknown; headers?: Record<string, string> };
/** While set, judge requests wait for it: lets a test hold requests "in flight". */
let hold: Promise<void> | null = null;

const send = (m: any) => (globalThis as any).chrome.runtime.sendMessage(m);
const TEXT = "We finally shipped the billing migration last Thursday and I think it is the best thing our team did all year.";
const stats = { wordCount: 20, sentenceCount: 1, sentenceLengthStdDev: 0, contractionsPer100Words: 0, exclamationCount: 0, emDashesPer1000Words: 0 };
const judgeMsg = (over: Record<string, unknown> = {}) => ({ type: "judge", urn: "post:abc", text: TEXT, stats, priority: 0, ...over });
const okVerdict = (over: Record<string, unknown> = {}) => ({
  model: "jev",
  aiLikelihood: 0.9,
  dimensions: {},
  tellMean: 0.3,
  tellRank: [],
  policy: { maxConcurrent: 4, ratePerMinute: 120 },
  weightsVersion: "v1",
  network: "linkedin",
  contentId: "c".repeat(32),
  cached: false,
  community: { no: 0, maybe: 1, probably: 2, total: 3 },
  usage: { used: 1, limit: 250, remaining: 249, resetsAt: new Date(Date.now() + 3600_000).toISOString() },
  ...over,
});
const judgeRequests = () => requests.filter((r) => r.url === `${SERVER}/api/v1/judge`);
const voteRequests = () => requests.filter((r) => r.url === `${SERVER}/api/v1/vote`);
const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  (globalThis as any).__SERVER_URL__ = SERVER;
  (globalThis as any).__COLLECTOR_URL__ = COLLECTOR;
  vi.stubGlobal("fetch", async (url: string, init: any) => {
    const req: Req = { url: String(url), method: init?.method ?? "GET", headers: init?.headers ?? {}, body: init?.body ? JSON.parse(init.body) : null, signal: init?.signal };
    requests.push(req);
    if (hold && req.url.endsWith("/judge")) await hold;
    if (req.url.startsWith(COLLECTOR)) throw new TypeError("Failed to fetch"); // the dev collector isn't running
    const r = respond(req);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json", ...(r.headers ?? {}) } });
  });
  await import("../src/background/index");
});

beforeEach(async () => {
  requests.length = 0;
  for (const k of Object.keys(mem.local)) if (k !== "installId") delete mem.local[k];
  mem.session = {};
  mem.sync.settings = { enabled: true, acknowledged: true, mode: "hide", sensitivity: "moderate", debug: true };
  respond = () => ({ status: 200, body: okVerdict() });
});

describe("judge requests", () => {
  it("post to the v1 API with the network, the text, the canonical id and engagement, and this install's id", async () => {
    const r = await send(judgeMsg({ nativeId: "urn:li:activity:7506917720538558465", engagement: { reactions: 5, comments: 1, reposts: 0 } }));
    expect(r).toMatchObject({ contentId: "c".repeat(32), community: { probably: 2 } });
    expect(judgeRequests()).toHaveLength(1);
    const req = judgeRequests()[0];
    expect(req.method).toBe("POST");
    expect(req.headers["x-install-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(req.body).toMatchObject({ network: "linkedin", postText: TEXT, nativeId: "urn:li:activity:7506917720538558465", engagement: { reactions: 5, comments: 1, reposts: 0 } });
  });

  it("remember the server's usage count for the popup", async () => {
    await send(judgeMsg());
    expect(mem.local.usage).toMatchObject({ used: 1, limit: 250 });
  });

  it("are cached by the post's text, so the same post in another view costs no request or daily check", async () => {
    await send(judgeMsg({ urn: "post:carousel-key" }));
    const again = await send(judgeMsg({ urn: "urn:li:activity:7506917720538558465", text: `  ${TEXT.toUpperCase()}  ` }));
    expect(again.contentId).toBe("c".repeat(32));
    expect(judgeRequests()).toHaveLength(1);
  });

  it("refetches saved answers once the server's weights have changed, and not before", async () => {
    await send(judgeMsg({ urn: "post:wa", text: `${TEXT} Weights A.` })); // saved under v1
    await send(judgeMsg({ urn: "post:wa", text: `${TEXT} Weights A.` }));
    expect(judgeRequests()).toHaveLength(1); // served from the browser's copy
    respond = () => ({ status: 200, body: okVerdict({ weightsVersion: "v2" }) });
    await send(judgeMsg({ urn: "post:wb", text: `${TEXT} Weights B.` })); // the server now answers with new weights
    respond = () => ({ status: 200, body: okVerdict({ weightsVersion: "v2" }) });
    const again = await send(judgeMsg({ urn: "post:wa", text: `${TEXT} Weights A.` }));
    expect(again.weightsVersion).toBe("v2");
    expect(judgeRequests()).toHaveLength(3); // A was asked for again
    await send(judgeMsg({ urn: "post:wa", text: `${TEXT} Weights A.` }));
    expect(judgeRequests()).toHaveLength(3); // and is cached again under v2
    respond = () => ({ status: 200, body: okVerdict() });
  });

  it("asks again as soon as the post's engagement has grown a step, and not for smaller changes or a drop", async () => {
    const text = `${TEXT} Growing.`;
    const quiet = { reactions: 10, comments: 1, reposts: 0 };
    const loud = { reactions: 400, comments: 30, reposts: 8 };
    await send(judgeMsg({ urn: "post:g", text, engagement: quiet }));
    await send(judgeMsg({ urn: "post:g", text, engagement: { reactions: 11, comments: 1, reposts: 0 } }));
    expect(judgeRequests()).toHaveLength(1); // same step: the saved answer is used
    await send(judgeMsg({ urn: "post:g", text, engagement: { reactions: 4, comments: 0, reposts: 0 } }));
    expect(judgeRequests()).toHaveLength(1); // a lower reading is not growth
    respond = () => ({ status: 200, body: okVerdict({ shield: 0.5 }) });
    const again = await send(judgeMsg({ urn: "post:g", text, engagement: loud }));
    expect(judgeRequests()).toHaveLength(2); // grown a step: the server is asked (it decides whether Jev is)
    expect(again.shield).toBe(0.5);
    expect(judgeRequests()[1].body.engagement).toEqual(loud);
    await send(judgeMsg({ urn: "post:g", text, engagement: loud }));
    expect(judgeRequests()).toHaveLength(2); // and the new answer is saved at the new step
    respond = () => ({ status: 200, body: okVerdict() });
  });

  const manifestBody = (over: Record<string, unknown> = {}) => ({ version: "m2", ttlSeconds: 86400, thresholds: { aggressive: 0.15, moderate: 0.2, mild: 0.3 }, values: { maxAttempts: 2, minChars: 250 }, ...over });
  const manifestRequests = () => requests.filter((r) => r.url === `${SERVER}/api/v1/manifest`);

  it("fetches the server's manifest when an answer reports a version it doesn't have, and keeps it", async () => {
    respond = (req) => (req.url.endsWith("/manifest") ? { status: 200, body: manifestBody() } : { status: 200, body: okVerdict({ manifestVersion: "m2" }) });
    await send(judgeMsg({ text: `${TEXT} Manifest.` }));
    await tick(80);
    expect(manifestRequests()).toHaveLength(1);
    expect(mem.local.manifest).toMatchObject({ version: "m2", thresholds: { mild: 0.3 }, values: { minChars: 250, maxAttempts: 2 } });
    await send(judgeMsg({ text: `${TEXT} Manifest again.` }));
    await tick(80);
    expect(manifestRequests()).toHaveLength(1); // the answer's version is the one held now
    respond = () => ({ status: 200, body: okVerdict() });
  });

  it("asks for the manifest again once the saved one is a day old, and not before", async () => {
    respond = (req) => (req.url.endsWith("/manifest") ? { status: 200, body: manifestBody({ version: "m3" }) } : { status: 200, body: okVerdict() });
    await send({ type: "pageStart" });
    await tick(80);
    expect(manifestRequests()).toHaveLength(1); // there was none
    await send({ type: "pageStart" });
    await tick(80);
    expect(manifestRequests()).toHaveLength(1); // fresh
    mem.local.manifest.at -= 25 * 3600_000;
    await send({ type: "pageStart" });
    await tick(80);
    expect(manifestRequests()).toHaveLength(2);
    respond = () => ({ status: 200, body: okVerdict() });
  });

  it("ignores a manifest that is malformed or has thresholds out of order, keeping what it had", async () => {
    respond = (req) => (req.url.endsWith("/manifest") ? { status: 200, body: manifestBody({ thresholds: { aggressive: 0.5, moderate: 0.2, mild: 0.3 } }) } : { status: 200, body: okVerdict({ manifestVersion: "bad" }) });
    await send(judgeMsg({ text: `${TEXT} Bad manifest.` }));
    await tick(80);
    expect(mem.local.manifest).toBeUndefined();
    respond = () => ({ status: 200, body: okVerdict() });
  });

  it("refetches a cached answer that predates the server's private tell weights (no tellMean)", async () => {
    respond = () => ({ status: 200, body: okVerdict({ tellMean: undefined, tellRank: undefined }) });
    await send(judgeMsg({ urn: "post:old", text: `${TEXT} Old answer.` }));
    respond = () => ({ status: 200, body: okVerdict() });
    const again = await send(judgeMsg({ urn: "post:old", text: `${TEXT} Old answer.` }));
    expect(again.tellMean).toBe(0.3);
    expect(judgeRequests()).toHaveLength(2);
  });

  it("refetch a cached answer that predates the server registry (no contentId), so its votes can be shared", async () => {
    respond = () => ({ status: 200, body: okVerdict({ contentId: undefined }) });
    await send(judgeMsg());
    respond = () => ({ status: 200, body: okVerdict() });
    const r = await send(judgeMsg());
    expect(judgeRequests()).toHaveLength(2);
    expect(r.contentId).toBe("c".repeat(32));
  });

  it("retry a busy server with backoff, then succeed", async () => {
    let n = 0;
    respond = () => (++n === 1 ? { status: 503, body: { error: "upstream_busy", message: "busy" } } : { status: 200, body: okVerdict() });
    expect(await send(judgeMsg({ text: TEXT + " unique-1" }))).toMatchObject({ contentId: "c".repeat(32) });
    expect(judgeRequests()).toHaveLength(2);
  });

  it("give up on a permanent error without retrying, keeping the server's explanation", async () => {
    respond = () => ({ status: 422, body: { error: "invalid_input", message: "postText must be 20-6000 characters." } });
    expect(await send(judgeMsg({ text: TEXT + " unique-2" }))).toBeNull();
    expect(judgeRequests()).toHaveLength(1);
    expect((await send({ type: "myDebug" })).lastError).toMatch(/422.*20-6000/);
  });
});

describe("the daily limit", () => {
  const limited = (resetsAt: string) => ({
    status: 429,
    body: { error: "daily_limit", message: "used all", usage: { used: 250, limit: 250, remaining: 0, resetsAt } },
  });

  it("stops after one request (no retry storm), explains itself, and stops asking the server until it resets", async () => {
    respond = () => limited(new Date(Date.now() + 3 * 3600_000).toISOString());
    expect(await send(judgeMsg({ text: TEXT + " limit-1" }))).toBeNull();
    expect(judgeRequests()).toHaveLength(1);
    expect((await send({ type: "myDebug" })).lastError).toMatch(/Daily limit of 250 checks reached\. It resets at/);
    expect(mem.local.usage).toMatchObject({ used: 250, limit: 250, remaining: 0 });

    // Different posts while limited: answered locally, no requests.
    await send(judgeMsg({ text: TEXT + " limit-2" }));
    await send(judgeMsg({ text: TEXT + " limit-3" }));
    expect(judgeRequests()).toHaveLength(1);
  });

  it("still answers posts it already has, from the cache", async () => {
    await send(judgeMsg({ text: TEXT + " have-it" })); // scored before the limit was hit
    respond = () => limited(new Date(Date.now() + 3600_000).toISOString());
    await send(judgeMsg({ text: TEXT + " new-one" }));
    const before = judgeRequests().length;
    expect(await send(judgeMsg({ text: TEXT + " have-it" }))).toMatchObject({ contentId: "c".repeat(32) });
    expect(judgeRequests()).toHaveLength(before);
  });

  it("starts asking again once the reset time has passed", async () => {
    respond = () => limited(new Date(Date.now() + 3600_000).toISOString());
    await send(judgeMsg({ text: TEXT + " reset-1" }));
    mem.local.dailyLimit = { ...mem.local.dailyLimit, until: Date.now() - 1 }; // midnight has passed
    respond = () => ({ status: 200, body: okVerdict() });
    expect(await send(judgeMsg({ text: TEXT + " reset-2" }))).toMatchObject({ contentId: "c".repeat(32) });
  });
});

describe("sharing votes with the server", () => {
  const rec = (over: Record<string, unknown> = {}) => ({
    urn: "post:abc",
    network: "linkedin",
    contentId: "c".repeat(32),
    label: "probably",
    at: 1,
    text: TEXT,
    own: false,
    engagement: { reactions: 0, comments: 0, reposts: 0 },
    verdict: okVerdict(),
    decided: { level: "none", score: 0, mode: "hide", sensitivity: "moderate" },
    ...over,
  });

  it("posts a vote to the vote endpoint with this install's id, without making the vote wait", async () => {
    await send({ type: "vote", record: rec() });
    await tick();
    expect(voteRequests()).toHaveLength(1);
    expect(voteRequests()[0]).toMatchObject({ method: "POST", body: { network: "linkedin", contentId: "c".repeat(32), vote: "probably" } });
    expect(voteRequests()[0].headers["x-install-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(mem.local["label:post:abc"]).toMatchObject({ label: "probably" }); // saved in the browser first
  });

  it("sends a clear as a null vote, using the content id from the stored vote", async () => {
    await send({ type: "vote", record: rec() });
    await tick();
    await send({ type: "unvote", urn: "post:abc" });
    await tick();
    expect(voteRequests().at(-1)!.body).toEqual({ network: "linkedin", contentId: "c".repeat(32), vote: null });
    expect(mem.local["label:post:abc"]).toBeUndefined();
  });

  it("keeps a vote when the server is down and delivers it later, in order", async () => {
    respond = (r) => (r.url.endsWith("/vote") ? { status: 503, body: { error: "x" } } : { status: 200, body: okVerdict() });
    await send({ type: "vote", record: rec({ urn: "post:one", contentId: "1".repeat(32) }) });
    await tick();
    expect((mem.local.voteOutbox as unknown[]).length).toBe(1);
    respond = () => ({ status: 200, body: { community: { no: 0, maybe: 0, probably: 1, total: 1 }, yourVote: "probably" } });
    await send({ type: "vote", record: rec({ urn: "post:two", contentId: "2".repeat(32) }) });
    await tick();
    expect(voteRequests().slice(-2).map((r) => r.body.contentId)).toEqual(["1".repeat(32), "2".repeat(32)]);
    expect((mem.local.voteOutbox as unknown[]).length).toBe(0);
  });

  it("does not try to share a vote that has no content id (scored before the registry existed)", async () => {
    await send({ type: "vote", record: rec({ contentId: undefined }) });
    await tick();
    expect(voteRequests()).toHaveLength(0);
    expect(mem.local["label:post:abc"]).toBeTruthy();
  });
});

describe("the request queue under a fast scroll", () => {
  const post = (n: number, priority: number) => judgeMsg({ urn: `post:q${n}`, text: `${TEXT} Variant ${n}.`, priority });
  const texts = () => judgeRequests().map((r) => r.body.postText as string);
  let release = () => {};
  beforeEach(async () => {
    hold = null;
    await send(judgeMsg({ urn: "post:warm", text: `${TEXT} Warm-up.` })); // the server's answer tells the client how many requests it may run at once
    requests.length = 0;
    hold = new Promise<void>((r) => (release = r));
  });

  it("keeps four requests in flight, and gives every request a timeout so a hung one cannot hold a slot", async () => {
    const replies = Array.from({ length: 8 }, (_, i) => send(post(i, i)));
    await tick(150);
    expect(judgeRequests()).toHaveLength(4);
    expect(judgeRequests().every((r) => r.signal instanceof AbortSignal)).toBe(true);
    hold = null;
    release();
    expect((await Promise.all(replies)).every(Boolean)).toBe(true);
    expect(judgeRequests()).toHaveLength(8);
  });

  it("serves waiting posts nearest the viewport first, using where they are now rather than when they were queued", async () => {
    const replies = Array.from({ length: 4 }, (_, i) => send(post(i, i))); // fill every slot
    await tick(100);
    const late = [send(post(10, 100)), send(post(11, 200)), send(post(12, 300))];
    await tick(50);
    await send({ type: "prioritize", items: [{ urn: "post:q12", priority: 1 }, { urn: "post:q10", priority: 900 }] }); // the user scrolled
    hold = null;
    release();
    await Promise.all([...replies, ...late]);
    expect(texts().slice(4).map((t) => t.slice(-3))).toEqual(["12.", "11.", "10."]);
  });

  it("drops posts the user scrolled far past: they answer null without ever being sent, so they cost no check", async () => {
    const replies = Array.from({ length: 4 }, (_, i) => send(post(i, i)));
    await tick(100);
    const dropped = send(post(20, 500));
    const kept = send(post(21, 600));
    await tick(50);
    await send({ type: "prioritize", items: [{ urn: "post:q20", priority: null }] });
    expect(await dropped).toBeNull();
    hold = null;
    release();
    await Promise.all([...replies, kept]);
    expect(texts().some((t) => t.endsWith("Variant 20."))).toBe(false);
    expect(texts().some((t) => t.endsWith("Variant 21."))).toBe(true);
  });

  it("ignores hints about requests already in flight or unknown", async () => {
    const replies = Array.from({ length: 2 }, (_, i) => send(post(i, i)));
    await tick(80);
    await send({ type: "prioritize", items: [{ urn: "post:q0", priority: null }, { urn: "post:nope", priority: null }] });
    hold = null;
    release();
    expect((await Promise.all(replies)).every(Boolean)).toBe(true);
  });
});


describe("a busy server", () => {
  it("waits as long as the server's Retry-After asks before trying again", async () => {
    hold = null;
    let n = 0;
    const times: number[] = [];
    respond = () => {
      times.push(Date.now());
      return ++n === 1 ? { status: 503, body: { error: "upstream_busy", message: "busy" }, headers: { "retry-after": "1" } } : { status: 200, body: okVerdict() };
    };
    const r = await send(judgeMsg({ urn: "post:busy", text: `${TEXT} Busy probe.` }));
    expect(r).toMatchObject({ contentId: "c".repeat(32) });
    expect(times).toHaveLength(2);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(950); // not the default 500ms backoff
  });
});
