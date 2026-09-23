// Slop Mop admin dashboard. No dependencies, no build step: plain ES modules, all rendered with DOM APIs (never innerHTML).
import { AuthError, api, getToken, prefs, setToken } from "./api.js";
import { el } from "./dom.js";
import { hooks } from "./hooks.js";
import { W, loadWeights } from "./weightsState.js";
import { simulatorCard } from "./simulator.js";
import { loadTuner, tunerCard } from "./tunerEditor.js";
import { manifestCard, loadManifest, M } from "./manifestEditor.js";
import { limitsCard, loadLimits } from "./limitsEditor.js";
import { currentPage, sidebar } from "./nav.js";
import { scoringCard, loadScoring, S } from "./scoringEditor.js";
import { weightsCard } from "./weightsEditor.js";
import { section, panel } from "./widgets.js";
import { activityCharts } from "./views/activity.js";
import { communitySections } from "./views/community.js";
import { devicesPage } from "./views/devicesPage.js";
import { header } from "./views/header.js";
import { jevSections } from "./views/jev.js";
import { kpiRow } from "./views/kpis.js";
import { overviewTail } from "./views/operations.js";

const app = document.getElementById("app");
const AUTO_REFRESH_MS = 60_000;

let timer = null;
let lastStats = null;

// ---------------------------------------------------------------- sign-in
function login(message) {
  clearInterval(timer);
  const input = el("input", { type: "password", placeholder: "Admin key", autocomplete: "current-password", required: true, autofocus: true, "aria-label": "Admin key" });
  const err = el("div", { class: "err", role: "alert" }, message || "");
  const form = el(
    "form",
    {
      onsubmit: async (e) => {
        e.preventDefault();
        setToken(input.value.trim());
        err.textContent = "Checking…";
        try {
          await load();
        } catch (ex) {
          setToken("");
          err.textContent = ex.message;
          input.value = "";
          input.focus();
        }
      },
    },
    input,
    el("button", { class: "primary", type: "submit" }, "Sign in"),
    err,
  );
  app.replaceChildren(el("div", { class: "login" }, el("h1", null, "Slop Mop admin"), el("div", { class: "sub" }, "Enter the ADMIN_TOKEN configured on the server."), form));
  input.focus();
}

// ---------------------------------------------------------------- loading and drawing
/** Fetches (unless `refetch` is false and we already have data) and draws the page, then restarts the auto-refresh timer. */
async function load(refetch = true) {
  if (!app.firstChild) app.replaceChildren(el("div", { class: "empty" }, "Loading…"));
  if (refetch || !lastStats) [lastStats] = await Promise.all([api("/stats", { range: prefs.range, network: prefs.network }), loadWeights(), loadScoring(), loadManifest(), loadTuner(), loadLimits()]);
  render(lastStats);
  clearInterval(timer);
  if (prefs.refresh) timer = setInterval(() => (currentPage() === "devices" ? void hooks.reloadDevices() : !W.dirty && !S.dirty && !M.dirty && void refresh()), AUTO_REFRESH_MS); // not while a weight edit is in progress; the device list reloads in place so a search isn't lost
}

async function refresh(refetch = true) {
  if (currentPage() === "devices") return hooks.reloadDevices(); // the device list fetches its own data and redraws itself
  try {
    await load(refetch);
  } catch (e) {
    if (e instanceof AuthError) login(e.message);
  }
}

/** What each section shows. Each is built from modules under views/ (or a card of its own). */
const PAGES = {
  overview: (d) => [kpiRow(d), ...activityCharts(d), ...overviewTail(d)],
  devices: () => [devicesPage()],
  scoring: () => [
    section("How a score is made", "The formula with today's numbers, and a simulator that runs the real code. Nothing here is saved."),
    panel(simulatorCard()),
    section("Tell weights", "How much each tell counts toward the slop score. Edits are live."),
    panel(weightsCard()),
    section("Scoring", "The likely-slop threshold for each sensitivity, and how reader response is measured. Edits are live."),
    panel(scoringCard()),
    section("Threshold tuner", "What each cut would catch on labelled posts. It only suggests; you decide."),
    panel(tunerCard()),
  ],
  defaults: () => [
    limitsCard(),
    section("Client settings", "Every fixed value the extension runs on. Edits reach extensions within a day, sooner as they hear a new version."),
    panel(manifestCard()),
  ],
  posts: (d) => [...jevSections(d), ...communitySections(d)],
};

/** The page for the current section: the side navigation, then the section's own header and content. */
function render(d) {
  const page = currentPage();
  app.replaceChildren(el("div", { class: "layout" }, sidebar(page), el("div", { class: "content" }, header(d, page), ...PAGES[page](d))));
}

// ---------------------------------------------------------------- boot
hooks.refresh = refresh;
window.addEventListener("hashchange", () => lastStats && void load(false)); // a section link: redraw from what we already have
hooks.login = login;

(async function boot() {
  if (!getToken()) return login();
  try {
    await load();
  } catch (e) {
    if (e instanceof AuthError) {
      setToken("");
      login(e.message);
    } else {
      app.replaceChildren(el("div", { class: "login" }, el("h1", null, "Couldn't load"), el("div", { class: "err" }, e.message), el("button", { onclick: () => location.reload() }, "Retry")));
    }
  }
})();
