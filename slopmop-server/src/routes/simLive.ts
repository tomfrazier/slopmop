import type { Ctx } from "../ctx.js";
import { HttpError } from "../http.js";
import { MANIFEST_DEFAULTS, validateManifest, type ManifestValues } from "../manifest.js";
import { validateScoring } from "../scoringStore.js";
import type { SimLive } from "../simulate.js";
import { validateWeights } from "../weights.js";

/** Values in an editor that haven't been saved: used in place of the live ones for a preview. */
export interface Draft {
  weights?: unknown;
  scoring?: unknown;
  manifest?: unknown;
}

/** The settings a decision runs on: the live ones, or `draft`'s where it gives them. `used` says which came from the draft. */
export async function simLive(ctx: Ctx, draft: Draft = {}): Promise<{ live: SimLive; used: { weights: boolean; scoring: boolean; manifest: boolean }; manifestOverrides: ManifestValues }> {
  const used = { weights: draft.weights !== undefined, scoring: draft.scoring !== undefined, manifest: draft.manifest !== undefined };
  const weights = used.weights ? validateWeights(draft.weights) : (await ctx.weights.current()).weights;
  const scoring = used.scoring ? validateScoring(draft.scoring) : await ctx.scoring.current();
  const overrides = used.manifest ? validateManifest(draft.manifest) : await ctx.manifest.overrides();
  for (const problem of [weights, scoring, overrides]) if (typeof problem === "string") throw new HttpError(422, "invalid_input", problem);
  const values = { ...MANIFEST_DEFAULTS, ...(overrides as ManifestValues) };
  const live: SimLive = {
    weights: weights as SimLive["weights"],
    scoring: scoring as SimLive["scoring"],
    aiDampen: Number(values.aiDampen),
    minMeanConfidence: Number(values.minMeanConfidence),
    yellowFraction: Number(values.yellowFraction),
    displayPossibly: Number(values.displayPossibly),
    displayLikely: Number(values.displayLikely),
    displayFullMultiple: Number(values.displayFullMultiple),
  };
  return { live, used, manifestOverrides: overrides as ManifestValues };
}
