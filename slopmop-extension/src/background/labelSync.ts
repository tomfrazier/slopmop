import type { LabelEvent, LabelSync } from "../shared/types";
import { createSerial } from "../shared/serial";

/**
 * A durable outbox for vote events. Every vote is first saved in the browser (the source of truth); this keeps a
 * queue and POSTs the events, in order, to an endpoint: the local file collector (`npm run collect`) and the Slop Mop
 * server's vote endpoint each get their own instance. If the endpoint is down the events simply wait, so no vote is
 * ever lost. An event the endpoint permanently rejects (a 4xx) is dropped so it can't block the ones behind it.
 */
export interface Deps {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  fetch: (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number }>;
  endpoint: string;
  /** Request path, default "/label". */
  path?: string;
  /** Storage keys, so two instances don't share a queue. */
  outboxKey?: string;
  statusKey?: string;
  /** Extra headers (for example the install id), resolved at send time. */
  headers?: () => Promise<Record<string, string>>;
  /** Turns an event into the request body; null means "nothing to send for this one" (it is dropped). */
  toBody?: (e: LabelEvent) => unknown | null;
  /** What to call the destination in messages, and the hint for an unreachable one. */
  name?: string;
  unreachableHint?: string;
  now?: () => number;
}

/** Without a collector running (the normal case for a non-developer) the queue would grow forever; the votes themselves are safe in storage. */
const MAX_OUTBOX = 500;
/** A rejection that retrying won't fix. 408 and 429 are transient. */
const permanent = (status: number) => status >= 400 && status < 500 && status !== 408 && status !== 429;

interface SyncStatus {
  lastOk: number | null;
  lastError: string | null;
}

export function createLabelSync(d: Deps) {
  const now = d.now ?? Date.now;
  const OUTBOX = d.outboxKey ?? "labelOutbox";
  const STATUS = d.statusKey ?? "labelSyncStatus";
  const name = d.name ?? "collector";
  const serial = createSerial();

  const outbox = async () => ((await d.get(OUTBOX)) as LabelEvent[] | undefined) ?? [];
  const status = async (): Promise<SyncStatus> => ((await d.get(STATUS)) as SyncStatus | undefined) ?? { lastOk: null, lastError: null };

  async function report(): Promise<LabelSync> {
    const s = await status();
    return { pending: (await outbox()).length, lastOk: s.lastOk, lastError: s.lastError, endpoint: d.endpoint };
  }

  /** Sends one event. A permanent rejection is recorded and the event skipped; a transient failure throws so the queue keeps it. */
  async function deliver(e: LabelEvent, st: SyncStatus) {
    const body = d.toBody ? d.toBody(e) : e;
    if (body === null) return; // nothing to send for this one
    const res = await d.fetch(`${d.endpoint}${d.path ?? "/label"}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(d.headers ? await d.headers() : {}) },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      st.lastOk = now();
      st.lastError = null;
    } else if (permanent(res.status)) st.lastError = `${name} rejected an event (${res.status}); skipped it`;
    else throw new Error(`${name} answered ${res.status}`);
  }

  const describe = (e: unknown) =>
    e instanceof TypeError ? `${name} not reachable at ${d.endpoint}${d.unreachableHint ? `: ${d.unreachableHint}` : ""}` : e instanceof Error ? e.message : String(e);

  /** Sends queued events oldest-first; stops at the first transient failure and keeps the rest. */
  const flush = () =>
    serial(async () => {
      let box = await outbox();
      const st = await status();
      while (box.length) {
        try {
          await deliver(box[0], st);
        } catch (e) {
          st.lastError = describe(e);
          await d.set(STATUS, st);
          return report();
        }
        box = box.slice(1);
        await d.set(OUTBOX, box);
        await d.set(STATUS, st);
      }
      return report();
    });

  return {
    /** Queue an event and try to send it right away. */
    enqueue: (e: LabelEvent) =>
      serial(async () => {
        await d.set(OUTBOX, [...(await outbox()), e].slice(-MAX_OUTBOX));
      }).then(flush),
    flush,
    status: () => serial(report),
  };
}
