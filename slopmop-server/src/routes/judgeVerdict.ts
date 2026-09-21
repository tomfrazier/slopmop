import type { JevBackend, Verdict } from "../jev.js";
import { isDue, type Schedule } from "../recheck.js";
import { USEFULNESS } from "../traits.js";
import type { StoredVerdict } from "../store.js";
import type { Timing } from "../timing.js";
import type { Lookup } from "./judgeAdmit.js";
import type { JudgeInput } from "./judgeInput.js";

const USEFULNESS_TOP_LEVEL = USEFULNESS.levels.length - 1;

// ---------------------------------------------------------------- getting a verdict

export interface Outcome {
  verdict: StoredVerdict;
  cached: boolean;
  /** Set only when Jev was actually called. */
  fresh: Verdict | null;
  latencyMs: number | null;
  /** How the stored verdict this one replaced (or reused) was scheduled; null for a first score. */
  previous: Schedule | null;
}

/**
 * The stored verdict while it is still inside its wait (see recheck.ts), otherwise a fresh answer from Jev. When a stored
 * one has run out of time, Jev is asked again with the engagement the post has now and its previous answer, so a post that
 * has taken off is judged on how readers received it and not only on its text.
 */
export async function obtainVerdict(jev: JevBackend, input: JudgeInput, lookup: Lookup, timing: Timing, now: number): Promise<Outcome> {
  if (lookup.status === "rejected") throw lookup.reason;
  const stored = lookup.value;
  if (stored && !isDue(stored.schedule, now)) return { verdict: stored, cached: true, fresh: null, latencyMs: null, previous: stored.schedule };
  const previousAssessment = stored ? { usefulnessLevel: Math.round((stored.dimensions.usefulness?.value ?? 0) * USEFULNESS_TOP_LEVEL), engagementThen: null } : null;
  const t0 = performance.now();
  const fresh = await timing.timed("jev", jev.score({ postText: input.text, surfaceStats: input.surfaceStats, engagement: input.engagement, previousAssessment }));
  return { verdict: fresh, cached: false, fresh, latencyMs: Math.round(performance.now() - t0), previous: stored?.schedule ?? null };
}
