import { panel, section } from "../widgets.js";
import { deviceTable } from "./devices.js";
import { footer } from "./footer.js";
import { problemsTable } from "./problems.js";

const RECENT_COUNT = 25;

/** The Overview's lower half: the busiest devices (the full list is on the Devices page), recent errors, and the footer. */
export function overviewTail(d) {
  const I = d.installs;
  return [
    section("Busiest devices", `Top ${RECENT_COUNT} in this range · cap is ${d.limits.dailyLimit}/day · today ${I.todayActive} active, ${I.todayNearCap} at ≥80%, ${I.todayAtCap} at cap · every device is on the Devices page`),
    panel(deviceTable(d)),
    section("Errors and limit hits", `Most recent ${RECENT_COUNT}`),
    panel(problemsTable(d)),
    footer(d),
  ];
}
