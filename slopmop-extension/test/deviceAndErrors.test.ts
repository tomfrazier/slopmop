// @vitest-environment jsdom
// The device id and the clearer failures: what the popup shows a user, and what the background says when the server says no.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mem: Record<string, any> = {};
let sets = 0;
(globalThis as any).chrome = {
  storage: {
    local: {
      get: async (k?: string | string[]) => (k == null ? { ...mem } : Object.fromEntries((Array.isArray(k) ? k : [k]).filter((x) => x in mem).map((x) => [x, mem[x]]))),
      set: async (o: Record<string, any>) => (sets++, void Object.assign(mem, o)),
      remove: async (k: string) => void delete mem[k],
    },
    session: { get: async () => ({}), set: async () => {} },
    sync: { get: async () => ({}), set: async () => {} },
    onChanged: { addListener() {} },
  },
  runtime: { getManifest: () => ({ version: "9.9.9" }), getURL: (p: string) => p },
};
(globalThis as any).__SERVER_URL__ = "https://api.example.test";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const failure = await import("../src/background/judgeFailure");
const { noteProblem, clearProblem } = await import("../src/background/problem");
const { refreshUsage } = await import("../src/background/usage");
const { supportText, paintDevice } = await import("../src/popup/device");

beforeEach(() => {
  for (const k of Object.keys(mem)) delete mem[k];
  sets = 0;
});

describe("what a failure says", () => {
  it("a bare 404 says where we asked and what it usually means", async () => {
    const r = await failure.interpretFailure(new Response("The page could not be found", { status: 404 }), 1000);
    expect(r).toMatchObject({ kind: "stop" });
    expect((r as { error: string }).error).toMatch(/server 404: https:\/\/api\.example\.test\/api\/v1 has no such page.*wrong server address/);
  });

  it("a 404 the server itself explained keeps the server's words", async () => {
    const r = await failure.interpretFailure(json(404, { error: "unknown_content", message: "That content hasn't been checked yet." }), 1000);
    expect((r as { error: string }).error).toBe("server 404: That content hasn't been checked yet.");
  });

  it("a VPN or cloud network gets a plain instruction, and no retry", async () => {
    const r = await failure.interpretFailure(json(403, { error: "datacenter_ip", message: "Requests from cloud or hosting-provider IP ranges aren't accepted." }), 1000);
    expect(r).toMatchObject({ kind: "stop" });
    expect((r as { error: string }).error).toMatch(/VPN off/);
  });

  it("an hourly limit on the network stops asking until the server says it is over", async () => {
    const r = await failure.interpretFailure(json(429, { error: "ip_rate_limited", message: "x" }, { "retry-after": "1800" }), 1000);
    expect(r).toMatchObject({ kind: "stop" });
    expect((r as { error: string }).error).toMatch(/Too many checks from your network.*30 min/);
    expect(mem.cooldown.message).toMatch(/30 min/);
    expect(mem.cooldown.until).toBeGreaterThan(Date.now() + 1700_000);
    expect(mem.cooldown.until).toBeLessThanOrEqual(Date.now() + 1800_000);
  });
});

describe("the last problem", () => {
  it("is saved when something goes wrong and cleared by the next success, writing nothing on ordinary successes", async () => {
    await clearProblem();
    await clearProblem();
    expect(sets).toBe(0); // nothing stored, nothing written
    await noteProblem("server 503: busy");
    expect(mem.lastProblem).toMatchObject({ message: "server 503: busy" });
    await clearProblem();
    expect(mem.lastProblem).toBeUndefined();
    const writes = sets;
    await clearProblem();
    expect(sets).toBe(writes);
  });
});

describe("the device id", () => {
  it("is asked for without spending a check, and saved with the usage the popup already shows", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init: any) => {
      seen.push(`${init?.method ?? "GET"} ${url}`);
      return json(200, { used: 4, limit: 1000, remaining: 996, resetsAt: "2026-09-24T00:00:00.000Z", device: "a1b2c3d4" });
    });
    await refreshUsage();
    expect(seen).toEqual(["GET https://api.example.test/api/v1/usage"]);
    expect(mem.usage).toMatchObject({ used: 4, limit: 1000, device: "a1b2c3d4" });
    vi.unstubAllGlobals();
  });

  it("changes nothing when something other than the server answers", async () => {
    vi.stubGlobal("fetch", async () => new Response("<!DOCTYPE html><html></html>", { status: 200, headers: { "content-type": "text/html" } }));
    await refreshUsage();
    expect(mem.usage).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it("goes into the support text with the version, server and last problem", () => {
    expect(supportText("a1b2c3d4", { at: Date.now() - 120_000, message: "server 404" })).toBe("Slop Mop 9.9.9\nDevice: a1b2c3d4\nServer: https://api.example.test\nLast problem: server 404 (2 min ago)");
    expect(supportText(undefined, undefined)).toMatch(/Device: not known yet\nServer: .*\nLast problem: none$/);
  });

  it("shows on the popup, faint, with a recent problem underneath; an old one is left out", async () => {
    document.body.innerHTML = '<button id="device"></button><p id="problem" hidden></p>';
    await chrome.storage.local.set({ usage: { used: 1, limit: 250, remaining: 249, resetsAt: "x", device: "a1b2c3d4" }, lastProblem: { at: Date.now() - 60_000, message: "server 404" } });
    await paintDevice();
    expect(document.getElementById("device")!.textContent).toBe("Device a1b2c3d4");
    expect(document.getElementById("problem")!.hidden).toBe(false);
    expect(document.getElementById("problem")!.textContent).toMatch(/Last problem \(1 min ago\): server 404/);
    await chrome.storage.local.set({ lastProblem: { at: Date.now() - 3 * 3600_000, message: "old" } });
    await paintDevice();
    expect(document.getElementById("problem")!.hidden).toBe(true);
  });

  it("shows a dash until the server has told us", async () => {
    document.body.innerHTML = '<button id="device"></button><p id="problem" hidden></p>';
    await paintDevice();
    expect(document.getElementById("device")!.textContent).toBe("Device –");
  });
});
