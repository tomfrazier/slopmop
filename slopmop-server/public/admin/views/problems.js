import { el } from "../dom.js";
import { fmt } from "../format.js";
import { deviceCode, table } from "../widgets.js";

/** How each kind of refusal is named in the errors table. */
const REFUSAL_NAMES = { rate_limit: "rate limit", disabled: "blocked (disabled)", ip_rate_limit: "IP hourly limit", datacenter_ip: "datacenter IP" };

export const problemsTable = (d) =>
  table(
    [
      { h: "When", v: (r) => fmt.time(r.at) },
      { h: "What", v: (r) => el("span", { class: `pill ${r.kind}` }, r.kind === "limited" ? REFUSAL_NAMES[r.detail] || "daily limit" : "error") },
      { h: "Detail", v: (r) => r.detail || "-" },
      { h: "Network", v: (r) => r.network },
      { h: "Device", v: deviceCode },
    ],
    d.problems,
    "No errors or limit hits in this range. \u{1F389}",
  );
