import { watchManifest } from "../shared/manifest";
import { mountSettingsPanel } from "./settingsPanel";
import { send } from "../shared/messages";
import { paintDevice } from "./device";
import { paintStats, paintUsage } from "./statsPanel";

/** The toolbar popup: settings on top, then how much it has done. Developer options live on the extension's settings page. */
async function main() {
  await watchManifest();
  await mountSettingsPanel();
  void paintStats();
  void paintUsage();
  void paintDevice();
  void send({ type: "refreshUsage" }).catch(() => undefined); // the device id and limit, without spending a check
  chrome.storage.onChanged.addListener(() => {
    void paintStats();
    void paintUsage();
    void paintDevice();
  });
  document.getElementById("open-settings")!.addEventListener("click", (e) => {
    e.preventDefault();
    void chrome.runtime.openOptionsPage();
  });
}
void main();
