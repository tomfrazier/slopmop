/**
 * The last thing that stopped a post being checked, kept where the popup can show it (and copy it into a support message), and
 * cleared by the next success. Kept apart from the per-tab debug counters, which the popup never reads for ordinary users.
 */
const KEY = "lastProblem";
export interface Problem {
  at: number;
  message: string;
}

/** Whether a problem is currently stored; null until we've looked, so a restarted worker doesn't write on every success. */
let stored: boolean | null = null;

export async function noteProblem(message: string): Promise<void> {
  stored = true;
  await chrome.storage.local.set({ [KEY]: { at: Date.now(), message } satisfies Problem });
}

export async function clearProblem(): Promise<void> {
  if (stored === null) stored = !!(await chrome.storage.local.get(KEY))[KEY];
  if (!stored) return;
  stored = false;
  await chrome.storage.local.remove(KEY);
}
