import { describe, expect, it } from "vitest";
import { OPENS_PER_MINUTE } from "../src/repos/opens.js";
import { ADAPTERS, makeHarness } from "./helpers.js";

const admin = { headers: { authorization: "Bearer s3cret" } };
const open = (level: unknown, network: unknown = "linkedin") => ({ network, level });

describe.each(ADAPTERS)("POST /api/v1/open (%s)", (kind) => {
  it("records a panel open by how the post was flagged, and the stats count them per bucket and in total", async () => {
    const h = await makeHarness(kind, { ADMIN_TOKEN: "s3cret" });
    for (const level of ["none", "none", "yellow", "red"]) expect((await h.call("open", open(level), { install: "install-reader-1xxx" })).body).toEqual({ recorded: true });
    await h.call("open", open("red"), { install: "install-reader-2xxx" });
    const { body } = await h.call("stats", undefined, { ...admin, query: "?range=24h" });
    expect(body.opens).toEqual({ total: 5, none: 2, yellow: 1, red: 2, installs: 2 });
    const sum = (k: string) => body.series.reduce((n: number, b: any) => n + b.opens[k], 0);
    expect([sum("none"), sum("yellow"), sum("red")]).toEqual([2, 1, 2]);
  });

  it("rejects a bad level, a bad network, or no install id", async () => {
    const h = await makeHarness(kind);
    expect((await h.call("open", open("purple"))).status).toBe(422);
    expect((await h.call("open", open("none", "myspace"))).status).toBe(400);
    expect((await h.call("open", open("none"), { install: null })).status).toBe(400);
    expect((await h.call("open", open("none"), { method: "GET" })).status).toBe(405);
  });

  it("doesn't record a disabled install, or one opening panels faster than a person could", async () => {
    const h = await makeHarness(kind, { ADMIN_TOKEN: "s3cret" });
    for (let i = 0; i < OPENS_PER_MINUTE; i++) await h.call("open", open("none"), { install: "install-script-xxxx" });
    expect((await h.call("open", open("none"), { install: "install-script-xxxx" })).body).toEqual({ recorded: false });
    h.clock.t += 61_000; // a minute later it counts again
    expect((await h.call("open", open("none"), { install: "install-script-xxxx" })).body).toEqual({ recorded: true });
    expect((await h.call("stats", undefined, admin)).body.devices).toEqual([]); // opens alone don't make a device show up as checking
    await h.ctx.store.events.record({ network: "linkedin", installId: "install-script-xxxx", kind: "scored" }); // a device the admin can see
    await h.ctx.store.clients.setDisabled(h.ctx.store.hashInstall("install-script-xxxx"), true, "test");
    expect((await h.call("open", open("red"), { install: "install-script-xxxx" })).body).toEqual({ recorded: false });
  });
});
