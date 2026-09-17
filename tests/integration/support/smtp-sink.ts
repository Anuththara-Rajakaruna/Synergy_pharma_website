// In-process SMTP capture server (the same approach as scripts/test-smtp-sink.ts, but messages are
// kept in memory so tests can assert on them). Listens on 127.0.0.1 only.

import { createServer } from "node:net";
import { SMTPServer } from "smtp-server";

export type CapturedMessage = { from: string; to: string[]; raw: string; receivedAt: Date };

const PORT_RANGE = { from: 2626, to: 2699 };

function canListen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });
}

// A free port in the range reserved for test SMTP servers, starting at a random offset so parallel
// suites on the same machine rarely probe the same port first.
export async function findFreeSmtpPort(): Promise<number> {
  const size = PORT_RANGE.to - PORT_RANGE.from + 1;
  const offset = Math.floor(Math.random() * size);
  for (let i = 0; i < size; i += 1) {
    const port = PORT_RANGE.from + ((offset + i) % size);
    if (await canListen(port)) return port;
  }
  throw new Error(`No free port for the SMTP capture server between ${PORT_RANGE.from} and ${PORT_RANGE.to}.`);
}

export class SmtpSink {
  readonly messages: CapturedMessage[] = [];
  // Recipients answered with "550 mailbox unavailable" (a permanent failure).
  readonly rejectedRecipients = new Set<string>();
  private server: SMTPServer | null = null;

  constructor(readonly port: number) {}

  get running(): boolean {
    return this.server !== null;
  }

  async start(): Promise<void> {
    if (this.server) return;
    const server = new SMTPServer({
      authOptional: true,
      disabledCommands: ["STARTTLS", "AUTH"],
      logger: false,
      closeTimeout: 1000,
      onRcptTo: (address, _session, callback) => {
        if (this.rejectedRecipients.has(address.address.toLowerCase())) {
          callback(Object.assign(new Error("Requested action not taken: mailbox unavailable"), { responseCode: 550 }));
          return;
        }
        callback();
      },
      onData: (stream, session, callback) => {
        const chunks: Buffer[] = [];
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("end", () => {
          this.messages.push({
            from: session.envelope.mailFrom ? session.envelope.mailFrom.address : "",
            to: session.envelope.rcptTo.map((recipient) => recipient.address),
            raw: Buffer.concat(chunks).toString("utf8"),
            receivedAt: new Date(),
          });
          callback();
        });
      },
    });
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => reject(err);
      server.once("error", onError);
      server.listen(this.port, "127.0.0.1", () => {
        server.off("error", onError);
        server.on("error", () => {
          // Client disconnects are expected when tests stop the server mid-conversation.
        });
        resolve();
      });
    });
    this.server = server;
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = null;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  messagesTo(address: string): CapturedMessage[] {
    const wanted = address.toLowerCase();
    return this.messages.filter((message) => message.to.some((to) => to.toLowerCase() === wanted));
  }
}
