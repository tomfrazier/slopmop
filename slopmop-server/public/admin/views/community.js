import { barChart, seriesAxis } from "../charts.js";
import { el } from "../dom.js";
import { fmt } from "../format.js";
import { card, panel, postColumns, section, table } from "../widgets.js";

const VOTE_ORDER = ["no", "maybe", "probably"];

const votesOverTime = (d) => {
  const axis = seriesAxis(d);
  return barChart(
    d.series,
    [
      { label: "Probably (flagged)", color: "var(--red)", get: (b) => b.votes.probably },
      { label: "Maybe", color: "var(--amber)", get: (b) => b.votes.maybe },
      { label: "No", color: "var(--green)", get: (b) => b.votes.no },
    ],
    { x: axis.x, tipTitle: axis.tipTitle },
  );
};

const calibrationTable = (d) =>
  table(
    [
      { h: "Vote", v: (r) => r.vote },
      { h: "Votes", r: 1, v: (r) => fmt.n(r.votes) },
      { h: "Avg Jev AI-likelihood", r: 1, v: (r) => fmt.pct(r.avgAiLikelihood, 0) },
      { h: "Jev agrees", r: 1, v: (r) => (r.jevAgreesPct == null ? "n/a" : fmt.pct(r.jevAgreesPct, 0)) },
    ],
    VOTE_ORDER.map((v) => d.community.calibration.find((c) => c.vote === v)).filter(Boolean),
    "No votes on scored posts yet.",
  );

/** Votes over time, how Jev lines up with voters, the most-flagged posts, and where they disagree. */
export function communitySections(d) {
  const { mostFlagged, jevMissed, jevOverreached } = d.posts;
  return [
    section("Community", "What people said, and how it lines up with Jev"),
    el("div", { class: "grid two" }, card("Votes over time", votesOverTime(d)), card("Jev vs. voters", calibrationTable(d), '"Jev agrees" = Jev leaned the same way: AI-likely for probably, not for no')),
    panel([el("h2", null, "Most flagged posts"), table(postColumns(), mostFlagged, "Nobody has flagged anything yet.")], "margin-bottom:12px"),
    el(
      "div",
      { class: "grid two" },
      card("Voters said slop, Jev didn't", table(postColumns(), jevMissed, "No disagreements. Jev caught what people flagged."), "Candidates for lowering thresholds"),
      card("Voters said fine, Jev flagged it", table(postColumns(), jevOverreached, "No disagreements."), "Candidates for raising thresholds / a false-positive check"),
    ),
  ];
}
