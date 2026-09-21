import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { adminRouteFor, PATHS } from "../src/paths.js";
import { serveAdmin } from "../src/serve.js";

const api = resolve(import.meta.dirname, "../api");
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(resolve(dir, e.name)) : e.name.endsWith(".ts") ? [resolve(dir, e.name)] : []));

describe("what gets deployed to Vercel", () => {
  it("stays within the Hobby plan's 12 functions (a 13th makes the whole deploy fail)", () => {
    expect(files(api).length).toBeLessThanOrEqual(12);
  });
  it("gives every public endpoint its own file, and every admin endpoint one shared function", () => {
    const names = files(api).map((f) => f.slice(api.length + 1));
    for (const path of Object.keys(PATHS)) {
      if (path.startsWith("admin/")) expect(names, path).toContain("v1/admin/[route].ts");
      else expect(names, path).toContain(`v1/${path}.ts`);
    }
  });
  it("sends each admin path to its handler, and nothing else", () => {
    for (const [path, route] of Object.entries(PATHS).filter(([p]) => p.startsWith("admin/"))) expect(adminRouteFor(`/api/v1/${path}`), path).toBe(route);
    expect(adminRouteFor("/api/v1/admin/stats/")).toBe("stats");
    expect(adminRouteFor("/api/v1/admin/nonsense")).toBeNull();
    expect(adminRouteFor("/api/v1/admin/constructor")).toBeNull(); // inherited object keys aren't routes
    expect(adminRouteFor("/api/v1/admin")).toBeNull();
  });
  it("answers 404 for an unknown admin path, without touching the database", async () => {
    const res = await serveAdmin().fetch(new Request("https://x.test/api/v1/admin/nonsense"));
    expect(res.status).toBe(404);
  });
});
