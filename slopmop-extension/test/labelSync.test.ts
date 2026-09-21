import { describe, expect, it } from "vitest";
import { createLabelSync } from "../src/background/labelSync";
import type { LabelEvent } from "../src/shared/types";

const vote = (urn: string, label: "no" | "maybe" | "probably"): LabelEvent => ({
  urn,
  label,
  at: 1,
  text: "t",
  own: false,
  engagement: { reactions: 0, comments: 0, reposts: 0 },
  verdict: { model: "t", aiLikelihood: 0.9, dimensions: {} },
  decided: { level: "none", score: 0, mode: "hide", sensitivity: "moderate" },
});

function harness(behaviour: () => Promise<{ ok: boolean; status: number }>, extra: Partial<Parameters<typeof createLabelSync>[0]> = {}) {
  const store: Record<string, unknown> = {};
  const sent: LabelEvent[] = [];
  const requests: { url: string; headers: Record<string, string>; body: unknown }[] = [];
  const sync = createLabelSync({
    unreachableHint: 'run "npm run collect"',
    ...extra,
    get: async (k) => store[k],
    set: async (k, v) => void (store[k] = v),
    endpoint: "http://collector.test",
    now: () => 1234,
    fetch: async (url, init) => {
      const res = await behaviour();
      requests.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      if (res.ok) sent.push(JSON.parse(init.body));
      return res;
    },
  });
  return { sync, sent, store, requests };
}

describe("label sync", () => {
  it("writes each vote to the collector and empties the outbox", async () => {
    const { sync, sent } = harness(async () => ({ ok: true, status: 200 }));
    await sync.enqueue(vote("a", "probably"));
    const st = await sync.enqueue(vote("b", "no"));
    expect(sent.map((e) => e.urn)).toEqual(["a", "b"]);
    expect(st).toMatchObject({ pending: 0, lastOk: 1234, lastError: null });
  });

  it("keeps votes when the collector is down, then delivers them in order once it is back", async () => {
    let up = false;
    const { sync, sent } = harness(async () => {
      if (!up) throw new TypeError("Failed to fetch");
      return { ok: true, status: 200 };
    });
    await sync.enqueue(vote("a", "maybe"));
    const down = await sync.enqueue(vote("b", "probably"));
    expect(down.pending).toBe(2);
    expect(down.lastError).toMatch(/npm run collect/);
    expect(sent).toHaveLength(0);

    up = true;
    const back = await sync.flush();
    expect(back).toMatchObject({ pending: 0, lastError: null });
    expect(sent.map((e) => e.urn)).toEqual(["a", "b"]); // oldest first
  });

  it("stops at a server error and keeps the rest queued", async () => {
    let n = 0;
    const { sync, sent } = harness(async () => (++n === 2 ? { ok: false, status: 500 } : { ok: true, status: 200 }));
    await sync.enqueue(vote("a", "no"));
    await sync.enqueue(vote("b", "no")); // fails
    const st = await sync.status();
    expect(sent.map((e) => e.urn)).toEqual(["a"]);
    expect(st.pending).toBe(1);
    expect(st.lastError).toMatch(/500/);
  });

  it("caps the outbox so an absent collector can't grow it without bound", async () => {
    const { sync } = harness(async () => {
      throw new TypeError("Failed to fetch");
    });
    for (let i = 0; i < 520; i++) await sync.enqueue(vote(`p${i}`, "no"));
    expect((await sync.status()).pending).toBe(500);
  });

  it("drops an event the endpoint permanently rejects (4xx) instead of blocking the queue behind it", async () => {
    let n = 0;
    const { sync, sent } = harness(async () => (++n === 1 ? { ok: false, status: 404 } : { ok: true, status: 200 }));
    await sync.enqueue(vote("a", "no")); // 404: skipped
    const st = await sync.enqueue(vote("b", "no"));
    expect(sent.map((e) => e.urn)).toEqual(["b"]);
    expect(st.pending).toBe(0);
  });

  it("still treats 429 and 5xx as transient: the event waits", async () => {
    for (const status of [429, 503, 408]) {
      const { sync, sent } = harness(async () => ({ ok: false, status }));
      const st = await sync.enqueue(vote("a", "no"));
      expect(st.pending).toBe(1);
      expect(sent).toHaveLength(0);
    }
  });

  it("can post to another path, with extra headers, its own queue, and a custom body (the server vote endpoint)", async () => {
    const store: Record<string, unknown> = {};
    const mk = (k: string, path: string) =>
      createLabelSync({ get: async (key) => store[key], set: async (key, v) => void (store[key] = v), endpoint: "http://server.test", path, outboxKey: `${k}Outbox`, statusKey: `${k}Status`, name: "server", fetch: async () => ({ ok: true, status: 200 }) });
    await mk("a", "/x").enqueue(vote("a", "no"));
    const requests: { url: string; headers: Record<string, string>; body: unknown }[] = [];
    const server = createLabelSync({
      get: async (key) => store[key],
      set: async (key, v) => void (store[key] = v),
      endpoint: "http://server.test",
      path: "/api/v1/vote",
      outboxKey: "voteOutbox",
      statusKey: "voteStatus",
      headers: async () => ({ "x-install-id": "install-1" }),
      toBody: (e) => ((e as { contentId?: string }).contentId ? { contentId: (e as { contentId: string }).contentId, vote: e.label } : null),
      fetch: async (url, init) => (requests.push({ url, headers: init.headers, body: JSON.parse(init.body) }), { ok: true, status: 200 }),
    });
    await server.enqueue({ ...(vote("p", "probably") as object), contentId: "c".repeat(32) } as LabelEvent);
    await server.enqueue(vote("no-content-id", "no")); // no contentId: nothing to share, dropped quietly
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ url: "http://server.test/api/v1/vote", headers: { "x-install-id": "install-1", "content-type": "application/json" }, body: { contentId: "c".repeat(32), vote: "probably" } });
    expect((await server.status()).pending).toBe(0);
    expect(store.voteOutbox).toEqual([]);
  });

  it("sends clears as events too", async () => {
    const { sync, sent } = harness(async () => ({ ok: true, status: 200 }));
    await sync.enqueue({ urn: "a", label: null, at: 9 });
    expect(sent[0]).toEqual({ urn: "a", label: null, at: 9 });
  });
});
