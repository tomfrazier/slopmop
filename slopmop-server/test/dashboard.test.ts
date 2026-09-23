// @vitest-environment jsdom
/// <reference lib="dom" />
// Boots the real admin dashboard (public/admin, plain ES modules) in jsdom against the real server handlers.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handle, type Route } from "../src/handlers.js";
import { judgeBody, makeHarness } from "./helpers.js";

const KEY = "s3cret";
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const $ = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const $$ = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const button = (text: string) => $$("button").find((b) => b.textContent === text)!;
const headings = () => $$(".fold > summary h2").map((h) => h.textContent);

let h: Awaited<ReturnType<typeof makeHarness>>;
const ROUTES: Record<string, Route> = { stats: "stats", weights: "weights", scoring: "scoring", manifest: "adminManifest", tuner: "tuner", simulate: "simulate", clients: "clients", export: "export", devices: "devices", limits: "limits", review: "review", events: "events", posts: "posts" };

/** The dashboard's fetches go to the real handlers, so this exercises the true request and response shapes. */
function serveAdminApi() {
  vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input), "http://test");
    const route = ROUTES[url.pathname.replace("/api/v1/admin/", "")];
    return handle(route, new Request(`http://test${url.pathname}${url.search}`, { method: init?.method ?? "GET", headers: init?.headers, body: init?.body as string | undefined }), h.ctx);
  });
}

async function seed() {
  for (let i = 0; i < 3; i++) {
    const r = await h.call("judge", judgeBody({ postText: `Seeded dashboard post ${i}: the quick brown fox jumps over the lazy dog, again and again and again.` }), { install: `install-dash-${i}xxxx` });
    await h.call("vote", { network: "linkedin", contentId: r.body.contentId, vote: i % 2 ? "no" : "probably" }, { install: `install-dash-${i}xxxx` });
  }
}

async function openDashboard(token: string | null, page = "overview") {
  document.body.innerHTML = '<main id="app"></main><div id="tip" hidden></div>';
  sessionStorage.clear();
  location.hash = `#/${page}`;
  if (token) sessionStorage.setItem("slopmop-admin-token", token);
  vi.resetModules();
  await import("../public/admin/app.js" as string);
  await tick(150);
}

beforeEach(async () => {
  h = await makeHarness("sqlite", { ADMIN_TOKEN: KEY });
  await seed();
  serveAdminApi();
  vi.stubGlobal("alert", () => {});
  vi.stubGlobal("confirm", () => true);
  vi.stubGlobal("prompt", () => "because");
});
afterEach(() => vi.unstubAllGlobals());

describe("admin dashboard", () => {
  it("asks for the admin key, and says so when it is wrong", async () => {
    await openDashboard(null);
    expect($(".login")).not.toBeNull();
    const input = $("input[type=password]") as HTMLInputElement;
    input.value = "wrong";
    ($(".login form") as HTMLFormElement).dispatchEvent(new Event("submit", { cancelable: true }));
    await tick(150);
    expect($(".err")!.textContent).toMatch(/not accepted/);
    expect(sessionStorage.getItem("slopmop-admin-token")).toBeNull();
  });

  it("signs in and draws every section from the server's real data", async () => {
    await openDashboard(KEY);
    expect($$(".side a").map((a) => a.textContent)).toEqual(["Overview", "Devices", "Errors", "Post review", "Scoring", "Defaults", "Posts and votes"]);
    expect($(".side a[aria-current=page]")!.textContent).toBe("Overview");
    expect(headings()).toEqual(["Activity", "Busiest devices", "Errors and limit hits"]);
    expect($$(".kpi")).toHaveLength(12);
    expect($$(".kpi .l").map((e) => e.textContent)).toContain("Checks");
    expect($$("svg.chart").length).toBeGreaterThanOrEqual(4);
    expect($$("details.fold").every((d) => (d as HTMLDetailsElement).open)).toBe(true); // the overview starts fully open
    const on = async (page: string) => {
      $(`.side a[href="#/${page}"]`)!.click();
      location.hash = `#/${page}`;
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      await tick(200);
    };
    await on("scoring");
    expect(headings()).toEqual(["How a score is made", "Tell weights", "Scoring", "Threshold tuner"]);
    const openness = $$("details.fold").map((d) => (d as HTMLDetailsElement).open);
    expect(openness).toEqual([false, true, true, false]); // the long ones start folded away
    expect($$(".wrow")).toHaveLength(11); // one slider per tell, plus the two counter-tells
    await on("defaults");
    expect(headings()).toEqual(["Default limits", "Client settings"]);
    await on("posts");
    expect(headings()).toEqual(["Networks", "What Jev is seeing", "Community"]);
    await on("devices");
    expect($$('input[aria-label^="Disable device"]')).toHaveLength(3); // every seeded install, not just a top few
  });

  it("edits the tell weights live: change, save, and the server now uses them", async () => {
    await openDashboard(KEY, "scoring");
    expect(($(".card .pill") as HTMLElement).textContent).toMatch(/Defaults/);
    const first = $(".wrow input[type=number]") as HTMLInputElement;
    first.value = "2.5";
    first.dispatchEvent(new Event("input", { bubbles: true }));
    expect((button("Save weights") as HTMLButtonElement).disabled).toBe(false);
    (button("Save weights") as HTMLButtonElement).click();
    await tick(150);
    expect((await h.ctx.weights.current()).source).toBe("live");
    expect((await h.ctx.weights.current()).weights.contrastFraming).toBe(2.5);
    expect(($(".card .pill") as HTMLElement).textContent).toBe("Live edit");
  });

  it("keeps an edit in progress when the page redraws", async () => {
    await openDashboard(KEY, "scoring");
    const first = $(".wrow input[type=number]") as HTMLInputElement;
    first.value = "1.7";
    first.dispatchEvent(new Event("input", { bubbles: true }));
    (button("Refresh") as HTMLButtonElement).click();
    await tick(150);
    expect(($(".wrow input[type=number]") as HTMLInputElement).value).toBe("1.7");
  });

  it("disables a device from its checkbox on the Devices page, and can re-enable it", async () => {
    await openDashboard(KEY, "devices");
    await tick(200);
    const box = $('input[aria-label^="Disable device"]') as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    await tick(250);
    expect(await h.ctx.store.clients.listDisabled()).toHaveLength(1);
    expect($$(".pill.error").map((p) => p.textContent)).toContain("disabled");
    const again = $$('input[aria-label^="Disable device"]').find((b) => (b as HTMLInputElement).checked) as HTMLInputElement;
    again.checked = false;
    again.dispatchEvent(new Event("change", { bubbles: true }));
    await tick(250);
    expect(await h.ctx.store.clients.listDisabled()).toHaveLength(0);
  });

  it("finds a device by part of its id, and sets its own limit from the Devices page", async () => {
    await openDashboard(KEY, "devices");
    await tick(200);
    const ids = $$("tbody code").map((c) => c.textContent!);
    expect(ids).toHaveLength(3);
    const search = $('input[type=search]') as HTMLInputElement;
    search.value = ids[1].slice(1, 5);
    search.dispatchEvent(new Event("input", { bubbles: true }));
    await tick(600);
    expect($$("tbody code").map((c) => c.textContent)).toContain(ids[1]);
    expect($$("tbody code").length).toBeLessThan(3);
    $$("button").find((b) => b.textContent === "Edit")!.click();
    await tick(50);
    const [name, daily] = $$("tr.editrow input") as HTMLInputElement[];
    name.value = "Test laptop";
    daily.value = "777";
    $$("tr.editrow button").find((b) => b.textContent === "Save")!.click();
    await tick(300);
    expect($$(".pill").map((p) => p.textContent)).toContain("own limits");
    expect($$("tbody td b").map((b) => b.textContent)).toContain("Test laptop"); // the name shows in the row
    const found = await h.ctx.store.clients.list({ q: "", status: "custom", sort: "lastSeen", dir: "desc", limit: 10, offset: 0 });
    expect(found.devices).toHaveLength(1);
    expect(found.devices[0].dailyLimit).toBe(777);
  });

  it("edits the thresholds and reader-response model, and the server serves the new thresholds", async () => {
    await openDashboard(KEY, "scoring");
    const mild = $('input[aria-label="Mild"]') as HTMLInputElement;
    expect(mild.value).toBe("0.22");
    mild.value = "0.3";
    mild.dispatchEvent(new Event("input"));
    button("Save scoring").click();
    await tick(200);
    expect((await h.call("manifest")).body.thresholds.mild).toBe(0.3);
    expect(($('input[aria-label="Mild"]') as HTMLInputElement).value).toBe("0.3");
    button("Reset to defaults").click();
    await tick(200);
    expect((await h.call("manifest")).body.thresholds.mild).toBe(0.22);
  });

  it("edits a client setting, shows its default, and resets", async () => {
    await openDashboard(KEY, "defaults");
    const minChars = $('input[aria-label="Shortest post to score (characters)"]') as HTMLInputElement;
    expect(minChars.value).toBe("200");
    minChars.value = "250";
    minChars.dispatchEvent(new Event("input"));
    button("Save client settings").click();
    await tick(200);
    expect((await h.call("manifest")).body.values.minChars).toBe(250);
    expect(document.body.textContent).toMatch(/default 200/);
    button("Reset client settings").click();
    await tick(200);
    expect((await h.call("manifest")).body.values.minChars).toBe(200);
  });

  it("shows the tuner's suggestion, loads it into the Scoring card without saving, and applies only on Save", async () => {
    const dim = (v: number) => ({ ...Object.fromEntries(["contrastFraming", "emptyEvaluation", "tradeoffFreePromises", "formalHedging", "hypeMarketing", "manneredProse", "formulaicHook", "manufacturedNarrative", "engagementBait", "humanVoice", "usefulness"].map((id) => [id, { value: v, confidence: 0.9 }])) });
    const labels = [...Array.from({ length: 16 }, (_, i) => ({ urn: `p${i}`, label: "probably", verdict: { model: "j", aiLikelihood: 0.9, dimensions: dim(0.35 + (i % 5) * 0.05) } })), ...Array.from({ length: 16 }, (_, i) => ({ urn: `n${i}`, label: "no", verdict: { model: "j", aiLikelihood: 0.9, dimensions: dim(0.02 + (i % 5) * 0.01) } }))];
    await h.call("tuner", { import: labels }, { method: "POST", headers: { authorization: `Bearer ${KEY}` } });
    await openDashboard(KEY, "scoring");
    expect(document.body.textContent).toMatch(/32 posts: 16 "probably", 16 "no"/);
    expect(document.body.textContent).toMatch(/Suggested thresholds/);
    const before = (await h.call("manifest")).body.thresholds;
    const mild = () => $('input[aria-label="Mild"]') as HTMLInputElement;
    const shownBefore = mild().value;
    button("Load into the Scoring card").click();
    await tick(100);
    expect(mild().value).not.toBe(""); // the Scoring card's draft now holds the suggestion
    expect((await h.call("manifest")).body.thresholds).toEqual(before); // ...and nothing has been saved
    button("Save scoring").click();
    await tick(200);
    const after = (await h.call("manifest")).body.thresholds;
    expect(after.aggressive).toBeLessThanOrEqual(after.moderate);
    expect(shownBefore).toBe("0.22");
  });

  it("switches the tuner to the community set with its own controls", async () => {
    await openDashboard(KEY, "scoring");
    button("Community consensus").click();
    await tick(200);
    expect($('input[aria-label="Voters needed per post"], input[aria-label="Voters needed"]')).not.toBeNull();
    expect(document.body.textContent).toMatch(/never changes anything on its own/);
  });

  it("explains the formula with today's numbers, runs the simulator, and previews an unsaved edit without saving it", async () => {
    await openDashboard(KEY, "scoring");
    await tick(400);
    expect(document.body.textContent).toMatch(/Tell average.*Slop.*Shield.*AI dampener.*Score.*What you see/s);
    expect(document.body.textContent).toMatch(/Likely slop starts at 0\.1 \(Aggressive\), 0\.18 \(Moderate\) or 0\.22 \(Mild\)/);
    const shown = () => ($$(".sim-result b").find((b) => /\/ 100/.test(b.textContent ?? ""))?.textContent ?? "");
    expect(shown()).toMatch(/^\d+ \/ 100$/);
    button("Blatant AI slop").click();
    await tick(500);
    expect(document.body.textContent).toMatch(/Likely slop/);
    const blatant = Number(shown().split(" ")[0]);
    button("Sincere human post").click();
    await tick(500);
    expect(Number(shown().split(" ")[0])).toBeLessThan(blatant);
    // Change the gain in the Scoring card without saving: the simulator uses it, and says so.
    const gain = $('input[aria-label="Slop gain"]') as HTMLInputElement;
    gain.value = "4";
    gain.dispatchEvent(new Event("input"));
    button("Blatant AI slop").click();
    await tick(500);
    expect(document.body.textContent).toMatch(/Using your unsaved edits to: scoring/);
    expect((await h.call("scoring", undefined, { headers: { authorization: `Bearer ${KEY}` } })).body.effective.formula.gain).toBe(2);
  });

  it("logs scoring changes with their note, and loads an earlier version back into the editor without saving", async () => {
    await openDashboard(KEY, "scoring");
    const gain = () => $('input[aria-label="Slop gain"]') as HTMLInputElement;
    gain().value = "3";
    gain().dispatchEvent(new Event("input"));
    const note = $('input[aria-label="Note for this scoring change"]') as HTMLInputElement;
    note.value = "raise the gain";
    note.dispatchEvent(new Event("input"));
    button("Save scoring").click();
    await tick(300);
    expect(document.body.textContent).toMatch(/raise the gain/);
    gain().value = "5";
    gain().dispatchEvent(new Event("input"));
    button("Save scoring").click();
    await tick(300);
    const loads = $$("button").filter((b) => b.textContent === "Load" && /Load these settings/.test(b.title));
    expect(loads.length).toBeGreaterThanOrEqual(2);
    loads[1].click(); // the older entry (gain 3)
    await tick(300);
    expect(gain().value).toBe("3");
    expect((await h.call("scoring", undefined, { headers: { authorization: `Bearer ${KEY}` } })).body.effective.formula.gain).toBe(5); // loaded, not saved
  });

  it("shows times in Pacific by default, and switches to UTC", async () => {
    await openDashboard(KEY);
    expect($(".top .sub")!.textContent).toMatch(/times in P[SD]T/);
    expect(button("Pacific").getAttribute("aria-pressed")).toBe("true");
    button("UTC").click();
    await tick(200);
    expect($(".top .sub")!.textContent).toMatch(/times in UTC/);
  });

  it("reviews a post from its pasted text: finds the record, walks through the score, and previews a change", async () => {
    await openDashboard(KEY, "review");
    const text = "Seeded dashboard post 1: the quick brown fox jumps over the lazy dog, again and again and again.";
    const box = $("textarea") as HTMLTextAreaElement;
    box.value = text;
    box.dispatchEvent(new Event("input", { bubbles: true }));
    button("Look up").click();
    await tick(400);
    expect(headings().length).toBe(0); // sections use cards on this page
    const titles = $$(".card h2").map((h) => h.textContent);
    expect(titles).toEqual(["Find a post", "What it scored", "How it was scored", "What Jev found", "What would change it", "Leaning on reader response", "Try it"]);
    expect($(".bigscore")!.textContent).toMatch(/\d+ \/ 100/);
    expect(document.body.textContent).toMatch(/Tell average.*Slop.*Corroboration.*Shield.*AI dampener.*Score/s);
    const slider = $('input[aria-label="Largest shield"]') as HTMLInputElement;
    slider.value = "0.95";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    await tick(700);
    expect($(".sim-result")!.textContent).toMatch(/\/ 100 \(was \d+\)/);
    // a post nobody has checked is said to be missing, not invented
    box.value = "A post that nobody has ever checked with the tool, long enough to be looked up here.";
    box.dispatchEvent(new Event("input", { bubbles: true }));
    button("Look up").click();
    await tick(300);
    expect(document.body.textContent).toMatch(/No stored post matches this text/);
  });

  it("remembers which sections you folded, across a redraw", async () => {
    await openDashboard(KEY, "scoring");
    const weights = () => $$("details.fold")[1] as HTMLDetailsElement;
    expect(weights().open).toBe(true);
    weights().open = false;
    weights().dispatchEvent(new Event("toggle"));
    button("Refresh").click();
    await tick(200);
    expect(weights().open).toBe(false);
    expect(($$("details.fold")[0] as HTMLDetailsElement).open).toBe(false); // the untouched default is still folded
  });

  it("lists every error on its own page, filters it by what happened, and pages the voted-post lists", async () => {
    h.failNext.error = new TypeError("seeded failure");
    await h.call("judge", judgeBody({ postText: "A post that fails on the way to Jev, long enough to be judged normally here." }), { install: "install-dash-0xxxx" });
    await openDashboard(KEY, "errors");
    await tick(300);
    expect($$("tbody tr").map((r) => r.textContent).join(" ")).toMatch(/TypeError/);
    expect($$(".chip").length).toBeGreaterThan(0);
    const select = $("select[aria-label=Show]") as HTMLSelectElement;
    select.value = "limited";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await tick(300);
    expect(document.body.textContent).toMatch(/Nothing matches/);
    await openDashboard(KEY, "posts");
    await tick(400);
    expect(headings()).toEqual(["Networks", "What Jev is seeing", "Community"]);
    expect($$(".card h2").map((e) => e.textContent)).toEqual(expect.arrayContaining(["Most flagged posts", "Voters said slop, Jev didn't"]));
    expect(document.body.textContent).toMatch(/in all|Nobody has flagged/);
  });

  it("switches the range and redraws", async () => {
    await openDashboard(KEY);
    button("24h").click();
    await tick(150);
    expect(button("24h").getAttribute("aria-pressed")).toBe("true");
    expect($(".top .sub")!.textContent).toMatch(/last 24 hours/);
  });
});
