import { API_BASE, NETWORK } from "../shared/config";
import { PUMP_SLACK_MS } from "../shared/constants";
import { live } from "../shared/manifest";
import type { JudgeResponse } from "../shared/types";
import { engagementBand } from "../shared/engagement";
import { installId } from "./installId";
import { describeNetworkError, interpretFailure } from "./judgeFailure";
import type { Attempt, Job } from "./judgeTypes";
import { learnPolicy, noteRequestStart, pauseFor, pausedForMs } from "./policy";
import { learnManifestVersion } from "./manifest";
import { updateTab } from "./tabs";
import { learnWeightsVersion, writeCached } from "./verdictCache";

export type { Job } from "./judgeTypes";

async function sendOnce(job: Job, id: string, attempt: number): Promise<Attempt> {
  const backoffMs = live.values.baseBackoffMs * 2 ** attempt;
  try {
    noteRequestStart();
    const res = await fetch(`${API_BASE}/judge`, {
      method: "POST",
      signal: AbortSignal.timeout(live.values.requestTimeoutMs),
      headers: { "content-type": "application/json", "x-install-id": id },
      body: JSON.stringify({ network: NETWORK, postText: job.text, surfaceStats: job.stats, nativeId: job.nativeId, engagement: job.engagement }),
    });
    if (!res.ok) return await interpretFailure(res, backoffMs);
    const response = (await res.json()) as JudgeResponse & { policy?: unknown };
    learnPolicy(response.policy);
    learnWeightsVersion(response.weightsVersion);
    learnManifestVersion(response.manifestVersion);
    await writeCached(job.key, response, job.engagement ? engagementBand(job.engagement) : undefined);
    return { kind: "ok", response };
  } catch (e) {
    return { kind: "retry", error: describeNetworkError(e), pauseMs: backoffMs };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Asks the server to check a post, retrying what is worth retrying. Any failure leaves the post alone (null). */
export async function requestVerdict(job: Job): Promise<JudgeResponse | null> {
  const id = await installId();
  void updateTab(job.tabId, (s) => ({ ...s, sent: s.sent + 1 }));
  let lastError = "unknown error";
  let rateWaits = 0;
  for (let attempt = 0; attempt < live.values.maxAttempts; attempt++) {
    const r = await sendOnce(job, id, attempt);
    if (r.kind === "ok") return r.response;
    lastError = r.error;
    if (r.kind === "stop") break;
    if (r.kind === "rate" && rateWaits++ < live.values.maxRateLimitWaits) {
      // Over the server's per-minute limit: the whole queue waits as long as it says, and this try doesn't count.
      pauseFor(r.waitMs);
      await sleep(pausedForMs() + PUMP_SLACK_MS);
      attempt--;
      continue;
    }
    if (attempt < live.values.maxAttempts - 1) await sleep(r.pauseMs);
  }
  void updateTab(job.tabId, (s) => ({ ...s, errors: s.errors + 1, lastError }));
  return null; // fail open
}
