import { watchManifest } from "../shared/manifest";
import { mountSettingsPanel } from "./settingsPanel";
import { paintStats, paintUsage } from "./statsPanel";

/** The toolbar popup: settings on top, then how much it has done. Developer options live on the extension's settings page. */
async function main() {
  await watchManifest();
  await mountSettingsPanel();
  void paintStats();
  void paintUsage();
  chrome.storage.onChanged.addListener(() => {
    void paintStats();
    void paintUsage();
  });
  document.getElementById("open-settings")!.addEventListener("click", (e) => {
    e.preventDefault();
    void chrome.runtime.openOptionsPage();
  });
}
void main();
