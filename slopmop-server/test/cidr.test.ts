import { describe, expect, it } from "vitest";
import { anyCidrMatch, inCidr } from "../src/cidr.js";

describe("inCidr", () => {
  it("matches an IPv4 address inside the range, and not one outside it", () => {
    expect(inCidr("10.1.2.3", "10.0.0.0/8")).toBe(true);
    expect(inCidr("10.1.2.3", "10.2.0.0/16")).toBe(false);
    expect(inCidr("192.168.1.1", "192.168.1.1/32")).toBe(true);
    expect(inCidr("192.168.1.2", "192.168.1.1/32")).toBe(false);
    expect(inCidr("1.2.3.4", "0.0.0.0/0")).toBe(true); // matches everything
  });
  it("matches on a non-byte boundary", () => {
    expect(inCidr("203.0.113.130", "203.0.113.128/26")).toBe(true); // the /26 covers .128-.191
    expect(inCidr("203.0.113.190", "203.0.113.128/26")).toBe(true);
    expect(inCidr("203.0.113.192", "203.0.113.128/26")).toBe(false); // one address past the end of the /26
  });
  it("matches an IPv6 address inside the range, including a compressed form", () => {
    expect(inCidr("2001:db8::1", "2001:db8::/32")).toBe(true);
    expect(inCidr("2001:db9::1", "2001:db8::/32")).toBe(false);
    expect(inCidr("2001:db8:abcd:1234::1", "2001:db8::/32")).toBe(true);
  });
  it("never matches across address families", () => {
    expect(inCidr("1.2.3.4", "2001:db8::/32")).toBe(false);
    expect(inCidr("2001:db8::1", "1.2.3.0/24")).toBe(false);
  });
  it("fails closed (never matches) on malformed input, rather than throwing", () => {
    expect(inCidr("not-an-ip", "10.0.0.0/8")).toBe(false);
    expect(inCidr("10.0.0.1", "not-a-range/8")).toBe(false);
    expect(inCidr("10.0.0.1", "10.0.0.0/40")).toBe(false); // out-of-range prefix length
    expect(inCidr("10.0.0.1", "10.0.0.0")).toBe(false); // no /bits at all
    expect(inCidr("999.1.1.1", "0.0.0.0/0")).toBe(false);
    expect(inCidr("2001:db8::1", "2001:db8::/200")).toBe(false);
    expect(inCidr("::ffff:10.0.0.1", "10.0.0.0/8")).toBe(false); // IPv4-mapped IPv6 isn't specially handled: fails safe
  });
});

describe("anyCidrMatch", () => {
  it("is true if any range matches, false for an empty list", () => {
    expect(anyCidrMatch("10.0.0.1", ["1.2.3.0/24", "10.0.0.0/8"])).toBe(true);
    expect(anyCidrMatch("10.0.0.1", [])).toBe(false);
    expect(anyCidrMatch("10.0.0.1", ["1.2.3.0/24"])).toBe(false);
  });
});
