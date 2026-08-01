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
});
