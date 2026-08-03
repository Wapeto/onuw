import { createApp } from "@onuw/server";

// Vercel's WebSockets docs (https://vercel.com/docs/functions/websockets)
// document a bare http.Server default export for Socket.IO Functions, with
// no .listen() call — createApp() already returns exactly that shape via
// httpServer, unmodified from local dev/test usage (server/src/index.ts).
const { httpServer } = createApp();

export default httpServer;
