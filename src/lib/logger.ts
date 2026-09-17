// Minimal structured logger. Each entry is one JSON line so hosting providers
// (Vercel, Docker, systemd, ...) can index and filter it. Never pass secrets,
// connection strings, or applicant PII (names, emails, phone numbers) as meta.

type LogLevel = "info" | "warn" | "error";
type LogMeta = Record<string, unknown>;

// Driver and validation error messages can embed the offending values (e.g. a duplicate
// email address), so only structural details are logged for those error types.
function serializeError(err: unknown): LogMeta {
  if (!(err instanceof Error)) return { message: typeof err === "string" ? err : "Non-error value thrown" };

  const withStack = (meta: LogMeta): LogMeta =>
    process.env.NODE_ENV !== "production" && err.stack ? { ...meta, stack: err.stack } : meta;
  // A stack starts with the error message, which is exactly what must not be logged for the
  // error types below, so only the call-site frames are kept.
  const withFramesOnly = (meta: LogMeta): LogMeta => {
    if (process.env.NODE_ENV === "production" || !err.stack) return meta;
    const frames = err.stack.split("\n").filter((line) => /^\s+at\s/.test(line));
    return frames.length > 0 ? { ...meta, stack: frames.join("\n") } : meta;
  };

  if (err.name === "ValidationError") {
    const errors = (err as { errors?: Record<string, { kind?: string }> }).errors ?? {};
    return withFramesOnly({
      name: err.name,
      fields: Object.keys(errors),
      kinds: Object.values(errors).map((e) => e?.kind ?? "unknown"),
    });
  }
  if (err.name === "CastError") {
    return withFramesOnly({ name: err.name, path: (err as { path?: unknown }).path });
  }
  if (err.name === "MongoServerError" || err.name === "MongoBulkWriteError" || err.name === "MongoWriteConcernError") {
    const e = err as { code?: unknown; codeName?: unknown; keyPattern?: unknown; errorLabels?: unknown };
    return withFramesOnly({ name: err.name, code: e.code, codeName: e.codeName, keyPattern: e.keyPattern, errorLabels: e.errorLabels });
  }

  const code = (err as { code?: unknown }).code;
  return withStack({
    name: err.name,
    message: err.message.slice(0, 500),
    ...(code !== undefined ? { code } : {}),
  });
}

function write(level: LogLevel, event: string, meta?: LogMeta) {
  const entry: LogMeta = { level, time: new Date().toISOString(), event };
  if (meta) {
    for (const [key, value] of Object.entries(meta)) {
      entry[key] = key === "err" || value instanceof Error ? serializeError(value) : value;
    }
  }

  let line: string;
  try {
    line = JSON.stringify(entry);
  } catch {
    line = JSON.stringify({ level, time: entry.time, event, note: "unserializable log meta" });
  }
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

export const logger = {
  info: (event: string, meta?: LogMeta) => write("info", event, meta),
  warn: (event: string, meta?: LogMeta) => write("warn", event, meta),
  error: (event: string, meta?: LogMeta) => write("error", event, meta),
};
