import type { ApplicationStatus } from "@/lib/careers/constants";
import { CONTACT_EMAIL, SITE_NAME, SITE_URL } from "@/lib/site";

// Transactional email content. Every template returns a subject, a plain-text body and an HTML
// body built from the same parts. All interpolated values are HTML-escaped; candidate-facing
// messages never contain links or other values supplied by candidates. No images or tracking.

export type EmailContent = { subject: string; text: string; html: string };

const BRAND = {
  primary: "#055f7c",
  accent: "#1075bd",
  ink: "#0a1f35",
  muted: "#42677f",
  soft: "#5f89a4",
  border: "#d9e6ee",
  background: "#f3f7fa",
};

const FONT = "'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Escapes and keeps line breaks.
function multiline(value: string): string {
  return escapeHtml(value.replace(/\r\n?/g, "\n")).replace(/\n/g, "<br>");
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function subjectLine(value: string): string {
  const cleaned = oneLine(value);
  return cleaned.length > 250 ? `${cleaned.slice(0, 247)}...` : cleaned;
}

type Block =
  | { type: "paragraph"; text: string }
  | { type: "details"; rows: [label: string, value: string][] }
  | { type: "quote"; title: string; text: string }
  | { type: "button"; label: string; url: string }
  | { type: "heading"; text: string };

type Layout = {
  subject: string;
  preheader: string;
  greeting: string | null;
  title: string;
  blocks: Block[];
  signOff: string[];
  footerNote: string;
};

function renderHtmlBlock(block: Block): string {
  switch (block.type) {
    case "paragraph":
      return `<p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:${BRAND.ink};">${multiline(block.text)}</p>`;
    case "heading":
      return `<h2 style="margin:24px 0 8px;font-size:16px;line-height:1.4;color:${BRAND.primary};font-weight:600;">${escapeHtml(block.text)}</h2>`;
    case "details": {
      const rows = block.rows
        .map(
          ([label, value]) =>
            `<tr><td width="130" style="width:130px;padding:8px 12px 8px 0;font-size:13px;color:${BRAND.muted};vertical-align:top;">${escapeHtml(label)}</td>` +
            `<td style="padding:8px 0;font-size:14px;color:${BRAND.ink};font-weight:600;vertical-align:top;word-break:break-word;">${multiline(value)}</td></tr>`
        )
        .join("");
      return (
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 20px;border-collapse:collapse;background:${BRAND.background};border-radius:12px;">` +
        `<tr><td style="padding:12px 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows}</table></td></tr></table>`
      );
    }
    case "quote":
      return (
        `<p style="margin:8px 0 6px;font-size:13px;color:${BRAND.muted};font-weight:600;">${escapeHtml(block.title)}</p>` +
        `<div style="margin:0 0 20px;padding:14px 16px;border-left:4px solid ${BRAND.accent};background:${BRAND.background};font-size:14px;line-height:1.65;color:${BRAND.ink};word-break:break-word;">${multiline(block.text)}</div>`
      );
    case "button":
      return (
        `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr>` +
        `<td style="border-radius:999px;background:${BRAND.primary};">` +
        `<a href="${escapeHtml(block.url)}" style="display:inline-block;padding:12px 26px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px;">${escapeHtml(block.label)}</a>` +
        `</td></tr></table>`
      );
  }
}

function renderTextBlock(block: Block): string {
  switch (block.type) {
    case "paragraph":
      return block.text;
    case "heading":
      return block.text.toUpperCase();
    case "details":
      return block.rows.map(([label, value]) => `${label}: ${value}`).join("\n");
    case "quote":
      return `${block.title}\n${block.text
        .split(/\r\n?|\n/)
        .map((line) => `> ${line}`)
        .join("\n")}`;
    case "button":
      return `${block.label}: ${block.url}`;
  }
}

function render(layout: Layout): EmailContent {
  const siteHost = SITE_URL.replace(/^https?:\/\//, "");
  const year = new Date().getFullYear();

  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta name="color-scheme" content="light"><title>${escapeHtml(layout.subject)}</title></head>` +
    `<body style="margin:0;padding:0;background:${BRAND.background};font-family:${FONT};">` +
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(layout.preheader)}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.background};border-collapse:collapse;">` +
    `<tr><td align="center" style="padding:32px 16px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;border-collapse:separate;background:#ffffff;border:1px solid ${BRAND.border};border-radius:20px;overflow:hidden;">` +
    `<tr><td style="padding:22px 32px;background:${BRAND.primary};background-image:linear-gradient(135deg, ${BRAND.primary}, ${BRAND.accent});">` +
    `<p style="margin:0;font-size:18px;line-height:1.3;font-weight:700;color:#ffffff;letter-spacing:0.2px;">${escapeHtml(SITE_NAME)}</p>` +
    `<p style="margin:4px 0 0;font-size:12px;line-height:1.4;color:#d7ecf5;text-transform:uppercase;letter-spacing:1.2px;">Careers</p>` +
    `</td></tr>` +
    `<tr><td style="padding:32px 32px 8px;font-family:${FONT};">` +
    `<h1 style="margin:0 0 20px;font-size:22px;line-height:1.35;color:${BRAND.ink};font-weight:700;">${escapeHtml(layout.title)}</h1>` +
    (layout.greeting ? `<p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:${BRAND.ink};">${escapeHtml(layout.greeting)}</p>` : "") +
    layout.blocks.map(renderHtmlBlock).join("") +
    (layout.signOff.length
      ? `<p style="margin:24px 0 24px;font-size:15px;line-height:1.65;color:${BRAND.ink};">${layout.signOff.map(escapeHtml).join("<br>")}</p>`
      : "") +
    `</td></tr>` +
    `<tr><td style="padding:20px 32px 28px;border-top:1px solid ${BRAND.border};font-family:${FONT};">` +
    `<p style="margin:0 0 6px;font-size:12px;line-height:1.6;color:${BRAND.soft};">${escapeHtml(layout.footerNote)}</p>` +
    `<p style="margin:0;font-size:12px;line-height:1.6;color:${BRAND.soft};">&copy; ${year} ${escapeHtml(SITE_NAME)} &middot; ` +
    `<a href="${escapeHtml(SITE_URL)}" style="color:${BRAND.accent};text-decoration:none;">${escapeHtml(siteHost)}</a></p>` +
    `</td></tr></table></td></tr></table></body></html>`;

  const textParts = [
    layout.title,
    ...(layout.greeting ? [layout.greeting] : []),
    ...layout.blocks.map(renderTextBlock),
    ...(layout.signOff.length ? [layout.signOff.join("\n")] : []),
    `-- \n${SITE_NAME}\n${SITE_URL}`,
    layout.footerNote,
  ];

  return { subject: subjectLine(layout.subject), text: `${textParts.join("\n\n")}\n`, html };
}

const CANDIDATE_FOOTER = `This message was sent by ${SITE_NAME} regarding your job application. If you have questions about how we handle your personal data, contact us at ${CONTACT_EMAIL}.`;
const TALENT_FOOTER = `You are receiving this message because you submitted your details to the ${SITE_NAME} talent pool. To update or remove your details, contact us at ${CONTACT_EMAIL}.`;
const INTERNAL_FOOTER = `Internal notification from the ${SITE_NAME} website. It contains personal data; do not forward it outside the organisation.`;
const RECRUITMENT_SIGN_OFF = ["Kind regards,", "Talent Acquisition Team", SITE_NAME];

function greeting(name: string): string {
  return `Dear ${oneLine(name)},`;
}

function adminLink(params: Record<string, string>): string {
  return `${SITE_URL}/careers/admin?${new URLSearchParams(params).toString()}`;
}

export function applicationReceivedEmail(input: { name: string; jobTitle: string; reference: string }): EmailContent {
  const jobTitle = oneLine(input.jobTitle);
  return render({
    subject: `Application received: ${jobTitle} (${input.reference})`,
    preheader: `Thank you for applying for the ${jobTitle} position.`,
    greeting: greeting(input.name),
    title: "Thank you for your application",
    blocks: [
      {
        type: "paragraph",
        text: `Thank you for your interest in joining ${SITE_NAME}. We have received your application for the ${jobTitle} position and our recruitment team will review it carefully.`,
      },
      { type: "details", rows: [["Position", jobTitle], ["Reference", input.reference]] },
      { type: "heading", text: "What happens next" },
      {
        type: "paragraph",
        text: "If your qualifications and experience match the requirements of the role, a member of our team will contact you about the next steps. Due to the number of applications we receive, we may not be able to respond to every applicant individually.",
      },
      { type: "paragraph", text: "Please quote your reference number if you contact us about this application." },
    ],
    signOff: RECRUITMENT_SIGN_OFF,
    footerNote: CANDIDATE_FOOTER,
  });
}

export function hrNewApplicationEmail(input: {
  name: string;
  jobTitle: string;
  reference: string;
  applicationId: string;
  hasCoverLetter: boolean;
  documentCount: number;
}): EmailContent {
  const jobTitle = oneLine(input.jobTitle);
  const documents = input.documentCount === 1 ? "1 PDF document" : `${input.documentCount} PDF documents`;
  return render({
    subject: `New application: ${jobTitle} (${input.reference})`,
    preheader: `A new application for ${jobTitle} is ready for review.`,
    greeting: null,
    title: "New job application received",
    blocks: [
      { type: "paragraph", text: "A new application has been submitted through the careers website." },
      {
        type: "details",
        rows: [
          ["Candidate", oneLine(input.name)],
          ["Position", jobTitle],
          ["Reference", input.reference],
          ["Cover letter", input.hasCoverLetter ? "Included" : "Not included"],
          ["Documents", documents],
        ],
      },
      { type: "button", label: "Review application", url: adminLink({ tab: "applications", application: input.applicationId }) },
      {
        type: "paragraph",
        text: "Contact details and documents are available in the careers admin portal. You will need to sign in to view them.",
      },
    ],
    signOff: [],
    footerNote: INTERNAL_FOOTER,
  });
}

export function talentReceivedEmail(input: { name: string; areaOfInterest: string }): EmailContent {
  const area = oneLine(input.areaOfInterest);
  return render({
    subject: `Your profile has been added to the ${SITE_NAME} talent pool`,
    preheader: "Thank you for your interest in future opportunities with us.",
    greeting: greeting(input.name),
    title: "Welcome to our talent pool",
    blocks: [
      {
        type: "paragraph",
        text: `Thank you for your interest in a career with ${SITE_NAME}. We have added your profile to our talent pool.`,
      },
      { type: "details", rows: [["Area of interest", area]] },
      {
        type: "paragraph",
        text: "Our recruitment team will keep your details on file and contact you when a suitable opportunity arises. We also encourage you to visit our careers page regularly and apply directly for open roles that match your experience.",
      },
    ],
    signOff: RECRUITMENT_SIGN_OFF,
    footerNote: TALENT_FOOTER,
  });
}

export function hrNewTalentEmail(input: { name: string; areaOfInterest: string; entryId: string }): EmailContent {
  const area = oneLine(input.areaOfInterest);
  return render({
    subject: `New talent pool profile: ${area}`,
    preheader: `A candidate interested in ${area} joined the talent pool.`,
    greeting: null,
    title: "New talent pool profile",
    blocks: [
      { type: "paragraph", text: "A candidate has submitted a profile to the talent pool through the careers website." },
      { type: "details", rows: [["Candidate", oneLine(input.name)], ["Area of interest", area]] },
      { type: "button", label: "View profile", url: adminLink({ tab: "talent", talent: input.entryId }) },
    ],
    signOff: [],
    footerNote: INTERNAL_FOOTER,
  });
}

type StatusCopy = { subject: string; title: string; paragraphs: string[] };

function statusCopy(status: ApplicationStatus, jobTitle: string): StatusCopy {
  switch (status) {
    case "submitted":
      return {
        subject: `Application update: ${jobTitle}`,
        title: "Your application has been received",
        paragraphs: [
          `Your application for the ${jobTitle} position is registered with our recruitment team and is awaiting review.`,
          "We will contact you if your profile is taken forward.",
        ],
      };
    case "under_review":
      return {
        subject: `Your application is under review: ${jobTitle}`,
        title: "Your application is under review",
        paragraphs: [
          `Our recruitment team is now reviewing your application for the ${jobTitle} position.`,
          "We will be in touch once the review is complete. Thank you for your patience.",
        ],
      };
    case "shortlisted":
      return {
        subject: `You have been shortlisted: ${jobTitle}`,
        title: "You have been shortlisted",
        paragraphs: [
          `We are pleased to let you know that your application for the ${jobTitle} position has been shortlisted.`,
          "A member of our recruitment team will contact you shortly with details of the next stage of the selection process.",
        ],
      };
    case "interview":
      return {
        subject: `Interview invitation: ${jobTitle}`,
        title: "Invitation to interview",
        paragraphs: [
          `Following a review of your application for the ${jobTitle} position, we would like to invite you to an interview.`,
          "Our recruitment team will contact you to confirm the date, time and format. Please make sure we can reach you on the phone number and email address you provided.",
        ],
      };
    case "selected":
      return {
        subject: `Congratulations: ${jobTitle}`,
        title: "Congratulations",
        paragraphs: [
          `We are delighted to inform you that you have been selected for the ${jobTitle} position.`,
          "Our HR team will contact you shortly regarding your offer and the next steps.",
        ],
      };
    case "rejected":
      return {
        subject: `Update on your application: ${jobTitle}`,
        title: "An update on your application",
        paragraphs: [
          `Thank you for your interest in the ${jobTitle} position and for the time you invested in your application.`,
          "After careful consideration, we regret to inform you that we will not be taking your application further on this occasion.",
          "We appreciate your interest in our organisation and encourage you to apply for future openings that match your skills and experience.",
        ],
      };
    case "withdrawn":
      return {
        subject: `Your application has been withdrawn: ${jobTitle}`,
        title: "Your application has been withdrawn",
        paragraphs: [
          `This is to confirm that your application for the ${jobTitle} position has been withdrawn.`,
          "If this was not your intention, or you would like to be considered again, please contact our recruitment team and quote your reference number.",
        ],
      };
  }
}

export function applicationStatusEmail(input: {
  name: string;
  jobTitle: string;
  reference: string;
  status: ApplicationStatus;
  message?: string | null;
}): EmailContent {
  const jobTitle = oneLine(input.jobTitle);
  const copy = statusCopy(input.status, jobTitle);
  const message = (input.message ?? "").trim();
  const blocks: Block[] = [
    ...copy.paragraphs.map((text): Block => ({ type: "paragraph", text })),
    { type: "details", rows: [["Position", jobTitle], ["Reference", input.reference]] },
  ];
  if (message) blocks.push({ type: "quote", title: "Message from our recruitment team", text: message });
  return render({
    subject: `${copy.subject} (${input.reference})`,
    preheader: copy.paragraphs[0],
    greeting: greeting(input.name),
    title: copy.title,
    blocks,
    signOff: RECRUITMENT_SIGN_OFF,
    footerNote: CANDIDATE_FOOTER,
  });
}

export function contactMessageEmail(input: {
  fullName: string;
  email: string;
  phone: string;
  company: string;
  subject: string;
  message: string;
}): EmailContent {
  const subject = oneLine(input.subject);
  return render({
    subject: `Website enquiry: ${subject}`,
    preheader: `New message from the website contact form: ${subject}`,
    greeting: null,
    title: "New website enquiry",
    blocks: [
      { type: "paragraph", text: "A new message was submitted through the contact form on the website." },
      {
        type: "details",
        rows: [
          ["Name", oneLine(input.fullName)],
          ["Email", input.email],
          ["Phone", input.phone ? oneLine(input.phone) : "Not provided"],
          ["Company", input.company ? oneLine(input.company) : "Not provided"],
          ["Subject", subject],
        ],
      },
      { type: "quote", title: "Message", text: input.message },
      { type: "paragraph", text: "Reply to this email to respond to the sender directly." },
    ],
    signOff: [],
    footerNote: INTERNAL_FOOTER,
  });
}
