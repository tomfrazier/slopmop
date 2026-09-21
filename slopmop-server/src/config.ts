import { DAY_MS } from "./constants.js";
import { parseWeights, type Weights } from "./weights.js";

/** Defaults for the settings below; each can be overridden by the environment variable named in .env.example. */
const DEFAULT_DAILY_LIMIT = 250;
const DEFAULT_VERDICT_MAX_AGE_DAYS = 30;
const DEFAULT_EVENT_RETENTION_DAYS = 90;
const DEFAULT_CLIENT_MAX_CONCURRENT = 4;
const DEFAULT_CLIENT_RATE_PER_MINUTE = 120;
const DEFAULT_INPUT_USD_PER_M = 0.042;

export type Env = Record<string, string | undefined>;

export interface Config {
  /** Checks (calls to /judge) allowed per install per UTC calendar day. */
  dailyLimit: number;
  /** Keep the post text itself in the registry. Off by default: only a hash, scores and counts are stored. */
  storeText: boolean;
  /** Mixed into install-id hashes so stored ids can't be matched against a leaked list of raw install ids. */
  installSalt: string;
  /** How long a stored verdict may be reused for identical content before it is re-scored. */
  verdictMaxAgeMs: number;
  /** Bearer token for GET /api/v1/admin/export. The endpoint is disabled when unset. */
  adminToken: string | null;
  /** Days of per-call history kept for the admin dashboard. */
  eventRetentionDays: number;
  /** What Jev costs, in USD per million tokens (input is billed; output is free at the time of writing). For the dashboard's cost figures. */
  inputUsdPerM: number;
  outputUsdPerM: number;
  /** Per-tell weights (private; see weights.ts). Equal unless TELL_WEIGHTS is set. */
  tellWeights: Weights;
  /** True when TELL_WEIGHTS changed anything. Reported by /health without revealing the values. */
  customWeights: boolean;
  /**
   * What the server tells every client to do. The server decides; the extension only obeys.
   * maxConcurrent: how many requests a client may have in flight. ratePerMinute: hard per-install limit, enforced here.
   */
  clientMaxConcurrent: number;
  clientRatePerMinute: number;
  /** Extra allowed browser origins (extension origins are always allowed). */
  allowedOrigins: string[];
}

const int = (v: string | undefined, fallback: number, min = 0) => {
  const n = v === undefined || v === "" ? NaN : Number(v);
  return Number.isFinite(n) && n >= min ? Math.floor(n) : fallback;
};
const dec = (v: string | undefined, fallback: number) => {
  const n = v === undefined || v === "" ? NaN : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};
const flag = (v: string | undefined) => /^(1|true|yes|on)$/i.test(v ?? "");

export function loadConfig(env: Env): Config {
  const { weights, custom } = parseWeights(env.TELL_WEIGHTS);
  return {
    tellWeights: weights,
    customWeights: custom,
    dailyLimit: int(env.DAILY_CHECK_LIMIT, DEFAULT_DAILY_LIMIT, 1),
    storeText: flag(env.STORE_CONTENT_TEXT),
    installSalt: env.INSTALL_ID_SALT || "slopmop",
    verdictMaxAgeMs: int(env.VERDICT_MAX_AGE_DAYS, DEFAULT_VERDICT_MAX_AGE_DAYS, 0) * DAY_MS,
    adminToken: env.ADMIN_TOKEN?.trim() || null,
    eventRetentionDays: int(env.EVENT_RETENTION_DAYS, DEFAULT_EVENT_RETENTION_DAYS, 1),
    inputUsdPerM: dec(env.JEV_INPUT_USD_PER_M, DEFAULT_INPUT_USD_PER_M),
    outputUsdPerM: dec(env.JEV_OUTPUT_USD_PER_M, 0),
    clientMaxConcurrent: int(env.CLIENT_MAX_CONCURRENT, DEFAULT_CLIENT_MAX_CONCURRENT, 1),
    clientRatePerMinute: int(env.CLIENT_RATE_PER_MINUTE, DEFAULT_CLIENT_RATE_PER_MINUTE, 1),
    allowedOrigins: (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  };
}
