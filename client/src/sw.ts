declare const self: ServiceWorkerGlobalScope;

export const SHELL_CACHE_NAME = "onuw-shell-v1";
export const SHELL_FALLBACK_PATH = "/index.html";

export function isCacheableGet(request: { method: string; url: string }, origin: string): boolean {
  if (request.method !== "GET") return false;
  return new URL(request.url).origin === origin;
}

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== SHELL_CACHE_NAME).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

// Runtime-caches the app shell (HTML/JS/CSS) only, network-first with a
// cache fallback for offline. Never intercepts Socket.io traffic: gameplay
// uses a WebSocket connection, not fetch(), so it never reaches this
// listener (Phase 7 constraint: "coquille offline seulement").
self.addEventListener("fetch", (event) => {
  if (!isCacheableGet(event.request, self.location.origin)) return;

  event.respondWith(
    (async () => {
      try {
        const response = await fetch(event.request);
        const cache = await caches.open(SHELL_CACHE_NAME);
        void cache.put(event.request, response.clone());
        // Navigation responses (the app shell itself) are additionally
        // cached under the fixed fallback key, since Vite Router serves the
        // same index.html for every client-side route — without this, the
        // offline fallback below can never match anything, because nothing
        // is ever requested under the literal "/index.html" URL.
        if (event.request.mode === "navigate") {
          void cache.put(SHELL_FALLBACK_PATH, response.clone());
        }
        return response;
      } catch {
        const cache = await caches.open(SHELL_CACHE_NAME);
        const cached = (await cache.match(event.request)) ?? (await cache.match(SHELL_FALLBACK_PATH));
        if (cached) return cached;
        throw new Error("offline and no cached response available");
      }
    })(),
  );
});
