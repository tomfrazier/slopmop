import { FALLBACK_POLICY, MINUTE_MS, POLICY_MAX_CONCURRENT, POLICY_MAX_RATE_PER_MINUTE } from "../shared/constants";

// What the server tells this client to do. The server decides how many requests may be in flight and how many per minute
// (and enforces both); this client only obeys. The numbers arrive with every answer and are remembered. Until the server has
// said anything, be modest.
export interface Policy {
  maxConcurrent: number;
  ratePerMinute: number;
}

let policy: Policy = { ...FALLBACK_POLICY };
let onChange: () => void = () => {};

const validPolicy = (p: unknown): p is Policy => {
  const x = p as Policy | null;
  return !!x && Number.isInteger(x.maxConcurrent) && x.maxConcurrent >= 1 && x.maxConcurrent <= POLICY_MAX_CONCURRENT && Number.isInteger(x.ratePerMinute) && x.ratePerMinute >= 1 && x.ratePerMinute <= POLICY_MAX_RATE_PER_MINUTE;
};

void chrome.storage.local.get("policy").then((r) => {
  if (validPolicy(r.policy)) policy = r.policy;
});

export const currentPolicy = () => policy;

/** The queue asks to be told when a policy change might let waiting requests start. */
export const onPolicyChange = (fn: () => void) => (onChange = fn);

export function learnPolicy(p: unknown) {
  if (!validPolicy(p) || (p.maxConcurrent === policy.maxConcurrent && p.ratePerMinute === policy.ratePerMinute)) return;
  policy = p;
  void chrome.storage.local.set({ policy });
  onChange();
}

// ---- pacing under the policy ----
const startedAt: number[] = []; // when each request in the last minute began
let pausedUntil = 0; // the server said "wait": no new requests until then

export const noteRequestStart = () => void startedAt.push(Date.now());

/** No new request may start until `ms` from now (used when the server says "slow down"). */
export const pauseFor = (ms: number) => (pausedUntil = Math.max(pausedUntil, Date.now() + ms));
export const pausedForMs = () => Math.max(0, pausedUntil - Date.now());

/** Milliseconds until another request may start under the policy (0 = now). */
export function startDelay(): number {
  const now = Date.now();
  while (startedAt.length && startedAt[0] <= now - MINUTE_MS) startedAt.shift();
  let wait = pausedForMs();
  if (startedAt.length >= policy.ratePerMinute) wait = Math.max(wait, startedAt[0] + MINUTE_MS - now);
  return wait;
}
