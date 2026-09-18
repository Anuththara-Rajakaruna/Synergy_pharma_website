// Manages careers admin accounts from the command line.
//
//   npm run admin:user -- create --email hr@synergypharma.lk --name "Nimali Perera" --role admin
//   npm run admin:user -- list
//   npm run admin:user -- reset-password --email hr@synergypharma.lk
//   npm run admin:user -- deactivate --email hr@synergypharma.lk
//   npm run admin:user -- activate --email hr@synergypharma.lk
//   npm run admin:user -- set-role --email hr@synergypharma.lk --role hr
//
// `create` and `reset-password` print a generated temporary password once; the user has to
// choose a new one after signing in. Add --password-stdin to set a password read from standard
// input instead (it is not printed and does not have to be changed), for example:
//
//   printf '%s' "$NEW_PASSWORD" | npm run admin:user -- create --email ... --name ... --role admin --password-stdin
//
// The last active administrator can never be deactivated or demoted.

import "./lib/load-env";
import { ADMIN_ROLE_LABELS, ADMIN_ROLES, type AdminRole } from "@/lib/careers/constants";
import { flushAuditLog } from "@/lib/careers/server/audit";
import {
  createAdminUser,
  createAdminUserWithPassword,
  getAdminUserByEmail,
  listAdminUsers,
  resetAdminPassword,
  setAdminPassword,
  updateAdminUser,
} from "@/lib/careers/server/users";
import { isAdminRole } from "@/lib/careers/validation";
import { AppError } from "@/lib/http/errors";
import type { AdminUserInfo } from "@/types/careers";
import { requireStoreTarget } from "./lib/store";

class UsageError extends Error {}

type Command = "create" | "list" | "reset-password" | "deactivate" | "activate" | "set-role";

type CommandSpec = { required: string[]; optional: string[]; flags: string[] };

const COMMANDS: Record<Command, CommandSpec> = {
  create: { required: ["email", "name", "role"], optional: [], flags: ["password-stdin"] },
  list: { required: [], optional: [], flags: [] },
  "reset-password": { required: ["email"], optional: [], flags: ["password-stdin"] },
  deactivate: { required: ["email"], optional: [], flags: [] },
  activate: { required: ["email"], optional: [], flags: [] },
  "set-role": { required: ["email", "role"], optional: [], flags: [] },
};

// Handled by scripts/lib/load-env.ts; accepted here so it can be combined with any command.
const GLOBAL_FLAGS = new Set(["no-env-files", "help"]);

const USAGE = `Usage: npm run admin:user -- <command> [options]

Commands:
  create --email <email> --name <name> --role <${ADMIN_ROLES.join("|")}> [--password-stdin]
  list
  reset-password --email <email> [--password-stdin]
  deactivate --email <email>
  activate --email <email>
  set-role --email <email> --role <${ADMIN_ROLES.join("|")}>

Without --password-stdin, create and reset-password print a one-time temporary password.`;

type ParsedArgs = { command: Command | null; values: Map<string, string>; flags: Set<string> };

function isCommand(value: string): value is Command {
  return Object.prototype.hasOwnProperty.call(COMMANDS, value);
}

function parseArgs(argv: string[]): ParsedArgs {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  let command: Command | null = null;

  const valueOptions = new Set(Object.values(COMMANDS).flatMap((spec) => [...spec.required, ...spec.optional]));
  const flagOptions = new Set([...Object.values(COMMANDS).flatMap((spec) => spec.flags), ...GLOBAL_FLAGS]);

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      const name = arg.slice(2, eq === -1 ? undefined : eq);
      if (flagOptions.has(name)) {
        if (eq !== -1) throw new UsageError(`--${name} does not take a value.`);
        flags.add(name);
      } else if (valueOptions.has(name)) {
        const value = eq === -1 ? argv[(i += 1)] : arg.slice(eq + 1);
        if (value === undefined || (eq === -1 && value.startsWith("--"))) throw new UsageError(`--${name} needs a value.`);
        if (values.has(name)) throw new UsageError(`--${name} was given more than once.`);
        values.set(name, value);
      } else {
        throw new UsageError(`Unknown option --${name}.`);
      }
    } else if (command === null) {
      if (!isCommand(arg)) throw new UsageError(`Unknown command "${arg}".`);
      command = arg;
    } else {
      throw new UsageError(`Unexpected argument "${arg}".`);
    }
  }

  if (command && !flags.has("help")) {
    const spec = COMMANDS[command];
    for (const name of values.keys()) {
      if (!spec.required.includes(name) && !spec.optional.includes(name)) {
        throw new UsageError(`--${name} is not used by "${command}".`);
      }
    }
    for (const name of flags) {
      if (!spec.flags.includes(name) && !GLOBAL_FLAGS.has(name)) throw new UsageError(`--${name} is not used by "${command}".`);
    }
    for (const name of spec.required) {
      if (!values.get(name)?.trim()) throw new UsageError(`"${command}" requires --${name}.`);
    }
  }
  return { command, values, flags };
}

async function readPasswordFromStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new UsageError(
      "--password-stdin reads the password from a pipe, e.g. printf '%s' \"$PASSWORD\" | npm run admin:user -- ... --password-stdin"
    );
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : (chunk as Buffer));
  }
  // Drop the single line break that `echo` or a here-string adds.
  const password = Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
  if (!password) throw new UsageError("No password was received on standard input.");
  return password;
}

function readRole(values: Map<string, string>): AdminRole {
  const role = values.get("role")?.trim();
  if (!isAdminRole(role)) throw new UsageError(`--role must be one of: ${ADMIN_ROLES.join(", ")}.`);
  return role;
}

async function requireUser(email: string): Promise<AdminUserInfo> {
  const user = await getAdminUserByEmail(email);
  if (!user) throw new UsageError(`No admin account exists for ${email.trim()}.`);
  return user;
}

function formatDate(iso: string | null): string {
  return iso ? `${iso.slice(0, 16).replace("T", " ")} UTC` : "never";
}

function printTemporaryPassword(password: string) {
  console.log("");
  console.log(`  Temporary password (shown only once): ${password}`);
  console.log("");
  console.log("Share it with the user over a secure channel. They must choose a new password after signing in.");
}

function printUsers(users: AdminUserInfo[]) {
  if (users.length === 0) {
    console.log("No admin accounts yet. Create one with: npm run admin:user -- create --email <email> --name <name> --role admin");
    return;
  }
  const rows = users.map((user) => [
    user.email,
    user.name,
    ADMIN_ROLE_LABELS[user.role],
    !user.active ? "inactive" : user.lockedUntil ? "locked" : "active",
    user.mustChangePassword ? "yes" : "no",
    formatDate(user.lastLoginAt),
  ]);
  const header = ["Email", "Name", "Role", "Status", "Must change password", "Last sign-in"];
  const widths = header.map((title, column) => Math.max(title.length, ...rows.map((row) => row[column].length)));
  const line = (cells: string[]) => cells.map((cell, column) => cell.padEnd(widths[column])).join("  ").trimEnd();
  console.log(line(header));
  console.log(line(widths.map((width) => "-".repeat(width))));
  for (const row of rows) console.log(line(row));
  const activeAdmins = users.filter((user) => user.active && user.role === "admin").length;
  console.log(`\n${users.length} account(s), ${activeAdmins} active administrator(s).`);
}

async function run(parsed: ParsedArgs & { command: Command }) {
  const { command, values, flags } = parsed;
  // Validate everything and read piped input before touching the database.
  const role = values.has("role") ? readRole(values) : null;
  const stdinPassword = flags.has("password-stdin") ? await readPasswordFromStdin() : null;

  // There is no connection to open: this only fails fast when the Google configuration is
  // incomplete, so a typo in a variable is reported before anything is written.
  const target = requireStoreTarget();
  console.log(`Spreadsheet: ${target.spreadsheetId}`);

  const email = values.get("email") ?? "";

  switch (command) {
    case "list": {
      printUsers(await listAdminUsers());
      return;
    }
    case "create": {
      const input = { email, name: values.get("name") ?? "", role };
      if (stdinPassword !== null) {
        const user = await createAdminUserWithPassword(input, stdinPassword, null);
        console.log(`✓ Created ${ADMIN_ROLE_LABELS[user.role]} account for ${user.email} with the password from standard input.`);
      } else {
        const { user, temporaryPassword } = await createAdminUser(input, null);
        console.log(`✓ Created ${ADMIN_ROLE_LABELS[user.role]} account for ${user.email}.`);
        printTemporaryPassword(temporaryPassword);
      }
      return;
    }
    case "reset-password": {
      const user = await requireUser(email);
      if (stdinPassword !== null) {
        await setAdminPassword(user.id, stdinPassword, null);
        console.log(`✓ Password for ${user.email} set from standard input. Their existing sessions were signed out.`);
      } else {
        const { temporaryPassword } = await resetAdminPassword(user.id, null);
        console.log(`✓ Password for ${user.email} reset. Their existing sessions were signed out.`);
        printTemporaryPassword(temporaryPassword);
      }
      if (!user.active) console.log(`Note: ${user.email} is inactive. Run "activate" before they can sign in.`);
      return;
    }
    case "deactivate": {
      const user = await requireUser(email);
      if (!user.active) {
        console.log(`${user.email} is already inactive.`);
        return;
      }
      await updateAdminUser(user.id, { active: false }, null);
      console.log(`✓ Deactivated ${user.email} and signed out their sessions.`);
      return;
    }
    case "activate": {
      const user = await requireUser(email);
      if (user.active) {
        console.log(`${user.email} is already active.`);
        return;
      }
      await updateAdminUser(user.id, { active: true }, null);
      console.log(`✓ Activated ${user.email}.`);
      return;
    }
    case "set-role": {
      if (!role) throw new UsageError(`--role must be one of: ${ADMIN_ROLES.join(", ")}.`);
      const user = await requireUser(email);
      if (user.role === role) {
        console.log(`${user.email} already has the ${ADMIN_ROLE_LABELS[role]} role.`);
        return;
      }
      await updateAdminUser(user.id, { role }, null);
      console.log(`✓ ${user.email} is now ${ADMIN_ROLE_LABELS[role]}.`);
      return;
    }
  }
}

async function main() {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`✗ ${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`);
    process.exitCode = 1;
    return;
  }
  if (parsed.flags.has("help") || parsed.command === null) {
    console.log(USAGE);
    if (parsed.command === null && !parsed.flags.has("help")) process.exitCode = 1;
    return;
  }

  try {
    await run({ ...parsed, command: parsed.command });
  } catch (err) {
    process.exitCode = 1;
    if (err instanceof UsageError) {
      console.error(`✗ ${err.message}`);
    } else if (err instanceof AppError) {
      console.error(`✗ ${err.message}`);
      for (const [field, message] of Object.entries(err.fields ?? {})) {
        if (message !== err.message) console.error(`  ${field}: ${message}`);
      }
    } else {
      console.error(`✗ Failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  } finally {
    // Audit entries are buffered and flushed a moment later, which never happens in a process
    // that is about to exit. Nothing here rejects.
    await flushAuditLog();
  }
}

void main();
