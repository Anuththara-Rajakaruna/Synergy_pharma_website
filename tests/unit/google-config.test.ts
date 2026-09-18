import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GOOGLE_VARIABLES, isGoogleConfigured, normalizePrivateKey, readGoogleEnv, type GoogleEnvResult } from "@/lib/google/config";
import { withCleanEnv } from "./support/env";
import {
  BASE64_KEY,
  DRIVE_FOLDER_ID,
  ESCAPED_KEY,
  PEM_KEY,
  SERVICE_ACCOUNT_EMAIL,
  SHARED_DRIVE_ID,
  SPREADSHEET_ID,
  googleEnv,
  serviceAccountJson,
} from "./support/google";

type Env = Record<string, string | undefined>;

function read(env: Env): GoogleEnvResult {
  return readGoogleEnv(env);
}

function problemVariables(env: Env): string[] {
  return read(env).problems.map((problem) => problem.variable);
}

describe("readGoogleEnv", () => {
  it("reads a complete three-variable configuration", () => {
    const result = read(googleEnv);
    assert.deepEqual(result.problems, [], JSON.stringify(result.problems));
    assert.equal(result.anySet, true);
    assert.deepEqual(result.settings, {
      clientEmail: SERVICE_ACCOUNT_EMAIL,
      privateKey: PEM_KEY,
      privateKeyId: null,
      spreadsheetId: SPREADSHEET_ID,
      driveFolderId: DRIVE_FOLDER_ID,
      sharedDriveId: null,
      impersonateUser: null,
    });
  });

  it("reads the optional Shared Drive, impersonation and key id settings", () => {
    const result = read({
      ...googleEnv,
      GOOGLE_PRIVATE_KEY_ID: "b7f1c0de0000000000000000000000000000abcd",
      GOOGLE_DRIVE_SHARED_DRIVE_ID: SHARED_DRIVE_ID,
      GOOGLE_IMPERSONATE_USER: "careers@synergypharma.lk",
    });
    assert.deepEqual(result.problems, []);
    assert.equal(result.settings?.sharedDriveId, SHARED_DRIVE_ID);
    assert.equal(result.settings?.impersonateUser, "careers@synergypharma.lk");
    assert.equal(result.settings?.privateKeyId, "b7f1c0de0000000000000000000000000000abcd");
  });

  it("reports nothing as set when no GOOGLE_ variable is present, but still lists what is required", () => {
    const result = read({});
    assert.equal(result.anySet, false);
    assert.equal(result.settings, null);
    assert.deepEqual(result.problems.map((problem) => problem.variable), [
      "GOOGLE_SERVICE_ACCOUNT_EMAIL",
      "GOOGLE_PRIVATE_KEY",
      "GOOGLE_SHEETS_SPREADSHEET_ID",
      "GOOGLE_DRIVE_FOLDER_ID",
    ]);
    // Every required variable names itself, so an operator knows what to set.
    for (const problem of result.problems) assert.ok(problem.message.includes(problem.variable), problem.message);
    assert.equal(read({ GOOGLE_DRIVE_FOLDER_ID: DRIVE_FOLDER_ID }).anySet, true);
  });

  it("treats blank and whitespace-only values as missing, and trims the rest", () => {
    assert.deepEqual(problemVariables({ ...googleEnv, GOOGLE_SHEETS_SPREADSHEET_ID: "   " }), ["GOOGLE_SHEETS_SPREADSHEET_ID"]);
    assert.equal(read({ ...googleEnv, GOOGLE_SHEETS_SPREADSHEET_ID: "   " }).settings, null);
    assert.equal(read({ ...googleEnv, GOOGLE_SERVICE_ACCOUNT_EMAIL: `  ${SERVICE_ACCOUNT_EMAIL}  ` }).settings?.clientEmail, SERVICE_ACCOUNT_EMAIL);
  });

  it("reports each malformed value against its own variable", () => {
    assert.deepEqual(problemVariables({ ...googleEnv, GOOGLE_SERVICE_ACCOUNT_EMAIL: "not-an-email" }), ["GOOGLE_SERVICE_ACCOUNT_EMAIL"]);
    assert.deepEqual(problemVariables({ ...googleEnv, GOOGLE_PRIVATE_KEY: "just some text" }), ["GOOGLE_PRIVATE_KEY"]);
    // Google resource ids are URL-safe and at least 10 characters long.
    assert.deepEqual(problemVariables({ ...googleEnv, GOOGLE_SHEETS_SPREADSHEET_ID: "short" }), ["GOOGLE_SHEETS_SPREADSHEET_ID"]);
    assert.deepEqual(problemVariables({ ...googleEnv, GOOGLE_SHEETS_SPREADSHEET_ID: "https://docs.google.com/spreadsheets/d/abc/edit" }), [
      "GOOGLE_SHEETS_SPREADSHEET_ID",
    ]);
    assert.deepEqual(problemVariables({ ...googleEnv, GOOGLE_DRIVE_FOLDER_ID: "folder id with spaces" }), ["GOOGLE_DRIVE_FOLDER_ID"]);
    assert.deepEqual(problemVariables({ ...googleEnv, GOOGLE_DRIVE_SHARED_DRIVE_ID: "nope!" }), ["GOOGLE_DRIVE_SHARED_DRIVE_ID"]);
    assert.deepEqual(problemVariables({ ...googleEnv, GOOGLE_IMPERSONATE_USER: "careers@" }), ["GOOGLE_IMPERSONATE_USER"]);
  });

  it("drops an invalid optional value rather than half-using it", () => {
    const result = read({ ...googleEnv, GOOGLE_DRIVE_SHARED_DRIVE_ID: "nope!", GOOGLE_IMPERSONATE_USER: "careers@" });
    assert.equal(result.problems.length, 2);
    assert.ok(result.settings, "an invalid optional setting does not make the store unconfigured");
    assert.equal(result.settings?.sharedDriveId, null);
    assert.equal(result.settings?.impersonateUser, null);
  });

  it("says where to find a missing resource id", () => {
    const [folder] = read({ ...googleEnv, GOOGLE_DRIVE_FOLDER_ID: undefined }).problems;
    assert.equal(folder.variable, "GOOGLE_DRIVE_FOLDER_ID");
    assert.ok(folder.message.includes("drive.google.com"), folder.message);
    const [sheet] = read({ ...googleEnv, GOOGLE_SHEETS_SPREADSHEET_ID: undefined }).problems;
    assert.ok(sheet.message.includes("docs.google.com/spreadsheets"), sheet.message);
  });

  it("accepts the service account key file verbatim", () => {
    const result = read({
      GOOGLE_SERVICE_ACCOUNT_JSON: serviceAccountJson(),
      GOOGLE_SHEETS_SPREADSHEET_ID: SPREADSHEET_ID,
      GOOGLE_DRIVE_FOLDER_ID: DRIVE_FOLDER_ID,
    });
    assert.deepEqual(result.problems, [], JSON.stringify(result.problems));
    assert.equal(result.settings?.clientEmail, SERVICE_ACCOUNT_EMAIL);
    assert.equal(result.settings?.privateKey, PEM_KEY);
    assert.equal(result.settings?.privateKeyId, "b7f1c0de0000000000000000000000000000abcd");
  });

  it("accepts the key file base64-encoded, for dashboards that cannot hold multi-line values", () => {
    const result = read({
      GOOGLE_SERVICE_ACCOUNT_JSON: Buffer.from(serviceAccountJson(), "utf8").toString("base64"),
      GOOGLE_SHEETS_SPREADSHEET_ID: SPREADSHEET_ID,
      GOOGLE_DRIVE_FOLDER_ID: DRIVE_FOLDER_ID,
    });
    assert.deepEqual(result.problems, []);
    assert.equal(result.settings?.clientEmail, SERVICE_ACCOUNT_EMAIL);
    assert.equal(result.settings?.privateKey, PEM_KEY);
  });

  it("lets the individual variables override the fields of the JSON key file", () => {
    const result = read({
      GOOGLE_SERVICE_ACCOUNT_JSON: serviceAccountJson(),
      GOOGLE_SERVICE_ACCOUNT_EMAIL: "override@synergy-careers.iam.gserviceaccount.com",
      GOOGLE_SHEETS_SPREADSHEET_ID: SPREADSHEET_ID,
      GOOGLE_DRIVE_FOLDER_ID: DRIVE_FOLDER_ID,
      GOOGLE_IMPERSONATE_USER: "careers@synergypharma.lk",
    });
    assert.deepEqual(result.problems, []);
    assert.equal(result.settings?.clientEmail, "override@synergy-careers.iam.gserviceaccount.com");
    assert.equal(result.settings?.privateKey, PEM_KEY, "the key still comes from the JSON blob");
    assert.equal(result.settings?.impersonateUser, "careers@synergypharma.lk");
  });

  it("reports an unusable key file against GOOGLE_SERVICE_ACCOUNT_JSON", () => {
    const broken = read({
      GOOGLE_SERVICE_ACCOUNT_JSON: "{ not json",
      GOOGLE_SHEETS_SPREADSHEET_ID: SPREADSHEET_ID,
      GOOGLE_DRIVE_FOLDER_ID: DRIVE_FOLDER_ID,
    });
    assert.ok(broken.problems.some((problem) => problem.variable === "GOOGLE_SERVICE_ACCOUNT_JSON"));
    assert.equal(broken.settings, null);

    // A JSON array is not a key file either.
    assert.deepEqual(problemVariables({ ...googleEnv, GOOGLE_SERVICE_ACCOUNT_JSON: "[]" }), ["GOOGLE_SERVICE_ACCOUNT_JSON"]);

    // A key file missing client_email falls back to the "required" message for that variable.
    const incomplete = read({
      GOOGLE_SERVICE_ACCOUNT_JSON: serviceAccountJson({ client_email: undefined }),
      GOOGLE_SHEETS_SPREADSHEET_ID: SPREADSHEET_ID,
      GOOGLE_DRIVE_FOLDER_ID: DRIVE_FOLDER_ID,
    });
    assert.deepEqual(incomplete.problems.map((problem) => problem.variable), ["GOOGLE_SERVICE_ACCOUNT_EMAIL"]);
  });

  it("never repeats key material or a configured value in a problem message", () => {
    const result = read({
      GOOGLE_SERVICE_ACCOUNT_EMAIL: "leaky-not-an-email",
      GOOGLE_PRIVATE_KEY: "leaky-private-key-material",
      GOOGLE_SHEETS_SPREADSHEET_ID: "leaky id",
      GOOGLE_DRIVE_FOLDER_ID: "leaky folder",
      GOOGLE_DRIVE_SHARED_DRIVE_ID: "leaky drive",
      GOOGLE_IMPERSONATE_USER: "leaky user",
    });
    const text = JSON.stringify(result.problems);
    assert.equal(text.includes("leaky"), false, text);
  });

  it("lists every variable it reads", () => {
    assert.deepEqual([...GOOGLE_VARIABLES].sort(), [
      "GOOGLE_DRIVE_FOLDER_ID",
      "GOOGLE_DRIVE_SHARED_DRIVE_ID",
      "GOOGLE_IMPERSONATE_USER",
      "GOOGLE_PRIVATE_KEY",
      "GOOGLE_PRIVATE_KEY_ID",
      "GOOGLE_SERVICE_ACCOUNT_EMAIL",
      "GOOGLE_SERVICE_ACCOUNT_JSON",
      "GOOGLE_SHEETS_SPREADSHEET_ID",
    ]);
  });
});

describe("isGoogleConfigured", () => {
  it("reads the process environment", () => {
    withCleanEnv(googleEnv, () => assert.equal(isGoogleConfigured(), true));
    withCleanEnv({}, () => assert.equal(isGoogleConfigured(), false));
    withCleanEnv({ ...googleEnv, GOOGLE_PRIVATE_KEY: "not a key" }, () => assert.equal(isGoogleConfigured(), false));
  });
});

describe("normalizePrivateKey", () => {
  it("accepts a key with real newlines unchanged", () => {
    assert.equal(normalizePrivateKey(PEM_KEY), PEM_KEY);
  });

  it("converts literal backslash-n escapes into real newlines", () => {
    assert.equal(normalizePrivateKey(ESCAPED_KEY), PEM_KEY);
    assert.equal(normalizePrivateKey(ESCAPED_KEY.split("\\n").join("\\r\\n")), PEM_KEY);
  });

  it("normalizes CRLF line endings", () => {
    assert.equal(normalizePrivateKey(PEM_KEY.split("\n").join("\r\n")), PEM_KEY);
  });

  it("strips the surrounding quotes a dashboard may keep from the env file", () => {
    assert.equal(normalizePrivateKey(`"${ESCAPED_KEY}"`), PEM_KEY);
    assert.equal(normalizePrivateKey(`'${ESCAPED_KEY}'`), PEM_KEY);
    assert.equal(normalizePrivateKey(`"${PEM_KEY}"`), PEM_KEY);
  });

  it("decodes base64 of the whole PEM", () => {
    assert.equal(normalizePrivateKey(BASE64_KEY), PEM_KEY);
    // Line-wrapped base64, as the base64 command line tool prints it.
    const wrapped = (BASE64_KEY.match(/.{1,64}/g) ?? []).join("\n");
    assert.equal(normalizePrivateKey(wrapped), PEM_KEY);
    assert.equal(normalizePrivateKey(`"${BASE64_KEY}"`), PEM_KEY);
  });

  it("always ends the key with exactly one trailing newline", () => {
    assert.equal(normalizePrivateKey(PEM_KEY.trimEnd()), PEM_KEY);
    assert.equal(PEM_KEY.endsWith("\n"), true);
    assert.equal(PEM_KEY.endsWith("\n\n"), false);
    assert.equal(normalizePrivateKey(PEM_KEY).endsWith("\n\n"), false);
  });

  it("returns an empty string for an empty value and leaves unrecognisable input alone", () => {
    assert.equal(normalizePrivateKey(""), "");
    assert.equal(normalizePrivateKey("   "), "");
    // Not base64 of a PEM: returned as given so the PEM check reports it against the variable.
    assert.equal(normalizePrivateKey("hello there"), "hello there\n");
  });
});
