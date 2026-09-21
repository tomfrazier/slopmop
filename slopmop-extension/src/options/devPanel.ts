import { updateSettings } from "../shared/settings";
import type { Settings } from "../shared/types";
import { paintDebug } from "./debugPanel";
import { $, POLL_INTERVAL_MS } from "../shared/pageDom";
import { mountVotesPanel, paintLabels } from "./votesPanel";

/** The Debug switch and its panel, and the saved-votes list. Keeps itself fresh while the page is open. */
export function mountDevPanel(settings: Settings) {
  const debug = $<HTMLInputElement>("debug");
  debug.checked = settings.debug;
  void paintDebug(settings.debug);
  debug.addEventListener("change", async () => {
    await updateSettings({ debug: debug.checked });
    void paintDebug(debug.checked);
  });
  mountVotesPanel();
  setInterval(() => {
    void paintDebug(debug.checked);
    void paintLabels();
  }, POLL_INTERVAL_MS);
}
