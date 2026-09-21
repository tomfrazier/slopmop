import { barChart } from "../charts.js";
import { el } from "../dom.js";
import { fmt } from "../format.js";
import { card, panel, section, table } from "../widgets.js";

const PERCENT = 100;
const HUMAN_SIDE_TELLS = new Set(["humanVoice", "usefulness"]); // counter-signals, drawn in green rather than blue

const networkTable = (d) =>
  table(
    [
      { h: "Network", v: (r) => r.network },
      { h: "Posts seen", r: 1, v: (r) => fmt.n(r.postsSeen) },
      { h: "New posts", r: 1, v: (r) => fmt.n(r.postsNew) },
      { h: "All-time posts", r: 1, v: (r) => fmt.n(r.postsTotal) },
      { h: "Checks", r: 1, v: (r) => fmt.n(r.checks) },
      { h: "Jev calls", r: 1, v: (r) => fmt.n(r.jevCalls) },
      { h: "AI-likely", r: 1, v: (r) => fmt.pct(r.aiLikelyPct, 0) },
      { h: "Avg AI-likelihood", r: 1, v: (r) => fmt.pct(r.avgAiLikelihood, 0) },
      { h: "Votes (range / all)", r: 1, v: (r) => `${fmt.n(r.votesInRange)} / ${fmt.n(r.votesTotal)}` },
      { h: "Flagged (all)", r: 1, v: (r) => fmt.n(r.flaggedTotal) },
      { h: "Cost", r: 1, v: (r) => fmt.usd(r.costUsd) },
    ],
    d.networks,
    "No posts recorded yet.",
  );

const histogram = (d) =>
  barChart(d.aiHistogram, [{ label: "Posts", color: "var(--blue)", get: (b) => b.posts, legend: false }], {
    x: (b) => `${Math.round(b.from * PERCENT)}%`,
    tipTitle: (b) => `AI-likelihood ${Math.round(b.from * PERCENT)}–${Math.round(b.to * PERCENT)}%`,
    tickEvery: 1,
  });

const tellBars = (d) => {
  if (!d.tells.some((t) => t.avg != null)) return el("div", { class: "empty" }, "No scored posts in this range.");
  const strongestFirst = [...d.tells].sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1));
  return el(
    "div",
    { class: "tells" },
    strongestFirst.flatMap((t) => [
      el("span", null, fmt.human(t.id)),
      el("div", { class: "bar", title: "Average level across posts, 0 = absent, 100% = strongest" }, el("span", { style: `width:${Math.round((t.avg ?? 0) * PERCENT)}%;background:${HUMAN_SIDE_TELLS.has(t.id) ? "var(--green)" : "var(--blue)"}` })),
      el("span", { class: "n" }, fmt.pct(t.avg, 0)),
    ]),
  );
};

/** The networks table, then what Jev is seeing (AI-likelihood distribution and average tell strength). */
export function jevSections(d) {
  return [
    section("Networks"),
    panel(networkTable(d)),
    section("What Jev is seeing"),
    el("div", { class: "grid two" }, card("AI-likelihood distribution", histogram(d), "Unique posts in range, by Jev's probability the text is LLM-drafted"), card("Average tell strength", tellBars(d), "Which patterns show up most across scored posts")),
  ];
}
