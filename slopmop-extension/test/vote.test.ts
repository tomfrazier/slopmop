// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { voteHides, voteLevel } from "../src/shared/vote";
import { createVoteButton } from "../src/content/voteButton";
import { closeVotePanel, openVotePanel } from "../src/content/inspector";
import type { PanelOpts, PanelState } from "../src/content/votePanelTypes";
import type { InspectData } from "../src/content/inspector";
import { decide } from "../src/shared/decide";
import { dropVote, loadVotes, voteOf, watchVotes } from "../src/content/votes";

const mem: Record<string, any> = {};
const listeners: ((c: any, a: string) => void)[] = [];
(globalThis as any).chrome = {
  storage: {
    local: { get: async (k: any) => (k == null ? { ...mem } : { [k]: mem[k] }) },
    onChanged: { addListener: (l: any) => listeners.push(l) },
  },
};

const post = (withMenu = true) => {
  document.body.innerHTML = `<div id="post"><div class="head"><span>Author</span><div class="btns" id="btns">${
    withMenu ? '<button aria-label="Open control menu for post by Someone" id="menu">…</button>' : ""
  }<button aria-label="Hide post by Someone">x</button></div></div></div>`;
  return document.getElementById("post") as HTMLElement;
};
const panelRoot = () => document.querySelector("[data-slopmop-inspector]")?.shadowRoot ?? null;
const panelOf = () => (panelRoot()?.querySelector(".panel") ?? null) as HTMLElement | null;
const rec = (urn: string, label: string) => ({ urn, label, at: 1, text: "t", own: false, engagement: { reactions: 0, comments: 0, reposts: 0 }, verdict: { model: "t", aiLikelihood: 0.9, dimensions: {} }, decided: {} });

describe("vote model", () => {
  it("maps votes onto the green / yellow / red scheme", () => {
    expect(voteLevel("no")).toBe("green");
    expect(voteLevel("maybe")).toBe("yellow");
    expect(voteLevel("probably")).toBe("red");
  });
  it("only 'probably' hides a post in Hide mode", () => {
    expect([voteHides("no"), voteHides("maybe"), voteHides("probably")]).toEqual([false, false, true]);
  });
});

describe("mop button", () => {
  it("sits immediately left of the post's '...' button", () => {
    const p = post();
    const btn = createVoteButton(p, () => {});
    const menu = document.getElementById("menu")!;
    expect(menu.previousElementSibling).toBe(btn.host);
    expect(btn.host.parentElement).toBe(menu.parentElement);
  });
  it("lines up with the '...' button even when LinkedIn gives that button a top margin (long headlines)", () => {
    const p = post();
    const menu = document.getElementById("menu") as HTMLElement;
    menu.style.marginTop = "8px";
    menu.style.alignSelf = "flex-start";
    const btn = createVoteButton(p, () => {});
    expect(btn.host.style.marginTop).toBe("8px");
    expect(btn.host.style.alignSelf).toBe("flex-start");
  });
  it("floats in the corner of the post if the '...' button can't be found", () => {
    const p = post(false);
    const btn = createVoteButton(p, () => {});
    expect(btn.host.parentElement).toBe(p);
    expect(btn.host.style.position).toBe("absolute");
  });
  it("opens the panel on click without letting LinkedIn see the click", () => {
    const p = post();
    const onOpen = vi.fn();
    const btn = createVoteButton(p, onOpen);
    const outer = vi.fn();
    document.addEventListener("click", outer);
    btn.button.click();
    expect(onOpen).toHaveBeenCalledWith(btn.button);
    expect(outer).not.toHaveBeenCalled();
    document.removeEventListener("click", outer);
  });
  it("shows the current vote in its label, and a tone class dims/tints the icon", () => {
    const btn = createVoteButton(post(), () => {});
    expect(btn.button.getAttribute("aria-label")).toMatch(/is this post slop/);
    btn.setVote("probably");
    expect(btn.button.getAttribute("aria-label")).toMatch(/Probably/);
    btn.setTone("red");
    expect(btn.button.classList.contains("tone-red")).toBe(true);
    btn.setTone(null);
    expect(btn.button.className).toBe("");
  });
  it("can be removed", () => {
    const btn = createVoteButton(post(), () => {});
    btn.remove();
    expect(btn.host.isConnected).toBe(false);
  });
});

describe("vote panel", () => {
  let anchor: HTMLElement;
  beforeEach(() => {
    closeVotePanel();
    document.body.innerHTML = '<button id="a">mop</button>';
    anchor = document.getElementById("a")!;
  });

  const inspect = (score = 0.4): InspectData => {
    const dims = Object.fromEntries(["contrastFraming", "emptyEvaluation", "tradeoffFreePromises", "formalHedging", "hypeMarketing", "manneredProse", "formulaicHook", "manufacturedNarrative", "engagementBait", "humanVoice", "usefulness"].map((k) => [k, { value: score, confidence: 0.9 }]));
    const response = { model: "t", aiLikelihood: 0.9, dimensions: dims };
    const engagement = { reactions: 0, comments: 0, reposts: 0 };
    return { urn: "u", text: "t", own: false, engagement, response, decision: decide(response, engagement, "hide", "moderate"), mode: "hide", sensitivity: "moderate", vote: null, community: { no: 2, maybe: 1, probably: 3, total: 6 } };
  };
  const state = (over: Partial<PanelState> = {}): PanelState => ({ current: null, inspect: inspect(), scoring: false, problem: null, canRefold: false, ...over });
  const opts = (over: Partial<PanelState> = {}, extra: Partial<PanelOpts> = {}): PanelOpts => ({
    getState: () => state(over),
    ensure: async () => {},
    onPick: async () => null,
    onRefold: () => {},
    ...extra,
  });
  const voteBtn = (label: string) => [...panelOf()!.querySelectorAll('.voterow button')].find((b) => b.textContent === label) as HTMLButtonElement;

  it("shows the score above the chip, then the vote row, then the range bar", () => {
    openVotePanel(anchor, opts());
    const panel = panelOf()!;
    expect(panel.querySelector(".scorehead")!.textContent).toMatch(/\/ 100/);
    const order = [...panel.children].map((c) => c.className);
    expect(order.indexOf("scorehead")).toBeLessThan(order.indexOf("head"));
    expect(order.indexOf("voterow")).toBeLessThan(order.indexOf("zones"));
  });

  it("labels the vote row so it reads as an action, not decoration", () => {
    openVotePanel(anchor, opts());
    expect(panelOf()!.querySelector(".votelabel")!.textContent).toBe("Is this slop?");
  });

  it("dims and strikes the chip once a vote overrides it, and says so; a plain 'Not sure' does neither", () => {
    openVotePanel(anchor, opts({ current: "maybe" }));
    const panel = panelOf()!;
    expect(panel.querySelector(".pill")!.className).toMatch(/overridden/);
    expect(panel.querySelector(".outcome")!.className).toMatch(/overridden/);
    expect(panel.querySelector(".overridenote")!.textContent).toMatch(/overrides Jev's call/);
    closeVotePanel();
    openVotePanel(anchor, opts({ current: null }));
    const panel2 = panelOf()!;
    expect(panel2.querySelector(".pill")!.className).not.toMatch(/overridden/);
    expect(panel2.querySelector(".overridenote")).toBeNull();
  });

  it("keeps the chip, its reason, the vote label and the vote row together as one group, not split by a floating banner", () => {
    openVotePanel(anchor, opts({ current: "maybe" }));
    const order = [...panelOf()!.children].map((c) => c.className);
    const head = order.indexOf("head");
    expect(order[head + 1]).toBe("votelabel");
    expect(order[head + 2]).toBe("voterow");
    expect(order[head + 3]).toBe("overridenote");
  });

  it("puts 'Hide post again' near community votes at the bottom, not inside the vote group", () => {
    openVotePanel(anchor, opts({ canRefold: true }));
    const order = [...panelOf()!.children].map((c) => c.className);
    expect(order.indexOf("quiet-link")).toBeGreaterThan(order.indexOf("counterbars"));
    expect(order.indexOf("quiet-link")).toBeLessThan(order.indexOf("community"));
  });

  it("shows what the community has said at the very bottom", () => {
    openVotePanel(anchor, opts());
    expect(panelOf()!.querySelector(".community")!.textContent).toBe("3 flagged as slop · 1 maybe · 2 no");
    closeVotePanel();
    openVotePanel(anchor, opts({ inspect: { ...inspect(), community: { no: 0, maybe: 0, probably: 0, total: 0 } } }));
    expect(panelOf()!.querySelector(".community")!.textContent).toBe("No community votes yet");
  });

  it("shows a scoring placeholder for an unscored post and fills the panel in when it arrives", async () => {
    let scored = false;
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    openVotePanel(anchor, {
      getState: () => (scored ? state({}) : state({ inspect: null, scoring: true })),
      ensure: async () => (await gate, void (scored = true)),
      onPick: async () => null,
      onRefold: () => {},
    });
    expect(panelOf()!.querySelector(".dots")).not.toBeNull();
    release();
    await vi.waitFor(() => expect(panelOf()!.querySelector(".voterow")).not.toBeNull());
  });
  it("says why when a post could not be scored", () => {
    openVotePanel(anchor, opts({ inspect: null, problem: "Couldn't score this post. server 502" }));
    expect(panelOf()!.textContent).toMatch(/server 502/);
  });
  it("offers 'Hide post again' only for a post you unfolded, and it calls onRefold", () => {
    openVotePanel(anchor, opts({ canRefold: false }));
    expect(panelOf()!.querySelector(".quiet-link")).toBeNull();
    closeVotePanel();
    const onRefold = vi.fn();
    openVotePanel(anchor, opts({ canRefold: true }, { onRefold }));
    (panelOf()!.querySelector(".quiet-link") as HTMLElement).click();
    expect(onRefold).toHaveBeenCalled();
    expect(panelOf()).toBeNull();
  });
  it("picking a segment reports that vote and stays open, recolouring the row", async () => {
    const onPick = vi.fn(async () => null);
    openVotePanel(anchor, opts({}, { onPick }));
    voteBtn("Maybe").click();
    await vi.waitFor(() => expect(onPick).toHaveBeenCalledWith("maybe"));
    expect(panelOf()).not.toBeNull(); // stays open, unlike the old menu
  });
  it("picking your current vote's segment clears it back to Not sure", async () => {
    const onPick = vi.fn(async () => null);
    openVotePanel(anchor, opts({ current: "probably" }, { onPick }));
    voteBtn("Not sure").click();
    await vi.waitFor(() => expect(onPick).toHaveBeenCalledWith(null));
  });
  it("marks the current vote's segment checked", () => {
    openVotePanel(anchor, opts({ current: "no" }));
    expect(voteBtn("No").getAttribute("aria-checked")).toBe("true");
    expect(voteBtn("Not sure").getAttribute("aria-checked")).toBe("false");
  });
  it("shows the problem and stays open when the vote can't be saved", async () => {
    openVotePanel(anchor, opts({}, { onPick: async () => "Couldn't score this post." }));
    voteBtn("No").click();
    await vi.waitFor(() => expect(panelOf()!.querySelector(".err")!.textContent).toBe("Couldn't score this post."));
  });
  it("keeps the panel where it was when a vote hides the post (and so the icon it hangs from)", async () => {
    const rect = (l: number, t: number, w: number, h: number) => ({ left: l, top: t, right: l + w, bottom: t + h, width: w, height: h, x: l, y: t, toJSON() {} }) as DOMRect;
    let visible = true;
    anchor.getBoundingClientRect = () => (visible ? rect(600, 120, 32, 32) : rect(0, 0, 0, 0));
    openVotePanel(anchor, opts({}, { onPick: async () => ((visible = false), null) }));
    const before = { left: panelOf()!.style.left, top: panelOf()!.style.top };
    expect(before.left).not.toBe("");
    voteBtn("Probably").click();
    await vi.waitFor(() => expect(voteBtn("Probably")).toBeDefined());
    await new Promise((r) => setTimeout(r, 20));
    expect({ left: panelOf()!.style.left, top: panelOf()!.style.top }).toEqual(before); // not thrown to the left edge
  });
  it("closes on Escape, on an outside press, and when the icon is pressed again", () => {
    openVotePanel(anchor, opts());
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(panelOf()).toBeNull();

    openVotePanel(anchor, opts());
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
    expect(panelOf()).toBeNull();

    openVotePanel(anchor, opts());
    openVotePanel(anchor, opts()); // second press on the same icon
    expect(panelOf()).toBeNull();
  });
  it("only ever has one panel open", () => {
    const other = document.createElement("button");
    document.body.append(other);
    openVotePanel(anchor, opts());
    openVotePanel(other, opts());
    expect(panelRoot()!.querySelectorAll(".panel")).toHaveLength(1);
  });
});

describe("saved votes", () => {
  it("loads votes from storage, including ones saved by earlier builds, and follows changes", async () => {
    mem["label:post:a"] = rec("post:a", "probably");
    mem["label:post:b"] = rec("post:b", "not-slop"); // legacy
    await loadVotes();
    expect(voteOf("post:a")).toBe("probably");
    expect(voteOf("post:b")).toBe("no");
    expect(voteOf("post:zzz")).toBeNull();

    const seen: string[] = [];
    watchVotes((u) => seen.push(u));
    listeners.forEach((l) => l({ "label:post:c": { newValue: rec("post:c", "maybe") } }, "local"));
    expect(voteOf("post:c")).toBe("maybe");
    listeners.forEach((l) => l({ "label:post:c": { oldValue: rec("post:c", "maybe"), newValue: undefined } }, "local"));
    expect(voteOf("post:c")).toBeNull();
    listeners.forEach((l) => l({ "label:post:d": { newValue: rec("post:d", "no") } }, "sync")); // other areas ignored
    expect(voteOf("post:d")).toBeNull();
    expect(seen).toEqual(["post:c", "post:c"]);
    dropVote("post:a");
    expect(voteOf("post:a")).toBeNull();
  });
});
