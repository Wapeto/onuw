export interface SocketEnv {
  VITE_SERVER_URL?: string;
  VITE_SOCKET_PATH?: string;
  PROD?: boolean;
}

export function resolveSocketUrl(env: SocketEnv): string | undefined {
  return env.VITE_SERVER_URL || (env.PROD ? undefined : "http://localhost:3001");
}

export function resolveSocketPath(env: SocketEnv): string | undefined {
  return env.VITE_SOCKET_PATH || undefined;
}
