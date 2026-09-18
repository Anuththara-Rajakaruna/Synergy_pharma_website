# Production Deployment — www.synergypharma.lk

Target: **https://www.synergypharma.lk/**. This document reflects the
actual current DNS configuration of `synergypharma.lk` (looked up live,
2026-09-07) and exactly what needs to change to cut this codebase over to
it, without touching anything unrelated (company email in particular).

---

## 0. Current DNS configuration (as found — do not lose this)

| Record | Current value | Meaning |
|---|---|---|
| Nameservers | `ns1.dreamhost.com`, `ns2.dreamhost.com`, `ns3.dreamhost.com` | DNS is managed in your **DreamHost** account, regardless of where the domain is registered. |
| `synergypharma.lk` A | `173.236.240.235` | Apex currently points at a DreamHost-hosted site (the current live site). |
| `www.synergypharma.lk` A | `173.236.240.235` | Same — www also serves the current DreamHost-hosted site. |
| MX | `0 synergypharma-lk.mail.protection.outlook.com` | **Company email runs on Microsoft 365 / Exchange Online.** |
| TXT (SPF) | `v=spf1 include:spf.protection.outlook.com -all` | SPF record authorizing Microsoft 365 to send mail as `@synergypharma.lk`. |
| TTL | 60 seconds on the A records | Changes propagate fast — safe to roll back quickly if something goes wrong. |

**Hard rule for whoever touches DNS: do not modify the MX record or the SPF
TXT record.** Those belong to company email (Outlook/Microsoft 365) and are
completely unrelated to the website. Only the A/CNAME records for
`synergypharma.lk` and `www.synergypharma.lk` need to change.

**Heads up on cutover:** the apex and www currently serve a live site from
DreamHost. Changing the A/CNAME records below will take that site offline
and replace it with this codebase — that's the point of this deployment,
but it means the moment you update DNS is the moment the old site goes
away. With a 60s TTL, reverting is fast if you need to.

---

## 1. Hosting platform: Vercel (recommended)

This is a standard Next.js 16 App Router app (static marketing pages +
server-rendered careers portal/API routes) — Vercel is the natural fit
(built by the Next.js team, zero-config for this exact structure). Netlify
works identically via its official Next.js Runtime if you prefer it; every
step below has a Netlify equivalent noted in parentheses.

There is **no database server and no object storage to provision**. Every
record lives in one Google Spreadsheet and every CV in one Google Drive
folder (§7); the only stateful things you own are that spreadsheet, that
folder and the SMTP mailbox.

---

## 2. GitHub repository requirements

- Repo: `github.com/Anuththara-Rajakaruna/Synergy_Final` (the `origin` remote).
- Keep it **private** — it is a company production site.
- Production branch: `main`. Merge the careers portal work through a pull
  request once CI (`.github/workflows/ci.yml`) is green.

---

## 3. Deploy on Vercel — exact steps (external action required)

I do not have Vercel/Netlify/GitHub CLI access or stored credentials in
this environment, so I cannot click through this myself. Exact steps:

1. Go to [vercel.com](https://vercel.com) → sign in (or create an account)
   → **Add New → Project**.
2. **Import Git Repository** → authorize Vercel's GitHub App → select
   `Anuththara-Rajakaruna/Synergy_Final`.
3. Framework Preset: **Next.js** (auto-detected). Leave build command
   (`next build`) and output directory as default — nothing custom needed.
4. **Before clicking Deploy**, add the environment variables from §5 under
   "Environment Variables" (Production scope).
5. Click **Deploy**. Vercel builds and gives you a `*.vercel.app` URL —
   verify the site works there first.
6. **Project Settings → Domains → Add** → enter `www.synergypharma.lk` →
   set it as the **primary/production domain**.
7. Add `synergypharma.lk` (apex) as a second domain on the same project.
   Vercel will detect the apex + www pair and offer a **"Redirect to
   www.synergypharma.lk"** option for the apex — enable it. This gives you
   the apex→www redirect with zero code, and Vercel handles it at the edge.
8. Vercel shows you the exact A record (for the apex) and CNAME record (for
   www) to add — copy them for §4.

*(Netlify equivalent: **Add new site → Import an existing project** → same
GitHub authorization → **Site configuration → Domain management → Add a
domain** → same env vars under **Site configuration → Environment
variables** → Netlify's domain settings also offer an apex→www redirect
toggle.)*

---

## 4. DNS records to change (in your DreamHost DNS panel)

Log into DreamHost → **Websites → Manage Domains** (or the DNS panel for
`synergypharma.lk`) and change **only** these two records — leave the MX
and SPF TXT records exactly as they are:

| Record | Type | Host | Current value | New value |
|---|---|---|---|---|
| Apex | A | `synergypharma.lk` (`@`) | `173.236.240.235` | `76.76.21.21` (Vercel's anycast IP — **confirm the exact IP Vercel shows you in step 3.8**, this can change) |
| www | CNAME | `www` | `173.236.240.235` (A record) | `cname.vercel-dns.com.` (**confirm exact value Vercel shows you**) |

Do not change: the NS records, the MX record, or the SPF TXT record.

Because the A record TTL is already 60 seconds, propagation should complete
within a few minutes of saving the change.

---

## 5. Environment variables (Vercel, Production scope)

The full list with explanations is in `DEPLOYMENT.md` §4 (environment
variables). Production values:

| Variable | Production value |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | `https://www.synergypharma.lk` |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | The `client_email` from the service account key file, e.g. `synergy-careers@<project>.iam.gserviceaccount.com` (§7) |
| `GOOGLE_PRIVATE_KEY` | The `private_key` from the same key file, **including** the `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` lines (§7) |
| `GOOGLE_PRIVATE_KEY_ID` | Optional. The `private_key_id` from the key file; sent as the JWT `kid` so Google can tell rotated keys apart |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Alternative to the three rows above: the downloaded key file **verbatim**, or base64 of that file. It only fills in fields you did not set individually |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | The id from the sheet URL: `https://docs.google.com/spreadsheets/d/<THIS PART>/edit` (§7) |
| `GOOGLE_DRIVE_FOLDER_ID` | The id from the folder URL: `https://drive.google.com/drive/folders/<THIS PART>` (§7) |
| `GOOGLE_DRIVE_SHARED_DRIVE_ID` | The id of the Shared Drive that holds the folder. **Set this in production** — see the quota warning in §7 |
| `GOOGLE_IMPERSONATE_USER` | Only for the domain-wide-delegation alternative in §7, e.g. `careers@synergypharma.lk`. Leave empty otherwise |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Real SMTP credentials (§8) |
| `HR_NOTIFICATION_EMAIL` | `hr@synergypharma.lk` |
| `CONTACT_NOTIFICATION_EMAIL` | `info@synergypharma.lk` |
| `CRON_SECRET` | New random value: `openssl rand -hex 32` |
| `HEALTHCHECK_TOKEN` | New random value: `openssl rand -hex 32` |
| `DATA_RETENTION_MONTHS` / `RETENTION_AUTO_PURGE` | `12` / `false` until HR agrees to automatic deletion (`DEPLOYMENT.md` §8) |
| `AUDIT_RETENTION_MONTHS` | `24` (1–120). Bounds the `AuditLog` tab: a spreadsheet is capped at 10 million cells, so audit rows cannot be kept forever |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | GA4 ID, or empty to disable analytics |

**Pasting `GOOGLE_PRIVATE_KEY` into a dashboard.** The key is multi-line and
hosting dashboards mangle multi-line values in different ways, so three shapes
are accepted: real newlines, literal `\n` escapes, or base64 of the whole PEM.
If the dashboard refuses multi-line values, base64 the PEM (`base64 -w0 key.pem`)
and paste that. Surrounding quotes are stripped automatically. A key that is
truncated or re-wrapped still *looks* like a PEM and passes the variable check —
it only fails when a token is signed. See the `GOOGLE_PRIVATE_KEY` row in §13.

Do **not** set `AUTH_SECRET`, `ADMIN_PASSWORD` or `SMTP_ALLOW_INSECURE_LOCAL`:
the first two belong to the previous release (administrators now have their own
accounts), the last is for local development only. `MONGODB_URI`,
`MONGODB_DB_NAME`, `MONGODB_MAX_POOL_SIZE`, every `S3_*` variable and
`DATABASE_URL` / `PGSSLROOTCERT` went with the MongoDB/S3 backend — delete them
from the project if they are still set. Only the two `NEXT_PUBLIC_` variables
reach the browser; the service account key never leaves the server.

---

## 6. SSL / HTTPS

- Vercel issues and renews certificates for both `www.synergypharma.lk` and
  `synergypharma.lk` once DNS points at it, and redirects HTTP to HTTPS.
- `next.config.ts` sends `Strict-Transport-Security` (2 years,
  `includeSubDomains`, no `preload`) and the other security headers; the admin
  session cookie is `__Host-` prefixed, `Secure`, `HttpOnly` and `SameSite=Strict`.
- The Content-Security-Policy no longer needs a storage origin: CV uploads go to
  this application's own `/api/uploads/<id>` route, not to a bucket on another
  host.
- **After cutover, verify**: `https://www.synergypharma.lk` loads with a valid
  padlock, `http://www.synergypharma.lk` redirects to https, and
  `https://synergypharma.lk` redirects to `https://www.synergypharma.lk`.

---

## 7. Google Sheets, Google Drive and first administrator

Details for every step are in `DEPLOYMENT.md` §9 (data store, Drive and
administrator setup).

1. **Google Cloud project.** In [console.cloud.google.com](https://console.cloud.google.com)
   create (or pick) a project and enable **both** APIs under *APIs & Services →
   Library*: **Google Sheets API** and **Google Drive API**. Enabling one and
   forgetting the other is the `SERVICE_DISABLED` row in §13.
2. **Service account.** *IAM & Admin → Service Accounts → Create*. No project
   roles are needed — access is granted by sharing the two resources with it, not
   through IAM. Then *Keys → Add key → Create new key → JSON* and download the
   file: it holds `client_email`, `private_key` and `private_key_id` for §5.
   Store it in the company password manager and delete the download.
3. **The spreadsheet.** Create one empty Google Spreadsheet (name it e.g.
   "Synergy Careers Portal — Production"). **Share it with the service account's
   email address as an Editor.** Copy its id out of the URL into
   `GOOGLE_SHEETS_SPREADSHEET_ID`. Do not share it any more widely than the
   people allowed to read applicant data: every applicant's name, email, phone
   number and HR notes end up in it.
4. **The Drive folder, on a Shared Drive.** Create a Shared Drive (Google
   Workspace → Drive → Shared drives → New), create one folder inside it for CVs,
   **add the service account as a member with Content manager (Editor) access**,
   and set both `GOOGLE_DRIVE_FOLDER_ID` (the folder) and
   `GOOGLE_DRIVE_SHARED_DRIVE_ID` (the drive).

   > ### ⚠ The one that bites in production
   >
   > **A Google service account has no Drive storage quota of its own.** If
   > `GOOGLE_DRIVE_FOLDER_ID` points at a folder in somebody's personal *My
   > Drive*, uploads work for a while and then start failing with
   > `storageQuotaExceeded`, because the file has no owner whose quota can carry
   > the bytes. There are exactly two supported fixes:
   >
   > **(a) Put the folder on a Shared Drive** and set
   > `GOOGLE_DRIVE_SHARED_DRIVE_ID` (recommended; requires Google Workspace).
   > Files are then owned by the Shared Drive and the quota question disappears.
   >
   > **(b) Use domain-wide delegation.** In the Workspace Admin console delegate
   > the service account's client ID for the scopes
   > `https://www.googleapis.com/auth/spreadsheets` and
   > `https://www.googleapis.com/auth/drive`, then set `GOOGLE_IMPERSONATE_USER`
   > to a real Workspace user (e.g. `careers@synergypharma.lk`). Files are then
   > created as, and owned by, that user and count against their quota.
   >
   > Doing neither is not a "simpler" configuration — it is a deployment that
   > will stop accepting CVs.

5. **Create the tabs, the first administrator, and verify.** From a machine with
   the production variables exported:
   ```
   npm run sheets:setup -- --no-env-files
   npm run admin:user -- create --email <hr manager> --name "<name>" --role admin --no-env-files
   npm run sheets:check -- --no-env-files
   ```
   `sheets:setup` creates every tab (`Jobs`, `Applications`, `TalentPool`,
   `Documents`, `Notes`, `StatusHistory`, `TalentActivity`, `AdminUsers`,
   `AdminSessions`, `AuditLog`, `EmailOutbox`, `Settings`), writes and freezes
   the header rows and records the schema version. It is idempotent: a tab that
   already exists is left alone and a column added by a later release is
   appended, so it is safe to re-run against a spreadsheet full of live data.
   `admin:user` prints a temporary password that must be changed at first
   sign-in. `sheets:check` must report 0 errors.
6. **CV uploads need no bucket and no CORS rule.** The browser PUTs the file to
   this application's `/api/uploads/<id>` route, which checks the signed upload
   ticket, verifies the PDF structure and forwards the bytes to Drive. Because
   the bytes now pass through the server, **any platform limit on serverless
   request bodies becomes the real CV size limit** — Vercel caps a request body
   at about **4.5 MB**, and a larger upload is rejected by the platform before
   the route ever runs. The application's own limit is `UPLOAD_LIMITS.cvMaxBytes`
   in `src/lib/careers/constants.ts` (10 MB). On Vercel, lower it to something
   under the platform cap (4 MB is a safe value) so candidates get the app's
   clear "file is too large" message instead of an opaque platform error — or
   deploy somewhere without that cap.
7. **Backups.** Google keeps version history for the spreadsheet and for every
   Drive file, and deleted Drive files sit in the trash for 30 days — but nothing
   protects against someone deleting the spreadsheet itself. Schedule a periodic
   *File → Make a copy* of the spreadsheet into a separate backup folder (or
   *File → Download → Microsoft Excel* into the company file store), and restrict
   who manages the Shared Drive. See §12.

---

## 8. Email (SMTP) and scheduled maintenance

1. Create SMTP credentials — company email already runs on Microsoft 365, so an
   SMTP AUTH-enabled mailbox such as `careers@synergypharma.lk` fits naturally
   (or Postmark/SendGrid/SES for transactional mail). Add the provider's DKIM
   record; the existing SPF record only authorizes Microsoft 365.
2. Emails sent: application and talent-pool confirmations to the applicant, alerts
   to `HR_NOTIFICATION_EMAIL`, status updates when HR ticks "Email the candidate",
   and contact form messages to `CONTACT_NOTIFICATION_EMAIL`.
3. Every email is written to the `EmailOutbox` tab first and sent right after the
   response; failures are retried by the maintenance cron
   (`/api/cron/maintenance`, every 6 hours from `vercel.json`, authorized by
   `CRON_SECRET`). A submission never fails because of email.
4. The same maintenance run sweeps abandoned uploads out of the Drive staging
   folder and applies the retention rules (`DATA_RETENTION_MONTHS`,
   `AUDIT_RETENTION_MONTHS`).
5. **After deploying, submit a real test application** and confirm both the HR
   inbox and the applicant's inbox receive their messages.

---

## 9. What is needed before this can go live

- [ ] Pull request with the careers portal work merged into `main` (CI green).
- [ ] **Vercel account** connected to the GitHub repo (§3); Pro plan, or a daily cron schedule on Hobby.
- [ ] **DreamHost DNS panel access** to change the two A/CNAME records (§4).
- [ ] **Google Cloud project** with the Sheets API *and* the Drive API enabled, plus a **service account JSON key** (§7).
- [ ] **The production spreadsheet**, shared with the service account as **Editor** (§7).
- [ ] **A Shared Drive** holding the CV folder with the service account as a member — or domain-wide delegation plus `GOOGLE_IMPERSONATE_USER` (§7).
- [ ] **SMTP credentials** for `careers@synergypharma.lk` (or another sender) (§8).
- [ ] The name and email of the first portal administrator (§7).
- [ ] A decision on the CV size limit if you deploy on Vercel: `UPLOAD_LIMITS.cvMaxBytes` vs. the ~4.5 MB body cap (§7.6).
- [ ] HR's decision on automatic deletion after 12 months (`RETENTION_AUTO_PURGE`).
- [ ] Optional: a **GA4 property** for analytics.

---

## 10. How to update the website after deployment

1. Branch → PR against `main` → CI and a Vercel preview deployment (preview
   environment variables and a **separate scratch spreadsheet**, never the
   production one) → merge → production redeploys.
2. If the release adds or renames columns in `src/lib/sheets-db/schema.ts`, run
   `npm run sheets:setup` against production right after it deploys (take a copy
   of the spreadsheet first). Until it is run, the new columns are logged as
   `sheets.columns_missing` and read back empty.
3. Manage job postings in the admin portal (`/careers/admin`).

## 11. How to rollback

- **Vercel**: Project → Deployments → pick the last known-good deployment →
  **⋯ → Promote to Production** (instant, no rebuild).
- **Netlify**: Site → Deploys → select a prior deploy → **Publish deploy**.
- **Git-level**: `git revert <bad-commit>` and push (preserves history;
  avoid `git reset --hard` on a shared branch).
- **DNS-level**: if the cutover itself causes a problem, revert the A/CNAME
  records in DreamHost back to `173.236.240.235` — with the 60s TTL this
  takes effect within minutes.
- **Data-level**: the spreadsheet keeps its own history — *File → Version history
  → See version history*, pick a timestamp, **Restore this version**. Do that
  only with the site quiet or outside working hours: restoring rewrites rows the
  running app may be addressing.

## 12. Backup & disaster recovery

- **Source code**: GitHub. Full rebuild: clone → `npm ci` → set the variables (§5)
  → `npm run sheets:setup` → create an administrator → deploy.
- **Records (the spreadsheet)**: Google's version history covers edits and
  accidental row deletions. Against loss of the whole file, keep scheduled copies
  (§7.7) in a separate folder, retained at least 30 days.
- **Applicant documents (Drive)**: files keep version history and a 30-day trash.
  On a Shared Drive, restrict *Manager* membership so nobody can empty it by
  accident.
- **Secrets**: keep the service account JSON key, the SMTP credentials,
  `CRON_SECRET` and `HEALTHCHECK_TOKEN` in the company password manager, outside
  Vercel. Rotate the service account key by adding a second key in the Cloud
  console, updating the variables, redeploying, then deleting the old key.

**Restore procedure.** There is no database to restore and no connection string
to repoint. A restore means putting a known-good spreadsheet and folder back in
front of the same service account:

1. Put the site into a quiet period (or roll the deployment back) so nothing is
   writing while you work.
2. **Rows lost or corrupted, file intact** — open the spreadsheet, *File →
   Version history → See version history*, select the last good timestamp and
   **Restore this version**. Nothing in the environment changes; running
   instances pick the data up within the 10-second read cache.
3. **Spreadsheet deleted or damaged beyond its history** — restore it from the
   Drive trash if it is still there; otherwise open the most recent backup copy,
   *File → Make a copy* into the production folder, and **share the copy with
   `GOOGLE_SERVICE_ACCOUNT_EMAIL` as an Editor**. A copy does not inherit the
   original's sharing — this is the step people miss. Put the copy's id into
   `GOOGLE_SHEETS_SPREADSHEET_ID` and redeploy so the new value is picked up.
4. Run `npm run sheets:setup -- --no-env-files` against the restored sheet to
   re-create anything missing, then `npm run sheets:check -- --no-env-files`;
   it must report 0 errors.
5. **CV files** — restore individual files from the Drive trash or from a file's
   version history. A `Documents` row whose Drive file is gone shows in the admin
   portal as missing rather than breaking the page, so records and files can be
   restored independently.
6. Verify end to end: sign in to `/careers/admin`, open a recent application,
   download its CV, and submit one test application.

## 13. Troubleshooting

Vercel → Project → Logs shows one JSON line per event; search for the event names below.
`GET /api/health` with `Authorization: Bearer <HEALTHCHECK_TOKEN>` checks the
spreadsheet, the Drive folder and the email configuration at once. Google's
failures are logged with their machine-readable `reason` (`PERMISSION_DENIED`,
`SERVICE_DISABLED`, `storageQuotaExceeded`, `RESOURCE_EXHAUSTED`) and never with
response bodies, so nothing applicant-related reaches the logs.

| Symptom | Likely cause | Fix |
|---|---|---|
| Site doesn't load on the new domain after DNS change | Propagation in progress, or wrong IP/CNAME value | Wait a few minutes (TTL is 60s); re-check the values Vercel showed in step 3.8 |
| Everything that touches data returns 500 "Something went wrong", immediately and consistently | `store.misconfigured` / `config.problem`: a `GOOGLE_*` variable is missing or malformed. The log entry names the variable | Fix the variable it names, redeploy, then run `npm run sheets:check` |
| 500s and `google.token_issued` never appears in the logs; the error mentions signing a token | Malformed `GOOGLE_PRIVATE_KEY` — truncated, re-wrapped by the dashboard, or missing the BEGIN/END lines. The variable check only proves it *looks* like a PEM; signing the JWT assertion is where a broken key actually fails | Re-paste the `private_key` field exactly as downloaded (literal `\n` escapes are fine), or paste base64 of the whole PEM, or use `GOOGLE_SERVICE_ACCOUNT_JSON`. If Google rejects the assertion itself, also check the server clock |
| 500s; log shows `google.request_rejected` with `status: 403` and `reason: "PERMISSION_DENIED"` | **The spreadsheet or the Drive folder was never shared with the service account.** Creating them is not enough — they are ordinary Google files and the service account is just another account | Spreadsheet → Share → add `GOOGLE_SERVICE_ACCOUNT_EMAIL` as **Editor**. Drive folder (or the Shared Drive) → add the same address as **Content manager / Editor** |
| 500s; log shows `google.request_rejected` with `reason: "SERVICE_DISABLED"` or `"accessNotConfigured"` | The Google Sheets API or the Google Drive API is not enabled in the Cloud project | Cloud console → APIs & Services → Library → enable **both** *Google Sheets API* and *Google Drive API*, then retry (it takes a minute or two to propagate) |
| Health check reports `spreadsheet_not_found` or `folder_not_found`; log shows a 404 for a `sheets.*` / `drive.*` operation | `GOOGLE_SHEETS_SPREADSHEET_ID` or `GOOGLE_DRIVE_FOLDER_ID` points at the wrong resource, the file was trashed or moved — **or it was never shared with the service account**, which Google often reports as "not found" rather than as a permission error | Re-copy the id out of the URL (`/spreadsheets/d/<id>/edit`, `/drive/folders/<id>`), check the file is not in the trash, and confirm the sharing step from the `PERMISSION_DENIED` row above |
| CV upload fails; log shows `drive.upload_failed` with `reason: "storageQuotaExceeded"` | The Drive folder is in a personal *My Drive* and the service account has no storage quota of its own (§7) | Move the folder to a **Shared Drive** and set `GOOGLE_DRIVE_SHARED_DRIVE_ID`, **or** set up domain-wide delegation and set `GOOGLE_IMPERSONATE_USER`. Redeploy after either change |
| CV upload fails only for larger PDFs, with a 413 and nothing in the application logs | The platform's request body cap (Vercel ≈ 4.5 MB) rejects the PUT before the route runs — CV bytes pass through the app now, not to a bucket (§7.6) | Lower `UPLOAD_LIMITS.cvMaxBytes` in `src/lib/careers/constants.ts` below the platform cap so candidates get a clear message, or host somewhere without the cap |
| Slow pages and intermittent 503 "temporarily unavailable" under load; repeated `google.request_retry`, then `google.request_failed` with `status: 429` and `reason: "RESOURCE_EXHAUSTED"` | Google Sheets quota: **300 requests/minute/project** and **60 reads/minute/user**. Usually a burst of admin activity, a too-frequent cron, or another app sharing the same Cloud project | Backoff usually absorbs it. If it persists: give this app its own Cloud project, raise the per-minute quota in *APIs & Services → Quotas*, and avoid bulk actions at peak times. Reads are already cached for 10 s and writes batched |
| Pages or API return 503 "temporarily unavailable" with `google.request_failed` and a 5xx status | Google Sheets/Drive outage, or the server could not reach Google | Check the [Google Workspace Status Dashboard](https://www.google.com/appsstatus). The app retries with backoff; queued emails and writes resume on their own |
| A field reads back empty in the admin portal although the sheet has the data; log shows `sheets.columns_missing` | A header cell in row 1 was renamed or deleted by hand, or a release added a column and `sheets:setup` was not re-run | `npm run sheets:setup` repairs the header row (it appends, it does not overwrite). Never edit row 1 by hand |
| `sheets.duplicate_reconciled` appears in the logs | Two instances appended a row for the same key at the same moment; the earlier row won and the later one was marked superseded. Informational — Sheets has no unique index, so this is the designed outcome | No action. If it happens constantly, look for a client retrying submissions |
| No confirmation/HR emails | `email.retry_scheduled` or `email.failed` entries: wrong SMTP credentials, sender not allowed, or the maintenance cron not running | Fix the SMTP settings; messages queued in the `EmailOutbox` tab are retried by the next maintenance run |
| Nobody can sign in to the admin portal | No administrator account was created | `npm run admin:user -- create … --role admin` (§7) |
| An administrator is locked out | Too many wrong passwords (temporary account lockout) or a forgotten password | Wait for the lock to expire, or another administrator resets the password (Team tab) |
| The same candidate appears twice under one job | The one-application-per-job rule is enforced when the row is written, but a row edited or pasted into the sheet by hand bypasses it | Check whether anyone edited the spreadsheet directly; keep all editing in the admin portal |
| Company email (`@synergypharma.lk`) stops working | MX/SPF record accidentally changed | Restore MX to `synergypharma-lk.mail.protection.outlook.com` and SPF TXT to `v=spf1 include:spf.protection.outlook.com -all` |
