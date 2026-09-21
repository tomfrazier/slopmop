// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { voteHides, voteLevel } from "../src/shared/vote";
import { createVoteButton } from "../src/content/voteButton";
import { closeVoteMenu, openVoteMenu, type MenuOpts, type MenuState } from "../src/content/voteMenu";
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
const menuRoot = () => document.querySelector("[data-slopmop-menu]")?.shadowRoot ?? null;
const items = () => [...(menuRoot()?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
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
  it("opens the menu on click without letting LinkedIn see the click", () => {
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
  it("shows the current vote on the icon and in its label", () => {
    const btn = createVoteButton(post(), () => {});
    expect(btn.button.getAttribute("aria-label")).toMatch(/is this post slop/);
    btn.setVote("probably");
    expect(btn.button.getAttribute("aria-label")).toMatch(/Probably/);
    expect(btn.button.querySelector("rect")!.getAttribute("fill")).toBe("#D93025");
    btn.setVote(null);
    expect(btn.button.querySelector("rect")!.getAttribute("fill")).toBe("#6E757D");
  });
  it("can be removed", () => {
    const btn = createVoteButton(post(), () => {});
    btn.remove();
    expect(btn.host.isConnected).toBe(false);
  });
});

describe("vote menu", () => {
  let anchor: HTMLElement;
  beforeEach(() => {
    closeVoteMenu();
    document.body.innerHTML = '<button id="a">mop</button>';
    anchor = document.getElementById("a")!;
  });

  const inspect = (score = 0.4): InspectData => {
    const dims = Object.fromEntries(["contrastFraming", "emptyEvaluation", "tradeoffFreePromises", "formalHedging", "hypeMarketing", "manneredProse", "formulaicHook", "manufacturedNarrative", "engagementBait", "humanVoice", "usefulness"].map((k) => [k, { value: score, confidence: 0.9 }]));
    const response = { model: "t", aiLikelihood: 0.9, dimensions: dims };
    const engagement = { reactions: 0, comments: 0, reposts: 0 };
    return { urn: "u", text: "t", own: false, engagement, response, decision: decide(response, engagement, "hide", "moderate"), mode: "hide", sensitivity: "moderate", vote: null };
  };
  const state = (over: Partial<MenuState> = {}): MenuState => ({ current: null, score: 38, verdict: "Not flagged", tone: "grey", zones: { possibly: 40, likely: 70 }, scoring: false, problem: null, inspect: inspect(), canRefold: false, community: null, ...over });
  const opts = (over: Partial<MenuState> = {}, extra: Partial<MenuOpts> = {}): MenuOpts => ({
    getState: () => state(over),
    ensure: async () => {},
    onPick: async () => null,
    onRefold: () => {},
    ...extra,
  });
  const box = () => menuRoot()!.querySelector(".menu") as HTMLElement;
  const texts = () => [...box().children].map((c) => (c.tagName === "HR" ? "---" : (c.textContent ?? "").replace(/\s+/g, " ").trim()));
  const panelOpen = () => !!document.querySelector("[data-slopmop-inspector]")?.shadowRoot?.querySelector(".panel");

  it("leads with the verdict, then the score, then the votes, then a separator and Details last", () => {
    openVoteMenu(anchor, opts({ score: 38, verdict: "Not flagged" }));
    const t = texts();
    expect(t[0]).toBe("Not flaggedSlop score38"); // the word first, the number as supporting detail
    expect(t[1]).toBe("---");
    expect(t.slice(2, 6)).toEqual(["Is this post slop?", "Nonot slop", "Maybeborderline", "Probablyslop"]);
    expect(t[t.length - 2]).toBe("---");
    expect(t[t.length - 1]).toMatch(/^Details/);
  });
  it("shows what the community has said under the score, or that nobody has yet", () => {
    openVoteMenu(anchor, opts({ community: { no: 2, maybe: 1, probably: 3, total: 6 } }));
    expect(box().querySelector(".community")!.textContent).toBe("Community: 3 flagged as slop · 1 maybe · 2 no");
    closeVoteMenu();
    openVoteMenu(anchor, opts({ community: { no: 0, maybe: 0, probably: 0, total: 0 } }));
    expect(box().querySelector(".community")!.textContent).toBe("No community votes yet");
    closeVoteMenu();
    openVoteMenu(anchor, opts({ community: null }));
    expect(box().querySelector(".community")).toBeNull();
  });
  it("draws the meter's zones where this person's sensitivity puts them, not at fixed places", () => {
    openVoteMenu(anchor, opts({ score: 36, verdict: "Possibly slop", tone: "yellow", zones: { possibly: 22, likely: 38 } }));
    const bands = [...box().querySelectorAll(".score .meter i")].map((i) => (i as HTMLElement).style.width);
    expect(bands[0]).toBe("22%");
    expect(bands[1]).toBe("16%");
  });

  it("draws a meter with a marker at the shown score, and no '/100'", () => {
    openVoteMenu(anchor, opts({ score: 62, verdict: "Possibly slop", tone: "yellow" }));
    const meter = box().querySelector(".score .meter")!;
    expect(meter.getAttribute("aria-label")).toBe("Slop score 62 out of 100");
    expect((meter.querySelector("b") as HTMLElement).style.left).toBe("62%");
    expect(box().querySelector(".score")!.textContent).not.toMatch(/\/100/);
  });

  it("shows Scoring... first for an unscored post and fills the score in when it arrives", async () => {
    let scored = false;
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    openVoteMenu(anchor, {
      getState: () => (scored ? state({ score: 57, verdict: "Likely slop", tone: "red" }) : state({ score: null, scoring: true, inspect: null })),
      ensure: async () => (await gate, void (scored = true)),
      onPick: async () => null,
      onRefold: () => {},
    });
    // While it is pending: three animated dots (not a static ellipsis), labelled for screen readers.
    const dots = box().querySelector(".score .dots")!;
    expect(dots.querySelectorAll("i")).toHaveLength(3);
    expect(dots.getAttribute("aria-label")).toBe("Scoring");
    expect(box().querySelector(".score .v")).toBeNull();
    release();
    await vi.waitFor(() => expect(box().querySelector(".score")!.textContent).toMatch(/Likely slop.*57/));
    expect(box().querySelector(".score .dots")).toBeNull();
    expect(box().querySelector(".details, [aria-haspopup=true]")!.getAttribute("aria-disabled")).toBe("false");
  });
  it("says why when a post could not be scored", () => {
    openVoteMenu(anchor, opts({ score: null, problem: "Couldn't score this post. server 502", inspect: null }));
    expect(box().querySelector(".score")!.textContent).toMatch(/server 502/);
    expect(box().querySelector("[aria-haspopup=true]")!.getAttribute("aria-disabled")).toBe("true");
  });
  it("Details shows the analysis card on hover and hides it on leave (it is not a click action)", () => {
    openVoteMenu(anchor, opts());
    const details = box().querySelector("[aria-haspopup=true]") as HTMLElement;
    expect(panelOpen()).toBe(false);
    details.dispatchEvent(new MouseEvent("mouseenter"));
    expect(panelOpen()).toBe(true);
    details.dispatchEvent(new MouseEvent("mouseleave"));
    expect(panelOpen()).toBe(false);
  });
  it("Details also opens on keyboard focus, and does nothing while the post is unscored", () => {
    openVoteMenu(anchor, opts());
    const details = box().querySelector("[aria-haspopup=true]") as HTMLElement;
    details.dispatchEvent(new FocusEvent("focus"));
    expect(panelOpen()).toBe(true);
    details.dispatchEvent(new FocusEvent("blur"));
    closeVoteMenu();
    openVoteMenu(anchor, opts({ score: null, inspect: null }));
    (box().querySelector("[aria-haspopup=true]") as HTMLElement).dispatchEvent(new MouseEvent("mouseenter"));
    expect(panelOpen()).toBe(false);
  });
  it("closing the menu also dismisses the analysis card", () => {
    openVoteMenu(anchor, opts());
    (box().querySelector("[aria-haspopup=true]") as HTMLElement).dispatchEvent(new MouseEvent("mouseenter"));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(panelOpen()).toBe(false);
  });
  it("offers 'Hide post again' only for a post you unfolded, and it calls onRefold", () => {
    openVoteMenu(anchor, opts({ canRefold: false }));
    expect(texts().join("|")).not.toMatch(/Hide post again/);
    closeVoteMenu();
    const onRefold = vi.fn();
    openVoteMenu(anchor, opts({ canRefold: true }, { onRefold }));
    const item = [...box().querySelectorAll("button")].find((b) => b.textContent === "Hide post again")!;
    item.click();
    expect(onRefold).toHaveBeenCalled();
    expect(menuRoot()!.querySelector(".menu")).toBeNull();
  });
  it("Details stays last, after a separator, even when 'Clear my vote' and 'Hide post again' are present", () => {
    openVoteMenu(anchor, opts({ current: "maybe", canRefold: true }));
    const t = texts().filter((x) => x !== ""); // drop the empty error line
    expect(t.slice(-4)).toEqual(["Clear my vote", "Hide post again", "---", "Details‹"]);
  });
  it("picking an item reports that vote and closes", async () => {
    const onPick = vi.fn(async () => null);
    openVoteMenu(anchor, opts({}, { onPick }));
    (box().querySelector('[data-v="maybe"]') as HTMLElement).click();
    await vi.waitFor(() => expect(onPick).toHaveBeenCalledWith("maybe"));
    await vi.waitFor(() => expect(menuRoot()!.querySelector(".menu")).toBeNull());
  });
  it("picking your current vote again clears it; 'Clear my vote' does too", async () => {
    const onPick = vi.fn(async () => null);
    openVoteMenu(anchor, opts({ current: "probably" }, { onPick }));
    (box().querySelector('[data-v="probably"]') as HTMLElement).click();
    await vi.waitFor(() => expect(onPick).toHaveBeenCalledWith(null));
  });
  it("marks the current vote", () => {
    openVoteMenu(anchor, opts({ current: "no" }));
    expect(box().querySelector('[data-v="no"]')!.getAttribute("aria-checked")).toBe("true");
    expect(box().querySelector('[data-v="maybe"]')!.getAttribute("aria-checked")).toBe("false");
  });
  it("stays open and shows the problem when the vote can't be saved", async () => {
    openVoteMenu(anchor, opts({}, { onPick: async () => "Couldn't score this post." }));
    (box().querySelector('[data-v="no"]') as HTMLElement).click();
    await vi.waitFor(() => expect(menuRoot()!.querySelector(".err-msg")!.textContent).toBe("Couldn't score this post."));
    expect(menuRoot()!.querySelector(".menu")).not.toBeNull();
    expect((box().querySelector('[data-v="no"]') as HTMLButtonElement).disabled).toBe(false);
  });
  it("closes on Escape, on an outside press, and when the icon is pressed again", () => {
    openVoteMenu(anchor, opts());
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(menuRoot()!.querySelector(".menu")).toBeNull();

    openVoteMenu(anchor, opts());
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
    expect(menuRoot()!.querySelector(".menu")).toBeNull();

    openVoteMenu(anchor, opts());
    openVoteMenu(anchor, opts()); // second press on the same icon
    expect(menuRoot()!.querySelector(".menu")).toBeNull();
  });
  it("only ever has one menu open", () => {
    const other = document.createElement("button");
    document.body.append(other);
    openVoteMenu(anchor, opts());
    openVoteMenu(other, opts());
    expect(menuRoot()!.querySelectorAll(".menu")).toHaveLength(1);
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
