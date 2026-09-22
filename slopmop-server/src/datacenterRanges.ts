import { DATACENTER_LIST_TIMEOUT_MS, DATACENTER_LIST_TTL_MS } from "./constants.js";
import { anyCidrMatch } from "./cidr.js";

/**
 * Published IPv4/IPv6 ranges for the two cloud providers that each publish one stable JSON file listing every range they
 * own: AWS and Google Cloud. Between them these cover a large share of scripted traffic (most bot hosting runs on one of
 * the two), without guessing at ranges from memory, which would risk being wrong in either direction. Other providers
 * (Azure, Oracle, DigitalOcean, Hetzner, OVH, Vultr, Linode, ...) don't publish a single equivalent file; add their
 * ranges by hand via `extra` (the DATACENTER_CIDR_EXTRA environment variable) if you want to cover them too.
 */
const AWS_URL = "https://ip-ranges.amazonaws.com/ip-ranges.json";
const GCP_URL = "https://www.gstatic.com/ipranges/cloud.json";

interface AwsRanges {
  prefixes?: { ip_prefix: string }[];
  ipv6_prefixes?: { ipv6_prefix: string }[];
}
interface GcpRanges {
  prefixes?: ({ ipv4Prefix: string } | { ipv6Prefix: string } | Record<string, never>)[];
}

async function fetchJson(fetchImpl: typeof fetch, url: string, timeoutMs: number): Promise<unknown> {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

async function fetchAws(fetchImpl: typeof fetch, timeoutMs: number): Promise<string[]> {
  const body = (await fetchJson(fetchImpl, AWS_URL, timeoutMs)) as AwsRanges;
  return [...(body.prefixes ?? []).map((p) => p.ip_prefix), ...(body.ipv6_prefixes ?? []).map((p) => p.ipv6_prefix)];
}

async function fetchGcp(fetchImpl: typeof fetch, timeoutMs: number): Promise<string[]> {
  const body = (await fetchJson(fetchImpl, GCP_URL, timeoutMs)) as GcpRanges;
  return body.prefixes?.flatMap((p) => ("ipv4Prefix" in p ? [p.ipv4Prefix] : "ipv6Prefix" in p ? [p.ipv6Prefix] : [])) ?? [];
}

/**
 * Keeps the AWS + GCP ranges cached (like WeightStore keeps the weights): read through a TTL, refreshed from the network
 * only when stale. A failed or slow refresh never blocks or fails a request: it falls back to the last good list, or (on
 * the very first call) to `extra` alone, so a network hiccup here can only under-block, never take the API down.
 */
export class DatacenterList {
  private cache: { at: number; ranges: string[] } | null = null;
  private pending: Promise<string[] | null> | null = null;

  constructor(
    private readonly extra: readonly string[] = [],
    private readonly now: () => number = Date.now,
    private readonly ttlMs = DATACENTER_LIST_TTL_MS,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = DATACENTER_LIST_TIMEOUT_MS,
  ) {}

  /** null means both providers failed: the caller keeps whatever it already had, rather than replacing a good list with an empty one. */
  private async refresh(): Promise<string[] | null> {
    const [aws, gcp] = await Promise.allSettled([fetchAws(this.fetchImpl, this.timeoutMs), fetchGcp(this.fetchImpl, this.timeoutMs)]);
    if (aws.status === "rejected") console.error("[slopmop] could not refresh AWS ip ranges", aws.reason instanceof Error ? aws.reason.message : String(aws.reason));
    if (gcp.status === "rejected") console.error("[slopmop] could not refresh GCP ip ranges", gcp.reason instanceof Error ? gcp.reason.message : String(gcp.reason));
    if (aws.status === "rejected" && gcp.status === "rejected") return null;
    return [...(aws.status === "fulfilled" ? aws.value : []), ...(gcp.status === "fulfilled" ? gcp.value : []), ...this.extra];
  }

  async isDatacenter(ip: string): Promise<boolean> {
    const t = this.now();
    if (!this.cache || t - this.cache.at > this.ttlMs) {
      this.pending ??= this.refresh().finally(() => (this.pending = null));
      const ranges = await this.pending;
      if (ranges) this.cache = { at: t, ranges };
      else if (this.cache) this.cache = { ...this.cache, at: t }; // both failed: keep the old list, just don't retry again until the TTL passes
      else return anyCidrMatch(ip, this.extra); // never had a good list at all: fall back to the hand-added ranges only
    }
    return anyCidrMatch(ip, this.cache.ranges);
  }
}
