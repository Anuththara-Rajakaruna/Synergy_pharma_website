// The Sheets/Drive stand-in lives in src/lib/google/local-emulator.ts, because the development
// server uses it too (`npm run dev:local`). Tests import it from here so their import paths read
// as test-support rather than as application code.
//
// Tests get the in-memory form: installGoogleStub() with no persistence, reset between files.
// The dev server gets installLocalGoogle(), which adds a snapshot file.

export {
  GoogleStub,
  columnIndexOf,
  columnLetterOf,
  exportSnapshot,
  importSnapshot,
  installGoogleStub,
  matchesDriveQuery,
  parseA1,
  resetApplicationCaches,
  testPrivateKey,
  FOLDER_MIME,
  LOCAL_STATE_FILE,
  type CellValue,
  type GoogleStubOptions,
  type InstalledStub,
  type ParsedRange,
} from "@/lib/google/local-emulator";
