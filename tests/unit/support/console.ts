// Captures what the structured logger writes (it uses console.info/warn/error) without printing it.

export type CapturedLine = { stream: "info" | "warn" | "error"; text: string };

export type ConsoleCapture = {
  lines: CapturedLine[];
  // Parsed JSON log entries; lines that are not JSON are skipped.
  entries: () => Record<string, unknown>[];
  text: () => string;
  restore: () => void;
};

export function captureConsole(): ConsoleCapture {
  const original = { info: console.info, warn: console.warn, error: console.error };
  const lines: CapturedLine[] = [];
  const collector =
    (stream: CapturedLine["stream"]) =>
    (...args: unknown[]): void => {
      lines.push({ stream, text: args.map((arg) => (typeof arg === "string" ? arg : String(arg))).join(" ") });
    };
  console.info = collector("info");
  console.warn = collector("warn");
  console.error = collector("error");
  return {
    lines,
    entries: () =>
      lines.flatMap((line) => {
        try {
          const parsed: unknown = JSON.parse(line.text);
          return parsed !== null && typeof parsed === "object" ? [parsed as Record<string, unknown>] : [];
        } catch {
          return [];
        }
      }),
    text: () => lines.map((line) => line.text).join("\n"),
    restore: () => {
      console.info = original.info;
      console.warn = original.warn;
      console.error = original.error;
    },
  };
}

// Runs fn while capturing console output; always restores the console.
export async function withCapturedConsole<T>(fn: (capture: ConsoleCapture) => T | Promise<T>): Promise<T> {
  const capture = captureConsole();
  try {
    return await fn(capture);
  } finally {
    capture.restore();
  }
}
