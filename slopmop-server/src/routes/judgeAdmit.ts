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

/** Gives a refused request's check back (if one was spent) and logs why it was refused. */
async function refuse(ctx: Ctx, installId: string, input: JudgeInput, spend: Spend, detail: string) {
  if (spend.ok) await ctx.store.caps.refund(installId).catch(() => undefined);
  await ctx.store.events.record({ network: input.network.id, installId, contentId: input.contentId, kind: "limited", detail });
}

/**
 * Spends the check, looks up a stored verdict and reads this install's state, all at once (independent round trips), then
 * decides. The kill switch and both limits are the server's decision, never the client's; a refusal costs the user no check.
 */
export async function admit(ctx: Ctx, installId: string, input: JudgeInput, timing: Timing): Promise<{ spend: Spend; lookup: Lookup }> {
  const { store } = ctx;
  const [spendR, lookup, disabledR, recentR] = await Promise.allSettled([
    timing.timed("cap", store.caps.consume(installId)),
    timing.timed("lookup", store.content.reusableVerdict(input.network.id, input.contentId, ctx.criteriaVersion)),
    timing.timed("client", store.clients.isDisabled(installId)),
    store.clients.recentRequests(installId, RATE_WINDOW_MS),
  ]);
  if (spendR.status === "rejected") throw spendR.reason;
  const spend = spendR.value;

  if (disabledR.status === "fulfilled" && disabledR.value) {
    await refuse(ctx, installId, input, spend, "disabled");
    throw disabledError();
  }
  if (recentR.status === "fulfilled" && recentR.value.n >= ctx.config.clientRatePerMinute) {
    await refuse(ctx, installId, input, spend, "rate_limit");
    const retryAfter = Math.ceil(Math.max(recentR.value.freeInMs, MIN_RETRY_AFTER_MS) / SECOND_MS);
    throw new HttpError(429, "rate_limited", "Too many requests. Slow down and try again shortly.", { policy: policyOf(ctx) }, { "Retry-After": String(retryAfter) });
  }
  if (!spend.ok) {
    await refuse(ctx, installId, input, spend, "daily_limit");
    const retryAfter = Math.max(1, Math.ceil((Date.parse(spend.usage.resetsAt) - store.now()) / SECOND_MS));
    throw new HttpError(429, "daily_limit", `You've used all ${spend.usage.limit} checks for today. The counter resets at ${spend.usage.resetsAt}.`, { usage: spend.usage }, { "Retry-After": String(retryAfter) });
  }
  return { spend, lookup };
}
