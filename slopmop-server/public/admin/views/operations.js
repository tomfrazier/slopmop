import { disabledClientsCard } from "../clients.js";
import { panel, section } from "../widgets.js";
import { deviceTable } from "./devices.js";
import { footer } from "./footer.js";
import { problemsTable } from "./problems.js";

const RECENT_COUNT = 25;

/** Devices (with the kill switch), disabled clients, recent errors, and the footer. */
export function operationsSections(d) {
  const I = d.installs;
  return [
    section("Devices", `Top ${RECENT_COUNT} by checks · cap is ${d.limits.dailyLimit}/day · today ${I.todayActive} active, ${I.todayNearCap} at ≥80%, ${I.todayAtCap} at cap`),
    panel(deviceTable(d)),
    section("Disabled clients", "Disabled clients are refused by the server, and their votes stop counting"),
    panel(disabledClientsCard(d)),
    section("Errors and limit hits", `Most recent ${RECENT_COUNT}`),
    panel(problemsTable(d)),
    footer(d),
  ];
}
