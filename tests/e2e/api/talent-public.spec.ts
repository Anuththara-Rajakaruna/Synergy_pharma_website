import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { api, clientIp, loginAsAdmin, loginAsHr, type ApiResult } from "../support/api";
import type { Paginated, SubmissionResponse, TalentListItem } from "@/types/careers";
import { expectApiError, expectIsoDate, expectNoSensitiveData, expectRetryAfter, expectStatus } from "./lib/assertions";
import { ORIGIN_EVIL, candidate, cvFile, findTalent, getTalent, isolatedClientIp, sendStreamedJson, supportingFile, talentBody, uploadDocuments } from "./lib/fixtures";
import { sentTo, waitForEmails } from "./lib/mail";

// POST /api/talent-pool: public talent pool profiles.

function postTalent(body: unknown, ip = clientIp()): Promise<ApiResult<SubmissionResponse>> {
  return api<SubmissionResponse>("POST", "/api/talent-pool", { json: body, ip });
}

test.describe("POST /api/talent-pool", () => {
  let admin = "";

  test.beforeAll(async () => {
    admin = await loginAsAdmin();
  });

  test("stores a profile and notifies the candidate and HR", async () => {
    const person = candidate("talent-ok");
    const uploads = await uploadDocuments("talent_pool", [cvFile("talent-cv", 5000), supportingFile("talent-cert", 2500)]);
    const result = await postTalent(talentBody(person, uploads, { notes: "  Interested in microbiology.\r\nAvailable from May.  " }));
    expectStatus(result, 201);
    expect(result.body).toMatchObject({ success: true, message: "Talent profile submitted successfully." });
    expect(result.body.reference).toMatch(/^TP-[0-9A-F]{8}$/);

    const item = await findTalent(admin, person.email);
    expect(item.id.slice(-8).toUpperCase()).toBe(result.body.reference.slice(3));
    const detail = await getTalent(admin, item.id);
    expect(detail).toMatchObject({
      name: person.name,
      email: person.email,
      phone: person.phone,
      areaOfInterest: "Quality Control",
      candidateNotes: "Interested in microbiology.\nAvailable from May.",
      source: "self_submitted",
      consentGiven: true,
      archived: false,
      tags: [],
      notes: [],
      applications: [],
      sourceApplicationId: null,
      documentCount: 2,
    });
    expectIsoDate(detail.consentAt, "consentAt");
    expect(detail.documents.map((doc) => [doc.kind, doc.size])).toEqual([
      ["cv", 5000],
      ["supporting", 2500],
    ]);
    expect(detail.activity.map((entry) => entry.action)).toEqual(["created"]);
    expectNoSensitiveData(detail, "talent detail");

    const candidateMail = await waitForEmails((mail) => sentTo(mail, person.email));
    expect(candidateMail[0].text).toContain("Quality Control");
    const hrMail = await waitForEmails((mail) => sentTo(mail, "hr@synergypharma.lk") && mail.html.includes(`talent=${item.id}`));
    expect(hrMail[0].replyTo.toLowerCase()).toContain(person.email.toLowerCase());
  });

  test("reports invalid fields", async () => {
    const result = await postTalent({
      name: "",
      email: "someone@",
      phone: "12",
      areaOfInterest: "Astronaut",
      notes: "x".repeat(1501),
      consentGiven: "yes",
      uploads: { cv: "" },
    });
    expectApiError(result, 400, "invalid_input", {
      fields: ["name", "email", "phone", "areaOfInterest", "notes", "consentGiven", "cv"],
    });
    const operators = await postTalent(talentBody(candidate("talent-ops"), { cv: randomUUID(), supporting: [] }, { areaOfInterest: { $ne: "" } }));
    expectApiError(operators, 400, "invalid_input", { fields: ["areaOfInterest"] });
  });

  test("an email already in the talent pool is a 409 duplicate, whatever the letter case", async () => {
    const person = candidate("talent-dup");
    const first = await uploadDocuments("talent_pool", [cvFile("first")]);
    expectStatus(await postTalent(talentBody(person, first)), 201);

    const second = await uploadDocuments("talent_pool", [cvFile("second")]);
    const duplicate = await postTalent(talentBody({ ...person, email: person.email.toUpperCase() }, second));
    expectApiError(duplicate, 409, "duplicate_talent_profile", {
      message: "This email address is already in our talent pool. We'll contact you when a matching role opens.",
    });
    // Checked before the upload was claimed.
    expectStatus(await postTalent(talentBody(candidate("talent-dup-other"), second)), 201);
  });

  test("an archived profile is never revived by a public resubmission", async () => {
    const person = candidate("talent-archived");
    const first = await uploadDocuments("talent_pool", [cvFile("first")]);
    expectStatus(await postTalent(talentBody(person, first)), 201);
    const item = await findTalent(admin, person.email);
    expectStatus(await api("POST", `/api/admin/talent-pool/${item.id}/archive`, { cookie: admin, json: { archived: true, reason: "E2E" } }), 200);

    const second = await uploadDocuments("talent_pool", [cvFile("second")]);
    expectApiError(await postTalent(talentBody(person, second)), 409, "duplicate_talent_profile");
    const detail = await getTalent(admin, item.id);
    expect(detail.archived).toBe(true);
    expect(detail.documentCount).toBe(1);
  });

  test("uploads issued for job applications cannot be used for a profile", async () => {
    const uploads = await uploadDocuments("application", [cvFile("application-cv")]);
    expectApiError(await postTalent(talentBody(candidate("talent-purpose"), uploads)), 400, "upload_expired", { fields: ["cv"] });
    const hr = await loginAsHr();
    const adminUploads = await uploadDocuments("admin_talent", [cvFile("admin-cv")], { cookie: hr });
    expectApiError(await postTalent(talentBody(candidate("talent-admin-purpose"), adminUploads)), 400, "upload_expired", { fields: ["cv"] });
  });

  test("an autofilled website field is ignored and the profile is still stored", async () => {
    // There is no honeypot: a 2xx from a public submission route always means the record was stored.
    const person = candidate("talent-autofill");
    const uploads = await uploadDocuments("talent_pool", [cvFile("autofill")]);
    const result = await postTalent(talentBody(person, uploads, { website: "https://candidate.example" }));
    expectStatus(result, 201);
    expect(result.body.reference).toMatch(/^TP-[0-9A-F]{8}$/);
    const list = await api<Paginated<TalentListItem>>("GET", `/api/admin/talent-pool?q=${encodeURIComponent(person.email)}&archived=include`, {
      cookie: admin,
    });
    expect(list.body.total).toBe(1);
  });

  test("cross-site submissions are refused before anything is stored", async () => {
    const person = candidate("talent-cross-site");
    const uploads = await uploadDocuments("talent_pool", [cvFile("cross-site")]);
    const body = talentBody(person, uploads);
    expectApiError(await api("POST", "/api/talent-pool", { json: body, headers: { origin: ORIGIN_EVIL } }), 403, "cross_site_request");
    expectApiError(
      await api("POST", "/api/talent-pool", { json: body, sameOrigin: false, headers: { "sec-fetch-site": "cross-site" } }),
      403,
      "cross_site_request"
    );
    expectStatus(await postTalent(body), 201);
  });

  test("requires a JSON object body within 1 MB", async () => {
    const body = talentBody(candidate("talent-body"), { cv: randomUUID(), supporting: [] });
    expectApiError(await api("POST", "/api/talent-pool", { body: JSON.stringify(body), headers: { "content-type": "text/plain" } }), 415, "unsupported_media_type");
    expectApiError(await api("POST", "/api/talent-pool", { json: "profile" }), 400, "invalid_json");
    expectApiError(await api("POST", "/api/talent-pool", { json: { ...body, notes: "n".repeat(1024 * 1024) } }), 413, "payload_too_large");
    const streamed = await sendStreamedJson("POST", "/api/talent-pool", 1100 * 1024);
    expect(streamed.status, streamed.text.slice(0, 200)).toBe(413);
  });

  test("the talent-ip bucket allows 5 attempts per hour per client", async () => {
    const ip = isolatedClientIp();
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      expect((await postTalent({}, ip)).status, `attempt ${attempt}`).toBe(400);
    }
    const limited = await postTalent(talentBody(candidate("talent-ip"), { cv: randomUUID(), supporting: [] }), ip);
    expectApiError(limited, 429, "rate_limited");
    expectRetryAfter(limited, 60 * 60);
  });

  test("the talent-email bucket allows 3 attempts per day per email address", async () => {
    const person = candidate("talent-email-limit");
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const result = await postTalent(talentBody(person, { cv: randomUUID(), supporting: [] }));
      expectApiError(result, 400, "upload_expired");
    }
    const limited = await postTalent(talentBody({ ...person, email: person.email.toUpperCase() }, { cv: randomUUID(), supporting: [] }));
    expectApiError(limited, 429, "rate_limited");
    expectRetryAfter(limited, 24 * 60 * 60);
  });
});
