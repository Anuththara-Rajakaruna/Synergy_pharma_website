# Production Deployment Guide — Synergy Pharmaceutical Corporation Website

This is a Next.js 16 (App Router) application. The public marketing pages
(home, about, products, quality, facility, contact) and the careers portal
(job listings, applications, talent pool, admin portal) run in one deployment.

There is **no database server**. Careers data lives in a single Google
Spreadsheet (one tab per record type); CVs and supporting documents live in a
single private Google Drive folder; email goes out over SMTP through an outbox
held in that spreadsheet. The application reaches both with one Google
**service account**, authenticated with a JSON key.

> **Setting this up for the first time? Read §9 first.** It is a step-by-step
> walkthrough of the Google Cloud project, the spreadsheet and the Drive folder,
> and it produces the values §4 asks for. §17 lists the operational limits a
> spreadsheet-backed deployment has to respect.

`PRODUCTION_DEPLOYMENT.md` covers the www.synergypharma.lk cut-over (current
DNS, what to change, what not to touch). This guide covers everything else.

---

## 1. Prerequisites

Before deploying, have accounts ready for:

- **GitHub** — source control (`origin` points at
  `github.com/Anuththara-Rajakaruna/Synergy_Final`).
- **Vercel** (recommended) or another Node.js 20.19+ host.
- **A Google Cloud project** — free. The Sheets and Drive APIs cost nothing
  within the quotas in §17 and no billing account is required. Created in §9.
- **A Google account that owns the data** — **Google Workspace is effectively
  required in production**: only Workspace has Shared Drives and domain-wide
  delegation, and one of the two is needed for CV uploads to keep working
  (§9, "The storage quota problem"). A personal Google account is fine for
  local development only.
- **An SMTP provider** — Microsoft 365 SMTP AUTH (company email already runs
  on Microsoft 365), Postmark, SendGrid or Amazon SES.
- **DNS access** for `synergypharma.lk` (DreamHost, see `PRODUCTION_DEPLOYMENT.md`).
- **Google Search Console** and optionally **Google Analytics** (§12).

---

## 2. GitHub setup

1. `main` is the production branch. Merge feature branches through pull requests.
2. **Keep the repository private** if applicant data or internal notes were
   ever committed to its history.
3. Add branch protection on `main` requiring the **CI** workflow
   (`.github/workflows/ci.yml`: lint, typecheck, unit tests, build, dependency
   audit, and integration tests against a dedicated test spreadsheet and Drive
   folder) to pass.
4. **Never commit the service-account JSON key.** It is a credential with full
   access to the applicant data; it belongs in the hosting dashboard and the
   company password manager, nowhere else. If one is ever committed, rotate it
   (§16) — removing the commit is not enough.

---

## 3. Hosting setup (Vercel — recommended)

1. [vercel.com](https://vercel.com) → **Add New → Project** → import the repository.
2. Framework preset **Next.js** (auto-detected); build command `npm run build`.
3. Set the **Production Branch** to `main`.
4. Add every variable from §4 in **Project Settings → Environment Variables**
   (Production scope). Preview deployments must use a **separate spreadsheet and
   a separate Drive folder**, never production data.
5. **Plan and cron schedule.** `vercel.json` runs `/api/cron/maintenance` every
   6 hours (§8). Vercel's Hobby plan only allows cron jobs that run once a day
   and rejects the deployment otherwise; on Hobby change the schedule to a
   daily one (e.g. `0 2 * * *`), on Pro keep it. The maintenance job is not
   optional here: it is also what keeps the spreadsheet inside its size
   limits (§17).
6. **Check the request-body limit.** CVs are uploaded through this
   application's own `/api/uploads/<id>` route, so the platform's body cap
   applies to them — Vercel rejects request bodies larger than about 4.5 MB.
   Read §17 before promising candidates a 10 MB CV limit.
7. Deploy, then verify on the `*.vercel.app` URL (§13) before attaching the
   custom domain.

Other Node.js hosts work too (`npm ci && npm run build && npm run start`).
Behind your own reverse proxy set `TRUSTED_IP_HEADER` (§4) and a body limit that
matches the  size (nginx: `client_max_body_size`), and call the maintenance
endpoint from an external scheduler (§8).

---

## 4. Environment variables

`.env.example` documents every variable with examples. The server validates the
configuration at start-up and logs each problem as a `config.problem` event;
`npm run sheets:check` prints the same report. Only the two `NEXT_PUBLIC_`
variables reach the browser (they are compiled into the build: redeploy after
changing them).

The Google values all come from §9. `GOOGLE_SERVICE_ACCOUNT_EMAIL`,
`GOOGLE_PRIVATE_KEY` and `GOOGLE_PRIVATE_KEY_ID` are the `client_email`,
`private_key` and `private_key_id` fields of the downloaded JSON key file;
`GOOGLE_SERVICE_ACCOUNT_JSON` supplies all three at once.

| Variable | Required | Production value / notes |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | Yes | `https://www.synergypharma.lk` (https, no trailing slash). Canonical URLs, sitemap, email links, the upload ticket URLs and the same-origin check on form submissions derive from it. |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | No | GA4 ID `G-…`; empty disables analytics (§12). |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Yes\* | `client_email` from the key file, e.g. `synergy-careers-web@<project-id>.iam.gserviceaccount.com`. This is the address the spreadsheet and the Drive folder must be shared with. |
| `GOOGLE_PRIVATE_KEY` | Yes\* | `private_key` from the key file — the whole PEM, including the `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` lines. Real newlines, literal `\n` escapes and base64 of the whole PEM are all accepted, so any hosting dashboard can hold it. |
| `GOOGLE_PRIVATE_KEY_ID` | No | `private_key_id`; sent as the JWT `kid`. Worth setting while two keys exist during a rotation (§16). |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Alternative to the three above | The downloaded key file **verbatim**, or base64 of it (`base64 -w0 key.json`). Variables set explicitly win over the fields inside it. |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | Yes | The id in the sheet URL: `https://docs.google.com/spreadsheets/d/<THIS PART>/edit`. |
| `GOOGLE_DRIVE_FOLDER_ID` | Yes | The id in the folder URL: `https://drive.google.com/drive/folders/<THIS PART>`. The application creates `Applications/`, `TalentPool/` and `_staging/` inside it. |
| `GOOGLE_DRIVE_SHARED_DRIVE_ID` | **Recommended** | Id of the Shared Drive the folder lives on. Without a Shared Drive (or `GOOGLE_IMPERSONATE_USER`) uploads eventually fail with `storageQuotaExceeded` — see §9. |
| `GOOGLE_IMPERSONATE_USER` | Alternative | Workspace user the service account acts as (domain-wide delegation), e.g. `careers@synergypharma.lk`. The other fix for the storage quota problem (§9). |
| `SMTP_HOST` / `SMTP_PORT` | Yes | Provider host; port 587 (STARTTLS, enforced) or 465 with `SMTP_SECURE=true`. |
| `SMTP_SECURE` | No | `true` for implicit TLS on 465. |
| `SMTP_USER` / `SMTP_PASS` | Usually | Leave both empty only for a relay that authenticates by IP. |
| `SMTP_FROM` | Yes | e.g. `Synergy Careers <careers@synergypharma.lk>` — an address the SMTP account may send as. |
| `SMTP_ALLOW_INSECURE_LOCAL` | **Never** | Local development only; remove in production. |
| `HR_NOTIFICATION_EMAIL` | Yes | New-application and talent-pool alerts, e.g. `hr@synergypharma.lk` (comma-separated, up to 10). |
| `CONTACT_NOTIFICATION_EMAIL` | No | Contact form recipients, e.g. `info@synergypharma.lk`; defaults to `HR_NOTIFICATION_EMAIL`. |
| `CRON_SECRET` | Yes | At least 32 characters (`openssl rand -hex 32`). Authorizes `/api/cron/maintenance` (§8); Vercel Cron sends it automatically. Empty disables maintenance. |
| `HEALTHCHECK_TOKEN` | Recommended | At least 32 characters. Unlocks the deep checks of `/api/health` (Drive folder access, spreadsheet tabs and columns) for uptime monitoring. |
| `TRUSTED_IP_HEADER` | Non-Vercel hosts | Header your proxy sets and overwrites (`x-real-ip` for nginx, `cf-connecting-ip` for Cloudflare). Not needed on Vercel. Rate limits and audit logs use the client IP. |
| `TRUSTED_PROXY_COUNT` | No | 1-10, default 1: proxies to skip in `X-Forwarded-For` when `TRUSTED_IP_HEADER` is unset. |
| `DATA_RETENTION_MONTHS` | No | 1-120, default 12 (the privacy policy promises 12 months). |
| `RETENTION_AUTO_PURGE` | No | `false` (default) only reports overdue records; `true` deletes them. Read §8 first — and note that with `false` no applicant row is ever removed from the sheet (§17). |
| `AUDIT_RETENTION_MONTHS` | No | 1-120, default 24. How long audit entries are kept before the maintenance job deletes them. It exists because the `AuditLog` tab grows with every admin action and a spreadsheet is capped at 10 million cells (§17). |

\* Provide either `GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_PRIVATE_KEY`, or
`GOOGLE_SERVICE_ACCOUNT_JSON`.

**Delete these if they are still in the hosting dashboard from an earlier
release**: `MONGODB_URI`, `MONGODB_DB_NAME`, `MONGODB_MAX_POOL_SIZE`, every
`S3_*` variable, `DATABASE_URL`, `PGSSLROOTCERT`, `AUTH_SECRET` and
`ADMIN_PASSWORD`. None of them is read any more: the data store is Google
Sheets and Drive, and administrators sign in with individual accounts (§9).

---

## 5. Domain configuration

1. In Vercel: **Project Settings → Domains** → add `www.synergypharma.lk` and
   `synergypharma.lk`, with the apex redirecting to `www`.
2. `NEXT_PUBLIC_SITE_URL` must be exactly the canonical form
   (`https://www.synergypharma.lk`). Form submissions from any other origin
   are rejected as cross-site, and upload tickets are issued against it.
3. The DNS changes and what must not be touched (Microsoft 365 MX/SPF) are in
   `PRODUCTION_DEPLOYMENT.md` §4.

---

## 6. DNS records

Vercel shows the exact records once the domains are added; typically an `A`
record for the apex and a `CNAME` (`cname.vercel-dns.com`) for `www`. Do not
change the MX or SPF records of company email. Ask the SMTP provider for its
SPF include and DKIM records so confirmation emails from `SMTP_FROM` are not
marked as spam.

---

## 7. SSL / HTTPS

- Vercel provisions and renews certificates automatically and redirects HTTP to HTTPS.
- `next.config.ts` sends `Strict-Transport-Security: max-age=63072000;
  includeSubDomains` (deliberately without `preload`, which would force HTTPS
  on every current and future subdomain), plus `X-Frame-Options`,
  `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` and
  `Cross-Origin-Opener-Policy`. `src/proxy.ts` sets a nonce-based
  Content-Security-Policy on every page; it no longer has to allow a storage
  origin, because uploads are same-origin now (§9).
- The admin session cookie is `__Host-synergy_admin`: `Secure`, `HttpOnly`,
  `SameSite=Strict`, 8-hour absolute and 1-hour idle lifetime. Only a SHA-256
  hash of the token is stored, in the `AdminSessions` tab
  (`src/lib/auth/session.ts`).
- The start-up check reports an error when `NEXT_PUBLIC_SITE_URL` is not https
  in production.

---

## 8. Backend, scheduled maintenance and data retention

The API routes (`src/app/api/**`) run in the same deployment; there is no
separate backend service.

### Scheduled maintenance

`GET/POST /api/cron/maintenance` with `Authorization: Bearer <CRON_SECRET>`:

1. deletes abandoned uploads from the Drive `_staging` folder — files a browser
   sent but whose form was never submitted (older than 24 hours),
2. applies the data retention rules below,
3. delivers queued email and retries failed deliveries (back-off 1 min, 5 min,
   30 min, 2 h, 6 h; a message is marked failed after 6 attempts),
4. removes expired rows from the `AdminSessions` tab — a spreadsheet has no TTL
   index, so nothing else would ever clear them,
5. deletes `EmailOutbox` rows 180 days after the message was delivered or given
   up (a message still waiting to be sent is never swept),
6. deletes `AuditLog` rows older than `AUDIT_RETENTION_MONTHS`.

Steps 4-6 are the only things keeping the spreadsheet from growing without
bound; see §17. Each step runs independently and is allowed to fail on its own —
a Drive outage must not stop the email queue from draining — and the report
counts how many of the six failed. Each sweep also deletes at most a few hundred
rows per run, oldest first, so a large backlog is cleared over several runs
rather than in one long request.

On Vercel, `vercel.json` schedules the route (see §3 for the
Hobby plan limit). Elsewhere call it from any scheduler, e.g.
`curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://www.synergypharma.lk/api/cron/maintenance`,
or run `npm run jobs:maintenance` on a machine with the production environment.
Without it, emails that failed on the first attempt are never retried and the
sheet never stops growing.

### Data retention

Applications and talent profiles are due for deletion `DATA_RETENTION_MONTHS`
after they were **submitted** (`createdAt`). With `RETENTION_AUTO_PURGE=false`
the maintenance job only logs how many records are overdue. With `true` it
permanently deletes overdue records — their rows in `Applications` /
`TalentPool` and the linked `Documents`, `Notes`, `StatusHistory` and
`TalentActivity` rows, their files in the Drive folder and their queued emails —
and writes a `retention.purge` audit entry for each.

**Before enabling auto-purge for the first time:** this is the only operation
that deletes spreadsheet rows rather than setting an archive flag, and the
application cannot undo it. Make a copy of the spreadsheet first (§9, Backups),
export anything HR must keep (Admin → Activity Log → candidate data export, or
the CSV exports), and agree the purge with HR. Leave `RETENTION_AUTO_PURGE=false`
for one maintenance run and read the reported counts before switching it on.

### Monitoring

- `GET /api/health` → `200 {"status":"ok"|"degraded"}` (503 when the
  spreadsheet cannot be read).
- With `Authorization: Bearer <HEALTHCHECK_TOKEN>` it also verifies that the
  Drive folder is reachable and writable by the service account, and that every
  tab and column this release expects exists.
- Logs are one JSON object per line (`level`, `event`, ids only — never
  applicant names, emails or file names). Alert on `level:"error"`, especially
  `email.failed`, `retention.purge_failed`, `config.problem`,
  `drive.upload_failed` (watch for reason `storageQuotaExceeded`) and repeated
  `sheets.*` failures, which mean the API quota is being hit (§17).

---

## 9. First-time setup: Google Cloud, the spreadsheet, Drive and the first administrator

Everything the application needs on the Google side, in order. Allow about
half an hour the first time. You need a Google account that may create a Google
Cloud project — ideally a Google Workspace account on the company domain.

Nothing here is destructive, and every step can be repeated.

### Step 1 — Create a Google Cloud project

1. Open [console.cloud.google.com](https://console.cloud.google.com) and sign in.
2. Project picker (top bar) → **New Project**.
3. Name it e.g. `Synergy Careers` and click **Create**. No billing account is
   needed: the Sheets and Drive APIs are free within the quotas in §17.
4. Make sure the new project is selected in the project picker before continuing
   — every following step applies to the selected project.

### Step 2 — Enable the Google Sheets API and the Google Drive API

1. **APIs & Services → Library**.
2. Search for **Google Sheets API** → **Enable**.
3. Search for **Google Drive API** → **Enable**.

Both must be enabled **in the same project as the service account**. If one is
missing, the first request fails with a message naming the disabled API and a
link to enable it.

### Step 3 — Create the service account

1. **IAM & Admin → Service Accounts → Create service account**.
2. Name: `synergy-careers-web`. Google derives the account's email address from
   it, e.g. `synergy-careers-web@<project-id>.iam.gserviceaccount.com`.
   **Copy that address** — you need it three more times below.
3. Skip the optional steps ("Grant this service account access to the project"
   and "Grant users access to this service account") and click **Done**.
   Project IAM roles have nothing to do with access to a spreadsheet or a Drive
   folder: that access comes from sharing the file with the account (Steps 6
   and 8). Granting it a project role instead is the usual reason a setup
   "looks right" and still returns permission errors.

### Step 4 — Create and download a JSON key

1. Open the service account → **Keys → Add key → Create new key → JSON → Create**.
2. The file downloads once; Google keeps no copy of the private key. Treat it
   like a password: store it in the company password manager, never commit it,
   never email it, never paste it into a chat.

The fields you need:

| Key file field | Environment variable |
|---|---|
| `client_email` | `GOOGLE_SERVICE_ACCOUNT_EMAIL` |
| `private_key` | `GOOGLE_PRIVATE_KEY` |
| `private_key_id` | `GOOGLE_PRIVATE_KEY_ID` (optional) |

Or paste the whole file into `GOOGLE_SERVICE_ACCOUNT_JSON` instead. If the
hosting dashboard mangles multi-line values, base64 it first
(`base64 -w0 key.json`) — the configuration parser accepts both forms, and it
accepts `GOOGLE_PRIVATE_KEY` with real newlines, with literal `\n` escapes, or
base64-encoded.

### Step 5 — Create the spreadsheet

1. Go to [sheets.new](https://sheets.new) (or Drive → **New → Google Sheets**).
2. Name it e.g. `Synergy Careers Data`.
3. **Do not create any tabs by hand** — `npm run sheets:setup` creates all
   twelve with the right columns in Step 11.
4. Copy the id out of the URL:
   `https://docs.google.com/spreadsheets/d/`**`<SPREADSHEET ID>`**`/edit`
   → `GOOGLE_SHEETS_SPREADSHEET_ID`.

On Workspace, create it **inside the Shared Drive from Step 7**. A spreadsheet
in an individual's My Drive is deleted when that person's account is deleted.

### Step 6 — Share the spreadsheet with the service account (the step everyone forgets)

1. Open the spreadsheet → **Share**.
2. Paste the service account email address from Step 3.
3. Set the role to **Editor**.
4. Untick **Notify people** (a service account has no inbox) → **Share**.

Without this, every request fails with a permission error even though the
credentials are perfectly valid — the credentials prove *who* the application
is, the sharing grants *access*. The same applies in Step 8 for the Drive folder.

While you are here, keep the human access list short. This spreadsheet holds
applicant names, email addresses, phone numbers, cover letters and internal HR
notes: anyone you share it with can read all of it, and general link sharing
must stay **Restricted**.

### Step 7 — Create the Drive folder (preferably on a Shared Drive)

**With Google Workspace (recommended):**

1. Drive → **Shared drives → New** → e.g. `Synergy Careers` → **Create**.
2. Open the Shared Drive and copy its id from the URL
   (`https://drive.google.com/drive/folders/`**`<SHARED DRIVE ID>`**)
   → `GOOGLE_DRIVE_SHARED_DRIVE_ID`.
3. Inside it: **New → Folder** → `Careers Documents`.
4. Open that folder and copy its id from the URL → `GOOGLE_DRIVE_FOLDER_ID`.

**Without a Shared Drive:** create an ordinary folder in My Drive, copy its id
into `GOOGLE_DRIVE_FOLDER_ID`, leave `GOOGLE_DRIVE_SHARED_DRIVE_ID` empty — and
read "The storage quota problem" below before going anywhere near production.

The application creates `Applications/`, `TalentPool/` and `_staging/` inside
this folder the first time it needs them. Do not rename or move them.

### Step 8 — Share the folder with the service account as Editor

**Shared Drive:** open the Shared Drive → **Manage members** → add the service
account email with the **Content manager** role (the Shared Drive equivalent of
Editor; it may create, move and delete files). Sharing only the one folder with
the account as **Editor** works too.

**My Drive folder:** right-click the folder → **Share** → paste the service
account email → **Editor** → untick **Notify people** → **Share**.

Verify it afterwards with `/api/health` and the health-check token, or with
`npm run sheets:check`: both check that the folder exists, is a folder, and that
the service account may add files to it.

### Step 9 — Alternative to a Shared Drive: domain-wide delegation

Only needed when the folder lives in My Drive and you have Google Workspace.
It lets the service account act **as a real Workspace user**, so uploaded files
are owned by that user and count against that user's storage.

1. Cloud Console → the service account → **Details** → copy the **Unique ID**
   (the numeric OAuth client ID).
2. [admin.google.com](https://admin.google.com) → **Security → Access and data
   control → API controls → Domain-wide delegation → Add new**.
3. Client ID: the Unique ID from step 1. OAuth scopes (exactly these two, comma
   separated — they are the scopes in `src/lib/google/auth.ts`):
   `https://www.googleapis.com/auth/spreadsheets`,
   `https://www.googleapis.com/auth/drive`
4. **Authorise**, then set `GOOGLE_IMPERSONATE_USER` to that user's address,
   e.g. `careers@synergypharma.lk`.

Pick a role account, not a person's mailbox: if the user is deleted, the files
they own go with them. Delegation is powerful — it allows the service account to
act as that user for those two scopes, so a leaked key is worth more. A Shared
Drive is the safer choice where it is available.

### Step 10 — Put the ids into the environment

Local development: copy `.env.example` to `.env.local` and fill in
`GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY` (or
`GOOGLE_SERVICE_ACCOUNT_JSON`), `GOOGLE_SHEETS_SPREADSHEET_ID`,
`GOOGLE_DRIVE_FOLDER_ID` and, when you have one,
`GOOGLE_DRIVE_SHARED_DRIVE_ID`.

Production: the same variables in the hosting dashboard (§4), Production scope.

### Step 11 — Create the tabs

From a machine whose environment points at the target spreadsheet:

```
npm run sheets:setup -- --no-env-files
```

It creates every tab — `Jobs`, `Applications`, `TalentPool`, `Documents`,
`Notes`, `StatusHistory`, `TalentActivity`, `AdminUsers`, `AdminSessions`,
`AuditLog`, `EmailOutbox`, `Settings` — writes and freezes each header row, and
records the schema version in `Settings`.

It is **idempotent**: a tab that exists is left alone, a header row that is
already correct is not rewritten, and a column added by a later release is
appended rather than replacing what is there. Running it against a spreadsheet
full of live data is safe, and it must be re-run after any release that changes
`src/lib/sheets-db/schema.ts`. `--no-env-files` makes sure a local `.env.local`
is not picked up by mistake when you are pointing at production.

### Step 12 — Verify

```
npm run sheets:check -- --no-env-files
```

Read-only. It reports configuration problems, whether the spreadsheet can be
reached and what it is called, every tab with its row count, missing or unknown
columns, whether the Drive folder is reachable and writable, and whether at
least one active administrator exists. It exits non-zero when anything is an
error. This is the first command to run whenever something is wrong.

### Step 13 — Create the first administrator

```
npm run admin:user -- create --email hr.manager@synergypharma.lk --name "Full Name" --role admin --no-env-files
```

It prints a temporary password once; the user must choose a new one at first
sign-in. Further accounts are created in the admin portal (**Team** tab) or with
the same command (`--role hr` for recruiters, who cannot manage accounts, view
the activity log or permanently delete records). Other commands: `list`,
`reset-password`, `deactivate`, `activate`, `set-role`. The last active
administrator can never be deactivated or demoted.

### The storage quota problem (read this before going live)

**A Google service account has no Drive storage quota of its own.** Any file it
creates in an ordinary My Drive folder is *owned by the service account*, and is
charged against a quota of zero. Uploads into such a folder are refused with
`storageQuotaExceeded` — often not on day one, which is exactly what makes this
dangerous: it looks like it works, and starts failing later in production. The
application turns that response into a configuration error and logs
`drive.upload_failed` with `reason: "storageQuotaExceeded"`.

There are exactly two supported fixes:

| Fix | What to do | Trade-off |
|---|---|---|
| **Shared Drive** (recommended) | Put `GOOGLE_DRIVE_FOLDER_ID`'s folder on a Shared Drive and set `GOOGLE_DRIVE_SHARED_DRIVE_ID` (Steps 7-8). | Needs Google Workspace. Files are owned by the drive — by the organisation — so no individual's departure affects them. |
| **Domain-wide delegation** | Set `GOOGLE_IMPERSONATE_USER` to a real Workspace user (Step 9). | Needs Google Workspace and admin-console access. Files are owned by, and count against the quota of, that user. |

Doing neither is acceptable for local development only. If uploads start failing
in production with `storageQuotaExceeded`, apply one of the two fixes and
redeploy: no data is lost, and applications submitted in the meantime simply
could not attach a CV.

### No CORS rule, no bucket policy

There is nothing to configure on the storage side. The browser never talks to
Google: it asks for an upload ticket, `PUT`s the file to
`/api/uploads/<uploadId>` **on this site** (same origin), and the server
verifies the ticket signature, the exact byte length and the PDF structure
before forwarding the bytes to Drive.

Consequences, all of them simplifications from the previous release:

- no CORS rule to configure anywhere, and none to forget on a new preview or
  test environment;
- no public storage URL and no presigned links — nothing to leak;
- the Content-Security-Policy no longer needs a storage origin (§7);
- **but** the hosting platform's request-body limit now applies to CV size
  (§17).

### Folder layout and how documents are served

- `_staging/` — one file per in-flight upload, named `<uploadId>.pdf`. Anything
  left over 24 hours is deleted by the maintenance job (§8).
- `Applications/` and `TalentPool/` — the permanent documents, named so the
  folder is readable by a human: `APP-7F3A9C21 - Jane Doe - CV.pdf`. Claiming an
  upload *moves* the staged file (a metadata change; the bytes are never
  copied), which is also why a staged file cannot be claimed twice.
- Files are never shared with anyone and no Drive link is ever handed out. The
  admin portal streams them through `/api/admin/documents/<id>`, which requires
  an admin session and records the download in the audit log.
- The `Documents` tab is the index: it holds the Drive file id, the original
  file name, the size and the owning record. The bytes are in Drive, the
  metadata is in the sheet — which is why the two must be backed up together.

### Backups

Google keeps your data highly available; it does not protect you from a wrong
edit, a bad script or a deleted file. Take your own copies.

- **Spreadsheet, manually** (the minimum): **File → Make a copy** into a
  `Backups` folder on the same Shared Drive, and **File → Download → Microsoft
  Excel (.xlsx)** for a copy that does not live in Google. Do this at least
  weekly, and always before a retention purge, a release that changes the
  schema, or any bulk edit by hand.
- **Spreadsheet, automatically**: schedule a **Google Takeout** export (Drive,
  every 2 months for a year) for the off-Google copy, and/or add a small Apps
  Script timer on the spreadsheet that calls
  `DriveApp.getFileById(id).makeCopy("Careers backup " + date, backupFolder)`
  once a day. Keep 30 days of copies.
- **Revision history**: Sheets keeps its own version history
  (**File → Version history → See version history**), which is the fastest way
  to undo an accidental edit or a deleted range — often within seconds. It does
  not survive deletion of the file itself, and it is not a substitute for
  copies, but check it first for small mistakes.
- **Drive folder**: the documents are write-once PDFs, so a periodic copy is
  enough — Google Takeout, or `rclone copy` from a machine with read access to
  the folder, to off-Google storage. A Shared Drive also keeps deleted files in
  its trash for 30 days, and Drive keeps prior versions of a replaced file.
- **Keep them consistent**: copy the spreadsheet and the Drive folder at the
  same time. The `Documents` tab references Drive file ids; a restore that mixes
  two points in time shows documents that cannot be downloaded.
- **Off-Google copy**: everything above lives in one Google tenant. Keep at
  least the monthly `.xlsx` export and one Takeout archive somewhere else
  (company file server, the password manager's document vault).

### Restoring

1. Find the backup copy. **Make a copy of the backup** and work on that, so the
   backup itself stays untouched.
2. **Share the copy with the service account as an Editor** (§9, Step 6). A copy
   does not always inherit the original's sharing, and this is the most common
   reason a restore "does not work".
3. Point `GOOGLE_SHEETS_SPREADSHEET_ID` at the copy's id — **in staging first**,
   not in production.
4. Run `npm run sheets:check -- --no-env-files`: tabs, columns, and at least one
   active administrator.
5. Spot-check in the admin portal, **including a CV download** — that is what
   proves the `Documents` rows still match the files in the Drive folder.
6. Only then repoint production and redeploy.

Never restore on top of the live spreadsheet. Make a copy of its current state
first, however broken it looks: it is the only record of everything submitted
since the backup.

**Drill this quarterly.** Restore the latest backup into a scratch spreadsheet,
point a staging deployment at it, run `npm run sheets:check` and download one
CV. An untested backup is not a backup.

### Failing over to another spreadsheet

The same procedure covers a planned move (a spreadsheet that has grown too
large, a tenant migration) and an unplanned one:

1. Prepare the new spreadsheet: a restored copy, or an empty one with
   `npm run sheets:setup`.
2. Share it with the service account as Editor.
3. Change `GOOGLE_SHEETS_SPREADSHEET_ID` in the hosting dashboard and redeploy
   (an environment variable change alone does not take effect until a new
   deployment).
4. Verify: `npm run sheets:check` reports 0 errors, `/api/health` with the
   health-check token reports `ok`, the admin portal lists the expected jobs and
   applications, and one CV downloads.
5. Set the old spreadsheet to view-only for everyone so nothing writes to it by
   accident, and keep it until you are satisfied.

`GOOGLE_DRIVE_FOLDER_ID` normally stays the same across a spreadsheet failover.
If the Drive folder moves too, the `Documents` rows keep working as long as the
**files** keep their ids — moving a file between folders does not change its id;
copying it does.

---

## 10. Email (SMTP)

Messages sent by the site:

| Trigger | Recipients |
|---|---|
| Job application | Applicant (confirmation with reference) and `HR_NOTIFICATION_EMAIL` (link to the application) |
| Talent pool profile | Applicant and `HR_NOTIFICATION_EMAIL` |
| Status change with "Email the candidate" ticked | Applicant |
| Contact form | `CONTACT_NOTIFICATION_EMAIL` (Reply-To: the sender) |

1. Create SMTP credentials (Microsoft 365: an SMTP AUTH-enabled mailbox such
   as `careers@synergypharma.lk`) and set the `SMTP_*` variables (§4).
2. Every message is first written to the `EmailOutbox` tab, sent right after the
   response, and retried by maintenance (§8). A slow or failing mail server never
   fails a submission, and nothing is lost while SMTP is down. Delivered and
   given-up messages are removed 180 days later (§8). `/api/health` reports
   `email: missing` when SMTP is not configured.
3. **After deploying, submit a real test application** and confirm that the HR
   inbox and the applicant's inbox both receive their messages, then check the
   delivery status in the application's detail view.

### Abuse protection

Per-IP and per-email rate limits apply to every public form: applications 10/h
per IP and 5/h per email; talent profiles 5/h per IP and 3/day per email;
contact 5 per 15 min; uploads 40 per 15 min; sign-in 20 per 15 min per IP.

These counters are held **in memory, per server instance**. Writing a row to the
spreadsheet on every request would exhaust the Sheets API quota (§17) long
before it stopped anybody. The practical consequences: a deployment running *n*
instances tolerates up to roughly *n* times each limit in the worst case, and
the counters reset when an instance is recycled. They are a courtesy brake on
accidental floods, not a security control.

The controls that *are* durable, because they do not depend on counting:

- **one application per candidate per job**, enforced on the `Applications` tab:
  a second submission from the same email address for the same job is rejected,
  and if two arrive at once on different instances the losing row is marked
  superseded and hidden everywhere;
- **admin account lockout** after 5 consecutive failed sign-ins, recorded on the
  account row in `AdminUsers`;
- same-origin checks on every form endpoint and server-side validation of every
  field;
- **PDF-only uploads** (10 MB CV, up to 3 supporting documents of 5 MB), whose
  declared size and PDF structure are verified by the server *before* the bytes
  are sent to Drive, so a non-PDF never reaches storage;
- signed, single-use, 15-minute upload tickets, each valid for exactly one file
  of one declared length;
- a required consent checkbox.

---

## 11. SEO setup

Already implemented:

- Per-page title, description, canonical, Open Graph and Twitter tags (`src/lib/metadata.ts`).
- `sitemap.xml` (`src/app/sitemap.ts`) with the marketing pages and every open job, rendered per request.
- `robots.txt` disallowing `/careers/admin` and `/api/`; admin pages and API responses also send `X-Robots-Tag: noindex`.
- Organization JSON-LD on every page and `JobPosting` JSON-LD on each job page.
- Closed, draft and expired jobs return 404 and drop out of the sitemap.

After deploying, submit `https://www.synergypharma.lk/sitemap.xml` in Search Console (§12).

---

## 12. Google Analytics / Search Console setup

### Analytics (optional)

1. Create a GA4 property and copy the Measurement ID (`G-XXXXXXX`).
2. Set `NEXT_PUBLIC_GA_MEASUREMENT_ID` and redeploy. The Content-Security-Policy
   allows the GA scripts only when this variable is set (`src/proxy.ts`).

### Search Console

1. Add a Domain property for `synergypharma.lk`, verified with a DNS TXT record (§6).
2. **Sitemaps → Add a new sitemap** → `sitemap.xml`.
3. Use **URL Inspection** to request indexing of the home and careers pages.

These are unrelated to the service account in §9: analytics and Search Console
use ordinary Google sign-in, and neither needs access to the spreadsheet.

---

## 13. Automated tests and final QA checklist

### Automated tests

| Command | Needs | Covers |
|---|---|---|
| `npm run lint`, `npm run typecheck` | — | Static checks |
| `npm test` | — | Unit tests (validation, templates, logger, env checks, sheet encoding) |
| `npm run test:integration` | A dedicated **test** spreadsheet and Drive folder | Services against the real Google APIs; see `tests/integration/support/env.ts` (`INTEGRATION_GOOGLE_*` variables). Use a throwaway spreadsheet and folder: the suite clears them. |
| `npm run test:e2e` | A running production build (below) | API, desktop and mobile UI, accessibility, security and regression tests with Playwright |

End-to-end tests run against a deployment that uses a **dedicated** spreadsheet,
Drive folder and SMTP capture server — never production:

1. Start the SMTP capture server: `npm run test:smtp-sink -- --port 2626 --dir test-results/mailbox`.
2. Create a test spreadsheet and a test Drive folder and share both with the
   service account as Editor (§9, Steps 5-8). A separate service account for
   testing is better still. There is no CORS rule to add any more.
3. Export the site variables for the test services (`NEXT_PUBLIC_SITE_URL=http://localhost:3400`,
   the `GOOGLE_*` variables pointing at the test spreadsheet and folder,
   `SMTP_PORT=2626`, `SMTP_ALLOW_INSECURE_LOCAL=true`, `TRUSTED_IP_HEADER=x-real-ip`,
   `CRON_SECRET`, `HEALTHCHECK_TOKEN`, …), then run `npm run sheets:setup`, create an
   `admin` and an `hr` account with `npm run admin:user -- create … --password-stdin`,
   and `npm run build && npm run start -- -p 3400`.
4. Run the suite with `E2E_BASE_URL=http://localhost:3400`, `E2E_ADMIN_EMAIL`,
   `E2E_ADMIN_PASSWORD`, `E2E_HR_EMAIL`, `E2E_HR_PASSWORD`,
   `E2E_MAILBOX_DIR=test-results/mailbox`, `E2E_CLIENT_IP_HEADER=x-real-ip`,
   `E2E_CRON_SECRET`, `E2E_HEALTHCHECK_TOKEN`, plus the spreadsheet the site
   under test is using — `E2E_GOOGLE_SHEETS_SPREADSHEET_ID` and the
   service-account credentials (`E2E_GOOGLE_SERVICE_ACCOUNT_JSON`, or
   `E2E_GOOGLE_SERVICE_ACCOUNT_EMAIL` + `E2E_GOOGLE_PRIVATE_KEY`): `npm run test:e2e`.
   The tests that seed data (for example a job whose deadline has already passed)
   and the stored-state checks read the spreadsheet directly and skip themselves
   when those variables are absent.

Because the suite drives the real Sheets API, run it with a low worker count
(`E2E_WORKERS`) if you start seeing quota errors (§17).

### Final QA checklist (on the deployed URL)

- [ ] CI is green; `npm run sheets:check` against production reports 0 errors
- [ ] `/api/health` with the health-check token reports `ok` for the spreadsheet,
      the Drive folder, email and the schema
- [ ] The spreadsheet is shared with the service account as Editor, and with as
      few people as possible; link sharing is **Restricted**
- [ ] All pages load: `/`, `/about`, `/products`, `/quality`, `/facility`, `/contact`,
      `/careers`, a job page, `/privacy-policy`; an unknown URL shows the 404 page
- [ ] Admin: sign-in, wrong password rejected, forced password change for new accounts, sign-out
- [ ] Publish a test job → it appears on `/careers`, in the `Jobs` tab and in `sitemap.xml`
- [ ] Apply with a real PDF → success reference shown; applicant and HR emails arrive;
      the application appears in the admin portal and as a row in `Applications`; the CV is
      in the Drive `Applications/` folder and downloads from the portal; a status change
      with "Email the candidate" sends the update email; close the test job afterwards
- [ ] Apply with a CV close to the size limit → it is accepted (this is what
      catches a platform body cap, §17)
- [ ] Talent pool form and contact form: submissions arrive
- [ ] 375px, 768px and 1440px widths: no horizontal scrolling on public and admin pages
- [ ] Response headers include `Strict-Transport-Security`, `Content-Security-Policy`,
      `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`
- [ ] `sitemap.xml` and `robots.txt` reference the production domain
- [ ] The first maintenance run appears in the logs (`maintenance.completed`), and
      the `_staging` folder is empty afterwards
- [ ] Remove the test job, application and talent profile (archive, then delete permanently)

---

## 14. How to update the website after deployment

1. Branch, change, open a PR against `main`; CI must pass.
2. Vercel builds a preview deployment per PR (preview environment variables
   pointing at a preview spreadsheet and folder, never production data).
3. Merge → production redeploys automatically.
4. If the release adds a tab or a column (`src/lib/sheets-db/schema.ts`), run
   `npm run sheets:setup` against production right after it deploys. It is safe
   to run every time; `npm run sheets:check` tells you when you have forgotten.
5. Manage job postings in the admin portal (`/careers/admin`), not by typing in
   the spreadsheet and not in `src/data/jobs.json` (that file only provides
   optional sample drafts for empty development spreadsheets).

Editing the spreadsheet by hand works — the store reads the header row rather
than fixed column positions, so a reordered column or an extra one of your own
does no harm — but there are three rules: do not rename the tabs or the header
cells, do not delete rows (records are archived, never removed, and row numbers
are addresses), and do not sort a tab while anyone is using the portal.

---

## 15. How to rollback

- **Vercel**: Deployments → last known-good deployment → **⋯ → Promote to Production**.
- **Git**: `git revert <bad-commit>` and push (keeps history intact).
- **Data**: the spreadsheet is the database, and a code rollback does not undo a
  data change. For a small, recent mistake use the sheet's own **File → Version
  history** (§9, Backups) — it is fast and needs no deployment. For anything
  larger, restore a backup copy and repoint `GOOGLE_SHEETS_SPREADSHEET_ID`
  (§9, Restoring and Failing over). Before releasing anything that changes the
  schema, make a copy of the spreadsheet so this option exists.

---

## 16. Backup and disaster recovery procedure

1. **Source code**: in GitHub. To rebuild from scratch: clone, `npm ci`, set the §4
   variables, `npm run sheets:setup`, `npm run sheets:check`, create an
   administrator (§9), deploy.
2. **Data**: the backup copies from §9. In a full-loss scenario, copy the most
   recent backup, share the copy with the service account as Editor, point
   `GOOGLE_SHEETS_SPREADSHEET_ID` at it, redeploy and run
   `npm run sheets:check`.
3. **Documents**: the Drive folder — Shared Drive trash keeps deleted files for
   30 days, and the periodic copies in §9 cover everything older. Restore the
   documents and the spreadsheet to the same point in time.
4. **The Google account itself**: everything above lives in one Google tenant. A
   lost or suspended tenant is the scenario the off-Google `.xlsx` and Takeout
   copies (§9) exist for. Keep them somewhere the tenant cannot take with it.
5. **Secrets** — the **service-account JSON key**, SMTP credentials,
   `CRON_SECRET`, `HEALTHCHECK_TOKEN`: keep a copy in the company password
   manager, outside the hosting dashboard. Administrator passwords are personal;
   a lost one is reset by another administrator or with
   `npm run admin:user -- reset-password`.
6. **Recovery time**: with the secrets available and a recent backup copy, a full
   redeploy from zero takes well under an hour. Copying a spreadsheet takes
   seconds.

### Rotating the service-account key without downtime

A service account may hold up to 10 keys at once, and every one of them is
valid. That overlap is what makes a clean rotation possible — create the new key
first, delete the old one last.

1. **Create** — Cloud Console → **IAM & Admin → Service Accounts** → the account
   → **Keys → Add key → Create new key → JSON**. Delete nothing yet.
2. **Deploy** — update `GOOGLE_PRIVATE_KEY` and `GOOGLE_PRIVATE_KEY_ID` (or
   `GOOGLE_SERVICE_ACCOUNT_JSON`) in the hosting dashboard and redeploy. Both
   keys are valid at this moment, so instances still serving requests with the
   old key keep working until they are recycled. Nothing has to be re-shared:
   the account's email address has not changed, so the spreadsheet and the Drive
   folder are still shared with it.
3. **Verify** — `npm run sheets:check` against production, `/api/health` with the
   health-check token, and one real test upload. The log line
   `google.token_issued` confirms a fresh token was obtained with the new key.
4. **Delete the old key** — back in **Keys**, delete the previous key, in the
   same working session. A key that is not deleted is valid forever, and the
   whole point of the rotation is that the old one stops working.
5. **Update** the copy in the password manager and note the date.

Rotate annually, whenever someone with access to the key file leaves, and
immediately if the file was ever committed, emailed or pasted into a chat. In
that emergency case reverse the order — delete the compromised key first and
accept the outage; with no valid key deployed, job pages, application submission
and the admin portal all stop until the new key is live.

Replacing the service *account* (rather than its key) is a different job: a new
account has a new email address, so the spreadsheet and the Drive folder must be
shared with it (§9, Steps 6 and 8) **before** the new credentials are deployed,
and the old account removed from both afterwards.

---

## 17. Operational limits and quotas

A spreadsheet is a good database for this workload — a few hundred jobs, a few
thousand applications a year, a handful of HR users — as long as four limits are
respected. All four are handled by the code and the maintenance job; this
section is so you know what to watch and what breaks them.

### Google Sheets API quotas

Google allows **300 requests per minute per project** and **60 read requests per
minute per user** for the Sheets API. Both are per-minute limits that refill;
there is no daily cap, and none of this costs money.

The data layer stays well inside them:

- reads are **cached for 10 seconds per server instance**, and all the tabs a
  request needs are fetched together in a single `batchGet`, so a typical admin
  page view costs one API call rather than one per tab
  (`src/lib/sheets-db/table.ts`);
- writes are **batched** into one `batchUpdate` instead of one call per cell
  (`src/lib/google/sheets.ts`);
- `429` and `5xx` responses are retried with exponential backoff and full jitter,
  honouring `Retry-After`, so concurrent instances do not all come back at the
  same instant (`src/lib/google/request.ts`).

What counts is **requests, not rows or users**. Normal HR use is far below the
limit. What can breach it: a script that loops over records one at a time, an
uptime monitor hitting a page every few seconds, a Playwright run with many
workers, or a burst of cold serverless instances each loading the tabs for the
first time. The symptom is `429` in the `sheets.*` log events and slow admin
pages while requests are retried.

### The 10 million cell ceiling

**A Google Spreadsheet can hold at most 10,000,000 cells across all its tabs**,
and a single cell at most 50,000 characters. With roughly 25 columns per tab,
10,000 applications come to about 250,000 cells — comfortable, but only because
every growing tab has a bound:

| Tab | Grows with | Bounded by |
|---|---|---|
| `Applications`, `TalentPool` and their `Documents`, `Notes`, `StatusHistory`, `TalentActivity` rows | Candidate volume | The retention purge: `DATA_RETENTION_MONTHS` with `RETENTION_AUTO_PURGE=true` (§8). **With auto-purge off nothing is ever deleted** and the sheet grows for ever. |
| `AuditLog` | Every admin action | `AUDIT_RETENTION_MONTHS` (default 24). The maintenance job deletes older entries. Lower it if the portal is used heavily. |
| `EmailOutbox` | Every message sent | Rows are deleted 180 days after the message was delivered or given up. |
| `AdminSessions` | Every sign-in | The maintenance job removes expired sessions — there is no TTL index to do it. |
| `Jobs`, `AdminUsers`, `Settings` | Manual work | Nothing needed. |

**Every one of those bounds is applied by the maintenance job (§8).** If the
cron is not running, none of them happen: check for `maintenance.completed` in
the logs and alert if it is absent for a day. Watch the row counts that
`npm run sheets:check` prints; when `Applications` approaches six figures, plan
a failover to a fresh spreadsheet with the older years archived (§9, Failing
over) rather than waiting for the ceiling.

Long text is truncated to the 50,000-character cell limit rather than rejected,
but every field a candidate can fill in is already length-limited by
`src/lib/careers/validation.ts` well below it.

### Google Drive limits

Files count against the storage of whoever owns them — the Shared Drive's
organisation pool, or the impersonated user (§9). A 10 MB CV per application
means about 10 GB per 1,000 applications, so size the plan accordingly and let
the retention purge (§8) delete the documents of expired records. Google also
caps the number of items a Shared Drive may hold (500,000 at the time of
writing), which is far beyond this application's needs.

### CV size and the request-body cap

Since the browser uploads to `/api/uploads/<id>` on this site rather than
straight to storage, **the hosting platform's request-body limit applies to the
CV**. On Vercel, serverless functions reject bodies larger than about **4.5 MB**:
a larger CV never reaches the route, and the candidate sees a failed upload
rather than a validation message.

The application's own limits live in `UPLOAD_LIMITS` in
`src/lib/careers/constants.ts`:

- `cvMaxBytes` — 10 MB,
- `supportingMaxBytes` — 5 MB, `maxSupportingDocuments` — 3,
- `presignExpirySeconds` — 15 minutes for an upload ticket.

On a platform with a body cap, either **lower `cvMaxBytes` below the cap** (the
"up to N MB" wording on the application form is derived from this constant, so
the change reaches candidates automatically) or deploy on a host without one —
a plain Node server behind your own proxy, with `client_max_body_size` set
accordingly on nginx. Keep the two numbers consistent: a candidate should only
be told "10 MB" if 10 MB actually works.

### Rate limiting

Rate-limit counters are per server instance and held in memory (§10). They do
not survive a cold start and are not shared between instances. That is a
deliberate trade against the Sheets quota above; the durable anti-abuse controls
are the one-application-per-job rule and the admin account lockout.
