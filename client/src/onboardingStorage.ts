const KEY_PREFIX = "onuw:onboarding-dismissed:";

export function isOnboardingDismissed(roomCode: string): boolean {
  return localStorage.getItem(KEY_PREFIX + roomCode) === "1";
}

export function dismissOnboarding(roomCode: string): void {
  localStorage.setItem(KEY_PREFIX + roomCode, "1");
}
