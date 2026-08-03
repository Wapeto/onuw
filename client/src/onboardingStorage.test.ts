import { describe, it, expect, afterEach } from "vitest";
import { isOnboardingDismissed, dismissOnboarding } from "./onboardingStorage";

describe("onboardingStorage", () => {
  afterEach(() => localStorage.clear());

  it("is not dismissed by default", () => {
    expect(isOnboardingDismissed("ABCDE")).toBe(false);
  });

  it("remembers dismissal per room code", () => {
    dismissOnboarding("ABCDE");
    expect(isOnboardingDismissed("ABCDE")).toBe(true);
    expect(isOnboardingDismissed("ZZZZZ")).toBe(false);
  });
});
