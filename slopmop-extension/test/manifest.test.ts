import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { engagementBand } from "../src/shared/engagement";
import { applyManifest, DEFAULT_MANIFEST, live, toStored } from "../src/shared/manifest";

beforeEach(() => applyManifest(undefined));

describe("the manifest in force", () => {
  const stored = (values: object, thresholds = { aggressive: 0.1, moderate: 0.2, mild: 0.3 }) => ({ version: "v", values, thresholds, at: 0, ttlMs: 1 });
  it("is the built-in defaults until the server has sent one", () => {
    expect(live.values).toEqual(DEFAULT_MANIFEST);
    expect(live.thresholds).toBeNull();
    expect(live.version).toBeNull();
  });
  it("takes the server's values over the defaults, and leaves the rest alone", () => {
    applyManifest(stored({ minChars: 250, postRetryDelaysMs: [1000, 2000] }));
    expect(live.values.minChars).toBe(250);
    expect(live.values.postRetryDelaysMs).toEqual([1000, 2000]);
    expect(live.values.maxAttempts).toBe(DEFAULT_MANIFEST.maxAttempts);
    expect(live.thresholds).toEqual({ aggressive: 0.1, moderate: 0.2, mild: 0.3 });
    expect(live.version).toBe("v");
  });
  it("ignores values of the wrong kind, unknown names, and thresholds out of order", () => {
    applyManifest(stored({ minChars: "250", maxAttempts: -1, postRetryDelaysMs: [], nonsense: 5, requestTimeoutMs: Infinity }, { aggressive: 0.5, moderate: 0.2, mild: 0.3 }));
    expect(live.values).toEqual(DEFAULT_MANIFEST);
    expect(live.thresholds).toBeNull();
  });
  it("turns a fetched body into a saved one only when it is well formed", () => {
    const body = { version: "m1", ttlSeconds: 86400, thresholds: { aggressive: 0.1, moderate: 0.2, mild: 0.3 }, values: { minChars: 250, junk: 1 } };
    expect(toStored(body, 5)).toEqual({ version: "m1", values: { minChars: 250 }, thresholds: body.thresholds, at: 5, ttlMs: 86400_000 });
    expect(toStored({ ...body, ttlSeconds: 0 }, 5)).toBeNull();
    expect(toStored({ ...body, version: 3 }, 5)).toBeNull();
    expect(toStored({ ...body, thresholds: { aggressive: 2, moderate: 2, mild: 2 } }, 5)).toBeNull();
    expect(toStored(null, 5)).toBeNull();
  });
  it("drives the engagement step from the manifest's growth ratio", () => {
    const b = (n: number) => engagementBand({ reactions: n, comments: 0, reposts: 0 });
    const fine = b(1000) - b(100);
    applyManifest(stored({ engagementBandGrowth: 2 }));
    expect(b(1000) - b(100)).toBeLessThan(fine); // a coarser step: fewer of them across the same growth
  });
});

// The defaults the extension ships with must match the server's, or a fresh install behaves differently until its first manifest arrives.
const serverManifest = resolve(import.meta.dirname, "../../slopmop-server/src/manifest.ts");
describe.skipIf(!existsSync(serverManifest))("agrees with the server's defaults", () => {
  it("has the same names and values", async () => {
    const { MANIFEST_DEFAULTS } = await import(/* @vite-ignore */ serverManifest);
    expect(DEFAULT_MANIFEST).toEqual(MANIFEST_DEFAULTS);
  });
});

// The admin console names each tell the way the spider chart does; keep the two lists from drifting apart.
const adminLabels = resolve(import.meta.dirname, "../../slopmop-server/public/admin/labels.js");
describe.skipIf(!existsSync(adminLabels))("the admin console's tell names", () => {
  it("are the spider chart's labels, and name the two counter-tells as the Details panel does", async () => {
    const { LABELS } = await import(/* @vite-ignore */ adminLabels);
    const { TELL_AXES } = await import("../src/content/labels");
    for (const a of TELL_AXES) expect(LABELS[a.id], a.id).toBe(a.label);
    expect(LABELS.humanVoice).toBe("Sounds like a person");
    expect(LABELS.usefulness).toBe("Useful to readers");
    expect(Object.keys(LABELS).sort()).toEqual([...TELL_AXES.map((a) => a.id), "humanVoice", "usefulness"].sort());
  });
});
