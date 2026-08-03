import { describe, it, expect, vi, afterEach } from "vitest";
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

interface FetchEventLike {
  request: { url: string; method: string; mode?: string };
  respondWith: (response: Promise<unknown>) => void;
}

// Re-imports sw.ts with `self.addEventListener` swapped for a collector, so
// the REAL fetch listener the module registers can be invoked directly
// instead of reimplementing its logic in the test.
async function loadFetchHandler(): Promise<(event: FetchEventLike) => void> {
  const listeners = new Map<string, (event: FetchEventLike) => void>();
  const original = self.addEventListener;
  self.addEventListener = ((type: string, listener: unknown) => {
    listeners.set(type, listener as (event: FetchEventLike) => void);
  }) as typeof self.addEventListener;

  try {
    vi.resetModules();
    await import("./sw");
  } finally {
    self.addEventListener = original;
  }

  const handler = listeners.get("fetch");
  if (!handler) throw new Error("sw.ts registered no fetch listener");
  return handler;
}

function stubCache() {
  const put = vi.fn().mockResolvedValue(undefined);
  const match = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("caches", { open: vi.fn().mockResolvedValue({ put, match }) });
  return { put, match };
}

async function runHandler(handler: (event: FetchEventLike) => void, mode: string | undefined) {
  const request = { url: `${self.location.origin}/room/ABCDE`, method: "GET", mode };
  let responded: Promise<unknown> | undefined;
  handler({ request, respondWith: (response) => void (responded = response) });
  return { request, responded };
}

describe("service worker fetch handler", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("caches a navigation response under the shell fallback path as well as its own URL", async () => {
    const handler = await loadFetchHandler();
    const { put } = stubCache();
    const response = { clone: vi.fn(() => ({ cloned: true })) };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    const { request, responded } = await runHandler(handler, "navigate");

    await expect(responded).resolves.toBe(response);
    expect(put).toHaveBeenCalledTimes(2);
    expect(put.mock.calls[0][0]).toBe(request);
    expect(put.mock.calls[1][0]).toBe(SHELL_FALLBACK_PATH);
  });

  it("caches a non-navigation response under its own URL only", async () => {
    const handler = await loadFetchHandler();
    const { put } = stubCache();
    const response = { clone: vi.fn(() => ({ cloned: true })) };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    const { request, responded } = await runHandler(handler, "cors");

    await expect(responded).resolves.toBe(response);
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0][0]).toBe(request);
  });

  it("falls back to the cached shell when the network fails and the URL itself isn't cached", async () => {
    const handler = await loadFetchHandler();
    const shell = { shell: true };
    const put = vi.fn().mockResolvedValue(undefined);
    const match = vi.fn(async (key: unknown) => (key === SHELL_FALLBACK_PATH ? shell : undefined));
    vi.stubGlobal("caches", { open: vi.fn().mockResolvedValue({ put, match }) });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    const { responded } = await runHandler(handler, "navigate");

    await expect(responded).resolves.toBe(shell);
  });
});
