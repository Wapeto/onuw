import { createApp } from "@onuw/server";

// Vercel's WebSockets docs (https://vercel.com/docs/functions/websockets)
// document a bare http.Server default export for Socket.IO Functions, with
// no .listen() call — createApp() already returns exactly that shape via
// httpServer, unmodified from local dev/test usage (server/src/index.ts).
//
// createApp() runs at cold-start (module load), not per-request, and sets
// up the Redis connection. If it throws, Vercel reports a bare
// FUNCTION_INVOCATION_FAILED with no further detail in the dashboard's
// summary view — logging here explicitly is what actually surfaces the
// real error/stack trace in the runtime logs.
let httpServer: ReturnType<typeof createApp>["httpServer"];
try {
  ({ httpServer } = createApp());
} catch (err) {
  console.error("createApp() failed during cold start:", err);
  throw err;
}

export default httpServer;
