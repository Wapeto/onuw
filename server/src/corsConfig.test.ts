import { describe, it, expect } from "vitest";
import { resolveCorsOrigin } from "./corsConfig.js";

describe("resolveCorsOrigin", () => {
  it("falls back to a wildcard when CORS_ORIGIN is unset", () => {
    expect(resolveCorsOrigin({})).toBe("*");
  });

  it("falls back to a wildcard when CORS_ORIGIN is blank", () => {
    expect(resolveCorsOrigin({ CORS_ORIGIN: "   " })).toBe("*");
  });

  it("returns a single configured origin as a list", () => {
    expect(resolveCorsOrigin({ CORS_ORIGIN: "https://loup.wapeto.net" })).toEqual([
      "https://loup.wapeto.net",
    ]);
  });

  it("splits a comma-separated list and trims each entry", () => {
    expect(
      resolveCorsOrigin({
        CORS_ORIGIN: "https://loup.wapeto.net, https://onuw-client.vercel.app",
      }),
    ).toEqual(["https://loup.wapeto.net", "https://onuw-client.vercel.app"]);
  });

  it("drops empty entries produced by stray commas", () => {
    expect(resolveCorsOrigin({ CORS_ORIGIN: "https://a.test,,https://b.test," })).toEqual([
      "https://a.test",
      "https://b.test",
    ]);
  });
});
