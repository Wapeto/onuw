import { createApp, listen } from "./index.js";

/**
 * Production entry point.
 *
 * `index.ts` self-starts only when it is the process entry point, a guard that
 * compares `process.argv[1]` against its own module URL. That comparison is
 * fragile once a host resolves the project directory through a symlink — the
 * process would boot, never listen, and the deploy would fail its health check
 * with no error to show for it. This module starts unconditionally instead, so
 * `node server/dist/start.js` always serves.
 */
const app = createApp();
const port = Number(process.env.PORT) || 3001;

const actualPort = await listen(app, port);
console.log(`ONUW server listening on port ${actualPort}`);

// Render sends SIGTERM before a redeploy or a free-instance spin-down. Closing
// Socket.io explicitly hangs up clients with a normal close frame, so they
// reconnect immediately instead of waiting out a timeout on a dead socket.
const shutdown = (signal: string) => {
  console.log(`Received ${signal}, shutting down`);
  app.io.close(() => {
    app.subClient.quit().finally(() => process.exit(0));
  });
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
