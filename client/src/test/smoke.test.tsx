import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

describe("client test infrastructure", () => {
  it("renders into jsdom and matches text content", () => {
    render(<div>ok</div>);
    expect(screen.getByText("ok")).toBeInTheDocument();
  });
});
