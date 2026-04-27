/**
 * Structured logger.
 *
 * Uses pino in production for fast JSON logs (CI-ingestable). Falls back to
 * a tiny console wrapper when pino isn't installed (e.g. dev/sandbox without
 * `npm install`). Either way the public surface is stable so no other module
 * needs to know which backend is in use.
 *
 * Levels: trace, debug, info, warn, error, fatal.
 *
 * Configuration via env:
 *   LOG_LEVEL    — one of the levels above (default: info)
 *   LOG_PRETTY   — "1" to use pino-pretty in dev (default: 0 in CI)
 */

export interface Logger {
  trace: (msgOrObj: unknown, msg?: string) => void;
  debug: (msgOrObj: unknown, msg?: string) => void;
  info: (msgOrObj: unknown, msg?: string) => void;
  warn: (msgOrObj: unknown, msg?: string) => void;
  error: (msgOrObj: unknown, msg?: string) => void;
  fatal: (msgOrObj: unknown, msg?: string) => void;
  child: (bindings: Record<string, unknown>) => Logger;
}

function makeFallback(prefix: Record<string, unknown> = {}): Logger {
  const level = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  const order = ["trace", "debug", "info", "warn", "error", "fatal"];
  const minIdx = Math.max(0, order.indexOf(level));
  const emit = (lvl: string, msgOrObj: unknown, msg?: string): void => {
    if (order.indexOf(lvl) < minIdx) return;
    const ts = new Date().toISOString();
    const payload =
      typeof msgOrObj === "string"
        ? { ...prefix, msg: msgOrObj }
        : { ...prefix, ...((msgOrObj ?? {}) as object), ...(msg ? { msg } : {}) };
    const line = JSON.stringify({ ts, level: lvl, ...payload });
    if (lvl === "error" || lvl === "fatal") console.error(line);
    else console.log(line);
  };
  return {
    trace: (m, s) => emit("trace", m, s),
    debug: (m, s) => emit("debug", m, s),
    info: (m, s) => emit("info", m, s),
    warn: (m, s) => emit("warn", m, s),
    error: (m, s) => emit("error", m, s),
    fatal: (m, s) => emit("fatal", m, s),
    child: (bindings) => makeFallback({ ...prefix, ...bindings }),
  };
}

function tryMakePino(): Logger | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pino = require("pino");
    const pretty = process.env.LOG_PRETTY === "1";
    const opts: any = {
      level: process.env.LOG_LEVEL ?? "info",
      base: { service: "sel2pw" },
    };
    if (pretty) {
      opts.transport = {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "SYS:HH:MM:ss" },
      };
    }
    const instance = pino(opts);
    return instance as Logger;
  } catch {
    return null;
  }
}

export const logger: Logger = tryMakePino() ?? makeFallback({ service: "sel2pw" });
