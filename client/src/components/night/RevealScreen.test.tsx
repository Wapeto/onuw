import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RevealScreen from "./RevealScreen";

describe("RevealScreen", () => {
  it("requires a tap on 'J'ai vu' before calling onContinue, and disables itself after", async () => {
    const onContinue = vi.fn();
    render(
      <RevealScreen onContinue={onContinue}>
        <p>Les Loups-Garous sont : Bob</p>
      </RevealScreen>,
    );

    expect(onContinue).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "J'ai vu" }));

    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "J'ai vu" })).toBeDisabled();
  });
});
