import { describe, it, expect, afterEach } from "vitest";
import { io as ioClient, type Socket } from "socket.io-client";
import { createApp, listen } from "./index";

describe("server bootstrap", () => {
  let app: ReturnType<typeof createApp>;
  let client: Socket;

  afterEach(async () => {
    client?.close();
    await new Promise<void>((resolve) => app.io.close(() => resolve()));
    // See roleSelectEvents.test.ts: createApp()'s duplicated adapter
    // connection must be quit per test, or it leaks and its in-flight
    // commands reject at teardown as an unhandled "Connection is closed.".
    await app.subClient.quit();
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
