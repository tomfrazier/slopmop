import { barChart, seriesAxis } from "../charts.js";
import { el } from "../dom.js";
import { fmt, localHour, tzName } from "../format.js";
import { card } from "../widgets.js";

const pad2 = (n) => String(n).padStart(2, "0");

/** Checks and cost over time, then installs and time-of-day usage. Returns two rows of cards. */
export function activityCharts(d) {
  const axis = seriesAxis(d);
  const overTime = { x: axis.x, tipTitle: axis.tipTitle };

  const checks = barChart(
    d.series,
    [
      { label: "Scored by Jev", color: "var(--blue)", get: (b) => b.scored },
      { label: "From cache", color: "var(--grey)", get: (b) => b.cached },
      { label: "Errors", color: "var(--red)", get: (b) => b.errors },
      { label: "Daily-limit hits", color: "var(--amber)", get: (b) => b.limited },
    ],
    overTime,
  );
  const cost = barChart(d.series, [{ label: "Cost", color: "var(--violet)", get: (b) => b.costUsd }], { ...overTime, y: fmt.usd, ytip: fmt.usd, money: true });
  const installs = barChart(d.series, [{ label: "Active installs", color: "var(--green)", get: (b) => b.activeInstalls }, { label: "New installs (first seen)", color: "var(--blue)", get: (b) => b.newInstalls }], overTime);
  // The server counts by UTC hour; relabel each to the hour it is in the chosen zone (today's offset) and put them in local order.
  const localHours = d.hourOfDay.map((h) => ({ ...h, hour: localHour(h.hour) })).sort((a, b) => a.hour - b.hour);
  const byHour = barChart(localHours, [{ label: "Checks", color: "var(--blue)", get: (h) => h.checks, legend: false }], {
    x: (h) => pad2(h.hour),
    tipTitle: (h) => `${pad2(h.hour)}:00–${pad2(h.hour)}:59 ${tzName()}`,
    tickEvery: 3,
  });

  return [
    el("div", { class: "grid two" }, card("Checks over time", checks, axis.hourly ? "Per hour" : "Per day"), card("Jev cost over time", cost, `$${d.pricing.inputUsdPerM}/M input tokens`)),
    el("div", { class: "grid two" }, card("Installs", installs, "Devices that checked something, and devices first seen"), card(`When people use it (${tzName()} hour of day)`, byHour)),
  ];
}
