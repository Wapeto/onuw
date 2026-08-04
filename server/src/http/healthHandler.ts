import type { IncomingMessage, ServerResponse } from "node:http";

const HEALTH_PATHS = new Set(["/", "/healthz"]);

/**
 * Plain-HTTP request handler for the Socket.io server.
 *
 * Socket.io only answers requests under its own path; anything else falls
 * through to the http.Server's own "request" listeners. With no listener at
 * all — how `createApp()` used to build the server — such a request never gets
 * a response and simply hangs until the client times out. A managed host that
 * probes the service over HTTP (Render's health check hits `/`) reads that
 * hang as an unhealthy deploy, so the server must answer plain requests.
 */
export function createHealthHandler() {
  return function handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const path = req.url?.split("?")[0];

    if (path !== undefined && HEALTH_PATHS.has(path)) {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end("ok");
      return;
    }

    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
  };
}
