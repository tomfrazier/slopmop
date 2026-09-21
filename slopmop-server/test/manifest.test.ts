import { describe, expect, it } from "vitest";
import { buildManifest, MANIFEST_DEFAULTS, MANIFEST_FIELDS, validateManifest } from "../src/manifest.js";
import { DEFAULT_THRESHOLDS } from "../src/scoringStore.js";
import { ADAPTERS, makeHarness } from "./helpers.js";

const admin = { headers: { authorization: "Bearer s3cret" } };

describe("manifest values", () => {
  it("has a default, a range and a note for every setting, and the defaults sit inside their ranges", () => {
    for (const x of MANIFEST_FIELDS) {
      expect(x.note.length, x.key).toBeGreaterThan(5);
      for (const v of [x.value].flat()) {
        expect(v, x.key).toBeGreaterThanOrEqual(x.min);
        expect(v, x.key).toBeLessThanOrEqual(x.max);
      }
    }
    expect(new Set(MANIFEST_FIELDS.map((x) => x.key)).size).toBe(MANIFEST_FIELDS.length);
  });
  it("stores only what differs from the defaults, and rejects unknown names and out-of-range values", () => {
    expect(validateManifest({})).toEqual({});
    expect(validateManifest({ maxAttempts: 3, minChars: 250 })).toEqual({ minChars: 250 });
    expect(validateManifest({ nope: 1 })).toMatch(/Unknown/);
    expect(validateManifest({ maxAttempts: 99 })).toMatch(/maxAttempts/);
    expect(validateManifest({ maxAttempts: "3" })).toMatch(/maxAttempts/);
    expect(validateManifest({ postRetryDelaysMs: [] })).toMatch(/postRetryDelaysMs/);
    expect(validateManifest({ postRetryDelaysMs: [5000, 20000] })).toEqual({ postRetryDelaysMs: [5000, 20000] });
    expect(validateManifest([1])).toMatch(/object/);
  });
  it("versions the values and thresholds together", () => {
    const a = buildManifest({}, DEFAULT_THRESHOLDS);
    expect(buildManifest({}, { ...DEFAULT_THRESHOLDS }).version).toBe(a.version);
    expect(buildManifest({ minChars: 250 }, DEFAULT_THRESHOLDS).version).not.toBe(a.version);
    expect(buildManifest({}, { ...DEFAULT_THRESHOLDS, mild: 0.3 }).version).not.toBe(a.version);
    expect(a.values).toEqual(MANIFEST_DEFAULTS);
  });
});

describe.each(ADAPTERS)("the manifest over HTTP (%s)", (kind) => {
  const H = () => makeHarness(kind, { ADMIN_TOKEN: "s3cret" });
  it("is public, complete, and holds no weights", async () => {
    const h = await H();
    const { status, body } = await h.call("manifest");
    expect(status).toBe(200);
    expect(body.values.maxAttempts).toBe(3);
    expect(body.thresholds).toEqual(DEFAULT_THRESHOLDS);
    expect(JSON.stringify(body)).not.toMatch(/weight|humanVoice|formulaicHook/i);
  });
  it("is edited by the admin only, live, validated, and reset", async () => {
    const h = await H();
    expect((await h.call("adminManifest")).status).toBe(401);
    const before = (await h.call("manifest")).body.version;
    const saved = await h.call("adminManifest", { values: { minChars: 250, postRetryDelaysMs: [1000] } }, { method: "POST", ...admin });
    expect(saved.body.values).toMatchObject({ minChars: 250, postRetryDelaysMs: [1000] });
    const after = (await h.call("manifest")).body;
    expect(after.values.minChars).toBe(250);
    expect(after.version).not.toBe(before);
    expect((await h.call("adminManifest", { values: { minChars: 5 } }, { method: "POST", ...admin })).status).toBe(422);
    expect((await h.call("manifest")).body.values.minChars).toBe(250); // unchanged by the bad edit
    await h.call("adminManifest", { reset: true }, { method: "POST", ...admin });
    expect((await h.call("manifest")).body.version).toBe(before);
  });
  it("tells clients the version with every answer", async () => {
    const h = await H();
    const v = (await h.call("manifest")).body.version;
    expect((await h.call("usage")).body.manifestVersion).toBe(v);
  });
});
