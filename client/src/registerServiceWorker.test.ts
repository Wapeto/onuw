import { describe, it, expect, vi } from "vitest";
import { registerServiceWorker } from "./registerServiceWorker";

describe("registerServiceWorker", () => {
  it("registers /sw.js as a module worker when a container is available", () => {
    const register = vi.fn().mockResolvedValue(undefined);
    registerServiceWorker({ register });
    expect(register).toHaveBeenCalledWith("/sw.js", { type: "module" });
  });

  it("does nothing when no service worker container is available", () => {
    expect(() => registerServiceWorker(undefined)).not.toThrow();
  });
});
