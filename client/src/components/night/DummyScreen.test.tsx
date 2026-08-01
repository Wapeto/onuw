import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NIGHT_TICK_IDS } from "@onuw/shared";
import DummyScreen from "./DummyScreen";
import { DUMMY_CONFIG } from "./dummyConfig";

describe("DummyScreen", () => {
  it("has a configured prompt and button label for every tick", () => {
    for (const tickId of NIGHT_TICK_IDS) {
      expect(DUMMY_CONFIG[tickId].prompt.length).toBeGreaterThan(0);
      expect(DUMMY_CONFIG[tickId].buttonLabel.length).toBeGreaterThan(0);
    }
  });

  it("requires a real tap before showing anything else", async () => {
    render(<DummyScreen tickId="seer" />);
    expect(screen.queryByText("Zzz…")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: DUMMY_CONFIG.seer.buttonLabel }));

    expect(screen.getByText("Zzz…")).toBeInTheDocument();
    expect(screen.getByRole("button")).toBeDisabled();
  });
});
