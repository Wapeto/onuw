import { describe, it, expect } from "vitest";
import { isCacheableGet, SHELL_CACHE_NAME, SHELL_FALLBACK_PATH } from "./sw";

describe("isCacheableGet", () => {
  it("accepts same-origin GET requests", () => {
    expect(isCacheableGet({ method: "GET", url: "https://onuw.app/assets/main.js" }, "https://onuw.app")).toBe(true);
  });

  it("rejects non-GET requests", () => {
    expect(isCacheableGet({ method: "POST", url: "https://onuw.app/assets/main.js" }, "https://onuw.app")).toBe(
      false,
    );
  });

  it("rejects cross-origin requests", () => {
    expect(isCacheableGet({ method: "GET", url: "https://cdn.example.com/lib.js" }, "https://onuw.app")).toBe(false);
  });
});

describe("service worker shell constants", () => {
  it("names the shell cache and the offline fallback path", () => {
    expect(SHELL_CACHE_NAME).toBe("onuw-shell-v1");
    expect(SHELL_FALLBACK_PATH).toBe("/index.html");
  });
});
