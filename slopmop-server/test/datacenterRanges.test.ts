import { describe, expect, it, vi } from "vitest";
import { DatacenterList } from "../src/datacenterRanges.js";

const awsBody = { prefixes: [{ ip_prefix: "203.0.113.0/24" }], ipv6_prefixes: [{ ipv6_prefix: "2001:db8:aaaa::/48" }] };
const gcpBody = { prefixes: [{ ipv4Prefix: "198.51.100.0/24" }, { ipv6Prefix: "2001:db8:bbbb::/48" }, {}] };
const ok = (body: unknown) => ({ ok: true, json: async () => body }) as Response;
const failing = { ok: false, status: 500, json: async () => ({}) } as Response;

describe("DatacenterList", () => {
  it("matches ranges from both AWS and GCP once fetched", async () => {
    const fetchImpl = vi.fn(async (url: string) => ok(url.includes("amazonaws") ? awsBody : gcpBody));
    const list = new DatacenterList([], () => 0, 60_000, fetchImpl as unknown as typeof fetch);
    expect(await list.isDatacenter("203.0.113.5")).toBe(true); // AWS
    expect(await list.isDatacenter("198.51.100.5")).toBe(true); // GCP
    expect(await list.isDatacenter("2001:db8:aaaa::1")).toBe(true); // AWS ipv6
    expect(await list.isDatacenter("192.0.2.5")).toBe(false); // not in either list
  });
  it("always includes the hand-added extra ranges, even when both fetches succeed", async () => {
    const fetchImpl = vi.fn(async () => ok(awsBody));
    const list = new DatacenterList(["192.0.2.0/24"], () => 0, 60_000, fetchImpl as unknown as typeof fetch);
    expect(await list.isDatacenter("192.0.2.5")).toBe(true);
  });
  it("caches the result and only re-fetches after the TTL", async () => {
    let now = 0;
    const fetchImpl = vi.fn(async () => ok(awsBody));
    const list = new DatacenterList([], () => now, 1000, fetchImpl as unknown as typeof fetch);
    await list.isDatacenter("1.2.3.4");
    await list.isDatacenter("1.2.3.4");
    expect(fetchImpl).toHaveBeenCalledTimes(2); // one refresh = AWS + GCP, both stubbed the same way here
    now = 500;
    await list.isDatacenter("1.2.3.4");
    expect(fetchImpl).toHaveBeenCalledTimes(2); // still fresh
    now = 1500;
    await list.isDatacenter("1.2.3.4");
    expect(fetchImpl).toHaveBeenCalledTimes(4); // stale: refreshed again
  });
  it("dedupes concurrent refreshes into one fetch", async () => {
    const fetchImpl = vi.fn(async () => ok(awsBody));
    const list = new DatacenterList([], () => 0, 60_000, fetchImpl as unknown as typeof fetch);
    await Promise.all([list.isDatacenter("1.2.3.4"), list.isDatacenter("1.2.3.4"), list.isDatacenter("1.2.3.4")]);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // AWS + GCP once each, not three times
  });
  it("fails open (never blocks) when both providers fail and there are no extra ranges", async () => {
    const fetchImpl = vi.fn(async () => failing);
    const list = new DatacenterList([], () => 0, 60_000, fetchImpl as unknown as typeof fetch);
    expect(await list.isDatacenter("203.0.113.5")).toBe(false);
  });
  it("still checks the extra ranges when both providers fail", async () => {
    const fetchImpl = vi.fn(async () => failing);
    const list = new DatacenterList(["203.0.113.0/24"], () => 0, 60_000, fetchImpl as unknown as typeof fetch);
    expect(await list.isDatacenter("203.0.113.5")).toBe(true);
    expect(await list.isDatacenter("192.0.2.5")).toBe(false);
  });
  it("keeps the last good list when a later refresh fails", async () => {
    let fail = false;
    let now = 0;
    const fetchImpl = vi.fn(async (url: string) => (fail ? failing : ok(url.includes("amazonaws") ? awsBody : gcpBody)));
    const list = new DatacenterList([], () => now, 1000, fetchImpl as unknown as typeof fetch);
    expect(await list.isDatacenter("203.0.113.5")).toBe(true);
    fail = true;
    now = 1500; // stale: tries to refresh, fails, keeps the old list rather than going empty
    expect(await list.isDatacenter("203.0.113.5")).toBe(true);
  });
  it("never throws even when fetch itself rejects (a network error, not just a bad response)", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("network down");
    });
    const list = new DatacenterList([], () => 0, 60_000, fetchImpl as unknown as typeof fetch);
    await expect(list.isDatacenter("1.2.3.4")).resolves.toBe(false);
  });
});
