import { fold, panel } from "../widgets.js";
import { activityCharts } from "./activity.js";
import { deviceTable } from "./devices.js";
import { footer } from "./footer.js";
import { problemsTable } from "./problems.js";

const RECENT_COUNT = 25;

/** The Overview below the headline numbers: the charts, the busiest devices, recent errors, and the footer. */
export function overviewFolds(d) {
  const I = d.installs;
  return [
    fold("activity", "Activity", "Checks, cost, installs and when people use it", ...activityCharts(d)),
    fold("busiest", "Busiest devices", `Top ${RECENT_COUNT} in this range · default cap ${d.limits.dailyLimit}/day · today ${I.todayActive} active, ${I.todayNearCap} at ≥80% of their own cap, ${I.todayAtCap} at it · every device is on the Devices page`, panel(deviceTable(d))),
    fold("errors", "Errors and limit hits", `Latest ${RECENT_COUNT} · every one, with filters, is on the Errors page`, panel(problemsTable(d))),
    footer(d),
  ];
}
