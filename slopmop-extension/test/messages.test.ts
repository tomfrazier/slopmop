import { beforeEach, describe, expect, it, vi } from "vitest";

let sendMessage: (m: unknown) => Promise<unknown>;
beforeEach(() => {
  vi.resetModules();
  (globalThis as any).chrome = { runtime: { id: "ext", sendMessage: (m: unknown) => sendMessage(m) } };
});

describe("send", () => {
  it("passes the reply through", async () => {
    sendMessage = async () => ({ ok: 1 });
    const { send } = await import("../src/shared/messages");
    expect(await send({ type: "getStats" })).toEqual({ ok: 1 });
  });

  it("when the extension has been reloaded, stops the page script once and resolves instead of throwing", async () => {
    sendMessage = async () => {
      throw new Error("Extension context invalidated.");
    };
    const { send, whenExtensionGone } = await import("../src/shared/messages");
    const gone = vi.fn();
    whenExtensionGone(gone);
    await expect(send({ type: "pageStart" })).resolves.toBeUndefined();
    await expect(send({ type: "pageStart" })).resolves.toBeUndefined();
    expect(gone).toHaveBeenCalled();
  });

  it("still throws every other kind of error", async () => {
    sendMessage = async () => {
      throw new Error("Could not establish connection.");
    };
    const { send } = await import("../src/shared/messages");
    await expect(send({ type: "pageStart" })).rejects.toThrow("Could not establish connection");
  });

  it("knows whether the extension is still there", async () => {
    const { extensionAlive } = await import("../src/shared/messages");
    expect(extensionAlive()).toBe(true);
    (globalThis as any).chrome.runtime.id = undefined;
    expect(extensionAlive()).toBe(false);
  });
});
