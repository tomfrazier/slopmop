import { describe, expect, it } from "vitest";
import { clientIp } from "../src/clientIp.js";

const req = (headers: Record<string, string>) => new Request("http://test/api/v1/judge", { headers });

describe("clientIp", () => {
  it("takes the first entry of x-forwarded-for (the original caller, not the proxy chain)", () => {
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.5, 10.0.0.1, 10.0.0.2" }))).toBe("203.0.113.5");
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.5" }))).toBe("203.0.113.5");
    expect(clientIp(req({ "x-forwarded-for": "  203.0.113.5  , 10.0.0.1" }))).toBe("203.0.113.5");
  });
  it("falls back to x-real-ip when there is no x-forwarded-for", () => {
    expect(clientIp(req({ "x-real-ip": "198.51.100.9" }))).toBe("198.51.100.9");
  });
  it("prefers x-forwarded-for over x-real-ip when both are present", () => {
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.5", "x-real-ip": "198.51.100.9" }))).toBe("203.0.113.5");
  });
  it("is null when neither header is present, or x-forwarded-for is empty", () => {
    expect(clientIp(req({}))).toBeNull();
    expect(clientIp(req({ "x-forwarded-for": "" }))).toBeNull();
  });
});
