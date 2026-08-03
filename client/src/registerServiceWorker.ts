export function registerServiceWorker(
  serviceWorkerContainer: Pick<ServiceWorkerContainer, "register"> | undefined,
): void {
  if (!serviceWorkerContainer) return;
  void serviceWorkerContainer.register("/sw.js", { type: "module" });
}
