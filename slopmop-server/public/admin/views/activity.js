import { UNIT_LABELS } from "../axes.js";
import { barChart, seriesAxis } from "../charts.js";
import { el } from "../dom.js";
import { fmt, rangeLabel, tzName } from "../format.js";
import { card } from "../widgets.js";
import { segmented } from "./header.js";

const pad2 = (n) => String(n).padStart(2, "0");

const rangeText = (d) => rangeLabel(d.range);

const PER = { hour: "Per hour", day: "Per day", week: "Per week (from Monday)", month: "Per month" };

/** Hour / Day / Week / Month for the over-time charts (not the hour-of-day one), offering only what suits the range. */
const unitToggle = (d) =>
  d.units.length > 1
    ? el("div", { class: "tools unit-toggle" }, el("span", { class: "sub" }, "Count the charts over time by"), segmented(d.units.map((u) => [u, UNIT_LABELS[u]]), "unit", d.unit))
    : null;

/** Checks and cost over time, then installs and time-of-day usage. Returns the unit toggle and two rows of cards. */
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
  // The server already places each check at its hour in the chosen timezone.
  const byHour = barChart(d.hourOfDay, [{ label: "Checks", color: "var(--blue)", get: (h) => h.checks, legend: false }], {
    x: (h) => pad2(h.hour),
    tipTitle: (h) => `${pad2(h.hour)}:00–${pad2(h.hour)}:59 ${tzName()}`,
    tickEvery: 3,
  });

  const per = PER[d.unit];
  return [
    unitToggle(d),
    el("div", { class: "grid two" }, card("Checks over time", checks, per), card("Jev cost over time", cost, `${per} · $${d.pricing.inputUsdPerM}/M input tokens`)),
    el("div", { class: "grid two" }, card("Installs", installs, `${per} · devices that checked something, and devices first seen`), card(`When people use it (${tzName()} hour of day)`, byHour, `All of the ${rangeText(d)} added up by hour`)),
  ];
}
