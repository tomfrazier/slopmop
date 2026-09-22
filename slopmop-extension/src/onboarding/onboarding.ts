import { updateSettings } from "../shared/settings";

const ack = document.getElementById("ack") as HTMLInputElement;
const go = document.getElementById("go") as HTMLButtonElement;
const openFeed = document.getElementById("openFeed") as HTMLButtonElement;
const done = document.getElementById("done")!;
const version = document.getElementById("version")!;

const LINKEDIN_FEED_URL = "https://www.linkedin.com/feed/";

version.textContent = `v${chrome.runtime.getManifest().version} · free · MIT · 250 checks a day`;

ack.addEventListener("change", () => (go.disabled = !ack.checked));

go.addEventListener("click", async () => {
  await updateSettings({ acknowledged: true, enabled: true });
  done.textContent = "Enabled. Open your LinkedIn feed to see it in action.";
  go.disabled = true;
  openFeed.disabled = false;
  openFeed.focus();
});

// Opens in this same tab (not a new one), so the one-time onboarding tab becomes the feed itself.
openFeed.addEventListener("click", () => {
  location.href = LINKEDIN_FEED_URL;
});
