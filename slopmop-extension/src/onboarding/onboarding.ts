import { updateSettings } from "../shared/settings";

const ack = document.getElementById("ack") as HTMLInputElement;
const go = document.getElementById("go") as HTMLButtonElement;
ack.addEventListener("change", () => (go.disabled = !ack.checked));
go.addEventListener("click", async () => {
  await updateSettings({ acknowledged: true, enabled: true });
  document.getElementById("done")!.textContent = "Enabled. Open your LinkedIn feed.";
  go.disabled = true;
});
