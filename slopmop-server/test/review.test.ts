import { describe, expect, it } from "vitest";
import { ADAPTERS, judgeBody, makeHarness, POST } from "./helpers.js";
import { LEVERS } from "../src/review.js";
import { simulate } from "../src/simulate.js";

const admin = { headers: { authorization: "Bearer s3cret" }, method: "POST" as const };
const env = { ADMIN_TOKEN: "s3cret" };

describe.each(ADAPTERS)("post review (%s)", (kind) => {
  it("finds a checked post from pasted text (whitespace and case don't matter), and from an id prefix", async () => {
    const h = await makeHarness(kind, env);
    const judged = await h.call("judge", judgeBody({ engagement: { reactions: 40, comments: 5, reposts: 1 } }));
    const byText = await h.call("review", { text: `  ${POST.toUpperCase()}\n\n` }, admin);
    expect(byText.status).toBe(200);
    expect(byText.body).toMatchObject({ found: true, scored: true, by: "text", contentId: judged.body.contentId });
    expect(byText.body.record).toMatchObject({ checks: 1, engagement: { reactions: 40, comments: 5, reposts: 1 } });
    expect(byText.body.result.steps).toMatchObject({ readerResponse: expect.any(Number), shield: expect.any(Number) });
    const byId = await h.call("review", { contentId: judged.body.contentId.slice(0, 10) }, admin);
    expect(byId.body).toMatchObject({ found: true, by: "id", contentId: judged.body.contentId });
  });

  it("says plainly when the post hasn't been checked, and never invents one", async () => {
    const h = await makeHarness(kind, env);
    const r = await h.call("review", { text: "A post that nobody ever ran through the checker, long enough to look up." }, admin);
    expect(r.body).toMatchObject({ found: false, by: "text" });
    expect(r.body.contentId).toMatch(/^[a-f0-9]{32}$/);
  });

  it("solves every lever against the real scoring: applying a 'needed' value really does change the verdict", async () => {
    const h = await makeHarness(kind, env);
    await h.call("judge", judgeBody());
    const r = (await h.call("review", { text: POST }, admin)).body;
    expect(r.result.verdicts.moderate.level).toBe("red"); // the stub scores every question 0.5: blatant
    const live = r.live;
    const by = new Map(LEVERS.map((l) => [l.id, l]));
    let solved = 0;
    for (const lever of r.levers) {
      for (const [target, ok] of [["notLikely", (v: { level: string }) => v.level !== "red"], ["looksFine", (v: { word: string }) => v.word === "Looks fine"]] as const) {
        const fix = lever[target];
        if (fix.status !== "needed") continue;
        const changed = by.get(lever.id)!.set(live, fix.value);
        expect(ok(simulate(r.input, changed).verdicts.moderate as never), `${lever.id} -> ${target} at ${fix.value}`).toBe(true);
        expect(fix.corpus.total).toBe(1);
        solved++;
      }
    }
    expect(solved).toBeGreaterThan(3);
    const shield = r.levers.find((l: { id: string }) => l.id === "maxShield");
    expect(shield.notLikely.status === "needed" ? shield.notLikely.direction : "up").toBe("up"); // more shield helps
  });

  it("offers combinations that lean on reader response, and each one really works", async () => {
    const h = await makeHarness(kind, env);
    await h.call("judge", judgeBody({ engagement: { reactions: 900, comments: 120, reposts: 40 } }));
    const r = (await h.call("review", { text: POST }, admin)).body;
    expect(r.recipes.length).toBeGreaterThan(5);
    for (const rc of r.recipes.filter((x: { maxShield: number | null; already: boolean }) => x.maxShield !== null && !x.already)) {
      const changed = { ...r.live, scoring: { ...r.live.scoring, formula: { ...r.live.scoring.formula, usefulShare: rc.usefulShare, maxShield: rc.maxShield }, engagement: { ...r.live.scoring.engagement, logScale: rc.logScale } } };
      expect(simulate(r.input, changed).verdicts.moderate.level, JSON.stringify(rc)).not.toBe("red");
    }
  });

  it("tells the admin when reactions look uncaptured, and when the post was left alone as unsure", async () => {
    const h = await makeHarness(kind, env);
    await h.call("judge", judgeBody({ engagement: { reactions: 0, comments: 300, reposts: 100 } }));
    const r = (await h.call("review", { text: POST }, admin)).body;
    expect(r.notes.join(" ")).toMatch(/Reactions were stored as 0 but it has 300 comments and 100 reposts/);
    const h2 = await makeHarness(kind, env);
    await h2.call("judge", judgeBody({ engagement: { reactions: 2, comments: 93, reposts: 15 } }));
    expect((await h2.call("review", { text: POST }, admin)).body.notes.join(" ")).toMatch(/Only 2 reactions were stored against 93 comments/);
  });

  it("validates its input and stays behind the admin key", async () => {
    const h = await makeHarness(kind, env);
    expect((await h.call("review", { text: "short" }, admin)).status).toBe(422);
    expect((await h.call("review", { contentId: "abc" }, admin)).status).toBe(422);
    expect((await h.call("review", {}, admin)).status).toBe(422);
    expect((await h.call("review", { text: POST }, { method: "POST" })).status).toBe(401);
  });
});
