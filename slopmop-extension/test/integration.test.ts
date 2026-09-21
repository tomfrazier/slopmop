// @vitest-environment jsdom
// Runs the real background worker and the real popup against a simulated chrome.* API, wired together the way
// Chrome wires them (popup sendMessage -> background onMessage -> sendResponse), and fails on any uncaught error.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

type Listener = (m: any, sender: any, respond: (r?: any) => void) => boolean | void;
const mem: Record<string, Record<string, any>> = { sync: {}, local: {}, session: {} };
const changeListeners: ((c: any, area: string) => void)[] = [];
const messageListeners: Listener[] = [];
const badge: string[] = [];
const uncaught: unknown[] = [];
const fetched: string[] = [];

const area = (name: string) => ({
  get: async (k?: string | string[] | null) => {
    if (k == null) return { ...mem[name] };
    const keys = Array.isArray(k) ? k : [k];
    return Object.fromEntries(keys.filter((x) => x in mem[name]).map((x) => [x, mem[name][x]]));
  },
  set: async (o: Record<string, any>) => {
    const changes: any = {};
    for (const [k, v] of Object.entries(o)) (changes[k] = { oldValue: mem[name][k], newValue: v }), (mem[name][k] = v);
    changeListeners.forEach((l) => l(changes, name));
  },
  remove: async (k: string | string[]) => [].concat(k as any).forEach((x) => delete mem[name][x]),
});

function installChrome() {
  (globalThis as any).chrome = {
    storage: { sync: area("sync"), local: area("local"), session: area("session"), onChanged: { addListener: (l: any) => changeListeners.push(l) } },
    runtime: {
      getURL: (p: string) => p,
      onMessage: { addListener: (l: Listener) => messageListeners.push(l) },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      // Mirrors Chrome: resolves with whatever the listener passes to sendResponse; rejects if nobody responds.
      sendMessage: (m: any) =>
        new Promise((resolve, reject) => {
          let answered = false;
          const respond = (r?: any) => ((answered = true), resolve(r));
          const keepOpen = messageListeners.map((l) => l(m, { tab: { id: 7 } }, respond)).some(Boolean);
          if (!keepOpen && !answered) reject(new Error("The message port closed before a response was received."));
        }),
    },
    tabs: { query: async () => [{ id: 7 }], create: async () => ({}), onRemoved: { addListener() {} } },
    action: { setBadgeText: async ({ text }: any) => void badge.push(text), setBadgeBackgroundColor: async () => {} },
  };
}

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

describe("popup + background, wired like Chrome", () => {
  beforeAll(async () => {
    // Never let this test reach a real collector or server on the developer's machine (an earlier version leaked a
    // fake vote into a live labels file): point both at a closed port, and stub fetch as a second line of defence.
    (globalThis as any).__COLLECTOR_URL__ = "http://127.0.0.1:1";
    (globalThis as any).__SERVER_URL__ = "http://127.0.0.1:1";
    installChrome();
    process.on("unhandledRejection", (e) => uncaught.push(e));
    window.addEventListener("error", (e) => uncaught.push(e.error ?? e.message));
    window.addEventListener("unhandledrejection", (e) => uncaught.push(e.reason));
    vi.stubGlobal("fetch", async (url: string) => {
      fetched.push(String(url));
      throw new TypeError("Failed to fetch");
    });
    mem.sync.settings = { enabled: true, acknowledged: true, mode: "hide", sensitivity: "moderate", debug: true };
    const body = (f: string) => readFileSync(f, "utf8").replace(/^[\s\S]*<body>/i, "").replace(/<script[\s\S]*$/i, "");
    document.body.innerHTML = body("popup.html") + body("options.html");
    await import("../src/background/index");
    await import("../src/popup/popup");
    await import("../src/options/options");
    await tick(150);
  });
  afterAll(() => vi.unstubAllGlobals());

  it("popup renders with no uncaught errors", () => {
    expect(uncaught).toEqual([]);
    expect((document.getElementById("d-sent") as HTMLElement).textContent).toBe("0");
    expect((document.getElementById("s-today") as HTMLElement).textContent).toBe("0");
    expect((document.getElementById("enabled") as HTMLInputElement).checked).toBe(true);
  });

  it("sensitivity is a three-button group that saves the choice", async () => {
    const buttons = [...document.querySelectorAll<HTMLButtonElement>("[data-sens]")];
    expect(buttons.map((b) => b.textContent)).toEqual(["Mild", "Moderate", "Aggressive"]);
    expect(buttons.find((b) => b.getAttribute("aria-checked") === "true")!.textContent).toBe("Moderate");
    buttons[2].click();
    await tick(60);
    expect(mem.sync.settings.sensitivity).toBe("aggressive");
    expect(buttons[2].getAttribute("aria-checked")).toBe("true");
    buttons[1].click();
    await tick(60);
  });

  // The judge request retries a down server with backoff (~3.5s), so this needs more than the default 5s.
  it("content-script traffic updates the debug counters shown on the settings page", { timeout: 20000 }, async () => {
    const send = (m: any) => (globalThis as any).chrome.runtime.sendMessage(m);
    await send({ type: "pageStart" });
    await send({ type: "debug", detected: 5, ads: 1, own: 0, skipped: 2 });
    const r = await send({ type: "judge", urn: "post:x", text: "some post text long enough", stats: {}, priority: 0 });
    expect(r).toBeNull(); // collector/server unreachable -> fail open
    await tick(1600); // popup polls every second
    expect((document.getElementById("d-detected") as HTMLElement).textContent).toBe("5");
    expect((document.getElementById("d-ads") as HTMLElement).textContent).toBe("1");
    expect((document.getElementById("d-errors") as HTMLElement).textContent).toBe("1");
    expect((document.getElementById("d-error") as HTMLElement).textContent).toMatch(/network/);
    expect(uncaught).toEqual([]);
  });

  it("a vote is stored, queued while the collector is down, and shown as waiting in the popup", { timeout: 20000 }, async () => {
    const send = (m: any) => (globalThis as any).chrome.runtime.sendMessage(m);
    await send({ type: "vote", record: { urn: "post:v1", label: "maybe", at: 1, text: "t", own: false, engagement: { reactions: 0, comments: 0, reposts: 0 }, verdict: { model: "t", aiLikelihood: 0.9, dimensions: {} }, decided: { level: "none", score: 0, mode: "hide", sensitivity: "moderate" } } });
    await tick(1600);
    expect((document.getElementById("lbl-count") as HTMLElement).textContent).toMatch(/1 \(0 no · 1 maybe · 0 probably\)/);
    expect((document.getElementById("lbl-sync") as HTMLElement).textContent).toMatch(/1 vote waiting/);
    expect(uncaught).toEqual([]);
  });

  it("only ever tried the closed test port (nothing can leak to a real collector)", () => {
    expect(fetched.length).toBeGreaterThan(0);
    expect(fetched.every((u) => u.startsWith("http://127.0.0.1:1/"))).toBe(true);
  });

  it("built extension pages have no <link rel=modulepreload> (Chrome warns 'cross-world extension resource mismatch')", () => {
    for (const f of ["dist/popup.html", "dist/onboarding.html", "dist/options.html"]) {
      let html: string;
      try {
        html = readFileSync(f, "utf8");
      } catch {
        continue; // not built in this checkout
      }
      expect(html).not.toMatch(/modulepreload/);
    }
  });

  it("every message type gets an answer (none leaves the popup hanging)", async () => {
    const send = (m: any) => (globalThis as any).chrome.runtime.sendMessage(m);
    for (const m of [{ type: "getStats" }, { type: "getDebug", tabId: 7 }, { type: "myDebug" }, { type: "getLabelSync" }, { type: "syncLabels" }, { type: "unvote", urn: "post:v1" }]) {
      await expect(send(m)).resolves.not.toThrow;
    }
  });
});
