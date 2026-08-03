import { describe, it, expect } from "vitest";
import { resolveSocketUrl, resolveSocketPath } from "./socketConfig";

describe("resolveSocketUrl", () => {
  it("defaults to localhost:3001 outside production when unset", () => {
    expect(resolveSocketUrl({})).toBe("http://localhost:3001");
  });

  it("resolves to same-origin (undefined) in production when unset", () => {
    expect(resolveSocketUrl({ PROD: true })).toBeUndefined();
  });

  it("prefers an explicit VITE_SERVER_URL in any environment", () => {
    expect(resolveSocketUrl({ VITE_SERVER_URL: "https://staging.example.com", PROD: true })).toBe(
      "https://staging.example.com",
    );
  });
});

describe("resolveSocketPath", () => {
  it("is undefined (socket.io's own default) when unset", () => {
    expect(resolveSocketPath({})).toBeUndefined();
  });

  it("uses an explicit VITE_SOCKET_PATH when provided", () => {
    expect(resolveSocketPath({ VITE_SOCKET_PATH: "/api/socket-io/socket.io" })).toBe("/api/socket-io/socket.io");
  });
});
