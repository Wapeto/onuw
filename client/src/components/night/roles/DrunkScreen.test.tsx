import { it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DrunkScreen from "./DrunkScreen";

it("submits the picked center index", async () => {
  const onSubmit = vi.fn();
  render(<DrunkScreen playerId="p1" players={[]} result={null} onSubmit={onSubmit} onContinue={vi.fn()} />);

  await userEvent.click(screen.getByRole("button", { name: "Carte 3" }));
  expect(onSubmit).toHaveBeenCalledWith({ centerIndex: 2 });
});

it("shows a blind confirmation (Drunk never sees the new card)", () => {
  render(<DrunkScreen playerId="p1" players={[]} result={{}} onSubmit={vi.fn()} onContinue={vi.fn()} />);
  expect(screen.getByText(/échangée/)).toBeInTheDocument();
});
