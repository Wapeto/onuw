import { describe, it, expect } from "vitest";
import { createHealthHandler } from "./healthHandler.js";

interface FakeRes {
  statusCode?: number;
  headers: Record<string, string>;
  body?: string;
}

function invoke(url: string | undefined) {
  const res: FakeRes = { headers: {} };
  const handler = createHealthHandler();
  handler(
    { url } as never,
    {
      writeHead(status: number, headers: Record<string, string>) {
        res.statusCode = status;
        res.headers = headers;
      },
      end(body?: string) {
        res.body = body;
      },
    } as never,
  );
  return res;
}

describe("createHealthHandler", () => {
  it("answers 200 on the root path, which is what Render's health check probes", () => {
    const res = invoke("/");

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("ok");
  });

  it("answers 200 on /healthz", () => {
    expect(invoke("/healthz").statusCode).toBe(200);
  });

  it("ignores the query string when matching", () => {
    expect(invoke("/healthz?probe=1").statusCode).toBe(200);
  });

  it("answers 404 on any other path rather than leaving the request hanging", () => {
    const res = invoke("/does-not-exist");

    expect(res.statusCode).toBe(404);
    expect(res.body).toBe("not found");
  });

  it("answers 404 when the url is missing entirely", () => {
    expect(invoke(undefined).statusCode).toBe(404);
  });
});
