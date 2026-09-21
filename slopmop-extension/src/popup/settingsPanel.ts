import { getSettings, updateSettings } from "../shared/settings";
import type { Mode, Sensitivity, Settings } from "../shared/types";
import { $ } from "../shared/pageDom";

const modeButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-mode]")];
const NOTES: Record<Mode, string> = {
  hide: "Posts that look like slop fold into a small paper strip. Click to unfold.",
  highlight: "Nothing is hidden. Possibly slop: yellow border. Likely slop: red border.",
};

const sensButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-sens]")];
const SENS_NOTES: Record<Sensitivity, string> = {
  mild: "Only the clearest slop. Fewest false alarms.",
  moderate: "The default balance.",
  aggressive: "Catches more, and is wrong more often.",
};

function paint(s: Settings) {
  $<HTMLInputElement>("enabled").checked = s.enabled;
  $("main").classList.toggle("disabled", !s.enabled);
  modeButtons.forEach((b) => b.setAttribute("aria-checked", String(b.dataset.mode === s.mode)));
  $("mode-note").textContent = NOTES[s.mode];
  sensButtons.forEach((b) => b.setAttribute("aria-checked", String(b.dataset.sens === s.sensitivity)));
  $("sens-note").textContent = SENS_NOTES[s.sensitivity];
}

/** The on/off switch, the Hide/Highlight choice and the sensitivity choice. Returns the settings as they were loaded. */
export async function mountSettingsPanel(): Promise<Settings> {
  let settings = await getSettings();
  /** Saves a change, then redraws from what was saved. */
  const change = async (patch: Partial<Settings>) => {
    settings = await updateSettings(patch);
    paint(settings);
    return settings;
  };
  paint(settings);

  $<HTMLInputElement>("enabled").addEventListener("change", async (e) => {
    const box = e.target as HTMLInputElement;
    if (box.checked && !settings.acknowledged) {
      // Can't enable before the research-only acknowledgement.
      box.checked = false;
      await chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") });
      window.close();
      return;
    }
    await change({ enabled: box.checked });
  });
  modeButtons.forEach((b) => b.addEventListener("click", () => void change({ mode: b.dataset.mode as Mode })));
  sensButtons.forEach((b) => b.addEventListener("click", () => void change({ sensitivity: b.dataset.sens as Sensitivity })));
  return settings;
}
