import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import RoleRecap from "./RoleRecap";

describe("RoleRecap", () => {
  it("lists each selected role with its count and label", () => {
    render(<RoleRecap roles={{ werewolf: 2, seer: 1, villager: 1 }} />);
    expect(screen.getByText("2 × Loup-Garou")).toBeInTheDocument();
    expect(screen.getByText("1 × Voyante")).toBeInTheDocument();
    expect(screen.getByText("1 × Villageois")).toBeInTheDocument();
  });

  it("omits roles with a zero or missing count", () => {
    render(<RoleRecap roles={{ werewolf: 2, seer: 0 }} />);
    expect(screen.queryByText(/Voyante/)).not.toBeInTheDocument();
  });

  it("shows a fallback message when nothing is selected", () => {
    render(<RoleRecap roles={{}} />);
    expect(screen.getByText(/aucun rôle/i)).toBeInTheDocument();
  });
});
