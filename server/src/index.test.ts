import { describe, it, expect, afterEach } from "vitest";
import { io as ioClient, type Socket } from "socket.io-client";
import { createApp, listen } from "./index";

describe("server bootstrap", () => {
  let app: ReturnType<typeof createApp>;
  let client: Socket;

  afterEach(async () => {
    client?.close();
    await new Promise<void>((resolve) => app.io.close(() => resolve()));
  });

  it("emits a connected event carrying the socket id", async () => {
    app = createApp();
    const port = await listen(app, 0);
    client = ioClient(`http://localhost:${port}`);

    const payload = await new Promise<{ socketId: string }>((resolve) => {
      client.on("connected", resolve);
    });

    expect(payload.socketId).toBe(client.id);
  });
});
