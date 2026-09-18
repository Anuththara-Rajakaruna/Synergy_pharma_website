// `npm run dev:local` - the development server, backed by an in-process stand-in for Google
// Sheets and Google Drive instead of a real Google project.
//
// Google publishes no emulator for either API, so without this the only way to run the careers
// portal locally is to point a developer machine at a real spreadsheet. This sets
// CAREERS_LOCAL_GOOGLE=1 and hands over to `next dev`; src/instrumentation.ts picks it up and
// installs src/lib/google/local-emulator.ts, which persists everything to .local-google/state.json.
//
// Nothing here can affect a deployment: the flag is only read when NODE_ENV is not production,
// and the emulator refuses to install in production regardless.

import { spawn } from "node:child_process";

// Placeholder credentials, so the configuration check passes and the application takes the
// ordinary code path. They are never sent anywhere - the emulator intercepts every Google
// request inside this process - but they must be well-formed, and they must not look like the
// "replace-with-" placeholders that src/lib/env.ts reports as an error.
const emulatorEnv = {
  CAREERS_LOCAL_GOOGLE: "1",
  GOOGLE_SERVICE_ACCOUNT_EMAIL: "local-emulator@synergy-local.iam.gserviceaccount.com",
  GOOGLE_SHEETS_SPREADSHEET_ID: "local-careers-spreadsheet",
  GOOGLE_DRIVE_FOLDER_ID: "local-careers-folder",
  // The emulator generates a real throwaway RSA key at start-up and overwrites this; it only has
  // to be PEM-shaped for the configuration check that runs first.
  GOOGLE_PRIVATE_KEY: ["-----BEGIN PRIVATE KEY-----", "bG9jYWwtZW11bGF0b3ItcGxhY2Vob2xkZXItcmVwbGFjZWQtYXQtc3RhcnR1cA==", "-----END PRIVATE KEY-----"].join("\n"),
};

const inherited = { ...process.env };
// A real GOOGLE_* value in .env.local would otherwise win and send traffic to a real project,
// which is exactly what this command exists to avoid.
for (const [key, value] of Object.entries(emulatorEnv)) inherited[key] = value;

console.log("");
console.log("  Careers portal - LOCAL mode");
console.log("  Google Sheets and Google Drive are simulated in this process.");
console.log("  Nothing reaches Google. Data is kept in .local-google/state.json");
console.log("");

const child = spawn("npx", ["next", "dev", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: inherited,
  shell: process.platform === "win32",
});

child.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
