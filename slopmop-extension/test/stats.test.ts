import { describe, expect, it } from "vitest";
import { emptyStats, record, summarize } from "../src/shared/stats";
import { surfaceStats } from "../src/shared/surface";

const d = (s: string) => new Date(`${s}T12:00:00`);

describe("stats", () => {
  it("dedupes by urn", () => {
    let s = emptyStats();
    s = record(s, "hidden", "u1", d("2026-09-18"));
    s = record(s, "hidden", "u1", d("2026-09-18"));
    expect(summarize(s.hidden, d("2026-09-18")).today).toBe(1);
  });
  it("buckets today/week/month/total and rolls over", () => {
    const counts = { "2026-09-18": 2, "2026-09-14": 3, "2026-09-02": 4, "2026-08-30": 5 };
    const s = summarize(counts, d("2026-09-18"));
    expect(s).toMatchObject({ today: 2, week: 5, month: 9, total: 14, record: 5 });
    expect(summarize(counts, d("2026-09-19")).today).toBe(0);
  });
  it("dial sits at today / record and flags a new record", () => {
    expect(summarize({ "2026-09-17": 10, "2026-09-18": 5 }, d("2026-09-18"))).toMatchObject({ dial: 0.5, isNewRecord: false });
    expect(summarize({ "2026-09-17": 10, "2026-09-18": 11 }, d("2026-09-18"))).toMatchObject({ dial: 1, isNewRecord: true });
    expect(summarize({}, d("2026-09-18")).dial).toBe(0);
  });
});

describe("surfaceStats", () => {
  it("measures rhythm, contractions, punctuation", () => {
    const s = surfaceStats("I don't like it! It's fine — really. Short.\nA much longer sentence follows here today.");
    expect(s.sentenceCount).toBe(4);
    expect(s.exclamationCount).toBe(1);
    expect(s.contractionsPer100Words).toBeGreaterThan(0);
    expect(s.emDashesPer1000Words).toBeGreaterThan(0);
    expect(s.sentenceLengthStdDev).toBeGreaterThan(0);
  });
});
