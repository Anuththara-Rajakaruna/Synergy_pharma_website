import { readGoogleEnv, type GoogleEnv } from "@/lib/google/config";
import { ensureStoreReady } from "@/lib/sheets-db";

// Which Google Sheets / Google Drive deployment a script is about to touch, and the sharing
// steps an operator has to perform by hand. Replaces scripts/lib/target.ts: there is no
// connection string any more, so there is nothing to strip credentials from - the ids printed
// here are the ones the operator needs in order to open the documents.
//
// The private key is never read from here, and never printed anywhere.

export type StoreTarget = GoogleEnv;

// The configured target, or null when a required variable is missing or malformed.
export function storeTarget(): StoreTarget | null {
  return readGoogleEnv().settings;
}

// Problems with the Google variables, for scripts that report instead of exiting.
export function storeTargetProblems(): { variable: string; message: string }[] {
  return readGoogleEnv().problems;
}

// Throws GoogleConfigError when the configuration is incomplete, naming the variables at fault.
// Callers report it through describeError().
export function requireStoreTarget(): StoreTarget {
  ensureStoreReady();
  const settings = readGoogleEnv().settings;
  if (!settings) throw new Error("unreachable: ensureStoreReady() accepted an incomplete configuration");
  return settings;
}

export function spreadsheetUrl(spreadsheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
}

export function driveFolderUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${folderId}`;
}

export function printStoreTarget(target: StoreTarget, log: (line: string) => void = console.log): void {
  log(`  Spreadsheet:     ${target.spreadsheetId}`);
  log(`  Drive folder:    ${target.driveFolderId}`);
  log(`  Service account: ${target.clientEmail}`);
  if (target.sharedDriveId) log(`  Shared drive:    ${target.sharedDriveId}`);
  if (target.impersonateUser) log(`  Acting as:       ${target.impersonateUser}`);
}

// The two shares nothing in the code can do for itself: a service account can only open a
// spreadsheet and a Drive folder that a human has shared with it.
export function sharingChecklist(target: StoreTarget): string[] {
  const lines = [
    `1. Open ${spreadsheetUrl(target.spreadsheetId)}`,
    `   Share -> add ${target.clientEmail} -> Editor. Without this every request fails with 403.`,
    `2. Open ${driveFolderUrl(target.driveFolderId)}`,
    `   Share -> add ${target.clientEmail} -> Editor. CVs and supporting documents are stored here.`,
  ];
  if (target.sharedDriveId) {
    lines.push(
      `   The folder is on a Shared Drive: the service account must also be a member of the drive with at least`,
      `   "Content manager" access, otherwise uploads are rejected for having no storage quota.`
    );
  } else {
    lines.push(
      `   The folder is in My Drive: a service account has no storage quota of its own, so either set`,
      `   GOOGLE_DRIVE_SHARED_DRIVE_ID and use a Shared Drive, or set GOOGLE_IMPERSONATE_USER to a Workspace`,
      `   user the service account may act as.`
    );
  }
  lines.push(
    `3. Do not share either document more widely. The spreadsheet holds applicant personal data (names,`,
    `   email addresses, phone numbers, cover letters) and the folder holds their CVs.`,
    `4. Do not rename the header cells in row 1, and do not delete rows. Columns may be reordered and`,
    `   extra columns are ignored, but rows are addressed by number and renaming a header loses its column.`
  );
  return lines;
}
