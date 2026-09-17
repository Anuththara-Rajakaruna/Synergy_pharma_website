import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CAREER_DEPARTMENTS, FIELD_LIMITS, PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX, UPLOAD_LIMITS } from "@/lib/careers/constants";
import {
  describeFileProblem,
  escapeCsvCell,
  escapeRegExp,
  formatDeadlineDate,
  hasControlCharacters,
  isAdminRole,
  isApplicationStatus,
  isJobOpen,
  isJobStatus,
  isValidEmail,
  isValidJobSlug,
  normalizeEmail,
  normalizeList,
  normalizeTags,
  parseDateFilter,
  parseDeadlineDate,
  parsePagination,
  parseSearchQuery,
  sanitizeOriginalFileName,
  slugify,
  validateApplicationSubmission,
  validateContactSubmission,
  validateEmail,
  validateHrTalentInput,
  validateJobInput,
  validateOptionalUrl,
  validatePassword,
  validatePersonName,
  validatePhone,
  validateTalentSubmission,
  validateUploadRequest,
  type FieldErrors,
  type ValidationResult,
} from "@/lib/careers/validation";

const TAB = String.fromCharCode(9);
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const NUL = String.fromCharCode(0);
const BEL = String.fromCharCode(7);
const DEL = String.fromCharCode(127);
const ZWJ = String.fromCharCode(0x200d);
const MB = 1024 * 1024;

function expectOk<T>(result: ValidationResult<T>): T {
  if (!result.ok) assert.fail(`expected a valid result, got errors ${JSON.stringify(result.errors)}`);
  return result.value;
}

function expectErrors<T>(result: ValidationResult<T>): FieldErrors {
  if (result.ok) assert.fail(`expected validation errors, got ${JSON.stringify(result.value)}`);
  assert.equal(result.message, Object.values(result.errors)[0], "message is the first field error");
  return result.errors;
}

function nameResult(raw: string | undefined, field?: string): { value: string; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const value = validatePersonName(raw, errors, field);
  return { value, errors };
}

describe("hasControlCharacters", () => {
  it("rejects C0 control characters and DEL in strict mode", () => {
    for (const ch of [NUL, BEL, TAB, LF, CR, DEL]) {
      assert.equal(hasControlCharacters(`a${ch}b`), true, `U+${ch.charCodeAt(0).toString(16)}`);
    }
    assert.equal(hasControlCharacters("plain text with unicode: සිංහල தமிழ்"), false);
  });

  it("allows tab, newline and carriage return only when newlines are allowed", () => {
    assert.equal(hasControlCharacters(`a${TAB}b${LF}c${CR}d`, true), false);
    assert.equal(hasControlCharacters(`a${NUL}b`, true), true);
    assert.equal(hasControlCharacters(`a${DEL}b`, true), true);
  });
});

describe("validatePersonName", () => {
  it("accepts Sinhala and Tamil names including combining vowel signs", () => {
    for (const name of ["සුනිල් පෙරේරා", "முருகன் செல்வம்", "செல்வி ராஜேஸ்வரி"]) {
      const { value, errors } = nameResult(name);
      assert.deepEqual(errors, {}, name);
      assert.equal(value, name);
    }
  });

  it("accepts Sinhala names written with zero-width-joiner conjuncts (e.g. Priyanka, Prasad)", () => {
    // ප්‍රියංකා and ප්‍රසාද් use rakaransaya, which Unicode encodes with U+200D ZERO WIDTH JOINER.
    const priyanka = `${String.fromCharCode(0x0db4, 0x0dca)}${ZWJ}${String.fromCharCode(0x0dbb, 0x0dd2, 0x0dba, 0x0d82, 0x0d9a, 0x0dcf)} පෙරේරා`;
    const prasad = `${String.fromCharCode(0x0db4, 0x0dca)}${ZWJ}${String.fromCharCode(0x0dbb, 0x0dc3, 0x0dcf, 0x0daf, 0x0dca)}`;
    for (const name of [priyanka, prasad]) {
      const { value, errors } = nameResult(name);
      assert.deepEqual(errors, {}, JSON.stringify(name));
      assert.equal(value, name);
    }
  });

  it("accepts accented Latin names, apostrophes, hyphens and dots", () => {
    for (const name of ["José Álvarez", "O'Brien-Smith Jr.", "D’Silva", "Nimal K. Perera"]) {
      assert.deepEqual(nameResult(name).errors, {}, name);
    }
  });

  it("trims and collapses internal whitespace", () => {
    assert.equal(nameResult("   Nimal     Perera  ").value, "Nimal Perera");
  });

  it("rejects spreadsheet formula injection and markup", () => {
    for (const name of ["=HYPERLINK(\"http://x\")", "+SUM(1,2)", "-2+3", "@SUM(A1)", "<script>alert(1)</script>", "Nimal=1+1"]) {
      const { errors } = nameResult(name);
      assert.equal(errors.name, "Please enter your name using letters only.", name);
    }
  });

  it("rejects digits, single letters, missing values, over-long values and control characters", () => {
    assert.equal(nameResult("Agent 007").errors.name, "Please enter your name using letters only.");
    assert.equal(nameResult("A").errors.name, "Please enter your name using letters only.");
    assert.equal(nameResult(undefined).errors.name, "Full name is required.");
    assert.equal(nameResult("   ").errors.name, "Full name is required.");
    assert.equal(nameResult("a".repeat(FIELD_LIMITS.name + 1)).errors.name, `Full name must be ${FIELD_LIMITS.name} characters or fewer.`);
    assert.equal(nameResult("a".repeat(FIELD_LIMITS.name)).errors.name, undefined);
    assert.equal(nameResult(`Nimal${TAB}Perera`).errors.name, "Full name contains characters that are not allowed.");
  });

  it("reports errors under a custom field name", () => {
    const { errors } = nameResult("", "fullName");
    assert.deepEqual(Object.keys(errors), ["fullName"]);
  });
});

describe("email validation", () => {
  it("accepts ordinary addresses including plus tags and sub-domains", () => {
    for (const email of ["nimal@example.com", "nimal.perera+careers@mail.synergypharma.lk", "a_b-c@x-y.co"]) {
      assert.equal(isValidEmail(email), true, email);
    }
  });

  it("rejects display names, lists and anything that could smuggle extra recipients", () => {
    for (const email of [
      "Nimal Perera <nimal@example.com>",
      "<nimal@example.com>",
      "nimal@example.com, attacker@example.com",
      "nimal@example.com;attacker@example.com",
      "a,b@example.com",
      "\"nimal perera\"@example.com",
      "nimal perera@example.com",
      `nimal@example.com${LF}Bcc: attacker@example.com`,
    ]) {
      assert.equal(isValidEmail(email), false, email);
    }
  });

  it("rejects malformed domains and local parts", () => {
    for (const email of ["nimal@localhost", "nimal@", "@example.com", "nimal..perera@example.com", "nimal@example..com", "nimal@-example.com", "nimal@example-.com"]) {
      assert.equal(isValidEmail(email), false, email);
    }
  });

  it("enforces the 254 character limit", () => {
    const domain = "@example.com";
    const atLimit = `${"a".repeat(64)}@${"b".repeat(60)}.${"c".repeat(60)}.${"d".repeat(60)}.lk`;
    assert.ok(atLimit.length <= FIELD_LIMITS.email);
    assert.equal(isValidEmail(atLimit), true);
    const overLimit = `${"a".repeat(FIELD_LIMITS.email - domain.length + 1)}${domain}`;
    assert.equal(isValidEmail(overLimit), false);
  });

  it("validateEmail trims, requires a value and uses the given label", () => {
    const errors: FieldErrors = {};
    assert.equal(validateEmail("  Nimal@Example.com ", errors), "Nimal@Example.com");
    assert.deepEqual(errors, {});
    validateEmail("", errors, "contactEmail", "Work email");
    assert.equal(errors.contactEmail, "Work email is required.");
    validateEmail("not-an-email", errors);
    assert.equal(errors.email, "Please enter a valid email address.");
  });

  it("normalizeEmail lower-cases and trims", () => {
    assert.equal(normalizeEmail("  Nimal.PERERA@Example.COM "), "nimal.perera@example.com");
  });
});

describe("validatePhone", () => {
  function phone(raw: string | undefined): { value: string; error: string | undefined } {
    const errors: FieldErrors = {};
    const value = validatePhone(raw, errors);
    return { value, error: errors.phone };
  }

  it("accepts local and international formats", () => {
    for (const value of ["+94 77 123 4567", "0771234567", "077-123-4567", "+94 (77) 123.4567", "011 234 5678"]) {
      assert.equal(phone(value).error, undefined, value);
    }
  });

  it("counts digits: at least 7 and at most 15", () => {
    assert.equal(phone("1234567").error, undefined);
    assert.equal(phone("123456").error, "Please enter a valid phone number.");
    assert.equal(phone("123456789012345").error, undefined);
    assert.equal(phone("1234567890123456").error, "Please enter a valid phone number.");
  });

  it("rejects letters, misplaced plus signs and over-long input", () => {
    assert.equal(phone("077 CALL NOW").error, "Please enter a valid phone number.");
    assert.equal(phone("94+771234567").error, "Please enter a valid phone number.");
    assert.equal(phone("=1+2+3+4+5+6+7").error, "Please enter a valid phone number.");
    // 11 digits but 21 characters long.
    assert.equal(phone("1 2 3 4 5 6 7 8 9 0 1").error, "Please enter a valid phone number.");
  });

  it("requires a value and collapses whitespace", () => {
    assert.equal(phone(undefined).error, "Phone number is required.");
    assert.equal(phone("  077   123  4567 ").value, "077 123 4567");
  });
});

describe("validateOptionalUrl", () => {
  function url(raw: string | undefined, options: { hostSuffix?: string } = {}): { value: string; error: string | undefined } {
    const errors: FieldErrors = {};
    const value = validateOptionalUrl(raw, errors, "link", "LinkedIn", options);
    return { value, error: errors.link };
  }
  const linkedIn = { hostSuffix: "linkedin.com" };

  it("returns an empty string without an error when nothing is entered", () => {
    assert.deepEqual(url(undefined), { value: "", error: undefined });
    assert.deepEqual(url("   "), { value: "", error: undefined });
  });

  it("adds https:// to bare hosts and normalizes the URL", () => {
    assert.deepEqual(url("linkedin.com/in/nimal", linkedIn), { value: "https://linkedin.com/in/nimal", error: undefined });
    assert.deepEqual(url("HTTPS://WWW.LinkedIn.COM/in/Nimal", linkedIn), { value: "https://www.linkedin.com/in/Nimal", error: undefined });
    assert.deepEqual(url("lk.linkedin.com/in/nimal", linkedIn), { value: "https://lk.linkedin.com/in/nimal", error: undefined });
    assert.deepEqual(url("http://portfolio.example.com"), { value: "http://portfolio.example.com/", error: undefined });
  });

  it("only accepts the configured host and its sub-domains", () => {
    for (const value of ["https://evil-linkedin.com/in/x", "https://linkedin.com.evil.com/in/x", "https://notlinkedin.com", "https://example.com/linkedin.com"]) {
      assert.equal(url(value, linkedIn).error, "Please enter a LinkedIn URL on linkedin.com.", value);
    }
  });

  it("rejects non-http schemes, credentials, whitespace, hosts without a dot and over-long URLs", () => {
    for (const value of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "ftp://linkedin.com/in/x",
      "https://user:pass@linkedin.com/in/x",
      "https://linkedin.com/in/nimal perera",
      "http://localhost/me",
      `https://example.com/${"a".repeat(FIELD_LIMITS.url)}`,
      `https://example.com/${BEL}`,
    ]) {
      const result = url(value);
      assert.equal(result.value, "", value);
      assert.equal(result.error, "Please enter a valid LinkedIn URL.", value);
    }
  });
});

describe("validatePassword", () => {
  function password(raw: unknown): string | undefined {
    const errors: FieldErrors = {};
    validatePassword(raw, errors);
    return errors.password;
  }

  it("accepts a long password with enough distinct characters", () => {
    assert.equal(password("correct horse battery staple"), undefined);
    assert.equal(password("Abcdefghijk1"), undefined);
  });

  it("enforces length, allowed characters and variety", () => {
    assert.equal(password("Short1!"), "Password must be at least 12 characters.");
    assert.equal(password("a".repeat(12)), "Password is too simple. Use a longer mix of characters.");
    assert.equal(password("abcdabcdabcd"), "Password is too simple. Use a longer mix of characters.");
    assert.equal(password(`${"Abcdefgh1234"}${"x".repeat(200)}`), "Password must be 200 characters or fewer.");
    assert.equal(password(`Abcdefgh1234${LF}`), "Password contains characters that are not allowed.");
    assert.equal(password(123456789012), "Password must be at least 12 characters.");
    assert.equal(password(undefined), "Password must be at least 12 characters.");
  });
});

describe("normalizeTags", () => {
  it("lower-cases, trims, collapses whitespace and removes duplicates and empty tags", () => {
    const errors: FieldErrors = {};
    assert.deepEqual(normalizeTags(["  Pharma   QA ", "pharma qa", "", "C++", "GMP"], errors), ["pharma qa", "c++", "gmp"]);
    assert.deepEqual(errors, {});
  });

  it("accepts comma-separated strings and treats null/undefined as no tags", () => {
    assert.deepEqual(normalizeTags("QA, Regulatory ,qa", {}), ["qa", "regulatory"]);
    assert.deepEqual(normalizeTags(undefined, {}), []);
    assert.deepEqual(normalizeTags(null, {}), []);
  });

  it("accepts letters from any script", () => {
    assert.deepEqual(normalizeTags(["සිංහල", "தமிழ்"], {}), ["සිංහල", "தமிழ்"]);
  });

  it("rejects markup, over-long tags, too many tags and non-text values", () => {
    const cases: [unknown, string][] = [
      [["<script>"], `Tags may use letters, numbers and simple punctuation, up to ${FIELD_LIMITS.tag} characters each.`],
      [["=cmd"], `Tags may use letters, numbers and simple punctuation, up to ${FIELD_LIMITS.tag} characters each.`],
      [["a".repeat(FIELD_LIMITS.tag + 1)], `Tags may use letters, numbers and simple punctuation, up to ${FIELD_LIMITS.tag} characters each.`],
      [Array.from({ length: FIELD_LIMITS.tags + 1 }, (_, i) => `tag${i}`), `Use at most ${FIELD_LIMITS.tags} tags.`],
      [["ok", 5], "Tags must be text."],
      [42, "Tags must be a list."],
      [{ tag: "x" }, "Tags must be a list."],
    ];
    for (const [input, message] of cases) {
      const errors: FieldErrors = {};
      assert.deepEqual(normalizeTags(input, errors), [], JSON.stringify(input));
      assert.equal(errors.tags, message, JSON.stringify(input));
    }
  });

  it("allows exactly the maximum number of tags, counting duplicates once", () => {
    const tags = Array.from({ length: FIELD_LIMITS.tags }, (_, i) => `tag${i}`);
    const errors: FieldErrors = {};
    assert.equal(normalizeTags([...tags, "TAG0", "tag1"], errors).length, FIELD_LIMITS.tags);
    assert.deepEqual(errors, {});
  });
});

describe("job slugs", () => {
  it("isValidJobSlug accepts lowercase words joined by single hyphens, 3 to 100 characters", () => {
    for (const slug of ["qa-lead", "abc", "a1-b2-c3", "x".repeat(FIELD_LIMITS.jobSlugMax)]) {
      assert.equal(isValidJobSlug(slug), true, slug);
    }
    for (const slug of ["ab", "x".repeat(FIELD_LIMITS.jobSlugMax + 1), "QA-Lead", "qa--lead", "-qa", "qa-", "qa_lead", "qa lead", "qa/lead", "ශ්‍රී"]) {
      assert.equal(isValidJobSlug(slug), false, slug);
    }
  });

  it("slugify produces valid slugs from titles", () => {
    assert.equal(slugify("Senior QA & Regulatory Officer (Café)"), "senior-qa-and-regulatory-officer-cafe");
    assert.equal(slugify("  Production -- Executive  "), "production-executive");
    assert.equal(slugify("---"), "");
    const long = slugify(`${"word ".repeat(40)}end`);
    assert.ok(long.length <= FIELD_LIMITS.jobSlugMax);
    assert.equal(isValidJobSlug(long), true);
    assert.equal(long.endsWith("-"), false);
  });
});

describe("normalizeList", () => {
  it("splits textarea input into trimmed, non-empty items", () => {
    assert.deepEqual(normalizeList(`  First   item ${LF}${LF} Second${LF}`), ["First item", "Second"]);
    assert.deepEqual(normalizeList(["a", "  ", " b "]), ["a", "b"]);
    assert.deepEqual(normalizeList(undefined), []);
  });

  it("returns null for anything that is not text", () => {
    assert.equal(normalizeList(["a", 1]), null);
    assert.equal(normalizeList(42), null);
  });
});

describe("deadline dates (Asia/Colombo)", () => {
  it("parses YYYY-MM-DD as the last millisecond of that day in Sri Lanka", () => {
    assert.equal(parseDeadlineDate("2026-09-30")?.toISOString(), "2026-09-30T18:29:59.999Z");
    assert.equal(parseDeadlineDate("2028-02-29")?.toISOString(), "2028-02-29T18:29:59.999Z");
    assert.equal(parseDeadlineDate("2026-12-31")?.toISOString(), "2026-12-31T18:29:59.999Z");
  });

  it("rejects malformed and impossible calendar dates", () => {
    for (const value of ["2026-9-30", "30/09/2026", "2026-09-30T10:00", "", "2026-02-29", "2026-02-30", "2026-04-31", "2026-13-01", "2026-00-10", "2026-01-00"]) {
      assert.equal(parseDeadlineDate(value), null, value);
    }
  });

  it("formats instants as the Sri Lankan calendar date", () => {
    assert.equal(formatDeadlineDate(new Date("2026-09-30T18:29:59.999Z")), "2026-09-30");
    assert.equal(formatDeadlineDate(new Date("2026-09-30T18:30:00.000Z")), "2026-10-01");
    assert.equal(formatDeadlineDate("2026-01-01T00:00:00.000Z"), "2026-01-01");
    assert.equal(formatDeadlineDate("2025-12-31T18:29:59.999Z"), "2025-12-31");
  });

  it("round-trips parse and format", () => {
    for (const value of ["2026-01-01", "2026-06-15", "2027-12-31"]) {
      const parsed = parseDeadlineDate(value);
      assert.ok(parsed);
      assert.equal(formatDeadlineDate(parsed), value);
    }
  });
});

describe("isJobOpen", () => {
  const now = new Date("2026-09-17T10:00:00.000Z");

  it("is open only while published and before the deadline (inclusive)", () => {
    assert.equal(isJobOpen({ status: "published", applicationDeadline: null }, now), true);
    assert.equal(isJobOpen({ status: "published" }, now), true);
    assert.equal(isJobOpen({ status: "published", applicationDeadline: now }, now), true);
    assert.equal(isJobOpen({ status: "published", applicationDeadline: "2026-09-17T10:00:00.001Z" }, now), true);
    assert.equal(isJobOpen({ status: "published", applicationDeadline: "2026-09-17T09:59:59.999Z" }, now), false);
  });

  it("is never open for draft, closed or archived jobs", () => {
    for (const status of ["draft", "closed", "archived"]) {
      assert.equal(isJobOpen({ status, applicationDeadline: "2030-01-01T00:00:00.000Z" }, now), false, status);
    }
  });
});

describe("validateJobInput", () => {
  const valid = {
    slug: "QA-Executive-2026",
    title: "  QA Executive ",
    department: "Quality Assurance",
    location: "Colombo",
    type: "Full-time",
    experience: "2+ years",
    description: `Line one${LF}${LF}Line two`,
    responsibilities: `Review batch records${LF}  ${LF}Approve releases`,
    requirements: ["BSc in Chemistry"],
    qualifications: [],
    benefits: "",
    applicationDeadline: "2026-12-31",
  };

  it("normalizes a valid create payload", () => {
    const value = expectOk(validateJobInput(valid, "create"));
    assert.equal(value.slug, "qa-executive-2026");
    assert.equal(value.title, "QA Executive");
    assert.deepEqual(value.responsibilities, ["Review batch records", "Approve releases"]);
    assert.deepEqual(value.benefits, []);
    assert.equal(value.description, `Line one${LF}${LF}Line two`);
    assert.equal(value.applicationDeadline?.toISOString(), "2026-12-31T18:29:59.999Z");
  });

  it("accepts id as an alias for slug and ignores slug on update", () => {
    const { slug, ...withoutSlug } = valid;
    assert.equal(expectOk(validateJobInput({ ...withoutSlug, id: slug }, "create")).slug, "qa-executive-2026");
    assert.equal(expectOk(validateJobInput({ ...withoutSlug, slug: "!!invalid!!" }, "update")).slug, "");
  });

  it("treats an empty or null deadline as no deadline", () => {
    assert.equal(expectOk(validateJobInput({ ...valid, applicationDeadline: "" }, "create")).applicationDeadline, null);
    assert.equal(expectOk(validateJobInput({ ...valid, applicationDeadline: null }, "create")).applicationDeadline, null);
  });

  it("reports every invalid field", () => {
    const errors = expectErrors(
      validateJobInput(
        {
          slug: "Bad Slug",
          title: "",
          department: "x".repeat(FIELD_LIMITS.department + 1),
          location: `Colombo${LF}Kandy`,
          type: "Freelance",
          description: "",
          responsibilities: [],
          requirements: "   ",
          qualifications: Array.from({ length: FIELD_LIMITS.listItems + 1 }, (_, i) => `q${i}`),
          benefits: ["x".repeat(FIELD_LIMITS.listItem + 1)],
          applicationDeadline: "2026-02-30",
        },
        "create"
      )
    );
    assert.deepEqual(Object.keys(errors).sort(), [
      "applicationDeadline",
      "benefits",
      "department",
      "description",
      "location",
      "qualifications",
      "requirements",
      "responsibilities",
      "slug",
      "title",
      "type",
    ]);
    assert.equal(errors.applicationDeadline, "Application deadline must be a valid date (YYYY-MM-DD).");
    assert.equal(errors.location, "Location contains characters that are not allowed.");
    assert.equal(errors.responsibilities, "Add at least one responsibility.");
  });

  it("rejects non-object bodies, non-string deadlines and missing type", () => {
    assert.deepEqual(expectErrors(validateJobInput(null, "create")), { body: "Invalid request body." });
    assert.deepEqual(expectErrors(validateJobInput([valid], "create")), { body: "Invalid request body." });
    assert.equal(expectErrors(validateJobInput({ ...valid, applicationDeadline: 20261231 }, "create")).applicationDeadline, "Invalid application deadline.");
    assert.equal(expectErrors(validateJobInput({ ...valid, type: undefined }, "create")).type, "Employment type is required.");
    assert.equal(expectErrors(validateJobInput({ ...valid, responsibilities: [1, 2] }, "create")).responsibilities, "Responsibilities must be a list of text items.");
  });
});

describe("enum guards", () => {
  it("recognise only known values", () => {
    assert.equal(isJobStatus("published"), true);
    assert.equal(isJobStatus("deleted"), false);
    assert.equal(isJobStatus(undefined), false);
    assert.equal(isApplicationStatus("under_review"), true);
    assert.equal(isApplicationStatus("reviewing"), false);
    assert.equal(isAdminRole("hr"), true);
    assert.equal(isAdminRole("superuser"), false);
    assert.equal(isAdminRole(["admin"]), false);
  });
});

describe("uploads", () => {
  it("sanitizeOriginalFileName keeps a safe display name ending in .pdf", () => {
    assert.equal(sanitizeOriginalFileName("C:\\fakepath\\My CV (final).pdf"), "My CV (final).pdf");
    assert.equal(sanitizeOriginalFileName("../../etc/passwd"), "passwd.pdf");
    assert.equal(sanitizeOriginalFileName("résumé.docx"), "resume.pdf");
    assert.equal(sanitizeOriginalFileName("CV<script>.pdf"), "CV_script_.pdf");
    assert.equal(sanitizeOriginalFileName(""), "document.pdf");
    assert.equal(sanitizeOriginalFileName("...pdf"), "pdf.pdf");
    const long = sanitizeOriginalFileName(`${"a".repeat(400)}.pdf`);
    assert.ok(long.length <= FIELD_LIMITS.originalFileName);
    assert.ok(long.endsWith(".pdf"));
  });

  it("describeFileProblem checks extension, type, emptiness and per-kind size limits", () => {
    const pdf = (size: number, name = "cv.pdf", type = "application/pdf") => ({ name, size, type });
    assert.equal(describeFileProblem(pdf(1000), "cv"), null);
    assert.equal(describeFileProblem(pdf(1000, "CV.PDF", ""), "cv"), null, "empty browser type is allowed");
    assert.equal(describeFileProblem(pdf(1000, "cv.docx"), "cv"), "CV must be a PDF file.");
    assert.equal(describeFileProblem(pdf(1000, "cv.pdf", "image/png"), "supporting"), "Supporting document must be a PDF file.");
    assert.equal(describeFileProblem(pdf(0), "cv"), "CV is empty.");
    assert.equal(describeFileProblem(pdf(UPLOAD_LIMITS.cvMaxBytes), "cv"), null);
    assert.equal(describeFileProblem(pdf(UPLOAD_LIMITS.cvMaxBytes + 1), "cv"), "CV must be 10 MB or smaller.");
    assert.equal(describeFileProblem(pdf(UPLOAD_LIMITS.supportingMaxBytes), "supporting"), null);
    assert.equal(describeFileProblem(pdf(UPLOAD_LIMITS.supportingMaxBytes + 1), "supporting"), "Supporting document must be 5 MB or smaller.");
  });

  describe("validateUploadRequest", () => {
    const cv = { kind: "cv", name: "cv.pdf", size: 2 * MB, contentType: "application/pdf" };
    const supporting = (i: number) => ({ kind: "supporting", name: `doc-${i}.pdf`, size: MB, contentType: "application/pdf" });

    it("accepts one CV and up to three supporting documents", () => {
      const value = expectOk(validateUploadRequest({ purpose: "application", files: [cv, supporting(1), supporting(2), supporting(3)] }));
      assert.equal(value.purpose, "application");
      assert.equal(value.files.length, 4);
    });

    it("defaults and forces the content type to application/pdf", () => {
      const value = expectOk(validateUploadRequest({ purpose: "talent_pool", files: [{ kind: "cv", name: "cv.pdf", size: 10 }] }));
      assert.equal(value.files[0].contentType, "application/pdf");
    });

    it("rejects unknown purposes and missing files", () => {
      assert.deepEqual(expectErrors(validateUploadRequest({ purpose: "avatar", files: [cv] })), { purpose: "Invalid upload purpose." });
      assert.deepEqual(expectErrors(validateUploadRequest({ purpose: "application", files: [] })), { files: "Select a file to upload." });
      assert.deepEqual(expectErrors(validateUploadRequest({ purpose: "application" })), { files: "Select a file to upload." });
      assert.deepEqual(expectErrors(validateUploadRequest("nope")), { body: "Invalid request body." });
    });

    it("rejects malformed file descriptions", () => {
      for (const file of [
        null,
        { ...cv, kind: "photo" },
        { ...cv, size: "2048" },
        { ...cv, size: 1.5 },
        { ...cv, name: 7 },
      ]) {
        assert.deepEqual(expectErrors(validateUploadRequest({ purpose: "application", files: [file] })), { files: "Invalid file description." }, JSON.stringify(file));
      }
      assert.deepEqual(expectErrors(validateUploadRequest({ purpose: "application", files: [{ ...cv, name: `${"a".repeat(252)}.pdf` }] })), { files: "Invalid file name." });
      assert.deepEqual(expectErrors(validateUploadRequest({ purpose: "application", files: [{ ...cv, name: `cv${NUL}.pdf` }] })), { files: "Invalid file name." });
    });

    it("enforces counts, sizes and types", () => {
      assert.deepEqual(expectErrors(validateUploadRequest({ purpose: "application", files: [cv, cv] })), { files: "Only one CV can be uploaded." });
      assert.deepEqual(
        expectErrors(validateUploadRequest({ purpose: "application", files: [cv, supporting(1), supporting(2), supporting(3), supporting(4)] })),
        { files: "Upload at most 3 supporting documents." }
      );
      assert.deepEqual(expectErrors(validateUploadRequest({ purpose: "application", files: [{ ...cv, size: UPLOAD_LIMITS.cvMaxBytes + 1 }] })), {
        files: "CV must be 10 MB or smaller.",
      });
      assert.deepEqual(expectErrors(validateUploadRequest({ purpose: "application", files: [{ ...supporting(1), size: 6 * MB }] })), {
        files: "Supporting document must be 5 MB or smaller.",
      });
      assert.deepEqual(expectErrors(validateUploadRequest({ purpose: "application", files: [{ ...cv, name: "cv.exe" }] })), { files: "CV must be a PDF file." });
      assert.deepEqual(expectErrors(validateUploadRequest({ purpose: "application", files: [{ ...cv, contentType: "text/html" }] })), { files: "CV must be a PDF file." });
      assert.deepEqual(expectErrors(validateUploadRequest({ purpose: "application", files: [{ ...cv, size: 0 }] })), { files: "CV is empty." });
    });
  });
});

describe("validateApplicationSubmission", () => {
  const cvId = "3f1d3a4e-9b1c-4c55-8d2f-1a2b3c4d5e6f";
  const valid = {
    jobId: " QA-Executive ",
    name: "Nimal Perera",
    email: " Nimal.Perera@Example.com ",
    phone: "+94 77 123 4567",
    coverLetter: `Dear team,${CR}${LF}I am applying.`,
    linkedIn: "linkedin.com/in/nimal",
    portfolio: "",
    consentGiven: true,
    uploads: { cv: ` ${cvId} `, supporting: ["a1b2c3d4-0000-4000-8000-000000000001"] },
  };

  it("normalizes a valid submission", () => {
    const value = expectOk(validateApplicationSubmission(valid));
    assert.equal(value.jobSlug, "qa-executive");
    assert.equal(value.email, "Nimal.Perera@Example.com");
    assert.equal(value.linkedIn, "https://linkedin.com/in/nimal");
    assert.equal(value.portfolio, "");
    assert.equal(value.coverLetter, `Dear team,${LF}I am applying.`);
    assert.deepEqual(value.uploads, { cv: cvId, supporting: ["a1b2c3d4-0000-4000-8000-000000000001"] });
  });

  it("accepts jobSlug as an alias for jobId", () => {
    const { jobId, ...rest } = valid;
    assert.equal(expectOk(validateApplicationSubmission({ ...rest, jobSlug: jobId })).jobSlug, "qa-executive");
  });

  it("requires explicit boolean consent", () => {
    for (const consentGiven of [false, "true", 1, undefined]) {
      assert.equal(
        expectErrors(validateApplicationSubmission({ ...valid, consentGiven })).consentGiven,
        "You must consent to data processing to apply.",
        String(consentGiven)
      );
    }
  });

  it("rejects invalid job ids, formula names, display-name emails and foreign LinkedIn hosts", () => {
    const errors = expectErrors(
      validateApplicationSubmission({
        ...valid,
        jobId: "../admin",
        name: "=HYPERLINK(\"x\")",
        email: "Nimal <nimal@example.com>",
        linkedIn: "https://linkedin.evil.com/in/x",
        portfolio: "javascript:alert(1)",
        coverLetter: "x".repeat(FIELD_LIMITS.coverLetter + 1),
      })
    );
    assert.equal(errors.jobId, "The selected role could not be found.");
    assert.equal(errors.name, "Please enter your name using letters only.");
    assert.equal(errors.email, "Please enter a valid email address.");
    assert.equal(errors.linkedIn, "Please enter a LinkedIn URL on linkedin.com.");
    assert.equal(errors.portfolio, "Please enter a valid portfolio URL.");
    assert.equal(errors.coverLetter, `Cover letter must be ${FIELD_LIMITS.coverLetter} characters or fewer.`);
  });

  it("validates upload references", () => {
    assert.equal(expectErrors(validateApplicationSubmission({ ...valid, uploads: undefined })).cv, "Please upload your CV.");
    assert.equal(expectErrors(validateApplicationSubmission({ ...valid, uploads: { cv: "", supporting: [] } })).cv, "Please upload your CV.");
    assert.equal(expectErrors(validateApplicationSubmission({ ...valid, uploads: { cv: cvId, supporting: "x" } })).supporting, "Invalid supporting documents.");
    assert.equal(expectErrors(validateApplicationSubmission({ ...valid, uploads: { cv: cvId, supporting: [""] } })).supporting, "Invalid supporting documents.");
    assert.equal(expectErrors(validateApplicationSubmission({ ...valid, uploads: { cv: cvId, supporting: [cvId] } })).supporting, "The same file was attached twice.");
    assert.equal(
      expectErrors(validateApplicationSubmission({ ...valid, uploads: { cv: cvId, supporting: ["a", "b", "c", "d"] } })).supporting,
      "Upload at most 3 supporting documents."
    );
    assert.equal(expectErrors(validateApplicationSubmission({ ...valid, uploads: { cv: "../../x", supporting: [] } })).cv, "Invalid upload reference.");
    assert.equal(expectErrors(validateApplicationSubmission({ ...valid, uploads: { cv: "a".repeat(65), supporting: [] } })).cv, "Invalid upload reference.");
  });
});

describe("validateTalentSubmission", () => {
  const valid = {
    name: "முருகன் செல்வம்",
    email: "murugan@example.com",
    phone: "0771234567",
    areaOfInterest: CAREER_DEPARTMENTS[0],
    notes: "Available from October.",
    consentGiven: true,
    uploads: { cv: "11111111-2222-4333-8444-555555555555", supporting: [] },
  };

  it("maps notes to candidateNotes", () => {
    const value = expectOk(validateTalentSubmission(valid));
    assert.equal(value.candidateNotes, "Available from October.");
    assert.equal(value.areaOfInterest, CAREER_DEPARTMENTS[0]);
  });

  it("only accepts areas of interest from the department list", () => {
    assert.equal(expectErrors(validateTalentSubmission({ ...valid, areaOfInterest: "Astronaut" })).areaOfInterest, "Please choose an area of interest from the list.");
    assert.equal(expectErrors(validateTalentSubmission({ ...valid, areaOfInterest: "" })).areaOfInterest, "Please choose an area of interest.");
  });

  it("limits notes and requires consent and a CV", () => {
    const errors = expectErrors(
      validateTalentSubmission({ ...valid, notes: "x".repeat(FIELD_LIMITS.candidateNotes + 1), consentGiven: false, uploads: { supporting: [] } })
    );
    assert.equal(errors.notes, `Notes must be ${FIELD_LIMITS.candidateNotes} characters or fewer.`);
    assert.equal(errors.consentGiven, "You must consent to data processing to submit your profile.");
    assert.equal(errors.cv, "Please upload your CV.");
  });
});

describe("validateHrTalentInput", () => {
  const valid = {
    name: "Kamala Silva",
    email: "kamala@example.com",
    phone: "0112345678",
    areaOfInterest: "Referral from the QA manager",
    tags: ["QA", "referral"],
    note: "Met at the career fair.",
    consentConfirmed: true,
    uploads: null,
  };

  it("accepts a candidate without documents and free-text area of interest", () => {
    const value = expectOk(validateHrTalentInput(valid));
    assert.equal(value.uploads, null);
    assert.deepEqual(value.tags, ["qa", "referral"]);
    assert.equal(expectOk(validateHrTalentInput({ ...valid, uploads: { cv: "", supporting: [] } })).uploads, null);
  });

  it("validates uploads when any are given; supporting documents need a CV", () => {
    const withCv = expectOk(validateHrTalentInput({ ...valid, uploads: { cv: "abc-123", supporting: [] } }));
    assert.deepEqual(withCv.uploads, { cv: "abc-123", supporting: [] });
    assert.equal(expectErrors(validateHrTalentInput({ ...valid, uploads: { cv: "", supporting: ["abc-123"] } })).cv, "Please upload your CV.");
  });

  it("requires consent confirmation and limits text fields", () => {
    const errors = expectErrors(
      validateHrTalentInput({
        ...valid,
        consentConfirmed: "yes",
        areaOfInterest: "x".repeat(FIELD_LIMITS.areaOfInterest + 1),
        note: "x".repeat(FIELD_LIMITS.hrNote + 1),
        tags: ["<b>"],
      })
    );
    assert.equal(errors.consentConfirmed, "Confirm that the candidate agreed to be kept on file.");
    assert.equal(errors.areaOfInterest, `Area of interest must be ${FIELD_LIMITS.areaOfInterest} characters or fewer.`);
    assert.equal(errors.note, `Note must be ${FIELD_LIMITS.hrNote} characters or fewer.`);
    assert.ok(errors.tags);
  });
});

describe("validateContactSubmission", () => {
  const valid = {
    fullName: "Nimal Perera",
    company: "",
    email: "nimal@example.com",
    phone: "",
    subject: "Distribution enquiry",
    message: `Hello,${LF}We would like to discuss distribution.`,
  };

  it("accepts optional phone and company", () => {
    const value = expectOk(validateContactSubmission(valid));
    assert.equal(value.phone, "");
    assert.equal(value.company, "");
    assert.equal(value.message, `Hello,${LF}We would like to discuss distribution.`);
  });

  it("keys errors by the contact form field names", () => {
    const errors = expectErrors(
      validateContactSubmission({ fullName: "", email: "bad", phone: "12", company: "x".repeat(FIELD_LIMITS.name + 1), subject: `a${LF}b`, message: "" })
    );
    assert.deepEqual(Object.keys(errors).sort(), ["company", "email", "fullName", "message", "phone", "subject"]);
    assert.equal(errors.subject, "Subject contains characters that are not allowed.");
    assert.equal(errors.message, "Message is required.");
  });
});

describe("list query parsing", () => {
  it("parsePagination applies defaults and caps", () => {
    const parse = (query: string) => parsePagination(new URLSearchParams(query));
    assert.deepEqual(parse(""), { page: 1, limit: PAGE_SIZE_DEFAULT, skip: 0 });
    assert.deepEqual(parse("page=3&limit=10"), { page: 3, limit: 10, skip: 20 });
    assert.deepEqual(parse("page=0&limit=1000"), { page: 1, limit: PAGE_SIZE_MAX, skip: 0 });
    assert.deepEqual(parse("page=-4&limit=0"), { page: 1, limit: PAGE_SIZE_DEFAULT, skip: 0 });
    assert.deepEqual(parse("page=abc&limit=xyz"), { page: 1, limit: PAGE_SIZE_DEFAULT, skip: 0 });
    assert.deepEqual(parse("page=99999999&limit=100"), { page: 10_000, limit: 100, skip: 999_900 });
  });

  it("parseSearchQuery collapses whitespace, drops control characters and truncates", () => {
    assert.equal(parseSearchQuery(new URLSearchParams({ q: "  nimal    perera " })), "nimal perera");
    assert.equal(parseSearchQuery(new URLSearchParams({ q: `nimal${NUL}` })), "");
    assert.equal(parseSearchQuery(new URLSearchParams({ q: "x".repeat(500) })).length, FIELD_LIMITS.searchQuery);
    assert.equal(parseSearchQuery(new URLSearchParams({ area: "QA" }), "area"), "QA");
    assert.equal(parseSearchQuery(new URLSearchParams()), "");
  });

  it("parseDateFilter returns the start or end of the day in Sri Lanka time", () => {
    assert.equal(parseDateFilter("2026-09-17", "start")?.toISOString(), "2026-09-16T18:30:00.000Z");
    assert.equal(parseDateFilter("2026-09-17", "end")?.toISOString(), "2026-09-17T18:29:59.999Z");
    for (const value of [null, "", "17-09-2026", "2026-9-17", "yesterday"]) {
      assert.equal(parseDateFilter(value, "start"), null, String(value));
    }
  });

  it("parseDateFilter rejects impossible calendar dates instead of rolling them over", () => {
    for (const value of ["2026-02-30", "2026-02-31", "2026-04-31", "2026-13-01", "2026-00-01"]) {
      assert.equal(parseDateFilter(value, "start"), null, value);
      assert.equal(parseDateFilter(value, "end"), null, value);
    }
    // Leap days and historic dates (Colombo used UTC+06:00 in 2000) are real calendar days.
    assert.equal(parseDateFilter("2028-02-29", "start")?.toISOString(), "2028-02-28T18:30:00.000Z");
    assert.equal(parseDateFilter("2000-01-01", "end")?.toISOString(), "2000-01-01T18:29:59.999Z");
    assert.equal(parseDateFilter("2027-02-29", "end"), null);
  });

  it("escapeRegExp makes user input match literally", () => {
    const input = "a.b*c+d?(e)[f]{g}|h^i$j\\k";
    const pattern = new RegExp(`^${escapeRegExp(input)}$`);
    assert.equal(pattern.test(input), true);
    assert.equal(pattern.test("aXb*c+d?(e)[f]{g}|h^i$j\\k"), false);
  });
});

describe("escapeCsvCell", () => {
  it("quotes every cell and doubles embedded quotes", () => {
    assert.equal(escapeCsvCell("Nimal Perera"), "\"Nimal Perera\"");
    assert.equal(escapeCsvCell("say \"hello\", then leave"), "\"say \"\"hello\"\", then leave\"");
    assert.equal(escapeCsvCell(`line1${CR}${LF}line2`), `"line1${CR}${LF}line2"`);
  });

  it("neutralizes spreadsheet formulas", () => {
    for (const value of ["=HYPERLINK(\"http://evil\")", "+1+1", "-2+3", "@SUM(A1)", `${TAB}=1`, `${CR}=1`]) {
      assert.equal(escapeCsvCell(value), `"'${value.replace(/"/g, "\"\"")}"`, JSON.stringify(value));
    }
  });

  it("formats empty values and non-strings", () => {
    assert.equal(escapeCsvCell(null), "\"\"");
    assert.equal(escapeCsvCell(undefined), "\"\"");
    assert.equal(escapeCsvCell(42), "\"42\"");
    assert.equal(escapeCsvCell(false), "\"false\"");
  });
});
