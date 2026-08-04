import http from "node:http";
import { Server } from "socket.io";

// Temporary diagnostic (not part of the game): bare Socket.IO Function,
// zero Redis, zero createApp() indirection -- straight from Vercel's own
// docs example. api/ws-test.ts already proved plain WebSocket Functions
// (and rewrites pointing at them) work fine on this project. This narrows
// further: does Socket.IO itself work here, isolated from the Redis
// adapter that api/socket-io.ts additionally sets up via createApp()?
const server = http.createServer();
// addTrailingSlash: false (previous test) did not fix it -- reverted to
// default. Testing a different variable in isolation: the browser
// negotiates permessage-deflate (WS compression) on every connection
// automatically. If Vercel's WS proxy layer has any quirk with that
// extension's negotiation, it's the kind of subtle mismatch that would
// explain "raw ws works, Socket.IO doesn't" even on an identical
// http.Server/upgrade-handling pattern.
const io = new Server(server, { perMessageDeflate: false });

io.on("connection", (socket) => {
  socket.emit("hello", "hello from api/socketio-test");
});

export default server;
