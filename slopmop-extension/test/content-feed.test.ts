// @vitest-environment jsdom
// A characterization test of the whole content script on a simulated feed: it finds posts, asks for verdicts, shows the
// vote icon, outlines or folds, skips ads, follows setting changes and records votes. It pins today's behaviour so the
// content script can be reorganised safely.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (changes: Record<string, { newValue?: unknown }>, area: string) => void;
const mem: Record<string, Record<string, any>> = { sync: {}, local: {}, session: {} };
let storageListeners: Listener[] = [];
let sent: any[] = [];
let judgeAnswer: (m: any) => any;

const area = (name: string) => ({
  get: async (k?: string | string[] | null) => {
    if (k == null) return { ...mem[name] };
    const keys = Array.isArray(k) ? k : [k];
    return Object.fromEntries(keys.filter((x) => x in mem[name]).map((x) => [x, mem[name][x]]));
  },
  set: async (o: Record<string, any>) => {
    Object.assign(mem[name], o);
    for (const l of storageListeners) l(Object.fromEntries(Object.keys(o).map((k) => [k, { newValue: o[k] }])), name);
  },
  remove: async (k: string | string[]) => [].concat(k as any).forEach((x) => delete mem[name][x]),
});

const IDS = ["contrastFraming", "emptyEvaluation", "tradeoffFreePromises", "formalHedging", "hypeMarketing", "manneredProse", "formulaicHook", "manufacturedNarrative", "engagementBait"];
const verdict = (level: number, ai = 0.95) => ({
  model: "jev",
  aiLikelihood: ai,
  dimensions: { ...Object.fromEntries(IDS.map((id) => [id, { value: level, confidence: 0.9 }])), humanVoice: { value: 0.1, confidence: 0.9 }, usefulness: { value: 0.1, confidence: 0.9 } },
  tellMean: level,
  tellRank: IDS,
  weightsVersion: "v1",
  network: "linkedin",
  contentId: "c".repeat(32),
  cached: false,
  community: { no: 0, maybe: 0, probably: 0, total: 0 },
});

const TEXT = "We finally shipped the billing migration last Thursday and I think it is the best thing that our team has done in the last year. ".repeat(3);
const card = (key: string, extra = "") => `<div role="listitem" componentkey="update-card-focus${key}">
  <div><button aria-label="Open control menu for post by Someone Else"></button></div>
  <p><span data-testid="expandable-text-box">${TEXT}</span></p><span>34 reactions</span>${extra}</div>`;
const AD = '<svg aria-label="View Sponsored Content"></svg>';

const tick = (ms = 40) => new Promise((r) => globalThis.setTimeout(r, ms));
const $ = (sel: string, root: ParentNode = document) => root.querySelector(sel) as HTMLElement | null;
const judgeMessages = () => sent.filter((m) => m.type === "judge");
const menu = () => $("[data-slopmop-menu]")?.shadowRoot?.querySelector(".menu") as HTMLElement | undefined;

const realMO = globalThis.MutationObserver;
let mutationObservers: MutationObserver[] = [];
// The script's own timers (rescans, retries) are cancelled between tests so one test's script can't act on the next page.
const realSetTimeout = window.setTimeout.bind(window);
let scriptTimers: number[] = [];

beforeEach(() => {
  for (const k of Object.keys(mem)) mem[k] = {};
  storageListeners = [];
  sent = [];
  judgeAnswer = () => verdict(0.9);
  mem.sync.settings = { enabled: true, acknowledged: true, mode: "highlight", sensitivity: "moderate", debug: false };
  (globalThis as any).chrome = {
    storage: { sync: area("sync"), local: area("local"), session: area("session"), onChanged: { addListener: (l: Listener) => storageListeners.push(l) } },
    runtime: {
      id: "test-extension", // present while the extension is installed; chrome removes it when the extension is reloaded
      getURL: (p: string) => p,
      sendMessage: async (m: any) => {
        sent.push(m);
        if (m.type === "judge") return judgeAnswer(m);
        if (m.type === "getStats" || m.type === "record") return { hidden: { today: 0, week: 0, month: 0, allTime: 0, record: 0 }, flagged: { today: 0, week: 0, month: 0, allTime: 0, record: 0 } };
        if (m.type === "myDebug") return { lastError: null };
        return undefined;
      },
    },
  };
  // Posts count as in view as soon as they are watched.
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(private cb: (e: any[]) => void) {}
      observe(el: Element) {
        this.cb([{ isIntersecting: true, target: el, boundingClientRect: { top: 100 } }]);
      }
      unobserve() {}
      disconnect() {}
    },
  );
  // Keep track of the script's feed watchers so one test's script can't act on the next test's page.
  mutationObservers = [];
  vi.stubGlobal("MutationObserver", class extends realMO { constructor(cb: MutationCallback) { super(cb); mutationObservers.push(this); } });
  vi.stubGlobal("alert", () => {});
  scriptTimers = [];
  vi.spyOn(window, "setTimeout").mockImplementation(((fn: TimerHandler, ms?: number, ...args: unknown[]) => {
    const id = realSetTimeout(fn, ms, ...args);
    scriptTimers.push(id);
    return id;
  }) as typeof window.setTimeout);
});
afterEach(() => {
  mutationObservers.forEach((o) => o.disconnect());
  scriptTimers.forEach((id) => window.clearTimeout(id));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

/** Puts a feed on the page and starts the content script on it. */
async function openFeed(html: string) {
  document.body.innerHTML = `<main>${html}</main>`;
  vi.resetModules();
  await import("../src/content/index");
  await tick(80);
}

describe("the composer's 'check this draft' button", () => {
  const composer = readFileSync(resolve(import.meta.dirname, "fixtures/linkedin-composer.html"), "utf8");
  const btnHost = () => $("[data-slopmop-composer]");
  const btn = () => btnHost()!.shadowRoot!.querySelector("button") as HTMLButtonElement;
  const editor = () => $('[role="textbox"]') as HTMLElement;
  const panelText = () => $("[data-slopmop-inspector]")?.shadowRoot?.querySelector(".panel")?.textContent ?? "";
  const write = (s: string) => (editor().innerHTML = `<p>${s}</p>`);
  const DRAFT = "We're thrilled to announce that we have reimagined the way teams collaborate, unlocking value at every layer of the organisation.";

  it("floats inside the dialog, once, and never inside LinkedIn's toolbar; and only while the composer is open", async () => {
    await openFeed(composer);
    expect(document.querySelectorAll("[data-slopmop-composer]")).toHaveLength(1);
    expect(btnHost()!.parentElement).toBe($("dialog")); // a child of the dialog itself, not a sibling of any toolbar button
    expect(btnHost()!.closest(".toolbar")).toBeNull();
    expect(btnHost()!.style.position).toBe("absolute");
    expect(btn().getAttribute("aria-label")).toBe("Check this draft with Slop Mop");
    document.body.append(document.createElement("i")); // page changes rescan
    await tick(400);
    expect(document.querySelectorAll("[data-slopmop-composer]")).toHaveLength(1);
    ($("dialog") as HTMLDialogElement).removeAttribute("open");
    document.body.append(document.createElement("i"));
    await tick(400);
    expect(btnHost()).toBeNull();
  });

  it("does not change LinkedIn's toolbar at all, however the toolbar collapses", async () => {
    // LinkedIn folds the toolbar down to a single icon for a long draft; the button must not sit in, or on, it.
    const collapsed = composer.replace(/<div><div><button aria-label="Media"[\s\S]*?<\/div><div><button aria-label="Expand content types" type="button"><\/button><\/div><\/div>/, "");
    expect(collapsed).not.toBe(composer); // the fixture really lost its Media and + buttons
    await openFeed(collapsed);
    const toolbar = $(".toolbar")!;
    const before = toolbar.innerHTML;
    document.body.append(document.createElement("i"));
    await tick(400);
    expect(toolbar.innerHTML).toBe(before);
    expect(toolbar.querySelector("[data-slopmop-composer]")).toBeNull();
    expect(document.querySelectorAll("[data-slopmop-composer]")).toHaveLength(1);
  });

  it("sits just left of the row that holds Post, at the row's height, and follows it when the dialog changes", async () => {
    const rect = (l: number, t: number, w: number, h: number) => ({ left: l, top: t, width: w, height: h, right: l + w, bottom: t + h, x: l, y: t, toJSON: () => ({}) }) as DOMRect;
    const spy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      if (this.tagName === "DIALOG") return rect(267, 32, 800, 640);
      if (this.tagName === "BUTTON" && (this.textContent ?? "").trim() === "Post") return rect(947, 608, 82, 48);
      if (this.className === "footer") return rect(847, 608, 181, 48); // the group holding the schedule control and Post
      if (this.getAttribute?.("aria-label") === "Dismiss") return rect(1024, 44, 32, 32);
      return rect(0, 0, 0, 0);
    });
    try {
      await openFeed(composer);
      // The group around Post (schedule control + Post) starts at x 847 (580 inside the dialog): the button goes 48 + 8 to its left.
      expect(btnHost()!.style.left).toBe(`${847 - 267 - 48 - 8}px`);
      expect(btnHost()!.style.top).toBe(`${608 - 32}px`);
    } finally {
      spy.mockRestore();
    }
  });

  it("is not there when the extension is switched off", async () => {
    mem.sync.settings = { ...mem.sync.settings, enabled: false };
    await openFeed(composer);
    expect(btnHost()).toBeNull();
  });

  it("asks for a little more text, and sends nothing, when the draft is too short", async () => {
    await openFeed(composer);
    write("Hi");
    btn().click();
    await tick(60);
    expect(judgeMessages()).toHaveLength(0);
    expect(panelText()).toMatch(/Write a little more first/);
  });

  it("scores the draft as your own writing and shows the breakdown, marked as a draft, with the check it used", async () => {
    judgeAnswer = () => ({ ...verdict(0.6), usage: { used: 12, limit: 250, remaining: 238, resetsAt: "2099-01-01T00:00:00Z" } });
    await openFeed(composer);
    write(DRAFT);
    btn().click();
    await tick(120);
    expect(judgeMessages()).toHaveLength(1);
    expect(judgeMessages()[0]).toMatchObject({ text: DRAFT, engagement: { reactions: 0, comments: 0, reposts: 0 } });
    expect(String(judgeMessages()[0].urn)).toMatch(/^draft:/);
    expect(panelText()).toMatch(/Draft\. Not posted yet/);
    expect(panelText()).toMatch(/This used one check \(12 of 250 today\)/);
    expect(panelText()).toMatch(/Likely slop|Possibly slop|Reads clean/);
    expect(panelText()).toMatch(/The Slopprint/);
  });

  it("lifts the panel into the browser's top layer, above the modal and its dimmed backdrop, and puts it back afterwards", async () => {
    // The composer is a modal <dialog> (top layer); a normal page element can never be drawn above it whatever its z-index. jsdom has no
    // popover API, so stand in for it and check the panel host is shown as a popover after the dialog, and hidden when it closes.
    const shown: Element[] = [];
    const hidden: Element[] = [];
    Object.defineProperty(HTMLElement.prototype, "showPopover", { configurable: true, value(this: Element) { shown.push(this); } });
    Object.defineProperty(HTMLElement.prototype, "hidePopover", { configurable: true, value(this: Element) { hidden.push(this); } });
    try {
      judgeAnswer = () => verdict(0.6);
      await openFeed(composer);
      write(DRAFT);
      btn().click(); // the button is inside a shadow root: closest("dialog") can't see out of it
      await tick(120);
      const host = $("[data-slopmop-inspector]")!;
      expect(shown).toEqual([host]);
      expect(host.getAttribute("popover")).toBe("manual");
      btn().click(); // put away
      await tick(30);
      expect(hidden).toEqual([host]);
      expect(host.hasAttribute("popover")).toBe(false);
      btn().click(); // and again: lifted again, above anything opened meanwhile
      await tick(120);
      expect(shown).toEqual([host, host]);
    } finally {
      delete (HTMLElement.prototype as any).showPopover;
      delete (HTMLElement.prototype as any).hidePopover;
    }
  });

  it("does not lift a panel that isn't over a modal (an ordinary hover panel stays in the page)", async () => {
    const shown: Element[] = [];
    Object.defineProperty(HTMLElement.prototype, "showPopover", { configurable: true, value(this: Element) { shown.push(this); } });
    try {
      await openFeed(card("a"));
      ($("[data-slopmop-vote]")!.shadowRoot!.querySelector("button") as HTMLElement).click();
      await tick(100);
      expect(shown).toEqual([]);
    } finally {
      delete (HTMLElement.prototype as any).showPopover;
    }
  });

  it("puts the panel away on a second press, on Escape, or a click elsewhere, and can be pressed again", async () => {
    judgeAnswer = () => verdict(0.6);
    await openFeed(composer);
    write(DRAFT);
    btn().click();
    await tick(120);
    expect(panelText()).not.toBe("");
    btn().click(); // second press
    await tick(30);
    expect(panelText()).toBe("");
    btn().click();
    await tick(120);
    expect(panelText()).not.toBe("");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await tick(30);
    expect(panelText()).toBe("");
    btn().click();
    await tick(120);
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    await tick(30);
    expect(panelText()).toBe("");
  });

  it("says why when the server can't check it, instead of failing silently", async () => {
    judgeAnswer = () => null;
    await openFeed(composer);
    write(DRAFT);
    btn().click();
    await tick(120);
    expect(panelText()).toMatch(/Couldn't check this draft/);
  });

  it("closes the breakdown when the composer closes", async () => {
    judgeAnswer = () => verdict(0.6);
    await openFeed(composer);
    write(DRAFT);
    btn().click();
    await tick(120);
    ($("dialog") as HTMLDialogElement).removeAttribute("open");
    await tick(60);
    expect(panelText()).toBe("");
  });
});

describe("a slow or silent background worker", () => {
  it("does not keep the mop icon (or the border on your own posts) from appearing", async () => {
    const original = (globalThis as any).chrome.runtime.sendMessage;
    (globalThis as any).chrome.runtime.sendMessage = async (m: any) => (m.type === "getStats" || m.type === "pageStart" ? new Promise(() => {}) : original(m));
    await openFeed(card("a"));
    expect($("[data-slopmop-vote]")).not.toBeNull();
  });
});

describe("the content script on LinkedIn's older post markup (your activity page, single-post pages)", () => {
  const legacy = readFileSync(resolve(import.meta.dirname, "fixtures/linkedin-legacy-post.html"), "utf8");
  const rail = '<a href="/in/tomfrazier/"><img alt="Tom Frazier" src="x"></a>';

  it("finds your own post there, puts the mop icon beside its menu, and outlines it", async () => {
    judgeAnswer = () => verdict(0.1);
    await openFeed(rail + legacy);
    expect(judgeMessages()).toHaveLength(1);
    const post = $("[data-urn]") as HTMLElement;
    expect($("[data-slopmop-vote]", post)).not.toBeNull();
    expect(post.style.boxShadow).not.toBe(""); // your own posts always get a coloured border
  });

  it("still recognises your own post when the extension has learned the wrong name", async () => {
    mem.local.ownName = "Someone Else";
    judgeAnswer = () => verdict(0.1);
    await openFeed(rail + legacy);
    expect(($("[data-urn]") as HTMLElement).style.boxShadow).not.toBe("");
  });

  it("does the same when the extension can't tell whose post it is (no left rail on the page)", async () => {
    judgeAnswer = () => verdict(0.1);
    await openFeed(legacy);
    const post = $("[data-urn]") as HTMLElement;
    expect($("[data-slopmop-vote]", post)).not.toBeNull();
    expect(judgeMessages()).toHaveLength(1);
    expect(post.style.boxShadow).not.toBe(""); // its author line says "• You", so it is still treated as your own post
  });
});

describe("the content script on a feed", () => {
  it("asks again when a post's reaction count grows a step, and keeps the old answer if the new one fails", async () => {
    await openFeed(card("g"));
    expect(judgeMessages()).toHaveLength(1);
    const counts = $("[data-testid=expandable-text-box]")!.closest("[role=listitem]")!.querySelector("span:not([data-testid])") as HTMLElement;
    counts.textContent = "35 reactions"; // still the same step
    document.body.append(document.createElement("i")); // a page change makes the script rescan
    await tick(700);
    expect(judgeMessages()).toHaveLength(1);
    judgeAnswer = () => null; // the server is unavailable for the recheck
    counts.textContent = "900 reactions";
    document.body.append(document.createElement("i"));
    await tick(700);
    expect(judgeMessages()).toHaveLength(2);
    expect(judgeMessages()[1].engagement.reactions).toBe(900);
    expect($("[data-slopmop-menu]")).toBeNull(); // nothing broke: the post keeps the answer it had
    expect([...document.querySelectorAll("[role=listitem]")][0]).toBeTruthy();
  });

  it("uses the thresholds the server sent, and redraws when they change", async () => {
    judgeAnswer = () => verdict(0.3); // a middling post: score about 0.4
    mem.local.manifest = { version: "a", values: {}, thresholds: { aggressive: 0.9, moderate: 0.95, mild: 0.99 }, at: Date.now(), ttlMs: 86400000 }; // so high that nothing is flagged
    await openFeed(card("t"));
    const post = () => $('[role="listitem"]') as HTMLElement;
    expect(post().style.boxShadow).toBe(""); // not flagged under the server's thresholds
    await (globalThis as any).chrome.storage.local.set({ manifest: { version: "b", values: {}, thresholds: { aggressive: 0.1, moderate: 0.15, mild: 0.2 }, at: Date.now(), ttlMs: 86400000 } });
    await tick(60);
    expect(post().style.boxShadow).toMatch(/217, 48, 37|d93025/i); // the server lowered them: now flagged red
  });

  it("checks a post, puts the vote icon beside it, and outlines it red when it reads as slop (Highlight mode)", async () => {
    await openFeed(card("a"));
    expect(judgeMessages()).toHaveLength(1);
    expect(judgeMessages()[0]).toMatchObject({ type: "judge", stats: expect.objectContaining({ wordCount: expect.any(Number) }), engagement: { reactions: 34 } });
    expect(judgeMessages()[0].text).toContain("billing migration");
    expect($("[data-slopmop-vote]")).not.toBeNull();
    const post = $('[role="listitem"]')!;
    expect(post.style.boxShadow).toMatch(/217, 48, 37|d93025/i);
    expect($("[data-slopmop-fold]")).toBeNull(); // Highlight mode never hides
  });

  it("leaves a post that reads clean alone (no outline), but still gives it the vote icon", async () => {
    judgeAnswer = () => verdict(0.02);
    await openFeed(card("a"));
    expect($('[role="listitem"]')!.style.boxShadow).toBe("");
    expect($("[data-slopmop-vote]")).not.toBeNull();
  });

  it("folds a slop post away in Hide mode", async () => {
    mem.sync.settings.mode = "hide";
    await openFeed(card("a"));
    expect($("[data-slopmop-fold]")).not.toBeNull();
    expect($('[role="listitem"]')!.hasAttribute("data-slopmop-hidden")).toBe(true);
    expect(sent.some((m) => m.type === "record" && m.kind === "hidden")).toBe(true);
  });

  it("never sends, hides, outlines or adds an icon to an ad", async () => {
    mem.sync.settings.mode = "hide";
    await openFeed(card("ad", AD));
    expect(judgeMessages()).toHaveLength(0);
    expect($("[data-slopmop-vote]")).toBeNull();
    expect($("[data-slopmop-fold]")).toBeNull();
  });

  it("does nothing while the extension is switched off", async () => {
    mem.sync.settings.enabled = false;
    await openFeed(card("a"));
    expect(judgeMessages()).toHaveLength(0);
    expect($("[data-slopmop-vote]")).toBeNull();
  });

  it("picks up posts that load later as the feed grows", async () => {
    await openFeed(card("a"));
    document.querySelector("main")!.insertAdjacentHTML("beforeend", card("b").replace("billing migration", "quarterly planning"));
    await tick(400); // the script rescans shortly after the page changes
    expect(judgeMessages().map((m) => m.text)).toEqual(expect.arrayContaining([expect.stringContaining("quarterly planning")]));
    expect(document.querySelectorAll("[data-slopmop-vote]")).toHaveLength(2);
  });

  it("follows a settings change made in the popup: switching to Hide folds the post, switching off removes everything", async () => {
    await openFeed(card("a"));
    expect($("[data-slopmop-fold]")).toBeNull();
    await chrome.storage.sync.set({ settings: { ...mem.sync.settings, mode: "hide" } });
    await tick(60);
    expect($("[data-slopmop-fold]")).not.toBeNull();
    await chrome.storage.sync.set({ settings: { ...mem.sync.settings, enabled: false } });
    await tick(60);
    expect($("[data-slopmop-fold]")).toBeNull();
    expect($("[data-slopmop-vote]")).toBeNull();
    expect($('[role="listitem"]')!.style.boxShadow).toBe("");
  });

  it("recolours an outline when a settings change moves a post from 'possibly' to 'likely'", async () => {
    judgeAnswer = () => verdict(0.1); // scores between the yellow and red lines at Moderate
    await openFeed(card("a"));
    const post = $('[role="listitem"]')!;
    expect(post.style.boxShadow).toMatch(/245, 180, 0|f5b400/i); // yellow: possibly
    await chrome.storage.sync.set({ settings: { ...mem.sync.settings, sensitivity: "aggressive" } });
    await tick(60);
    expect(post.style.boxShadow).toMatch(/217, 48, 37|d93025/i); // red: likely
  });

  it("records a vote from the mop menu, and the vote replaces the score for what is shown", async () => {
    judgeAnswer = () => verdict(0.02); // scored clean
    await openFeed(card("a"));
    ($("[data-slopmop-vote]")!.shadowRoot!.querySelector("button") as HTMLElement).click();
    await tick(60);
    expect(menu()).toBeDefined();
    (menu()!.querySelector('button[data-v="probably"]') as HTMLElement).click();
    await tick(80);
    const vote = sent.find((m) => m.type === "vote");
    expect(vote.record).toMatchObject({ label: "probably", contentId: "c".repeat(32), network: "linkedin" });
    expect($('[role="listitem"]')!.style.boxShadow).toMatch(/217, 48, 37|d93025/i); // "probably" is a red border
  });

  it("voting 'probably' in Hide mode hides the post", async () => {
    mem.sync.settings.mode = "hide";
    judgeAnswer = () => verdict(0.02);
    await openFeed(card("a"));
    expect($("[data-slopmop-fold]")).toBeNull();
    ($("[data-slopmop-vote]")!.shadowRoot!.querySelector("button") as HTMLElement).click();
    await tick(60);
    (menu()!.querySelector('button[data-v="probably"]') as HTMLElement).click();
    await tick(80);
    expect($("[data-slopmop-fold]")).not.toBeNull();
  });

  it("stays quiet when the server can't be reached, and doesn't outline or fold", async () => {
    judgeAnswer = () => null;
    mem.sync.settings.mode = "hide";
    await openFeed(card("a"));
    expect($("[data-slopmop-fold]")).toBeNull();
    expect($('[role="listitem"]')!.style.boxShadow).toBe("");
    expect($("[data-slopmop-vote]")).not.toBeNull(); // you can still open the menu
  });

  it("tells the extension how many posts it has seen (for the debug counters)", async () => {
    await openFeed(card("a") + card("ad", AD));
    const debug = sent.filter((m) => m.type === "debug").pop();
    expect(debug).toMatchObject({ detected: 1, ads: 1 });
  });

  it("shuts down quietly when the extension is reloaded under an open page, and leaves the page as LinkedIn made it", async () => {
    mem.sync.settings.mode = "hide";
    await openFeed(card("a"));
    expect($("[data-slopmop-fold]")).not.toBeNull();
    const judged = judgeMessages().length;

    // Chrome cuts the old script off: the runtime id disappears and every message throws.
    (chrome.runtime as any).id = undefined;
    chrome.runtime.sendMessage = async () => {
      throw new Error("Extension context invalidated.");
    };
    document.querySelector("main")!.insertAdjacentHTML("beforeend", card("b").replace("billing migration", "quarterly planning"));
    await tick(400); // the next rescan finds the extension gone

    expect($("[data-slopmop-fold]")).toBeNull(); // what it drew is removed...
    expect($("[data-slopmop-vote]")).toBeNull();
    expect($('[role="listitem"]')!.hasAttribute("data-slopmop-hidden")).toBe(false); // ...and the post is visible again
    expect(judgeMessages()).toHaveLength(judged); // nothing more is sent
    // (an uncaught error anywhere above would fail this test run)
  });
});
