const env = typeof process === "undefined" ? {} : process.env;

export const DEV_SERVER_HOST = env.CONCOURSE_DEV_HOST ?? "127.0.0.1";
export const DEV_SERVER_PORT = Number(env.CONCOURSE_DEV_PORT ?? 5173);
export const DEV_SERVER_ORIGIN =
  env.CONCOURSE_SERVER_ORIGIN ??
  env.CONCOURSE_DEV_URL ??
  `http://${DEV_SERVER_HOST}:${DEV_SERVER_PORT}`;
