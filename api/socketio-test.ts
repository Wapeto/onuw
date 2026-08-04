import http from "node:http";
import { Server } from "socket.io";

// Temporary diagnostic (not part of the game): bare Socket.IO Function,
// zero Redis, zero createApp() indirection -- straight from Vercel's own
// docs example. api/ws-test.ts already proved plain WebSocket Functions
// (and rewrites pointing at them) work fine on this project. This narrows
// further: does Socket.IO itself work here, isolated from the Redis
// adapter that api/socket-io.ts additionally sets up via createApp()?
const server = http.createServer();
const io = new Server(server);

io.on("connection", (socket) => {
  socket.emit("hello", "hello from api/socketio-test");
});

export default server;
