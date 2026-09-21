import { DEFAULT_SETTINGS, type Settings } from "./types";

export async function getSettings(): Promise<Settings> {
  const { settings } = await chrome.storage.sync.get("settings");
  return { ...DEFAULT_SETTINGS, ...(settings as Partial<Settings> | undefined) };
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  // The master toggle can never be on before the research-only acknowledgement.
  if (!next.acknowledged) next.enabled = false;
  await chrome.storage.sync.set({ settings: next });
  return next;
}
