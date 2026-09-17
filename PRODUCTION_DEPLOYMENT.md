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

The full list with explanations is in `DEPLOYMENT.md` §4. Production values:

| Variable | Production value |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | `https://www.synergypharma.lk` |
| `MONGODB_URI` / `MONGODB_DB_NAME` | Production MongoDB connection string / `synergy_website` (§7) |
| `S3_BUCKET`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (`S3_REGION` for AWS) | Production bucket and a key limited to it (§7) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Real SMTP credentials (§8) |
| `HR_NOTIFICATION_EMAIL` | `hr@synergypharma.lk` |
| `CONTACT_NOTIFICATION_EMAIL` | `info@synergypharma.lk` |
| `CRON_SECRET` | New random value: `openssl rand -hex 32` |
| `HEALTHCHECK_TOKEN` | New random value: `openssl rand -hex 32` |
| `DATA_RETENTION_MONTHS` / `RETENTION_AUTO_PURGE` | `12` / `false` until HR agrees to automatic deletion (DEPLOYMENT.md §8) |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | GA4 ID, or empty to disable analytics |

Do **not** set `AUTH_SECRET`, `ADMIN_PASSWORD` or `SMTP_ALLOW_INSECURE_LOCAL`:
the first two belong to the previous release (administrators now have their own
accounts), the last is for local development only. Only the two `NEXT_PUBLIC_`
variables reach the browser.

---

## 6. SSL / HTTPS

- Vercel issues and renews certificates for both `www.synergypharma.lk` and
  `synergypharma.lk` once DNS points at it, and redirects HTTP to HTTPS.
- `next.config.ts` sends `Strict-Transport-Security` (2 years,
  `includeSubDomains`, no `preload`) and the other security headers; the admin
  session cookie is `__Host-` prefixed, `Secure`, `HttpOnly` and `SameSite=Strict`.
- **After cutover, verify**: `https://www.synergypharma.lk` loads with a valid
  padlock, `http://www.synergypharma.lk` redirects to https, and
  `https://synergypharma.lk` redirects to `https://www.synergypharma.lk`.

---

## 7. Database, storage and first administrator

Details for every step are in `DEPLOYMENT.md` §9.

1. Create a MongoDB Atlas cluster (M10+ for continuous backups) with a user
   that has `readWrite` on `synergy_website` only. Vercel has no fixed IPs:
   allow `0.0.0.0/0` or use the Vercel–Atlas integration.
2. Create a **private** bucket (Cloudflare R2 recommended), enable versioning,
   create a key limited to it, and add the **CORS rule** allowing `PUT` from
   `https://www.synergypharma.lk` with the `content-type` header. Without it,
   applicants cannot upload their CVs.
3. From a machine with the production variables exported:
   ```
   npm run db:setup -- --no-env-files --confirm=synergy_website
   npm run admin:user -- create --email <hr manager> --name "<name>" --role admin --no-env-files
   npm run db:check -- --no-env-files
   ```
   `db:setup` applies data migrations and creates all collections and indexes
   (safe to re-run; it seeds nothing). `admin:user` prints a temporary password
   that must be changed at first sign-in. `db:check` must report 0 errors.
4. **Existing PostgreSQL data**: before go-live run
   `npm run db:migrate:postgres -- --dry-run --check-files`, then the import with
   `--backup-dir` (DEPLOYMENT.md §9). Existing CVs stay in the same bucket.
5. Enable Atlas Continuous Cloud Backup (30-day retention recommended).

---

## 8. Email (SMTP) and scheduled maintenance

1. Create SMTP credentials — company email already runs on Microsoft 365, so an
   SMTP AUTH-enabled mailbox such as `careers@synergypharma.lk` fits naturally
   (or Postmark/SendGrid/SES for transactional mail). Add the provider's DKIM
   record; the existing SPF record only authorizes Microsoft 365.
2. Emails sent: application and talent-pool confirmations to the applicant, alerts
   to `HR_NOTIFICATION_EMAIL`, status updates when HR ticks "Email the candidate",
   and contact form messages to `CONTACT_NOTIFICATION_EMAIL`.
3. Every email is stored in MongoDB first and sent right after the response;
   failures are retried by the maintenance cron (`/api/cron/maintenance`, every
   6 hours from `vercel.json`, authorized by `CRON_SECRET`). A submission never
   fails because of email.
4. **After deploying, submit a real test application** and confirm both the HR
   inbox and the applicant's inbox receive their messages.

---

## 9. What is needed before this can go live

- [ ] Pull request with the careers portal work merged into `main` (CI green).
- [ ] **Vercel account** connected to the GitHub repo (§3); Pro plan, or a daily cron schedule on Hobby.
- [ ] **DreamHost DNS panel access** to change the two A/CNAME records (§4).
- [ ] **MongoDB Atlas** cluster and an **S3-compatible bucket** with the CORS rule (§7).
- [ ] **SMTP credentials** for `careers@synergypharma.lk` (or another sender) (§8).
- [ ] The name and email of the first portal administrator (§7).
- [ ] Access to the old PostgreSQL database, if its applications must be kept (§7).
- [ ] HR's decision on automatic deletion after 12 months (`RETENTION_AUTO_PURGE`).
- [ ] Optional: a **GA4 property** for analytics.

---

## 10. How to update the website after deployment

1. Branch → PR against `main` → CI and a Vercel preview deployment (preview
   environment variables, never production data) → merge → production redeploys.
2. If the release changes `src/models/` or adds `scripts/migrations/`, run
   `npm run db:setup` against production right after it deploys (snapshot first).
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

## 12. Backup & disaster recovery

- **Source code**: GitHub. Full rebuild: clone → `npm ci` → set the variables (§5)
  → `npm run db:setup` → create an administrator → deploy.
- **Database**: Atlas continuous backups (§7). Restore to a new cluster, verify
  with `npm run db:check`, then repoint `MONGODB_URI`.
- **Applicant documents**: bucket versioning; cross-region replication once the
  portal has real applicant volume.
- **Secrets**: keep the MongoDB, S3 and SMTP credentials, `CRON_SECRET` and
  `HEALTHCHECK_TOKEN` in the company password manager, outside Vercel.

## 13. Troubleshooting

Vercel → Project → Logs shows one JSON line per event; search for the event names below.
`GET /api/health` with `Authorization: Bearer <HEALTHCHECK_TOKEN>` checks database,
storage, email configuration and indexes at once.

| Symptom | Likely cause | Fix |
|---|---|---|
| Site doesn't load on the new domain after DNS change | Propagation in progress, or wrong IP/CNAME value | Wait a few minutes (TTL is 60s); re-check the values Vercel showed in step 3.8 |
| Pages or API return 503 "temporarily unavailable" | `mongodb.connect_failed`: wrong `MONGODB_URI`, Atlas Network Access, or user password | Fix the variable or Atlas access; run `npm run db:check` with the production values |
| API returns 500 "Something went wrong" | `config.problem`, `mongodb.misconfigured` or `storage.misconfigured` | Fix the variable named in the log entry |
| CV upload fails in the browser (network error) | Bucket CORS rule missing or wrong origin | Add the CORS rule from DEPLOYMENT.md §9 for the exact site origin |
| CV upload fails with 503 "File storage is temporarily unavailable" | Storage provider outage or wrong `S3_ENDPOINT` | Check `storage.bucket_check_failed` / health check |
| No confirmation/HR emails | `email.retry_scheduled` or `email.failed` entries: wrong SMTP credentials, sender not allowed, or maintenance cron not running | Fix SMTP settings; queued emails are retried by the next maintenance run |
| Nobody can sign in to the admin portal | No administrator account was created | `npm run admin:user -- create … --role admin` (§7) |
| An administrator is locked out | Too many wrong passwords (temporary lock) or a forgotten password | Wait for the lock to expire, or another administrator resets the password (Team tab) |
| Duplicate applications get through / `db:check` reports missing indexes | `npm run db:setup` not run after a release | Run `npm run db:setup` |
| Company email (`@synergypharma.lk`) stops working | MX/SPF record accidentally changed | Restore MX to `synergypharma-lk.mail.protection.outlook.com` and SPF TXT to `v=spf1 include:spf.protection.outlook.com -all` |
