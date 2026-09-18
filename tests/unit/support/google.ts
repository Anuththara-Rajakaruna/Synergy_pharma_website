// Fixtures for the Google service-account configuration. The key below is not a real key: it has
// the shape src/lib/google/config.ts checks for (a PEM envelope) and nothing else.

const KEY_BODY = [
  "MIIBVAIBADANBgkqhkiG9w0BAQEFAASCAT4wggE6AgEAAkEAxJ7Uk8gk3qz0Zx5m",
  "notARealKeyJustEnoughBase64ToLookLikeOneAAAAAAAAAAAAAAAAAAAAAAAA",
  "wIDAQABAkAGyZ2mQ1s7PpkeOD0MH2c1S1tOd7Xb0Kk4fake0CgYEA0000000000",
].join("\n");

export const PEM_KEY = `-----BEGIN PRIVATE KEY-----\n${KEY_BODY}\n-----END PRIVATE KEY-----\n`;

// The same key as a hosting dashboard usually mangles it: one line with literal backslash-n.
export const ESCAPED_KEY = PEM_KEY.trimEnd().split("\n").join("\n");

export const BASE64_KEY = Buffer.from(PEM_KEY, "utf8").toString("base64");

export const SERVICE_ACCOUNT_EMAIL = "careers-portal@synergy-careers.iam.gserviceaccount.com";
export const SPREADSHEET_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abc";
export const DRIVE_FOLDER_ID = "1ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210";
export const SHARED_DRIVE_ID = "0ABcDeFgHiJkLmNoPQ9";

// A complete, valid configuration in the three-variable form.
export const googleEnv: Record<string, string> = {
  GOOGLE_SERVICE_ACCOUNT_EMAIL: SERVICE_ACCOUNT_EMAIL,
  GOOGLE_PRIVATE_KEY: PEM_KEY,
  GOOGLE_SHEETS_SPREADSHEET_ID: SPREADSHEET_ID,
  GOOGLE_DRIVE_FOLDER_ID: DRIVE_FOLDER_ID,
};

export function serviceAccountJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "service_account",
    project_id: "synergy-careers",
    private_key_id: "b7f1c0de0000000000000000000000000000abcd",
    private_key: PEM_KEY,
    client_email: SERVICE_ACCOUNT_EMAIL,
    client_id: "100000000000000000000",
    ...overrides,
  });
}
