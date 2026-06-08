import nodemailer from "nodemailer";

function createTransport() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

const from = process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "careers@synergypharma.lk";
const adminEmail = process.env.ADMIN_NOTIFY_EMAIL;

export async function sendApplicationConfirmation(opts: {
  to: string;
  name: string;
  position: string;
  applicationId: string;
}) {
  const transport = createTransport();
  if (!transport) return;

  await transport.sendMail({
    from: `"Synergy Pharmaceuticals Careers" <${from}>`,
    to: opts.to,
    subject: `Application received — ${opts.position}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:32px 24px;color:#1a2b38">
        <h2 style="color:#055f7c;margin-bottom:8px">Thank you, ${opts.name}.</h2>
        <p style="font-size:16px;line-height:1.6">
          We've received your application for <strong>${opts.position}</strong> at Synergy Pharmaceuticals.
          Our HR team reviews every submission carefully and will be in touch if your profile is a strong match.
        </p>
        <p style="font-size:14px;color:#4d6578;margin-top:24px">
          Your reference number: <strong>${opts.applicationId}</strong>
          <br>You can check your application status at any time at
          <a href="${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/careers/status" style="color:#055f7c">
            ${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/careers/status
          </a>
        </p>
        <hr style="border:none;border-top:1px solid #dce8f0;margin:28px 0">
        <p style="font-size:12px;color:#7a8a9d">
          Synergy Pharmaceuticals · Bingiriya, Sri Lanka<br>
          This is an automated message — please do not reply directly.
        </p>
      </div>
    `,
    text: `Thank you ${opts.name}. We received your application for ${opts.position}. Reference: ${opts.applicationId}.`,
  });
}

export async function sendNewApplicationAlert(opts: {
  applicantName: string;
  position: string;
  email: string;
  applicationId: string;
}) {
  const transport = createTransport();
  if (!transport || !adminEmail) return;

  await transport.sendMail({
    from: `"Careers Portal" <${from}>`,
    to: adminEmail,
    subject: `New application — ${opts.position}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:32px 24px;color:#1a2b38">
        <h2 style="color:#055f7c">New application received</h2>
        <table style="width:100%;border-collapse:collapse;font-size:15px;margin-top:16px">
          <tr><td style="padding:8px 0;color:#4d6578;width:140px">Applicant</td><td><strong>${opts.applicantName}</strong></td></tr>
          <tr><td style="padding:8px 0;color:#4d6578">Position</td><td>${opts.position}</td></tr>
          <tr><td style="padding:8px 0;color:#4d6578">Email</td><td><a href="mailto:${opts.email}" style="color:#055f7c">${opts.email}</a></td></tr>
          <tr><td style="padding:8px 0;color:#4d6578">Reference</td><td>${opts.applicationId}</td></tr>
        </table>
        <a href="${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/careers/admin" style="display:inline-block;margin-top:24px;padding:12px 24px;background:#055f7c;color:white;border-radius:8px;text-decoration:none;font-weight:bold">
          View in Admin Portal
        </a>
      </div>
    `,
    text: `New application from ${opts.applicantName} for ${opts.position} (${opts.email}). Reference: ${opts.applicationId}.`,
  });
}

export async function sendStatusUpdateNotification(opts: {
  to: string;
  name: string;
  position: string;
  status: string;
}) {
  const transport = createTransport();
  if (!transport) return;

  const statusMessages: Record<string, string> = {
    reviewed: "Your application has been reviewed by our HR team.",
    shortlisted: "Great news — you have been shortlisted! Our team will be in touch shortly to discuss next steps.",
    rejected: "After careful review, we have decided not to proceed with your application at this time. We appreciate your interest and encourage you to apply for future openings.",
  };

  const message = statusMessages[opts.status];
  if (!message) return;

  await transport.sendMail({
    from: `"Synergy Pharmaceuticals Careers" <${from}>`,
    to: opts.to,
    subject: `Update on your application — ${opts.position}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:32px 24px;color:#1a2b38">
        <h2 style="color:#055f7c">Application Update</h2>
        <p style="font-size:16px;line-height:1.6">Dear ${opts.name},</p>
        <p style="font-size:16px;line-height:1.6">${message}</p>
        <p style="font-size:14px;color:#4d6578;margin-top:24px">
          Role applied for: <strong>${opts.position}</strong>
        </p>
        <hr style="border:none;border-top:1px solid #dce8f0;margin:28px 0">
        <p style="font-size:12px;color:#7a8a9d">Synergy Pharmaceuticals · Bingiriya, Sri Lanka</p>
      </div>
    `,
    text: `Dear ${opts.name}, ${message}`,
  });
}

export async function sendInterviewInvitation(opts: {
  to: string;
  name: string;
  position: string;
  interviewLink: string;
}) {
  const transport = createTransport();
  if (!transport) return;

  await transport.sendMail({
    from: `"Synergy Pharmaceuticals Careers" <${from}>`,
    to: opts.to,
    subject: `Interview Invitation — ${opts.position} at Synergy Pharmaceuticals`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:32px 24px;color:#1a2b38">
        <h2 style="color:#055f7c">Interview Invitation</h2>
        <p style="font-size:16px;line-height:1.6">Dear ${opts.name},</p>
        <p style="font-size:16px;line-height:1.6">
          Thank you for your application for the <strong>${opts.position}</strong> role at Synergy Pharmaceuticals.
          We are pleased to invite you to an interview.
        </p>
        <p style="font-size:16px;line-height:1.6">
          Please use the link below to select a time that works for you:
        </p>
        <a href="${opts.interviewLink}" style="display:inline-block;margin:16px 0;padding:14px 28px;background:#055f7c;color:white;border-radius:8px;text-decoration:none;font-weight:bold;font-size:15px;">
          Schedule Interview →
        </a>
        <p style="font-size:14px;color:#4d6578;margin-top:24px">
          If you have any questions, contact us at <a href="mailto:hr@synergypharma.lk" style="color:#055f7c">hr@synergypharma.lk</a>.
        </p>
        <hr style="border:none;border-top:1px solid #dce8f0;margin:28px 0">
        <p style="font-size:12px;color:#7a8a9d">Synergy Pharmaceuticals · Bingiriya, Sri Lanka</p>
      </div>
    `,
    text: `Dear ${opts.name}, you have been invited to an interview for ${opts.position}. Schedule here: ${opts.interviewLink}`,
  });
}
