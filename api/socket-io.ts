import type { Server } from "node:http";

// Vercel's WebSockets docs (https://vercel.com/docs/functions/websockets)
// document a bare http.Server default export for Socket.IO Functions, with
// no .listen() call — createApp() already returns exactly that shape via
// httpServer, unmodified from local dev/test usage (server/src/index.ts).
//
// Both the module import AND createApp() itself run at cold-start (module
// load), not per-request, and a static top-level `import` failing (e.g. a
// dependency the bundler didn't trace/include) throws before any code in
// this file runs — a try/catch around calling createApp() alone can't
// catch that. Using a dynamic import with top-level await lets a single
// try/catch cover both failure modes, so the real error/stack trace
// actually reaches the runtime logs instead of a bare
// FUNCTION_INVOCATION_FAILED with no detail.
let httpServer: Server;
try {
  const { createApp } = await import("@onuw/server");
  ({ httpServer } = createApp());
} catch (err) {
  console.error("Failed to load @onuw/server or run createApp() during cold start:", err);
  throw err;
}

export default httpServer;
