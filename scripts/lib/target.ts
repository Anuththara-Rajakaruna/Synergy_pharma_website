import { readDatabaseConfig } from "@/lib/mongodb";

// Which MongoDB deployment a script is about to touch, printed without credentials, and a
// guard that makes writes to anything but a local server require an explicit confirmation.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

// hostname[:port] or [ipv6][:port]. Anything else means the URI could not be split reliably
// (for example an unescaped "@" or "/" in the password), and is never echoed.
const HOST_PATTERN = /^(?:\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9._%-]+)(?::\d{1,5})?$/;

function parseHosts(uri: string): string[] | null {
  const rest = uri.replace(/^mongodb(?:\+srv)?:\/\//, "");
  const queryStart = rest.indexOf("?");
  const beforeQuery = queryStart === -1 ? rest : rest.slice(0, queryStart);
  const credentialsEnd = beforeQuery.lastIndexOf("@");
  const afterCredentials = credentialsEnd === -1 ? beforeQuery : beforeQuery.slice(credentialsEnd + 1);
  const hostList = afterCredentials.split("/")[0];
  const hosts = hostList.split(",").map((host) => host.trim()).filter(Boolean);
  if (hosts.length === 0 || hosts.some((host) => !HOST_PATTERN.test(host))) return null;
  return hosts;
}

function hostName(host: string): string {
  if (host.startsWith("[")) return host.slice(1, host.indexOf("]"));
  return host.replace(/:\d+$/, "").toLowerCase();
}

// "cluster0.example.mongodb.net/synergy" or "localhost:27017/synergy".
export function describeTarget(): string {
  const { uri, dbName } = readDatabaseConfig();
  const hosts = parseHosts(uri);
  return `${hosts ? hosts.join(",") : "(unrecognised host list)"}/${dbName}`;
}

export function isLocalTarget(): boolean {
  const { uri } = readDatabaseConfig();
  if (uri.startsWith("mongodb+srv://")) return false;
  const hosts = parseHosts(uri);
  return hosts !== null && hosts.every((host) => LOCAL_HOSTS.has(hostName(host)));
}

function readConfirmValue(argv: string[]): string | null {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--confirm=")) return arg.slice("--confirm=".length);
    if (arg === "--confirm") return argv[i + 1] ?? "";
  }
  return null;
}

// Exits the process (status 1) unless the target is a local server or the operator passed
// --confirm=<database name> matching MONGODB_DB_NAME. Call before connecting.
export function assertWriteConfirmed(argv: string[]): void {
  if (isLocalTarget()) return;
  const { dbName } = readDatabaseConfig();
  const confirmed = readConfirmValue(argv);
  if (confirmed === dbName) return;

  const target = describeTarget();
  console.error("");
  if (confirmed === null) {
    console.error(`✗ Refusing to write to the non-local MongoDB target ${target} without confirmation.`);
  } else {
    console.error(`✗ --confirm does not match the target database name (target: ${target}).`);
  }
  console.error(`  Check that this is the intended deployment, then re-run with --confirm=${dbName}`);
  console.error("  Tip: add --no-env-files when using exported production variables, so .env.local cannot fill in");
  console.error("  a variable you did not export (such as MONGODB_DB_NAME).");
  process.exit(1);
}
