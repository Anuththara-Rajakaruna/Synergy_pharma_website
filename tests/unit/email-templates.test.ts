import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { APPLICATION_STATUSES, type ApplicationStatus } from "@/lib/careers/constants";
import {
  applicationReceivedEmail,
  applicationStatusEmail,
  contactMessageEmail,
  escapeHtml,
  hrNewApplicationEmail,
  hrNewTalentEmail,
  talentReceivedEmail,
  type EmailContent,
} from "@/lib/email/templates";
import { SITE_URL } from "@/lib/site";

const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const HOSTILE = "<img src=x onerror=\"alert(1)\">'&amp;";
const ESCAPED_HOSTILE = "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&#39;&amp;amp;";

function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
}

function assertNoRawMarkup(content: EmailContent): void {
  assert.equal(content.html.includes("<img"), false, "raw <img> tag in HTML");
  assert.equal(content.html.includes("onerror=\""), false, "unescaped attribute in HTML");
  assert.ok(content.html.includes(ESCAPED_HOSTILE), "escaped value missing from HTML");
}

function assertSingleLineSubject(content: EmailContent): void {
  assert.equal(/[\r\n]/.test(content.subject), false, JSON.stringify(content.subject));
  assert.ok(content.subject.length <= 250, `subject is ${content.subject.length} characters`);
}

// Candidate-facing emails may only link to the public site itself.
function assertOnlySiteLinks(content: EmailContent): void {
  for (const href of hrefs(content.html)) assert.equal(href, escapeHtml(SITE_URL), href);
  assert.equal(content.html.includes("/careers/admin"), false);
  assert.equal(content.text.includes("/careers/admin"), false);
}

describe("escapeHtml", () => {
  it("escapes the five HTML-significant characters", () => {
    assert.equal(escapeHtml("<a href=\"x\">'Tom' & Jerry</a>"), "&lt;a href=&quot;x&quot;&gt;&#39;Tom&#39; &amp; Jerry&lt;/a&gt;");
  });
});

describe("applicationReceivedEmail", () => {
  it("escapes every interpolated value and contains no candidate-supplied or admin links", () => {
    const content = applicationReceivedEmail({ name: HOSTILE, jobTitle: HOSTILE, reference: HOSTILE });
    assertNoRawMarkup(content);
    assertOnlySiteLinks(content);
    assertSingleLineSubject(content);
  });

  it("names the role and reference in subject, text and HTML", () => {
    const content = applicationReceivedEmail({ name: "Nimal Perera", jobTitle: "QA Executive", reference: "APP-7F3A9C21" });
    assert.equal(content.subject, "Application received: QA Executive (APP-7F3A9C21)");
    assert.ok(content.text.includes("Dear Nimal Perera,"));
    assert.ok(content.text.includes("Reference: APP-7F3A9C21"));
    assert.ok(content.html.includes("QA Executive"));
    assert.ok(content.html.startsWith("<!doctype html>"));
  });

  it("keeps the subject on one line even when the job title contains line breaks", () => {
    const content = applicationReceivedEmail({ name: "Nimal", jobTitle: `QA${CR}${LF}Bcc: attacker@example.com`, reference: "APP-1" });
    assertSingleLineSubject(content);
    assert.equal(content.subject, "Application received: QA Bcc: attacker@example.com (APP-1)");
  });

  it("truncates very long subjects", () => {
    const content = applicationReceivedEmail({ name: "Nimal", jobTitle: "Q".repeat(400), reference: "APP-1" });
    assert.equal(content.subject.length, 250);
    assert.ok(content.subject.endsWith("..."));
  });
});

describe("talentReceivedEmail", () => {
  it("escapes values and contains no admin links", () => {
    const content = talentReceivedEmail({ name: HOSTILE, areaOfInterest: HOSTILE });
    assertNoRawMarkup(content);
    assertOnlySiteLinks(content);
    assertSingleLineSubject(content);
    assert.ok(content.text.includes(`Area of interest: ${HOSTILE}`));
  });
});

describe("applicationStatusEmail", () => {
  const decisions: ApplicationStatus[] = ["under_review", "shortlisted", "interview", "selected", "rejected", "withdrawn"];

  it("has distinct professional copy for every decision status", () => {
    const subjects = new Set<string>();
    const titles = new Set<string>();
    for (const status of decisions) {
      const content = applicationStatusEmail({ name: "Nimal", jobTitle: "QA Executive", reference: "APP-1", status });
      assert.ok(content.subject.includes("QA Executive"), status);
      assert.ok(content.subject.endsWith("(APP-1)"), status);
      subjects.add(content.subject);
      titles.add(/<h1[^>]*>([^<]*)<\/h1>/.exec(content.html)?.[1] ?? "");
      assertOnlySiteLinks(content);
    }
    assert.equal(subjects.size, decisions.length);
    assert.equal(titles.size, decisions.length);
  });

  it("uses the expected wording for key decisions", () => {
    const copy = (status: ApplicationStatus) => applicationStatusEmail({ name: "Nimal", jobTitle: "QA Executive", reference: "APP-1", status }).text;
    assert.ok(copy("interview").includes("invite you to an interview"));
    assert.ok(copy("shortlisted").includes("has been shortlisted"));
    assert.ok(copy("selected").includes("selected for the QA Executive position"));
    assert.ok(copy("rejected").includes("will not be taking your application further"));
    assert.ok(copy("withdrawn").includes("has been withdrawn"));
    assert.ok(copy("under_review").includes("reviewing your application"));
  });

  it("renders every status, including submitted", () => {
    for (const status of APPLICATION_STATUSES) {
      const content = applicationStatusEmail({ name: "Nimal", jobTitle: "QA", reference: "APP-1", status });
      assert.ok(content.subject.length > 0 && content.html.length > 0 && content.text.length > 0, status);
    }
  });

  it("escapes the HR message and keeps its line breaks", () => {
    const content = applicationStatusEmail({
      name: HOSTILE,
      jobTitle: HOSTILE,
      reference: HOSTILE,
      status: "interview",
      message: `Please bring your certificates.${LF}${HOSTILE}${CR}${LF}See you soon.`,
    });
    assertNoRawMarkup(content);
    assertOnlySiteLinks(content);
    assert.ok(content.html.includes("Message from our recruitment team"));
    assert.ok(content.html.includes(`Please bring your certificates.<br>${ESCAPED_HOSTILE}<br>See you soon.`));
    assert.ok(content.text.includes("> Please bring your certificates."));
  });

  it("omits the message block when there is no message", () => {
    for (const message of [undefined, null, "", "   "]) {
      const content = applicationStatusEmail({ name: "Nimal", jobTitle: "QA", reference: "APP-1", status: "rejected", message });
      assert.equal(content.html.includes("Message from our recruitment team"), false);
    }
  });
});

describe("HR notification emails", () => {
  it("hrNewApplicationEmail links to the application in the admin portal and escapes values", () => {
    const id = "66e9a1b2c3d4e5f601234567";
    const content = hrNewApplicationEmail({ name: HOSTILE, jobTitle: HOSTILE, reference: HOSTILE, applicationId: id, hasCoverLetter: true, documentCount: 1 });
    assertNoRawMarkup(content);
    assertSingleLineSubject(content);
    assert.deepEqual(hrefs(content.html), [
      escapeHtml(`${SITE_URL}/careers/admin?tab=applications&application=${id}`),
      escapeHtml(SITE_URL),
    ]);
    assert.ok(content.text.includes(`${SITE_URL}/careers/admin?tab=applications&application=${id}`));
    assert.ok(content.text.includes("Cover letter: Included"));
    assert.ok(content.text.includes("Documents: 1 PDF document"));
  });

  it("hrNewApplicationEmail pluralizes documents and reports a missing cover letter", () => {
    const content = hrNewApplicationEmail({ name: "Nimal", jobTitle: "QA", reference: "APP-1", applicationId: "x", hasCoverLetter: false, documentCount: 3 });
    assert.ok(content.text.includes("Cover letter: Not included"));
    assert.ok(content.text.includes("Documents: 3 PDF documents"));
  });

  it("hrNewTalentEmail links to the talent profile and escapes values", () => {
    const id = "66e9a1b2c3d4e5f601234568";
    const content = hrNewTalentEmail({ name: HOSTILE, areaOfInterest: HOSTILE, entryId: id });
    assertNoRawMarkup(content);
    assertSingleLineSubject(content);
    assert.equal(hrefs(content.html)[0], escapeHtml(`${SITE_URL}/careers/admin?tab=talent&talent=${id}`));
  });

  it("contactMessageEmail escapes all sender-supplied fields", () => {
    const content = contactMessageEmail({
      fullName: HOSTILE,
      email: "sender@example.com",
      phone: HOSTILE,
      company: HOSTILE,
      subject: `${HOSTILE}${CR}${LF}Bcc: attacker@example.com`,
      message: `${HOSTILE}${LF}second line`,
    });
    assertNoRawMarkup(content);
    assertSingleLineSubject(content);
    assert.ok(content.html.includes(`${ESCAPED_HOSTILE}<br>second line`));
    for (const href of hrefs(content.html)) assert.equal(href, escapeHtml(SITE_URL));
  });

  it("contactMessageEmail marks optional fields as not provided", () => {
    const content = contactMessageEmail({ fullName: "Nimal", email: "nimal@example.com", phone: "", company: "", subject: "Hello", message: "Hi" });
    assert.ok(content.text.includes("Phone: Not provided"));
    assert.ok(content.text.includes("Company: Not provided"));
    assert.equal(content.subject, "Website enquiry: Hello");
  });
});
