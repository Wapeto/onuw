import { useEffect } from "react";

export function useFullscreen(active: boolean): void {
  useEffect(() => {
    if (!active) return;

    void document.documentElement.requestFullscreen?.().catch(() => {});
    void screen.orientation?.lock?.("portrait")?.catch(() => {});
    history.pushState(null, "", location.href);

    const blockBack = () => {
      history.pushState(null, "", location.href);
    };
    window.addEventListener("popstate", blockBack);

    return () => {
      window.removeEventListener("popstate", blockBack);
      screen.orientation?.unlock?.();
      if (document.fullscreenElement) void document.exitFullscreen();
    };
  }, [active]);
}
