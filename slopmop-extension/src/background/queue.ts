import { PUMP_SLACK_MS } from "../shared/constants";
import type { JudgeResponse } from "../shared/types";
import { requestVerdict, type Job } from "./judgeRequest";
import { currentPolicy, onPolicyChange, startDelay } from "./policy";

// The request queue: as many in flight as the server's policy allows, nearest-to-viewport first.
const queue: Job[] = [];
const pending = new Map<string, Job>();
let inFlight = 0;
let pumpTimer: ReturnType<typeof setTimeout> | undefined;

/** Queues a post for checking. The same post asked for twice shares one request. */
export function enqueue(job: Omit<Job, "resolvers">): Promise<JudgeResponse | null> {
  return new Promise((resolve) => {
    const existing = pending.get(job.key);
    if (existing) {
      existing.priority = Math.min(existing.priority, job.priority);
      existing.resolvers.push(resolve);
      return;
    }
    const j: Job = { ...job, resolvers: [resolve] };
    pending.set(job.key, j);
    queue.push(j);
    pump();
  });
}

/**
 * The page tells us where its posts are now. A post still waiting can be re-ranked (nearest to the viewport first) or, when
 * the user has scrolled far past it, dropped: it never costs a check, and it is asked for again if it scrolls back.
 * Requests already in flight are left alone.
 */
export function prioritize(items: { urn: string; priority: number | null }[]) {
  const by = new Map(items.map((i) => [i.urn, i.priority]));
  for (const job of [...queue]) {
    if (!by.has(job.urn)) continue;
    const priority = by.get(job.urn);
    if (priority === null || priority === undefined) {
      queue.splice(queue.indexOf(job), 1);
      pending.delete(job.key);
      job.resolvers.forEach((res) => res(null));
    } else job.priority = priority;
  }
}

/** Starts waiting requests while the policy allows. */
function pump() {
  while (inFlight < currentPolicy().maxConcurrent && queue.length) {
    const wait = startDelay();
    if (wait > 0) {
      clearTimeout(pumpTimer);
      pumpTimer = setTimeout(pump, wait + PUMP_SLACK_MS);
      return;
    }
    queue.sort((a, b) => a.priority - b.priority);
    const job = queue.shift()!;
    inFlight++;
    void requestVerdict(job).then((r) => {
      inFlight--;
      pending.delete(job.key);
      job.resolvers.forEach((res) => res(r));
      pump();
    });
  }
}

onPolicyChange(pump); // a raised limit can start waiting jobs right away
