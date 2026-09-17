# Production Deployment Guide — Synergy Pharmaceutical Corporation Website

This is a Next.js 16 (App Router) application. The public marketing pages
(home, about, products, quality, facility, contact) and the careers portal
(job listings, applications, talent pool, admin portal) run in one
deployment. Careers data lives in MongoDB (via Mongoose); CVs and supporting
documents live in a private S3-compatible bucket; email goes out over SMTP
through a MongoDB-backed outbox.

`PRODUCTION_DEPLOYMENT.md` covers the www.synergypharma.lk cut-over (current
DNS, what to change, what not to touch). This guide covers everything else.

---

## 1. Prerequisites

Before deploying, have accounts ready for:

- **GitHub** — source control (`origin` points at
  `github.com/Anuththara-Rajakaruna/Synergy_Final`).
- **Vercel** (recommended) or another Node.js 20.19+ host.
- **MongoDB 6.0+** — [MongoDB Atlas](https://www.mongodb.com/atlas) is
  recommended (a dedicated M10+ cluster for continuous backups).
- **An S3-compatible object storage provider** — Cloudflare R2 (no egress
  fees, recommended), AWS S3, Backblaze B2 or MinIO — for applicant documents.
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
   audit, and integration tests against MongoDB + S3-compatible storage) to pass.

---

## 3. Hosting setup (Vercel — recommended)

1. [vercel.com](https://vercel.com) → **Add New → Project** → import the repository.
2. Framework preset **Next.js** (auto-detected); build command `npm run build`.
3. Set the **Production Branch** to `main`.
4. Add every variable from §4 in **Project Settings → Environment Variables**
   (Production scope). Preview deployments must use a separate database and
   bucket, never production data.
5. **Plan and cron schedule.** `vercel.json` runs `/api/cron/maintenance` every
   6 hours (§8). Vercel's Hobby plan only allows cron jobs that run once a day
   and rejects the deployment otherwise; on Hobby change the schedule to a
   daily one (e.g. `0 2 * * *`), on Pro keep it.
6. Deploy, then verify on the `*.vercel.app` URL (§13) before attaching the
   custom domain.

Other Node.js hosts work too (`npm ci && npm run build && npm run start`).
Behind your own reverse proxy set `TRUSTED_IP_HEADER` (§4), and call the
maintenance endpoint from an external scheduler (§8).

---

## 4. Environment variables

`.env.example` documents every variable with examples. The server validates
the configuration at start-up and logs each problem as a `config.problem`
event; `npm run db:check` prints the same report. Only the two `NEXT_PUBLIC_`
variables reach the browser (they are compiled into the build: redeploy after
changing them).

| Variable | Required | Production value / notes |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | Yes | `https://www.synergypharma.lk` (https, no trailing slash). Canonical URLs, sitemap, email links and the same-origin check on form submissions derive from it. |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | No | GA4 ID `G-…`; empty disables analytics (§12). |
| `MONGODB_URI` | Yes | Atlas SRV string of a user with `readWrite` on `MONGODB_DB_NAME` only. |
| `MONGODB_DB_NAME` | Yes | e.g. `synergy_website`. There is no default. |
| `MONGODB_MAX_POOL_SIZE` | No | 1-200, default 10 per server instance. |
| `S3_BUCKET` | Yes | Private bucket for applicant documents (§9). |
| `S3_REGION` | AWS only | Real region for AWS S3 (e.g. `ap-south-1`); defaults to `auto` when `S3_ENDPOINT` is set. |
| `S3_ENDPOINT` | R2/MinIO/B2 | Provider endpoint, e.g. `https://<account-id>.r2.cloudflarestorage.com`. Empty for AWS S3. |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | Yes | A key limited to this bucket (GetObject, PutObject, DeleteObject, ListBucket). |
| `S3_PUBLIC_ENDPOINT` | No | Only when browsers must use a different endpoint than the server. |
| `S3_FORCE_PATH_STYLE` | No | Defaults to true with `S3_ENDPOINT`, false for AWS S3. |
| `S3_SERVER_SIDE_ENCRYPTION` | No | AWS S3 only: `AES256`, `aws:kms` or `aws:kms:dsse`. |
| `SMTP_HOST` / `SMTP_PORT` | Yes | Provider host; port 587 (STARTTLS, enforced) or 465 with `SMTP_SECURE=true`. |
| `SMTP_SECURE` | No | `true` for implicit TLS on 465. |
| `SMTP_USER` / `SMTP_PASS` | Usually | Leave both empty only for a relay that authenticates by IP. |
| `SMTP_FROM` | Yes | e.g. `Synergy Careers <careers@synergypharma.lk>` — an address the SMTP account may send as. |
| `SMTP_ALLOW_INSECURE_LOCAL` | **Never** | Local development only; remove in production. |
| `HR_NOTIFICATION_EMAIL` | Yes | New-application and talent-pool alerts, e.g. `hr@synergypharma.lk` (comma-separated, up to 10). |
| `CONTACT_NOTIFICATION_EMAIL` | No | Contact form recipients, e.g. `info@synergypharma.lk`; defaults to `HR_NOTIFICATION_EMAIL`. |
| `CRON_SECRET` | Yes | At least 32 characters (`openssl rand -hex 32`). Authorizes `/api/cron/maintenance` (§8); Vercel Cron sends it automatically. Empty disables maintenance. |
| `HEALTHCHECK_TOKEN` | Recommended | At least 32 characters. Unlocks the deep checks of `/api/health` (bucket access, indexes) for uptime monitoring. |
| `TRUSTED_IP_HEADER` | Non-Vercel hosts | Header your proxy sets and overwrites (`x-real-ip` for nginx, `cf-connecting-ip` for Cloudflare). Not needed on Vercel. Rate limits and audit logs use the client IP. |
| `TRUSTED_PROXY_COUNT` | No | 1-10, default 1: proxies to skip in `X-Forwarded-For` when `TRUSTED_IP_HEADER` is unset. |
| `DATA_RETENTION_MONTHS` | No | 1-120, default 12 (the privacy policy promises 12 months). |
| `RETENTION_AUTO_PURGE` | No | `false` (default) only reports overdue records; `true` deletes them. Read §8 first. |
| `DATABASE_URL` / `PGSSLROOTCERT` | Migration only | Legacy PostgreSQL source for `npm run db:migrate:postgres` (§9). Remove afterwards. |

`AUTH_SECRET` and `ADMIN_PASSWORD` from the previous release are **no longer
used**: administrators sign in with individual accounts (§9). Delete them from
the hosting dashboard; the start-up check warns while they are still set.

---

## 5. Domain configuration

1. In Vercel: **Project Settings → Domains** → add `www.synergypharma.lk` and
   `synergypharma.lk`, with the apex redirecting to `www`.
2. `NEXT_PUBLIC_SITE_URL` must be exactly the canonical form
   (`https://www.synergypharma.lk`). Form submissions from any other origin
   are rejected as cross-site.
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
  Content-Security-Policy on every page.
- The admin session cookie is `__Host-synergy_admin`: `Secure`, `HttpOnly`,
  `SameSite=Strict`, 8-hour absolute and 1-hour idle lifetime, stored hashed
  in MongoDB (`src/lib/auth/session.ts`).
- The start-up check reports an error when `NEXT_PUBLIC_SITE_URL` is not https
  in production.

---

## 8. Backend, scheduled maintenance and data retention

The API routes (`src/app/api/**`) run in the same deployment; there is no
separate backend service.

### Scheduled maintenance

`GET/POST /api/cron/maintenance` with `Authorization: Bearer <CRON_SECRET>`:

1. deletes browser uploads under `incoming/` that were never submitted (older than 24 hours),
2. applies the data retention rules below,
3. delivers queued email and retries failed deliveries (back-off 1 min, 5 min,
   30 min, 2 h, 6 h; a message is marked failed after 6 attempts).

On Vercel, `vercel.json` schedules it (see §3 for the Hobby plan limit). Elsewhere
call it from any scheduler, e.g.
`curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://www.synergypharma.lk/api/cron/maintenance`,
or run `npm run jobs:maintenance` on a machine with the production environment.
Without it, emails that failed on the first attempt are never retried.

### Data retention

Applications and talent profiles are due for deletion `DATA_RETENTION_MONTHS`
after they were **submitted** (`createdAt`). With `RETENTION_AUTO_PURGE=false`
the maintenance job only logs how many records are overdue. With `true` it
permanently deletes overdue records, their documents in storage and their
queued emails, and writes a `retention.purge` audit entry for each.

**Before enabling auto-purge on a database with migrated PostgreSQL data:**
imported records keep their original submission dates, so every record older
than the retention period is deleted on the next run. Export anything HR must
keep (Admin → Activity Log → candidate data export, or the CSV exports) and
agree the purge with HR first.

### Monitoring

- `GET /api/health` → `200 {"status":"ok"|"degraded"}` (503 when the database is down).
- With `Authorization: Bearer <HEALTHCHECK_TOKEN>` it also verifies bucket access and indexes.
- Logs are one JSON object per line (`level`, `event`, ids only — never
  applicant names, emails or file names). Alert on `level:"error"`, especially
  `email.failed`, `retention.purge_failed` and `config.problem`.

---

## 9. Database, storage and administrator setup

### MongoDB

1. Create the cluster (Atlas **M10 or larger** for continuous backups).
2. **Database Access**: a dedicated user with `readWrite` on the one database
   (e.g. `synergy_website`) — not `atlasAdmin` or `readWriteAnyDatabase`.
3. **Network Access**: Vercel functions have no fixed egress IPs, so allow
   `0.0.0.0/0` with a strong password, or use the Vercel–Atlas integration.
4. From a machine whose environment points at production, run:
   ```
   npm run db:setup -- --no-env-files --confirm=synergy_website
   npm run db:check -- --no-env-files
   ```
   `db:setup` applies pending data migrations, then creates every collection
   and index (unique constraints and TTL indexes included). It is safe to
   re-run and must be re-run after any release that changes `src/models/` or
   adds a migration: production builds do not create indexes. It never seeds
   jobs unless you pass `--seed-sample-jobs` (drafts, empty collection only).
   `db:check` is read-only and exits non-zero on configuration problems,
   missing indexes, pending migrations or when no active administrator exists.
   `--no-env-files` makes sure a local `.env.local` is not used by mistake.

### Object storage bucket

1. Create a **private** bucket (no public access, no public URL) and enable **versioning**.
2. Create an access key limited to that bucket.
3. Add a **CORS rule**. Browsers upload documents straight to the bucket with
   short-lived presigned URLs; without this rule every application fails at the
   upload step:
   ```json
   [
     {
       "AllowedOrigins": ["https://www.synergypharma.lk"],
       "AllowedMethods": ["PUT"],
       "AllowedHeaders": ["content-type"],
       "ExposeHeaders": ["etag"],
       "MaxAgeSeconds": 3000
     }
   ]
   ```
   (Cloudflare R2: bucket → Settings → CORS policy. AWS S3: bucket →
   Permissions → CORS.) Add preview origins only to preview buckets.
4. Layout: `incoming/` holds uploads until the form is submitted; accepted files
   are copied to `applications/<id>/` or `talent-pool/<id>/`. Documents are
   only ever served through `/api/admin/documents/<id>`, which requires an
   admin session, records the download in the audit log and redirects to a
   60-second presigned URL that forces a download.

### First administrator

```
npm run admin:user -- create --email hr.manager@synergypharma.lk --name "Full Name" --role admin --no-env-files
```

It prints a temporary password once; the user must choose a new one at first
sign-in. Further accounts are created in the admin portal (**Team** tab) or with
the same command (`--role hr` for recruiters, who cannot manage accounts, view
the activity log or permanently delete records). Other commands: `list`,
`reset-password`, `deactivate`, `activate`, `set-role`. The last active
administrator can never be deactivated or demoted.

### Migrating existing data from PostgreSQL

If the site previously ran on the PostgreSQL release, import its data **before**
opening the new deployment to traffic:

1. Take a fresh backup of the PostgreSQL database and run `npm run db:setup` (above).
2. Dry run (validates every record, reports conflicts, writes nothing):
   ```
   npm run db:migrate:postgres -- --dry-run --check-files --no-env-files
   ```
3. Import:
   ```
   npm run db:migrate:postgres -- --backup-dir ./pg-backup --confirm=synergy_website --no-env-files
   ```
   PostgreSQL is read in one read-only transaction. `--backup-dir` first saves
   every row read (NDJSON plus a checksummed manifest). Every document is
   validated before anything is written; afterwards the script checks that each
   source row maps to exactly one record. Re-running skips records that were
   already imported. Duplicate submissions (same email and job, differing only in
   letter case) are merged into one record with the extra details kept as notes.
4. Run `npm run db:check`, spot-check the admin portal (including CV downloads),
   then switch traffic. Keep PostgreSQL read-only as a fallback until you are
   satisfied, then remove `DATABASE_URL`.

Job IDs (URL slugs) are unchanged. Applications and talent profiles get new ids;
their PostgreSQL ids are kept in `legacyIds`. CV files are not copied: the
imported documents reference the existing `cvs/…` and `talent-pool/…` keys, so
keep using the same bucket.

### Backups

- **MongoDB Atlas**: enable **Continuous Cloud Backup** (point-in-time
  recovery), 30-day retention recommended. Self-hosted: schedule
  `mongodump --uri "$MONGODB_URI" --db synergy_website --gzip --archive=…` to
  off-site storage at least daily.
- **Restore** into a **separate** cluster, point a staging deployment at it,
  run `npm run db:check`, and only then repoint production. Never restore on top
  of the live database without a fresh snapshot of its current state.
- **Drill** quarterly: restore the latest backup into a scratch cluster and run
  `npm run db:check` against it. An untested backup is not a backup.
- **Documents**: bucket versioning makes deletes and overwrites recoverable;
  enable cross-region replication once the portal has real applicant volume.
  A database restore and the bucket must be restored to the same point in time
  for document links to match.

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
2. Every message is first stored in the `email_outbox` collection, sent right
   after the response, and retried by maintenance (§8). A slow or failing mail
   server never fails a submission, and nothing is lost while SMTP is down.
   `/api/health` reports `email: missing` when SMTP is not configured.
3. **After deploying, submit a real test application** and confirm that the HR
   inbox and the applicant's inbox both receive their messages, then check the
   delivery status in the application's detail view.

Abuse protection: per-IP and per-email rate limits stored in MongoDB (applications
10/h per IP and 5/h per email; talent profiles 5/h per IP and 3/day per email;
contact 5 per 15 min; uploads 40 per 15 min; sign-in 20 per 15 min per IP plus
account lockout), same-origin checks on every form endpoint, server-side
validation, PDF-only uploads (10 MB CV, up to 3 supporting documents of 5 MB)
verified by size and PDF structure before they are accepted, and a required
consent checkbox.

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

---

## 13. Automated tests and final QA checklist

### Automated tests

| Command | Needs | Covers |
|---|---|---|
| `npm run lint`, `npm run typecheck` | — | Static checks |
| `npm test` | — | Unit tests (validation, templates, logger, env checks, migration mapping) |
| `npm run test:integration` | MongoDB and an S3-compatible server | Services against real databases; see `tests/integration/support/env.ts` (`INTEGRATION_*` variables; the database name must end in `_test` because it is dropped) |
| `npm run test:e2e` | A running production build (below) | API, desktop and mobile UI, accessibility, security and regression tests with Playwright |

End-to-end tests run against a deployment that uses a **dedicated** database,
bucket and SMTP capture server — never production:

1. Start the SMTP capture server: `npm run test:smtp-sink -- --port 2626 --dir test-results/mailbox`.
2. Create a test bucket with the CORS rule from §9 for the test origin.
3. Export the site variables for the test services (`NEXT_PUBLIC_SITE_URL=http://localhost:3400`,
   `SMTP_PORT=2626`, `SMTP_ALLOW_INSECURE_LOCAL=true`, `TRUSTED_IP_HEADER=x-real-ip`,
   `CRON_SECRET`, `HEALTHCHECK_TOKEN`, …), then run `npm run db:setup`, create an
   `admin` and an `hr` account with `npm run admin:user -- create … --password-stdin`,
   and `npm run build && npm run start -- -p 3400`.
4. Run the suite with `E2E_BASE_URL=http://localhost:3400`, `E2E_ADMIN_EMAIL`,
   `E2E_ADMIN_PASSWORD`, `E2E_HR_EMAIL`, `E2E_HR_PASSWORD`,
   `E2E_MAILBOX_DIR=test-results/mailbox`, `E2E_CLIENT_IP_HEADER=x-real-ip`,
   `E2E_CRON_SECRET`, `E2E_HEALTHCHECK_TOKEN`, `E2E_MONGODB_URI` and
   `E2E_MONGODB_DB_NAME`: `npm run test:e2e`.

### Final QA checklist (on the deployed URL)

- [ ] CI is green; `npm run db:check` against production reports 0 errors
- [ ] `/api/health` with the health-check token reports `ok` for database, storage, email and indexes
- [ ] All pages load: `/`, `/about`, `/products`, `/quality`, `/facility`, `/contact`,
      `/careers`, a job page, `/privacy-policy`; an unknown URL shows the 404 page
- [ ] Admin: sign-in, wrong password rejected, forced password change for new accounts, sign-out
- [ ] Publish a test job → it appears on `/careers` and in `sitemap.xml`
- [ ] Apply with a real PDF → success reference shown; applicant and HR emails arrive;
      the application appears in the admin portal; the CV downloads; a status change
      with "Email the candidate" sends the update email; close the test job afterwards
- [ ] Talent pool form and contact form: submissions arrive
- [ ] 375px, 768px and 1440px widths: no horizontal scrolling on public and admin pages
- [ ] Response headers include `Strict-Transport-Security`, `Content-Security-Policy`,
      `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`
- [ ] `sitemap.xml` and `robots.txt` reference the production domain
- [ ] The first maintenance run appears in the logs (`maintenance.completed`)
- [ ] Remove the test job, application and talent profile (archive, then delete permanently)

---

## 14. How to update the website after deployment

1. Branch, change, open a PR against `main`; CI must pass.
2. Vercel builds a preview deployment per PR (preview environment variables, never production data).
3. Merge → production redeploys automatically.
4. If the release adds indexes or a migration (`src/models/`, `scripts/migrations/`),
   run `npm run db:setup` against production right after it deploys.
5. Manage job postings in the admin portal (`/careers/admin`), not in `src/data/jobs.json`
   (that file only provides optional sample drafts for empty development databases).

---

## 15. How to rollback

- **Vercel**: Deployments → last known-good deployment → **⋯ → Promote to Production**.
- **Git**: `git revert <bad-commit>` and push (keeps history intact).
- **Database**: rolling back the code across a release that ran a data migration is not
  supported without a restore: take a snapshot before running `db:setup` for such a
  release. If a bad deploy corrupted data, restore a snapshot into a new cluster per §9,
  verify it with `npm run db:check`, then repoint `MONGODB_URI`.

---

## 16. Backup and disaster recovery procedure

1. **Source code**: in GitHub. To rebuild from scratch: clone, `npm ci`, set the §4
   variables, `npm run db:setup`, create an administrator (§9), deploy.
2. **Database**: Atlas continuous backups (§9). In a full-loss scenario restore the
   latest snapshot to a new cluster, run `npm run db:check`, repoint `MONGODB_URI`.
3. **Documents**: bucket versioning and, for disaster recovery, replication (§9).
4. **Secrets** (`MONGODB_URI`, S3 keys, SMTP credentials, `CRON_SECRET`,
   `HEALTHCHECK_TOKEN`): keep a copy in the company password manager, outside the
   hosting dashboard. Administrator passwords are personal; a lost one is reset by
   another administrator or with `npm run admin:user -- reset-password`.
5. **Recovery time**: with secrets available and a snapshot restore of a few minutes,
   a full redeploy from zero takes well under an hour.
