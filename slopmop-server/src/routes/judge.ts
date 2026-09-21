import type { Ctx } from "../ctx.js";
import { StorageNotConfigured } from "../db/types.js";
import { HttpError, installIdOf, json, readJson } from "../http.js";
import { serverTiming } from "../timing.js";
import { upstreamError } from "../upstream.js";
import { engagementTotal, nextInterval } from "../recheck.js";
import { scoreParts } from "../scoring.js";
import { modelVersion } from "../scoringStore.js";
import { applyWeights } from "../weights.js";
import { admit } from "./judgeAdmit.js";
import { parseJudgeInput } from "./judgeInput.js";
import { obtainVerdict } from "./judgeVerdict.js";
import { manifestOf } from "./manifestRoute.js";
import { policyOf } from "./shared.js";

// ---------------------------------------------------------------- the route

export async function judgeRoute(request: Request, ctx: Ctx): Promise<Response> {
  const installId = installIdOf(request);
  const input = parseJudgeInput(await readJson(request));
  if (!ctx.jev) throw new HttpError(503, "server_misconfigured", "No Jev credentials are configured on the server (set AI_GATEWAY_API_KEY).");

  const timing = serverTiming();
  const { spend, lookup } = await admit(ctx, installId, input, timing);
  const { store } = ctx;

  try {
    const outcome = await obtainVerdict(ctx.jev, input, lookup, timing, store.now());
    const [live, scoring] = await Promise.all([ctx.weights.current(), ctx.scoring.current()]); // in-memory except once every few seconds
    const weighted = applyWeights(outcome.verdict.dimensions, live.weights, scoring.formula.confidencePower);
    const fresh = outcome.fresh;
    // Independent writes and the vote read go out together: one round trip instead of three.
    const [, , community] = await timing.timed(
      "write",
      Promise.all([
        store.content.record({
          network: input.network.id,
          contentId: input.contentId,
          nativeId: input.nativeId,
          text: ctx.config.storeText ? input.text : null,
          textLen: input.text.length,
          surface: input.surfaceStats,
          engagement: input.engagement,
          scored: fresh ? { verdict: fresh, criteriaVersion: ctx.criteriaVersion, engagementTotal: engagementTotal(input.engagement), intervalMs: nextInterval(outcome.previous, store.now(), engagementTotal(input.engagement), scoring.recheck) } : null,
        }),
        store.events.record({
          network: input.network.id,
          installId,
          contentId: input.contentId,
          kind: outcome.cached ? "cached" : "scored",
          inputTokens: fresh?.usage?.inputTokens,
          outputTokens: fresh?.usage?.outputTokens,
          latencyMs: outcome.latencyMs,
          aiLikelihood: outcome.verdict.aiLikelihood,
          detail: outcome.fresh && outcome.previous ? "rescored" : (fresh?.attempts ?? 1) > 1 ? "hedged" : null,
        }),
        store.votes.community(input.network.id, input.contentId),
      ]),
    );
    return json(
      200,
      {
        model: outcome.verdict.model,
        dimensions: outcome.verdict.dimensions,
        // The weighted result only: the weights themselves never leave the server.
        ...weighted,
        // The server's half of the decision: the counter-tells and reader response are worked out here, so they stay private.
        ...scoreParts({ tellMean: weighted.tellMean, dimensions: outcome.verdict.dimensions, engagement: input.engagement }, live.weights, scoring.engagement, scoring.corroboration, scoring.formula),
        weightsVersion: modelVersion(live.version, scoring.engagement, scoring.corroboration, scoring.formula),
        manifestVersion: (await manifestOf(ctx)).version,
        aiLikelihood: outcome.verdict.aiLikelihood,
        network: input.network.id,
        contentId: input.contentId,
        cached: outcome.cached,
        community,
        usage: spend.usage,
        policy: policyOf(ctx),
      },
      { "Server-Timing": timing.header() },
    );
  } catch (e) {
    await store.caps.refund(installId).catch(() => undefined); // a failure on our side shouldn't cost the user a check
    await store.events.record({ network: input.network.id, installId, contentId: input.contentId, kind: "error", latencyMs: timing.elapsedMs(), detail: e instanceof Error ? e.name : "unknown" });
    throw e instanceof HttpError || e instanceof StorageNotConfigured ? e : upstreamError(e);
  }
}
