import nodemailer, { type Transporter } from "nodemailer";

let transporter: Transporter | null | undefined;

function getTransporter(): Transporter | null {
  if (transporter !== undefined) return transporter;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    transporter = null;
    return transporter;
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
  return transporter;
}

export async function sendMail(options: {
  to: string;
  subject: string;
  text: string;
}): Promise<void> {
  const t = getTransporter();
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;

  if (!t || !from) {
    console.warn(`SMTP is not configured — skipped sending email "${options.subject}" to ${options.to}.`);
    return;
  }

  try {
    await t.sendMail({ from, to: options.to, subject: options.subject, text: options.text });
  } catch (err) {
    console.error("Failed to send email:", err);
  }
}
