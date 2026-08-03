import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useFullscreen } from "./useFullscreen";

describe("useFullscreen", () => {
  beforeEach(() => {
    document.documentElement.requestFullscreen = vi.fn().mockResolvedValue(undefined);
    document.exitFullscreen = vi.fn().mockResolvedValue(undefined);
  });

  it("requests fullscreen and pushes a history entry when active", () => {
    const pushStateSpy = vi.spyOn(history, "pushState");
    renderHook(() => useFullscreen(true));

    expect(document.documentElement.requestFullscreen).toHaveBeenCalled();
    expect(pushStateSpy).toHaveBeenCalled();
  });

  it("does nothing when inactive", () => {
    renderHook(() => useFullscreen(false));
    expect(document.documentElement.requestFullscreen).not.toHaveBeenCalled();
  });

  it("re-pushes history state on popstate to block back navigation", () => {
    const pushStateSpy = vi.spyOn(history, "pushState");
    renderHook(() => useFullscreen(true));
    pushStateSpy.mockClear();

    window.dispatchEvent(new PopStateEvent("popstate"));

    expect(pushStateSpy).toHaveBeenCalled();
  });

  it("attempts to lock screen orientation to portrait when active", () => {
    const lock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(screen, "orientation", {
      value: { lock, unlock: vi.fn() },
      configurable: true,
    });

    renderHook(() => useFullscreen(true));

    expect(lock).toHaveBeenCalledWith("portrait");
  });

  it("unlocks screen orientation on cleanup", () => {
    const unlock = vi.fn();
    Object.defineProperty(screen, "orientation", {
      value: { lock: vi.fn().mockResolvedValue(undefined), unlock },
      configurable: true,
    });

    const { unmount } = renderHook(() => useFullscreen(true));
    unmount();

    expect(unlock).toHaveBeenCalled();
  });
});
