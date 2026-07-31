import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import QRCode from "qrcode";
import RoomQrCode from "./RoomQrCode";

vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,ABC") },
}));

describe("RoomQrCode", () => {
  it("renders a QR image encoding the join URL for the room code", async () => {
    render(<RoomQrCode roomCode="ABCDE" />);

    const img = await screen.findByAltText(/ABCDE/);
    expect(img).toHaveAttribute("src", "data:image/png;base64,ABC");
    expect(QRCode.toDataURL).toHaveBeenCalledWith(expect.stringContaining("/join/ABCDE"));
  });

  it("renders nothing for an empty room code", () => {
    const { container } = render(<RoomQrCode roomCode="" />);
    expect(container).toBeEmptyDOMElement();
  });
});
