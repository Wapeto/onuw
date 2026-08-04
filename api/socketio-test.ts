import http from "node:http";
import { Server } from "socket.io";

// Temporary diagnostic (not part of the game): bare Socket.IO Function,
// zero Redis, zero createApp() indirection -- straight from Vercel's own
// docs example. api/ws-test.ts already proved plain WebSocket Functions
// (and rewrites pointing at them) work fine on this project. This narrows
// further: does Socket.IO itself work here, isolated from the Redis
// adapter that api/socket-io.ts additionally sets up via createApp()?
const server = http.createServer();
// Testing a lead from a Socket.IO GitHub discussion about serverless
// routing quirks: engine.io normalizes its own request path to always end
// in a trailing slash (/socket.io/) before matching by default. If
// Vercel's WS-upgrade routing handles that trailing slash differently than
// a normal HTTP request (everything else we've hit today has been
// trailing-slash-related), disabling that normalization may be what's
// needed for the path match to succeed.
const io = new Server(server, { addTrailingSlash: false });

io.on("connection", (socket) => {
  socket.emit("hello", "hello from api/socketio-test");
});

export default server;
