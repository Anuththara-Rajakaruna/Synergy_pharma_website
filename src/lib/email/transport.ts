import nodemailer, { type Transporter } from "nodemailer";
import { hasControlCharacters, isValidEmail } from "@/lib/careers/validation";

// SMTP delivery. Messages are normally sent through the outbox (src/lib/email/outbox.ts), which
// records every message before it is sent and retries failures; call sendEmailNow directly only
// from the outbox worker.

export class EmailNotConfiguredError extends Error {
  constructor(message = "SMTP is not configured.") {
    super(message);
    this.name = "EmailNotConfiguredError";
  }
}

type SmtpSettings = {
  host: string;
  port: number;
  secure: boolean;
  // Plain-text SMTP to a loopback mail catcher (Mailpit, MailHog) during local development.
  allowInsecureLocal: boolean;
  auth: { user: string; pass: string } | null;
  from: { name: string; address: string };
};

export type EmailConfigProblem = { variable: string; message: string };

const HOSTNAME = /^[A-Za-z0-9.-]+$|^\[[0-9A-Fa-f:.]+\]$/;

function parseFrom(raw: string): { name: string; address: string } | null {
  const match = /^(.*)<([^<>]+)>$/.exec(raw);
  const name = (match ? match[1] : "").trim().replace(/^"(.*)"$/, "$1").trim();
  const address = (match ? match[2] : raw).trim();
  if (!isValidEmail(address)) return null;
  if (name && (hasControlCharacters(name) || /["<>]/.test(name) || name.length > 100)) return null;
  return { name, address };
}

function readSmtpSettings(env: Record<string, string | undefined> = process.env): { settings: SmtpSettings | null; problems: EmailConfigProblem[] } {
  const problems: EmailConfigProblem[] = [];
  const host = (env.SMTP_HOST ?? "").trim();
  if (!host) problems.push({ variable: "SMTP_HOST", message: "SMTP_HOST is not set, so emails cannot be delivered." });
  else if (!HOSTNAME.test(host) || host.length > 253) problems.push({ variable: "SMTP_HOST", message: "SMTP_HOST is not a valid host name." });

  const portRaw = (env.SMTP_PORT ?? "").trim();
  let port = 587;
  if (portRaw) {
    const parsed = /^\d+$/.test(portRaw) ? Number(portRaw) : Number.NaN;
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      problems.push({ variable: "SMTP_PORT", message: "SMTP_PORT must be a whole number between 1 and 65535." });
    } else {
      port = parsed;
    }
  }

  const secureRaw = (env.SMTP_SECURE ?? "").trim().toLowerCase();
  let secure = port === 465;
  if (secureRaw === "true") secure = true;
  else if (secureRaw === "false") secure = false;
  else if (secureRaw) problems.push({ variable: "SMTP_SECURE", message: "SMTP_SECURE must be true or false." });

  const insecureRaw = (env.SMTP_ALLOW_INSECURE_LOCAL ?? "").trim().toLowerCase();
  const isLoopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host.toLowerCase());
  const allowInsecureLocal = insecureRaw === "true" && isLoopback;
  if (insecureRaw && insecureRaw !== "true" && insecureRaw !== "false") {
    problems.push({ variable: "SMTP_ALLOW_INSECURE_LOCAL", message: "SMTP_ALLOW_INSECURE_LOCAL must be true or false." });
  } else if (insecureRaw === "true" && !isLoopback) {
    problems.push({
      variable: "SMTP_ALLOW_INSECURE_LOCAL",
      message: "SMTP_ALLOW_INSECURE_LOCAL is only allowed when SMTP_HOST is localhost; remote SMTP servers always require TLS.",
    });
  }

  // Both empty is allowed for relays that authenticate by IP address.
  const user = env.SMTP_USER ?? "";
  const pass = env.SMTP_PASS ?? "";
  if (Boolean(user.trim()) !== Boolean(pass)) {
    problems.push({
      variable: user.trim() ? "SMTP_PASS" : "SMTP_USER",
      message: "SMTP_USER and SMTP_PASS must be set together (or both left empty for an IP-authenticated relay).",
    });
  }

  const fromRaw = (env.SMTP_FROM ?? "").trim();
  const from = fromRaw ? parseFrom(fromRaw) : null;
  if (!fromRaw) problems.push({ variable: "SMTP_FROM", message: 'SMTP_FROM is not set (e.g. "Synergy Careers <careers@example.com>").' });
  else if (!from) problems.push({ variable: "SMTP_FROM", message: 'SMTP_FROM must be an email address or "Name <address>".' });

  if (problems.length > 0 || !from) return { settings: null, problems };
  return {
    settings: { host, port, secure, allowInsecureLocal, auth: user.trim() ? { user: user.trim(), pass } : null, from },
    problems,
  };
}

export function inspectEmailConfig(): EmailConfigProblem[] {
  return readSmtpSettings().problems;
}

export function getEmailConfigProblems(): string[] {
  return inspectEmailConfig().map((problem) => problem.message);
}

export function isEmailConfigured(): boolean {
  return readSmtpSettings().settings !== null;
}

let cached: { transporter: Transporter; from: SmtpSettings["from"] } | null = null;

function getTransport(): { transporter: Transporter; from: SmtpSettings["from"] } {
  if (cached) return cached;
  const { settings } = readSmtpSettings();
  if (!settings) throw new EmailNotConfiguredError();
  const transporter = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    // Refuse to continue without STARTTLS so credentials and candidate data are never sent in
    // clear text when a network attacker strips the STARTTLS capability.
    // SMTP_ALLOW_INSECURE_LOCAL only ever applies to a loopback host (see readSmtpSettings).
    requireTLS: !settings.secure && !settings.allowInsecureLocal,
    ...(settings.allowInsecureLocal ? { ignoreTLS: true } : {}),
    tls: { minVersion: "TLSv1.2" },
    ...(settings.auth ? { auth: settings.auth } : {}),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    dnsTimeout: 5_000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  cached = { transporter, from: settings.from };
  return cached;
}

function assertRecipient(address: string, label: string): void {
  if (!isValidEmail(address)) throw new Error(`Invalid ${label} address.`);
}

export async function sendEmailNow(msg: { to: string; replyTo?: string | null; subject: string; text: string; html: string }): Promise<void> {
  assertRecipient(msg.to, "recipient");
  if (msg.replyTo) assertRecipient(msg.replyTo, "reply-to");
  const { transporter, from } = getTransport();
  await transporter.sendMail({
    from,
    // Address objects are never re-parsed, so a crafted value cannot add recipients.
    to: { name: "", address: msg.to },
    ...(msg.replyTo ? { replyTo: { name: "", address: msg.replyTo } } : {}),
    subject: msg.subject.replace(/[\r\n]+/g, " ").trim(),
    text: msg.text,
    html: msg.html,
    headers: { "Auto-Submitted": "auto-generated" },
  });
}

// Short, PII-free description of a delivery failure for the outbox record and logs. SMTP
// responses can echo recipient addresses, so only codes are kept.
export function describeEmailError(err: unknown): string {
  if (err instanceof EmailNotConfiguredError) return "smtp_not_configured";
  if (!(err instanceof Error)) return "unknown_error";
  const e = err as Error & { code?: unknown; responseCode?: unknown; command?: unknown };
  const parts = [typeof e.code === "string" ? e.code : err.name];
  if (typeof e.responseCode === "number") parts.push(String(e.responseCode));
  if (typeof e.command === "string" && /^[A-Z ]{2,20}$/.test(e.command)) parts.push(e.command);
  return parts.join(" ").slice(0, 200);
}

// Failures that will not succeed on retry (the server rejected the recipient or the envelope).
export function isPermanentEmailError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const e = err as Error & { code?: unknown; responseCode?: unknown; command?: unknown };
  if (e.code === "EENVELOPE" && typeof e.responseCode === "number" && e.responseCode >= 550 && e.responseCode <= 553) return true;
  return e.command === "RCPT TO" && typeof e.responseCode === "number" && e.responseCode >= 550 && e.responseCode <= 553;
}
