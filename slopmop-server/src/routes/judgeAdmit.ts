import { clientIp } from "../clientIp.js";
import { MIN_RETRY_AFTER_MS, RATE_WINDOW_MS, SECOND_MS } from "../constants.js";
import type { Ctx } from "../ctx.js";
import { HttpError } from "../http.js";
import type { ReusableVerdict } from "../store.js";
import type { Timing } from "../timing.js";
import type { JudgeInput } from "./judgeInput.js";
import { disabledError, policyOf } from "./shared.js";

// ---------------------------------------------------------------- deciding whether to serve it

export type Spend = Awaited<ReturnType<Ctx["store"]["caps"]["consume"]>>;
export type Lookup = PromiseSettledResult<ReusableVerdict | null>;

/** Gives a refused request's checks back (install and, if one was spent, IP) and logs why it was refused. */
async function refuse(ctx: Ctx, installId: string, input: JudgeInput, spend: Spend, ipHash: string | null, detail: string) {
  if (spend.ok) await ctx.store.caps.refund(installId).catch(() => undefined);
  if (ipHash) await ctx.store.ipCaps.refund(ipHash).catch(() => undefined);
  await ctx.store.events.record({ network: input.network.id, installId, contentId: input.contentId, kind: "limited", detail });
}

/**
 * Spends the check, looks up a stored verdict and reads this install's and this IP's state, all at once (independent
 * round trips), then decides. The kill switch and every limit are the server's decision, never the client's; a refusal
 * costs the user no check. A known-datacenter IP is refused before anything is spent (see below): that decision needs no
 * database round trip once the range list is cached, so there is nothing to refund if it fires.
 */
export async function admit(ctx: Ctx, installId: string, input: JudgeInput, timing: Timing, request: Request): Promise<{ spend: Spend; lookup: Lookup }> {
  const { store, config } = ctx;
  const ip = clientIp(request);
  const ipHash = ip ? store.hashInstall(`ip:${ip}`) : null;

  // The install id costs a script nothing to change; the source IP is at least somewhat harder to rotate, and a known
  // cloud/hosting range is not where a real extension install runs from. This check alone can reject a request, before
  // any check is spent on either ceiling below.
  if (ip && config.blockDatacenterIps && (await timing.timed("datacenter", ctx.datacenter.isDatacenter(ip)))) {
    await store.events.record({ network: input.network.id, installId, contentId: input.contentId, kind: "limited", detail: "datacenter_ip" });
    throw new HttpError(403, "datacenter_ip", "Requests from cloud or hosting-provider IP ranges aren't accepted.");
  }

  const [spendR, lookup, disabledR, recentR, ipSpendR] = await Promise.allSettled([
    timing.timed("cap", store.caps.consume(installId)),
    timing.timed("lookup", store.content.reusableVerdict(input.network.id, input.contentId, ctx.criteriaVersion)),
    timing.timed("client", store.clients.isDisabled(installId)),
    store.clients.recentRequests(installId, RATE_WINDOW_MS),
    ipHash ? timing.timed("ipcap", store.ipCaps.consume(ipHash, config.ipHourlyLimit)) : Promise.resolve(null),
  ]);
  if (spendR.status === "rejected") throw spendR.reason;
  const spend = spendR.value;
  const ipSpend = ipSpendR.status === "fulfilled" ? ipSpendR.value : null;

  if (disabledR.status === "fulfilled" && disabledR.value) {
    await refuse(ctx, installId, input, spend, ipHash, "disabled");
    throw disabledError();
  }
  if (recentR.status === "fulfilled" && recentR.value.n >= ctx.config.clientRatePerMinute) {
    await refuse(ctx, installId, input, spend, ipHash, "rate_limit");
    const retryAfter = Math.ceil(Math.max(recentR.value.freeInMs, MIN_RETRY_AFTER_MS) / SECOND_MS);
    throw new HttpError(429, "rate_limited", "Too many requests. Slow down and try again shortly.", { policy: policyOf(ctx) }, { "Retry-After": String(retryAfter) });
  }
  if (ipSpend && !ipSpend.ok) {
    await refuse(ctx, installId, input, spend, ipHash, "ip_rate_limit");
    throw new HttpError(429, "ip_rate_limited", "Too many requests from this network in the last hour. Try again once the hour resets.", {}, { "Retry-After": "3600" });
  }
  if (!spend.ok) {
    await refuse(ctx, installId, input, spend, ipHash, "daily_limit");
    const retryAfter = Math.max(1, Math.ceil((Date.parse(spend.usage.resetsAt) - store.now()) / SECOND_MS));
    throw new HttpError(429, "daily_limit", `You've used all ${spend.usage.limit} checks for today. The counter resets at ${spend.usage.resetsAt}.`, { usage: spend.usage }, { "Retry-After": String(retryAfter) });
  }
  return { spend, lookup };
}
