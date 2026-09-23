// @vitest-environment jsdom
// A web page where data was expected (a captive portal, filter or VPN answering instead of the server) is named plainly.
import { describe, expect, it } from "vitest";

(globalThis as any).chrome = { storage: { local: { get: async () => ({}), set: async () => {} }, session: { get: async () => ({}), set: async () => {} }, onChanged: { addListener() {} } } };
const { describeNetworkError, interpretFailure, NotJsonError, readJson } = await import("../src/background/judgeFailure");

const page = (status: number) => new Response("<!DOCTYPE html><html><body>Sign in to the network</body></html>", { status, headers: { "content-type": "text/html" } });

describe("a reply that is a web page, not data", () => {
  it("readJson says so plainly instead of 'Unexpected token <'", async () => {
    const err = await readJson(page(200)).catch((e) => e);
    expect(err).toBeInstanceOf(NotJsonError);
    expect(describeNetworkError(err)).toMatch(/returned a web page instead of data \(HTTP 200\).*VPN.*captive portal.*\/api\/v1\/health/);
    expect(describeNetworkError(err)).not.toMatch(/Unexpected token/);
  });

  it("still parses real JSON", async () => {
    expect(await readJson(new Response('{"a":1}'))).toEqual({ a: 1 });
  });

  it("a non-success reply that is a web page gets the same explanation (and isn't retried: it won't change on its own)", async () => {
    const r = await interpretFailure(page(403), 1000);
    expect(r).toMatchObject({ kind: "stop" });
    expect((r as { error: string }).error).toMatch(/web page instead of data \(HTTP 403\)/);
  });

  it("a normal JSON error from the server is unchanged", async () => {
    const res = new Response('{"error":"boom","message":"it broke"}', { status: 503, headers: { "content-type": "application/json" } });
    expect(await interpretFailure(res, 1000)).toMatchObject({ kind: "retry", error: "server 503: it broke" });
  });
});
