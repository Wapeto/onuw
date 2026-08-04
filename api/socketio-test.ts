import http from "node:http";
import { Server } from "socket.io";

// Temporary diagnostic (not part of the game): bare Socket.IO Function,
// zero Redis, zero createApp() indirection -- straight from Vercel's own
// docs example. api/ws-test.ts already proved plain WebSocket Functions
// (and rewrites pointing at them) work fine on this project. This narrows
// further: does Socket.IO itself work here, isolated from the Redis
// adapter that api/socket-io.ts additionally sets up via createApp()?
const server = http.createServer();
// addTrailingSlash:false and perMessageDeflate:false (previous tests)
// neither fixed it -- reverted. Testing another variable: the client
// forces transports:['websocket'], but by default the SERVER still
// advertises polling as an available transport too, which changes
// engine.io's internal handshake state machine even though the client
// never uses polling. Restricting the server to websocket-only as well,
// so both sides agree symmetrically.
const io = new Server(server, { transports: ["websocket"] });

io.on("connection", (socket) => {
  socket.emit("hello", "hello from api/socketio-test");
});

export default server;
