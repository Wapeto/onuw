export interface CorsEnv {
  CORS_ORIGIN?: string;
}

/**
 * Origins allowed to open a Socket.io connection.
 *
 * The client and the server no longer share an origin: the client is served
 * from Vercel, the server runs on its own host. `CORS_ORIGIN` accepts a
 * comma-separated list so preview deployments can be allowed alongside the
 * production domain. Left unset it stays a wildcard, which is what local
 * development and a freshly created server need to work at all.
 */
export function resolveCorsOrigin(env: CorsEnv): string | string[] {
  const configured = env.CORS_ORIGIN?.trim();
  if (!configured) return "*";

  const origins = configured
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  return origins.length > 0 ? origins : "*";
}
