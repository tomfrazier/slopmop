import { describe, expect, it } from "vitest";
import { createJev } from "../src/jev.js";
import { chooseRoute } from "../src/jevRoute.js";

describe("which way Jev is reached", () => {
  it("uses the AI Gateway when its key is set, under the gateway's model name", () => {
    expect(chooseRoute({ AI_GATEWAY_API_KEY: "g" })).toEqual({ via: "gateway", model: "typesafe-ai/jev", apiKey: "g", baseURL: "https://ai-gateway.vercel.sh/typesafe" });
  });

  it("uses TypeSafe directly when only its key is set", () => {
    expect(chooseRoute({ TYPESAFE_API_KEY: "t" })).toEqual({ via: "direct", model: "jev-latest", apiKey: "t" });
  });

  it("prefers the gateway when both keys are present, unless told otherwise", () => {
    const both = { AI_GATEWAY_API_KEY: "g", TYPESAFE_API_KEY: "t" };
    expect(chooseRoute(both)?.via).toBe("gateway");
    expect(chooseRoute({ ...both, JEV_PROVIDER: "direct" })).toMatchObject({ via: "direct", apiKey: "t" });
    expect(chooseRoute({ ...both, JEV_PROVIDER: "gateway" })).toMatchObject({ via: "gateway", apiKey: "g" });
  });

  it("can point the gateway route at another base URL", () => {
    expect(chooseRoute({ AI_GATEWAY_API_KEY: "g", AI_GATEWAY_BASE_URL: "https://example.test/x" })?.baseURL).toBe("https://example.test/x");
  });

  it("is null when the chosen route has no key, even if the other one does", () => {
    expect(chooseRoute({})).toBeNull();
    expect(chooseRoute({ TYPESAFE_API_KEY: "t", JEV_PROVIDER: "gateway" })).toBeNull();
    expect(chooseRoute({ AI_GATEWAY_API_KEY: "g", JEV_PROVIDER: "direct" })).toBeNull();
    expect(createJev({})).toBeNull();
  });

  it("builds a backend that reports which route it uses", () => {
    expect(createJev({ AI_GATEWAY_API_KEY: "g" })).toMatchObject({ via: "gateway", model: "typesafe-ai/jev" });
    expect(createJev({ TYPESAFE_API_KEY: "t" })).toMatchObject({ via: "direct", model: "jev-latest" });
  });
});
