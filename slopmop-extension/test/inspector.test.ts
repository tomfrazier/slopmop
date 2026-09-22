import { readdirSync, readFileSync } from "node:fs";
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { closeInspector, radarChart, showInspectorBeside, type InspectData } from "../src/content/inspector";
import { TELL_AXES } from "../src/content/labels";
import { decide, decideOwn } from "../src/shared/decide";
import type { JudgeResponse } from "../src/shared/types";
import { verdictLabel } from "../src/shared/verdict";

const IDS = TELL_AXES.map((a) => a.id);
const resp = (level: number, ai = 0.95, over: Partial<JudgeResponse> = {}): JudgeResponse => ({
  model: "jev",
  aiLikelihood: ai,
  dimensions: { ...Object.fromEntries(IDS.map((id) => [id, { value: level, confidence: 0.9 }])), humanVoice: { value: 0.2, confidence: 0.9 }, usefulness: { value: 0.6, confidence: 0.9 } },
  ...over,
});
const none = { reactions: 0, comments: 0, reposts: 0 };
const anchor = () => {
  const a = document.createElement("div");
  document.body.append(a);
  return a;
};
const panelOf = () => document.querySelector("[data-slopmop-inspector]")?.shadowRoot?.querySelector(".panel") as HTMLElement | undefined;
const text = () => (panelOf()?.textContent ?? "").replace(/\s+/g, " ");
const show = (r: JudgeResponse, opts: { mode?: "hide" | "highlight"; own?: boolean; advanced?: boolean; sensitivity?: "aggressive" | "moderate" | "mild" } = {}) => {
  const mode = opts.mode ?? "highlight";
  const sensitivity = opts.sensitivity ?? "moderate";
  const decision = opts.own ? decideOwn(r, sensitivity) : decide(r, none, mode, sensitivity);
  const data: InspectData = { urn: "u", text: "t", own: !!opts.own, engagement: none, response: r, decision, mode, sensitivity, vote: null, advanced: opts.advanced };
  showInspectorBeside(anchor(), data);
};
afterEach(() => {
  closeInspector();
  document.body.innerHTML = "";
});

describe("the breakdown panel", () => {
  it("leads with the numeric score, out of 100, above the chip", () => {
    show(resp(0.9));
    const p = panelOf()!;
    expect(p.querySelector(".scorehead")!.textContent).toMatch(/^\d+ \/ 100$/);
    const order = [...p.children].map((c) => c.className);
    expect(order.indexOf("scorehead")).toBe(0);
    expect(order.indexOf("scorehead")).toBeLessThan(order.indexOf("head"));
  });

  it("shows a plain verdict chip and a sentence, in 'possibly / likely' language", () => {
    show(resp(0.9));
    expect(text()).toMatch(/Likely slop/);
    expect(text()).toMatch(/reads like AI slop/i);
    closeInspector();
    show(resp(0.12)); // between the possibly and likely lines
    expect(text()).toMatch(/Possibly slop/);
    expect(text()).toMatch(/some hallmarks of AI slop/i);
    closeInspector();
    show(resp(0.02));
    expect(text()).toMatch(/Looks fine/);
  });

  it("styles the chip as a wash background, coloured text and a thin border of the same colour, per the verdict scale (never colour alone)", () => {
    show(resp(0.9));
    const pill = panelOf()!.querySelector(".pill") as HTMLElement;
    expect(pill.style.background).not.toBe(pill.style.color); // two different channels carry the meaning
    expect(pill.style.border).toMatch(/1px solid/);
  });

  it("has no interactive vote row in a read-only (hover) view", () => {
    show(resp(0.9));
    expect(panelOf()!.querySelector(".voterow")).toBeNull();
  });

  it("shows where the post sits on Looks fine / Possibly / Likely (same zones in Hide mode, plus a line where posts are hidden)", () => {
    show(resp(0.9));
    const labels = [...panelOf()!.querySelectorAll(".zlabels span")].map((s) => s.textContent);
    expect(labels).toEqual(["Looks fine", "Possibly", "Likely"]);
    expect(panelOf()!.querySelector(".dot")).not.toBeNull();
    closeInspector();
    show(resp(0.9), { mode: "hide" });
    expect([...panelOf()!.querySelectorAll(".zlabels span")].map((s) => s.textContent)).toEqual(["Looks fine", "Possibly", "Likely (hidden)"]);
    expect(panelOf()!.querySelector(".cut")).not.toBeNull();
  });

  it("never sizes a zone label to its own zone's width (that's what used to clip 'Possibly' at tight sensitivities)", () => {
    show(resp(0.9), { sensitivity: "aggressive" });
    for (const el of panelOf()!.querySelectorAll<HTMLElement>(".zlabels .zl")) expect(el.style.width).toBe("");
  });

  it("puts THE SLOPPRINT and What Jev noticed on one line, above Strongest signs", () => {
    show(resp(0.6));
    const p = panelOf()!;
    expect(p.querySelector("h4.sloppr")!.textContent).toBe("The SlopprintWhat Jev noticed");
    const order = [...p.children];
    expect(order.indexOf(p.querySelector("h4.sloppr")!)).toBeLessThan(order.indexOf(p.querySelector(".signals")!));
  });

  it("draws the zones on the shown 0-100 scale: 40 and 70 at Moderate, and the same number at every sensitivity", () => {
    show(resp(0.9), { sensitivity: "moderate" });
    const widths = () => [...panelOf()!.querySelectorAll(".zones i")].map((i) => (i as HTMLElement).style.width);
    expect(widths()[0]).toBe("40%");
    expect(widths()[1]).toBe("calc(30%)"); // 70 - 40, as the browser normalises it
    closeInspector();
    show(resp(0.9), { sensitivity: "aggressive" });
    expect(widths()[0]).not.toBe("40%"); // the cutoffs move with the sensitivity; the scale does not
  });

  it("draws a spider chart with one labelled axis per tell", () => {
    show(resp(0.6));
    const svg = panelOf()!.querySelector("svg.radar")!;
    expect([...svg.querySelectorAll("text")].map((t) => t.textContent)).toEqual(TELL_AXES.map((a) => a.label));
    expect(svg.querySelectorAll("polygon")).toHaveLength(4); // three rings and the shape
    expect(svg.getAttribute("aria-label")).toMatch(/Scroll-stopper 60%/);
  });

  it("puts each tell's Jev score on its own axis: stronger tells reach further from the centre, and strong ones are emphasised", () => {
    const axes = [{ label: "A", value: 0 }, { label: "B", value: 0.5 }, { label: "C", value: 1 }];
    const svg = radarChart(axes, "#d93025");
    const dots = [...svg.querySelectorAll("circle")].map((c) => Math.hypot(Number(c.getAttribute("cx")) - 170, Number(c.getAttribute("cy")) - 124));
    expect(dots[0]).toBeLessThan(dots[1]);
    expect(dots[1]).toBeLessThan(dots[2]);
    expect(dots[2]).toBeCloseTo(74, 0); // a full score reaches the outer ring
    const hot = [...svg.querySelectorAll("text")].filter((t) => t.getAttribute("class") === "hot").map((t) => t.textContent);
    expect(hot).toEqual(["B", "C"]);
  });

  it("names the strongest signs in plain words", () => {
    show(resp(0.1, 0.95, { dimensions: { ...resp(0.1).dimensions, formulaicHook: { value: 0.9, confidence: 0.9 }, emptyEvaluation: { value: 0.7, confidence: 0.9 } } }));
    expect(text()).toMatch(/Strongest signs: (Scroll-stopper, Empty praise|Empty praise, Scroll-stopper)/);
    closeInspector();
    show(resp(0.05));
    expect(text()).toMatch(/No strong signs of AI writing/);
    closeInspector();
    show(resp(0.12)); // flagged "possibly" with every tell only moderate: it still says what pushed it there
    expect(text()).toMatch(/Possibly slop/);
    expect(text()).toMatch(/Strongest signs:/);
  });

  it("shows the human-voice and usefulness counter-signals with no trailing percentage", () => {
    show(resp(0.5));
    expect(text()).toMatch(/Sounds like a person/);
    expect(text()).toMatch(/Useful to readers/);
    expect(text()).toMatch(/Reader response/);
    expect(text()).not.toMatch(/\d+%/); // the bar itself is the number now
  });

  it("drops the old 'further from the centre' and 'vote with the mop icon' captions", () => {
    show(resp(0.9));
    expect(text()).not.toMatch(/Further from the cent/i);
    expect(text()).not.toMatch(/Vote with the mop icon/i);
  });

  it("never shows weights, colour names, or the arithmetic to an ordinary user", () => {
    show(resp(0.9));
    const t = text();
    expect(t).not.toMatch(/×\d|wt\b|adds|weight|threshold|guard|shield|yellow|red\b/i);
    expect(panelOf()!.querySelector(".math")).toBeNull();
    expect(t).not.toMatch(/Developer details/);
  });

  it("adds the numbers only in developer builds, and even then never the weights", () => {
    show(resp(0.9), { advanced: true });
    const t = text();
    expect(t).toMatch(/Developer details/);
    expect(t).toMatch(/AI-drafted\?/);
    expect(t).toMatch(/possibly ≥ .*likely ≥/);
    expect(t).not.toMatch(/\bwt\b|weight/i);
    expect(panelOf()!.querySelector(".rows")!.textContent).not.toMatch(/×/);
  });

  it("does not show a per-tell weight even when the extension had to compute the mean itself", () => {
    show(resp(0.9), { advanced: true }); // no server composite in this response, so weights are the equal public defaults
    expect(panelOf()!.querySelector(".rows")!.textContent).not.toMatch(/×/);
  });

  it("uses 'Reads clean' language for your own posts and the server's ranking when it has one", () => {
    show(resp(0.02), { own: true });
    expect(text()).toMatch(/Reads clean/);
    closeInspector();
    show(resp(0.1, 0.95, { tellMean: 0.05, tellRank: IDS }), { advanced: true });
    expect(text()).not.toMatch(/\bwt\b|weight/i);
  });
});

describe("the human-written dampener", () => {
  it("is not shown in the panel, only in developer details", () => {
    show(resp(0.9, 0.2));
    expect(text()).not.toMatch(/Reads human-written/);
    closeInspector();
    show(resp(0.9, 0.2), { advanced: true });
    expect(text()).toMatch(/AI-drafted\?.*score ×0\.72/);
  });
  it("never leaves 'Looks human-written' as a verdict anywhere in the source", () => {
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
    for (const f of walk("src").filter((f) => /\.(ts|css|html)$/.test(f))) expect(readFileSync(f, "utf8"), f).not.toMatch(/Looks human-written/);
  });
});

describe("verdict wording", () => {
  const d = (r: JudgeResponse, own = false) => (own ? decideOwn(r, "moderate") : decide(r, none, "highlight", "moderate"));
  it("says possibly / likely, never 'some AI tells'; 'Looks fine' and 'Reads clean' are the clean tone, 'Not sure' its own grey", () => {
    expect(verdictLabel(d(resp(0.9)), false)).toEqual({ text: "Likely slop", tone: "red" });
    expect(verdictLabel(d(resp(0.12)), false)).toEqual({ text: "Possibly slop", tone: "yellow" });
    expect(verdictLabel(d(resp(0.02)), false)).toEqual({ text: "Looks fine", tone: "green" });
    expect(verdictLabel(d(resp(0.9, 0.2)), false)).toEqual({ text: "Likely slop", tone: "red" }); // typed by a person, still slop
    expect(verdictLabel(d(resp(0.9), true), true)).toEqual({ text: "Likely slop", tone: "red" });
    expect(verdictLabel(d(resp(0.02), true), true)).toEqual({ text: "Reads clean", tone: "green" });
  });
});
