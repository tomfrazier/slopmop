import { api, prefs } from "../api.js";
import { el } from "../dom.js";
import { fmt } from "../format.js";

const EXPORT_MIN_VOTES = "2";
const EXPORT_LIMIT = "10000";
const OBJECT_URL_LIFETIME_MS = 5000;

async function downloadExport() {
  try {
    const res = await api("/export", { network: prefs.network || "linkedin", minVotes: EXPORT_MIN_VOTES, limit: EXPORT_LIMIT }, true);
    const link = el("a", { href: URL.createObjectURL(await res.blob()), download: `slopmop-export-${new Date().toISOString().slice(0, 10)}.ndjson` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), OBJECT_URL_LIFETIME_MS);
  } catch (e) {
    alert(e.message);
  }
}

export const footer = (d) =>
  el(
    "div",
    { class: "foot" },
    el("button", { onclick: downloadExport }, "Download tuning export (NDJSON)"),
    el("span", null, `Stored: ${fmt.n(d.storage.contentRows)} posts · ${fmt.n(d.storage.voteRows)} votes · ${fmt.n(d.storage.eventRows)} events (kept ${d.limits.eventRetentionDays} days) · ${fmt.n(d.storage.installRows)} installs`),
    el("span", null, d.limits.storesText ? "Post text IS stored (STORE_CONTENT_TEXT on)" : "Post text is not stored"),
    el("span", null, "Devices are shown as a prefix of a salted hash"),
  );
