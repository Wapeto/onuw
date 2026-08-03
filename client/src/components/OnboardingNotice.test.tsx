import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import OnboardingNotice from "./OnboardingNotice";

describe("OnboardingNotice", () => {
  it("shows the tête baissée reminder", () => {
    render(<OnboardingNotice onContinue={vi.fn()} />);
    expect(screen.getByText(/tête baissée/i)).toBeInTheDocument();
  });

  it("calls onContinue(false) by default", () => {
    const onContinue = vi.fn();
    render(<OnboardingNotice onContinue={onContinue} />);
    fireEvent.click(screen.getByRole("button", { name: /continuer/i }));
    expect(onContinue).toHaveBeenCalledWith(false);
  });

  it("calls onContinue(true) when 'don't show again' is checked", () => {
    const onContinue = vi.fn();
    render(<OnboardingNotice onContinue={onContinue} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /ne plus afficher/i }));
    fireEvent.click(screen.getByRole("button", { name: /continuer/i }));
    expect(onContinue).toHaveBeenCalledWith(true);
  });
});
