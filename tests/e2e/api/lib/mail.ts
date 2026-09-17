import { readMailbox, type CapturedEmail } from "../../support/api";

// Decodes messages captured by the SMTP sink (MIME multipart, quoted-printable / base64 parts,
// RFC 2047 encoded headers) so tests can assert on what candidates and HR actually receive.

export type ParsedEmail = {
  n: number;
  envelopeTo: string[];
  headers: Map<string, string>;
  subject: string;
  replyTo: string;
  to: string;
  text: string;
  html: string;
};

function decodeQuotedPrintable(input: string): string {
  const source = input.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const hex = source.slice(index + 1, index + 3);
    if (char === "=" && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(Number.parseInt(hex, 16));
      index += 2;
    } else {
      bytes.push(...Buffer.from(char, "utf8"));
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

function decodeEncodedWords(value: string): string {
  const joined = value.replace(/\?=\s+=\?/g, "?==?");
  return joined.replace(/=\?([^?]+)\?([QqBb])\?([^?]*)\?=/g, (_match, _charset: string, encoding: string, text: string) => {
    if (encoding.toUpperCase() === "B") return Buffer.from(text, "base64").toString("utf8");
    return decodeQuotedPrintable(text.replace(/_/g, " "));
  });
}

function splitHeaders(raw: string): { headers: Map<string, string>; body: string } {
  const match = /\r?\n\r?\n/.exec(raw);
  const head = match ? raw.slice(0, match.index) : raw;
  const body = match ? raw.slice(match.index + match[0].length) : "";
  const headers = new Map<string, string>();
  const unfolded = head.replace(/\r?\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const index = line.indexOf(":");
    if (index <= 0) continue;
    const name = line.slice(0, index).trim().toLowerCase();
    if (!headers.has(name)) headers.set(name, line.slice(index + 1).trim());
  }
  return { headers, body };
}

function decodeBody(body: string, transferEncoding: string): string {
  const encoding = transferEncoding.toLowerCase();
  if (encoding === "quoted-printable") return decodeQuotedPrintable(body);
  if (encoding === "base64") return Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8");
  return body;
}

function collectParts(raw: string, into: { text: string; html: string }): void {
  const { headers, body } = splitHeaders(raw);
  const contentType = headers.get("content-type") ?? "text/plain";
  const boundary = /boundary="?([^";]+)"?/i.exec(contentType)?.[1];
  if (/^multipart\//i.test(contentType) && boundary) {
    const segments = body.split(`--${boundary}`);
    for (const segment of segments.slice(1)) {
      if (segment.startsWith("--")) break;
      collectParts(segment.replace(/^\r?\n/, ""), into);
    }
    return;
  }
  const decoded = decodeBody(body, headers.get("content-transfer-encoding") ?? "7bit");
  if (/^text\/html/i.test(contentType)) into.html += decoded;
  else if (/^text\/plain/i.test(contentType)) into.text += decoded;
}

export function parseEmail(mail: CapturedEmail): ParsedEmail {
  const { headers } = splitHeaders(mail.raw);
  const parts = { text: "", html: "" };
  collectParts(mail.raw, parts);
  return {
    n: mail.n,
    envelopeTo: mail.to.map((address) => address.toLowerCase()),
    headers,
    subject: decodeEncodedWords(headers.get("subject") ?? mail.subject),
    replyTo: decodeEncodedWords(headers.get("reply-to") ?? ""),
    to: decodeEncodedWords(headers.get("to") ?? ""),
    text: parts.text,
    html: parts.html,
  };
}

// Waits until at least `count` captured messages satisfy the predicate.
export async function waitForEmails(
  predicate: (mail: ParsedEmail) => boolean,
  options: { count?: number; timeoutMs?: number } = {}
): Promise<ParsedEmail[]> {
  const count = options.count ?? 1;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const started = Date.now();
  for (;;) {
    const matches = (await readMailbox()).filter((mail) => mail.raw.length > 0).map(parseEmail).filter(predicate);
    if (matches.length >= count) return matches;
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Expected ${count} matching email(s) within ${timeoutMs} ms, found ${matches.length}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

export async function findEmails(predicate: (mail: ParsedEmail) => boolean): Promise<ParsedEmail[]> {
  return (await readMailbox()).filter((mail) => mail.raw.length > 0).map(parseEmail).filter(predicate);
}

export function sentTo(mail: ParsedEmail, address: string): boolean {
  return mail.envelopeTo.includes(address.toLowerCase());
}
