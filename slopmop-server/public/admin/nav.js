// The dashboard's sections and the side navigation. A section is a hash route (#/devices), so links, back and reload all work.
import { el, mopMark } from "./dom.js";

export const PAGES = [
  { id: "overview", label: "Overview", note: "Activity, cost and errors" },
  { id: "devices", label: "Devices", note: "Every install: find one, set its limits, switch it off" },
  { id: "errors", label: "Errors", note: "Every error and refused request, with filters" },
  { id: "review", label: "Post review", note: "Paste a post: why it scored as it did, and what would change it" },
  { id: "scoring", label: "Scoring", note: "How a score is made: simulator, weights, thresholds, tuner" },
  { id: "defaults", label: "Defaults", note: "Default limits and what the extension runs on" },
  { id: "posts", label: "Posts and votes", note: "What Jev found, and what the community said" },
];

export const currentPage = () => PAGES.find((p) => location.hash === `#/${p.id}`)?.id ?? "overview";
export const pageInfo = (id) => PAGES.find((p) => p.id === id);

/** The left-hand navigation. */
export function sidebar(active) {
  return el(
    "nav",
    { class: "side", "aria-label": "Sections" },
    el("div", { class: "brand" }, mopMark(24), el("span", null, "Slop Mop")),
    PAGES.map((p) => el("a", { href: `#/${p.id}`, "aria-current": p.id === active ? "page" : null, title: p.note }, p.label)),
  );
}
