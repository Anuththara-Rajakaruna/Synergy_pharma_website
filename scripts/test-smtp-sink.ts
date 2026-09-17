// SMTP capture server for local development and automated tests. It accepts every message on
// 127.0.0.1 and saves it instead of delivering it:
//
//   npm run test:smtp-sink -- --port 2525 --dir test-results/mailbox
//
// Each message is written as <n>.eml, and index.ndjson gets one line per message (envelope and
// subject). Point the site at it with SMTP_HOST=127.0.0.1, SMTP_PORT=2525, SMTP_SECURE=false,
// SMTP_ALLOW_INSECURE_LOCAL=true. Never expose it beyond localhost.

import { appendFileSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SMTPServer } from "smtp-server";

function readOption(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const port = Number(readOption("port", "2525"));
const dir = path.resolve(readOption("dir", "test-results/mailbox"));
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("--port must be a number between 1 and 65535");
  process.exit(1);
}

mkdirSync(dir, { recursive: true });
let counter = readdirSync(dir).filter((file) => file.endsWith(".eml")).length;

const server = new SMTPServer({
  authOptional: true,
  disabledCommands: ["STARTTLS"],
  onAuth(auth, _session, callback) {
    callback(null, { user: auth.username });
  },
  onData(stream, session, callback) {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      counter += 1;
      writeFileSync(path.join(dir, `${counter}.eml`), raw);
      const subject = (/^Subject: (.*(?:\r?\n[ \t].*)*)/m.exec(raw)?.[1] ?? "").replace(/\r?\n[ \t]/g, " ");
      const from = session.envelope.mailFrom ? session.envelope.mailFrom.address : "";
      appendFileSync(
        path.join(dir, "index.ndjson"),
        `${JSON.stringify({ n: counter, at: new Date().toISOString(), from, to: session.envelope.rcptTo.map((r) => r.address), subject, size: raw.length })}\n`
      );
      callback();
    });
  },
});

server.on("error", (err) => console.error("smtp sink error:", err.message));
server.listen(port, "127.0.0.1", () => {
  console.log(`SMTP capture server listening on 127.0.0.1:${port}; saving messages to ${dir}`);
});
