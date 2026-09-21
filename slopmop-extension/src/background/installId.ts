/** A random id created at install: anonymous, and only used by the server for its per-install limits. */
export async function installId(): Promise<string> {
  const { installId } = await chrome.storage.local.get("installId");
  if (typeof installId === "string") return installId;
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ installId: id });
  return id;
}
