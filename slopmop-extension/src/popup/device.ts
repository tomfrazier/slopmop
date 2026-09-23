import { SERVER_URL } from "../shared/config";
import type { Usage } from "../shared/types";
import { $ } from "../shared/pageDom";

interface Problem {
  at: number;
  message: string;
}

/** A problem this recent is worth showing in the popup; older ones are only in the copied support text. */
const PROBLEM_SHOWN_MS = 30 * 60 * 1000;
const COPIED_SHOWN_MS = 1500;

const read = async () => (await chrome.storage.local.get(["usage", "lastProblem"])) as { usage?: Usage; lastProblem?: Problem };
const ago = (t: number) => {
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};

/** What to paste into a support message: which build, which device, which server, and what last went wrong. */
export const supportText = (device: string | undefined, problem: Problem | undefined) =>
  [`Slop Mop ${chrome.runtime.getManifest().version}`, `Device: ${device ?? "not known yet"}`, `Server: ${SERVER_URL}`, `Last problem: ${problem ? `${problem.message} (${ago(problem.at)})` : "none"}`].join("\n");

let copiedTimer = 0;

/** The faint device id under the logo (click to copy support text), and the last problem if it was just now. */
export async function paintDevice() {
  const { usage, lastProblem } = await read();
  const button = $<HTMLButtonElement>("device");
  if (!copiedTimer) button.textContent = `Device ${usage?.device ?? "–"}`;
  button.onclick = async () => {
    try {
      await navigator.clipboard.writeText(supportText(usage?.device, lastProblem));
      button.textContent = "Copied";
      clearTimeout(copiedTimer);
      copiedTimer = window.setTimeout(() => {
        copiedTimer = 0;
        button.textContent = `Device ${usage?.device ?? "–"}`;
      }, COPIED_SHOWN_MS);
    } catch {
      /* clipboard blocked: the id is still on screen */
    }
  };
  const note = $("problem");
  const recent = !!lastProblem && Date.now() - lastProblem.at < PROBLEM_SHOWN_MS;
  note.hidden = !recent;
  if (recent) note.textContent = `Last problem (${ago(lastProblem!.at)}): ${lastProblem!.message}`;
}
