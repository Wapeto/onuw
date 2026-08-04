import http from "node:http";
import { WebSocketServer } from "ws";

// Temporary diagnostic endpoint (not part of the game): the minimal
// WebSocket Function example from Vercel's own docs
// (https://vercel.com/docs/functions/websockets), with no Socket.IO, no
// Redis, no createApp() indirection. Its only purpose is to answer one
// question in isolation: does a bare WebSocket Function work at all on
// this Vercel project? If this also fails the same way api/socket-io.ts
// does, the problem isn't in the game's code or dependencies.
const server = http.createServer();
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  ws.send("hello from api/ws-test");
  ws.on("message", (data) => {
    ws.send(data);
  });
});

export default server;
