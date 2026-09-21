// @vitest-environment jsdom
// A normal build (no SLOPMOP_COLLECTOR_URL) has no developer collector: nothing is sent to localhost, votes still go to the server.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";

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
const fetched: string[] = [];
const send = (m: any) => (globalThis as any).chrome.runtime.sendMessage(m);
const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  (globalThis as any).__SERVER_URL__ = SERVER;
  delete (globalThis as any).__COLLECTOR_URL__; // and "" (what the build defines when the variable is unset) is the same
  vi.stubGlobal("fetch", async (url: string) => {
    fetched.push(String(url));
    return new Response("{}", { status: 200 });
  });
  await import("../src/background/index");
});

describe("without a developer collector", () => {
  it("has no collector configured, whether the define is missing or empty", async () => {
    vi.resetModules();
    expect((await import("../src/shared/config")).COLLECTOR_URL).toBeNull();
    (globalThis as any).__COLLECTOR_URL__ = "";
    vi.resetModules();
    expect((await import("../src/shared/config")).COLLECTOR_URL).toBeNull();
    (globalThis as any).__COLLECTOR_URL__ = "http://localhost:8788";
    vi.resetModules();
    expect((await import("../src/shared/config")).COLLECTOR_URL).toBe("http://localhost:8788");
    delete (globalThis as any).__COLLECTOR_URL__;
  });

  it("shares a vote with the server only, and reports no file sync", async () => {
    await send({ type: "vote", record: { urn: "post:a", network: "linkedin", contentId: "c".repeat(32), label: "probably", at: 1, text: "t", own: false, engagement: { reactions: 0, comments: 0, reposts: 0 }, verdict: { model: "t", aiLikelihood: 0.9, dimensions: {} }, decided: { level: "none", score: 0, mode: "hide", sensitivity: "moderate" } } });
    await send({ type: "unvote", urn: "post:a" });
    await tick(100);
    expect(fetched.length).toBeGreaterThan(0);
    expect(fetched.every((u) => u === `${SERVER}/api/v1/vote`)).toBe(true);
    expect(await send({ type: "getLabelSync" })).toBeNull();
    expect(await send({ type: "syncLabels" })).toBeNull();
    expect(mem.local.labelOutbox).toBeUndefined(); // no queue building up for a collector that doesn't exist
  });

  it("the build asks for the server's origin only, unless a collector was requested", () => {
    const src = readFileSync("scripts/build.mjs", "utf8");
    expect(src).toMatch(/collectorUrl = process\.env\.SLOPMOP_COLLECTOR_URL \?\? ""/);
    expect(src).toMatch(/host_permissions: \[origin, \.\.\.\(collectorUrl \?/);
  });
});
