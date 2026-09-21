import { disableCheckbox } from "../clients.js";
import { el } from "../dom.js";
import { fmt } from "../format.js";
import { deviceCode, table } from "../widgets.js";

const PERCENT = 100;

/** Peak share of the daily cap a device would use if it spread its checks evenly over the days it was active. */
const capUse = (r, dailyLimit) => Math.min(PERCENT, Math.round((r.checks / Math.max(1, r.activeDays) / dailyLimit) * PERCENT));

export const deviceTable = (d) =>
  table(
    [
      { h: "Disabled", v: disableCheckbox },
      { h: "Device", v: deviceCode },
      { h: "Checks", r: 1, v: (r) => fmt.n(r.checks) },
      { h: "Jev calls", r: 1, v: (r) => fmt.n(r.scored) },
      { h: "Cost", r: 1, v: (r) => fmt.usd(r.costUsd) },
      {
        h: "vs cap/day",
        r: 1,
        v: (r) => el("div", { class: "bar", title: `Peak share of the ${d.limits.dailyLimit}/day cap if used evenly over active days` }, el("span", { style: `width:${capUse(r, d.limits.dailyLimit)}%;background:${r.limitHits ? "var(--amber)" : "var(--blue)"}` })),
      },
      { h: "Limit hits", r: 1, v: (r) => (r.limitHits ? el("span", { class: "warn" }, fmt.n(r.limitHits)) : "0") },
      { h: "Errors", r: 1, v: (r) => fmt.n(r.errors) },
      { h: "Votes", r: 1, v: (r) => fmt.n(r.votes) },
      { h: "Active days", r: 1, v: (r) => fmt.n(r.activeDays) },
      { h: "First seen", v: (r) => fmt.time(r.firstSeen) },
      { h: "Last seen", v: (r) => fmt.ago(r.lastSeen) },
    ],
    d.devices,
    "No activity in this range.",
  );
