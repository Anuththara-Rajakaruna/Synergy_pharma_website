# Production Deployment Guide — Synergy Pharmaceutical Corporation Website

This is a Next.js 16 (App Router) application. The public marketing pages
(home, about, products, quality, facility) are statically generated; the
careers portal (job listings, applications, talent pool, admin CMS) is
server-rendered and backed by PostgreSQL + S3-compatible object storage.

---

## 1. Prerequisites

Before deploying, have accounts ready for:

- **GitHub** — source control (you already have this: `origin` points at
  `github.com/Anuththara-Rajakaruna/Synergy_Final`).
- **Vercel or Netlify** — frontend/app hosting.
- **A managed Postgres provider** — e.g. [Neon](https://neon.tech),
  [Supabase](https://supabase.com), or Vercel Postgres. Any standard
  `postgresql://` connection string works.
- **An S3-compatible object storage provider** — e.g.
  [Cloudflare R2](https://developers.cloudflare.com/r2/) (no egress fees,
  recommended), AWS S3, or Backblaze B2 — for storing uploaded CV PDFs.
- **An SMTP provider** — e.g. Google Workspace, Microsoft 365, Postmark,
  SendGrid, or Amazon SES — for application confirmation emails and HR
  notifications.
- **A domain registrar / DNS provider** for `synergypharma.lk` (or wherever
  the domain is currently registered).
- **Google Search Console** and **Google Analytics** accounts (optional but
  recommended — see §12).

---

## 2. GitHub setup

The repo already has a remote at
`https://github.com/Anuththara-Rajakaruna/Synergy_Final.git`. Before going
live:

1. Decide which branch is production (`main` is the default branch here).
   Merge your `UI` branch work into `main` via a pull request once reviewed.
2. **Confirm the repository's visibility** (Settings → General → Danger
   Zone → visibility) matches your expectations. If applicant data or
   internal notes were ever committed to history, keep the repo **private**.
3. Add branch protection on `main` (Settings → Branches) requiring PR review
   before merge, once you have collaborators.

---

## 3. Hosting setup (Vercel — recommended)

1. Go to [vercel.com](https://vercel.com) → **Add New → Project** → import
   `Anuththara-Rajakaruna/Synergy_Final` from GitHub.
2. Framework preset: **Next.js** (auto-detected). Build command
   `npm run build`, output is auto-detected — no changes needed.
3. Set the **Production Branch** to `main`.
4. Add all environment variables from §4 in **Project Settings →
   Environment Variables** (scope: Production, and add safe equivalents for
   Preview if you want PR previews to work).
5. Deploy. Vercel gives you a `*.vercel.app` URL immediately — verify the
   site works there before attaching the custom domain.

**Netlify** works the same way (`next build`, the official Next.js Runtime
plugin handles the rest) — the environment variables and everything else in
this guide are identical either way.

---

## 4. Environment variables

Set these in your hosting provider's dashboard (never commit real values —
`.env.example` documents the same list with placeholders).

| Variable | Purpose | Required | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | Canonical production URL, used in sitemap, canonical tags, OG tags, JSON-LD | Yes | `https://synergypharma.lk` (no trailing slash) |
| `DATABASE_URL` | Postgres connection string | Yes | From your DB provider |
| `S3_BUCKET` | Object storage bucket name for CV uploads | Yes | |
| `S3_REGION` | Storage region | Yes | `auto` works for R2 |
| `S3_ENDPOINT` | Custom endpoint for non-AWS S3-compatible storage | Only for R2/B2/etc | Leave unset for real AWS S3 |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | Storage credentials | Yes | Scope to only this bucket |
| `AUTH_SECRET` | Signs admin session cookies (HMAC-SHA256) | Yes | Generate with `openssl rand -hex 32`. **Must differ from the dev value in git history.** |
| `ADMIN_PASSWORD` | Careers admin panel password | Yes | Must be changed from any dev/test value |
| `HR_NOTIFICATION_EMAIL` | Inbox that receives new application/talent-pool alerts | Yes | e.g. `hr@synergypharma.lk` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | Outbound email for confirmations + HR alerts | Yes | Real SMTP provider, not the dev maildev capture |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | GA4 measurement ID | Optional | Starts with `G-`. Leave unset to disable analytics entirely |

Nothing above is exposed to the browser except the two `NEXT_PUBLIC_`
variables, which are safe to expose by design (a URL and a public analytics
ID, not secrets).

---

## 5. Domain configuration

1. In Vercel: **Project Settings → Domains → Add** → enter `synergypharma.lk`
   (and `www.synergypharma.lk` if you want the www variant redirected).
2. Vercel will show you the exact DNS records to add (§6) and auto-issues
   SSL once DNS propagates (§7).
3. Decide the canonical form (`synergypharma.lk` vs `www.synergypharma.lk`)
   — the codebase currently assumes the bare apex domain
   (`NEXT_PUBLIC_SITE_URL=https://synergypharma.lk`). Set up a redirect from
   the other form to this one in Vercel's domain settings.

---

## 6. DNS records

Exact records are shown by Vercel/Netlify once you add the domain, but
typically:

| Type | Host | Value | Purpose |
|---|---|---|---|
| A | `@` | Vercel's IP (shown in dashboard) | Apex domain |
| CNAME | `www` | `cname.vercel-dns.com` | www subdomain |
| TXT | `@` or provider-specified | Verification token | Domain ownership verification |
| MX / TXT | per your SMTP provider's instructions | — | So `@synergypharma.lk` email keeps working / SPF for outbound mail deliverability |

**Action required from you:** log into your domain registrar's DNS panel
(wherever `synergypharma.lk` is registered) and add the records your hosting
provider gives you. This is not something that can be done from the
codebase.

Also add an **SPF record** (and DKIM, provided by your SMTP host) for
`synergypharma.lk` so application-confirmation emails sent via the
`SMTP_FROM` address don't land in spam.

---

## 7. SSL / HTTPS

- Vercel and Netlify both provision and renew free TLS certificates
  (Let's Encrypt) automatically once DNS points at them — no manual
  certificate management needed.
- HTTP → HTTPS redirect is automatic on both platforms.
- The app already sends `Strict-Transport-Security` (HSTS, `max-age=2 years`,
  `includeSubDomains`, `preload`) — see `next.config.ts`. Once you confirm
  HTTPS works correctly end-to-end, you can submit the domain to the
  [HSTS preload list](https://hstspreload.org) for extra protection (optional).
- The admin session cookie is already marked `secure` in production
  (`src/lib/auth.ts`), so it will only ever be sent over HTTPS.
- No mixed-content risk was found — all internal assets are relative paths
  and the only external asset host (`images.unsplash.com`) is loaded over
  HTTPS and explicitly allow-listed in the CSP.

---

## 8. Backend deployment

There is no separate backend — the careers portal's API routes
(`src/app/api/**`) run as part of the same Next.js deployment (Vercel
serverless functions / Netlify functions). No separate service to deploy.

---

## 9. Database setup & backup

### Setup

1. Create a Postgres database with your chosen provider (Neon/Supabase/etc).
2. Copy its connection string into `DATABASE_URL`.
3. Run the schema + seed script **once**, from a machine with `DATABASE_URL`
   pointed at production:
   ```
   npm run db:setup
   ```
   This applies `db/schema.sql` (creates `jobs`, `applications`,
   `talent_pool` tables — safe to re-run, every statement is idempotent) and
   seeds the `jobs` table from `src/data/jobs.json` **only if it's currently
   empty** (so it never clobbers live edits made from the admin panel).

### Backups

- **Neon / Supabase / Vercel Postgres**: all three take automatic daily
  backups with point-in-time recovery on paid tiers — enable this in your
  provider's dashboard (Settings → Backups). Recommended retention: **30
  days** minimum for applicant records (balances storage cost against
  recruitment-cycle length).
- **Frequency**: daily automated snapshot at minimum; point-in-time recovery
  (if your provider offers it) is strictly better and needs no extra setup
  once enabled.
- **Restore procedure**: use your provider's dashboard "restore to point in
  time" / "restore snapshot" flow, which creates a new database instance —
  point a *staging* `DATABASE_URL` at it and verify data before switching
  production traffic over. Never restore directly on top of the live
  database without a fresh snapshot of the current (pre-restore) state first.
- **Verify restores actually work**: schedule a recurring (e.g. quarterly)
  drill — restore the latest backup into a scratch database and run
  `SELECT count(*) FROM jobs; SELECT count(*) FROM applications;` to confirm
  the data is intact and queryable. An untested backup is not a backup.

### Object storage (CV uploads) backup

Most S3-compatible providers (R2, S3, B2) support **versioning** — enable it
on the bucket so accidental deletes/overwrites are recoverable. This is a
one-time toggle in the bucket settings, not something this codebase controls.

---

## 10. Contact email / SMTP setup

The site has two lead-generating forms — the job **application form** and
the **talent pool** form (there is no separate generic "Contact Us" form;
general business inquiries go to `info@synergypharma.lk` via the `mailto:`
link in the footer).

1. Get SMTP credentials from your provider (an app password for Google
   Workspace, an API-key-as-password for SendGrid/Postmark, SES SMTP
   credentials, etc).
2. Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` in
   your hosting provider's environment variables.
3. Set `HR_NOTIFICATION_EMAIL` to the real inbox that should receive new
   application/talent-pool alerts.
4. **Test after deploying**: submit a real test application on the live
   site and confirm (a) the HR inbox receives the notification, and (b) the
   applicant's own email receives the confirmation. Both are sent from
   `src/app/api/apply/route.ts` and `src/app/api/talent-pool/route.ts` via
   `src/lib/email.ts`.
5. If `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS` are missing, email sending is
   silently skipped (logged as a warning) rather than breaking the
   submission — the application/profile is still saved to the database
   either way, so a misconfigured SMTP setup degrades gracefully rather than
   blocking candidates.

**Spam/abuse protection already in place:** rate limiting on both endpoints
(5 submissions per IP per 15 minutes — `src/proxy.ts`), server-side
validation of all fields, PDF magic-byte verification on uploads (rejects
renamed non-PDF files), a 10 MB upload cap, and a required consent checkbox.

---

## 11. SEO setup

Already implemented in the codebase:

- Per-page `<title>`/meta description/canonical/Open Graph/Twitter card tags
  on every real page (`src/lib/metadata.ts` + each `page.tsx`).
- `sitemap.xml` (`src/app/sitemap.ts`) covering all marketing pages, the
  careers listing, and every published job — rendered dynamically so it
  always reflects current job postings.
- `robots.txt` (`src/app/robots.ts`) disallowing `/careers/admin` and `/api/`.
- Organization JSON-LD on every page (root layout) and JobPosting JSON-LD on
  each job detail page.
- Square favicon/apple-touch-icon/manifest generated from the logo.

**Your action after deploying:**
1. Set `NEXT_PUBLIC_SITE_URL=https://synergypharma.lk` in production env vars
   (the sitemap/canonical/OG URLs all derive from this).
2. Once live, submit `https://synergypharma.lk/sitemap.xml` in Google Search
   Console (see §12).

---

## 12. Google Analytics / Search Console setup

### Analytics (optional)

1. Create a GA4 property at [analytics.google.com](https://analytics.google.com).
2. Copy the Measurement ID (`G-XXXXXXX`).
3. Set `NEXT_PUBLIC_GA_MEASUREMENT_ID` in your hosting provider's env vars.
4. Redeploy. The site's Content-Security-Policy automatically allows the GA
   scripts only when this variable is set (see `src/proxy.ts`) — no other
   changes needed, and the site works identically with analytics disabled.

### Search Console

1. Go to [search.google.com/search-console](https://search.google.com/search-console).
2. Add property → Domain property → `synergypharma.lk` → verify via the DNS
   TXT record method (add the record at your DNS provider, §6).
3. Once verified, submit the sitemap: **Sitemaps → Add a new sitemap** →
   `sitemap.xml`.
4. Use **URL Inspection** to request indexing for the homepage once live.

---

## 13. Final QA checklist

Run before every production deploy:

- [ ] `npm run lint` — passes with zero errors
- [ ] `npx tsc --noEmit` — passes with zero errors
- [ ] `npm run build` — completes successfully
- [ ] All pages load: `/`, `/about`, `/products`, `/quality`, `/facility`,
      `/careers`, `/careers/[a real job id]`, `/privacy-policy`
- [ ] 404 page renders for a nonexistent URL and its "Back to Home" link works
- [ ] Careers admin: login works, a wrong password is rejected, logout works,
      job create/edit/delete works, applicant list loads
- [ ] Application form: submits successfully, rejects a non-PDF file,
      rejects a duplicate application for the same job+email, HR + applicant
      emails arrive
- [ ] Talent pool form: same checks
- [ ] Resize the browser (or use device toolbar) at 375px, 768px, and
      1440px+ widths on every page — no horizontal scroll, no overlapping text
- [ ] Response headers on the live URL include `Strict-Transport-Security`,
      `Content-Security-Policy`, `X-Frame-Options: DENY`,
      `X-Content-Type-Options: nosniff`, `Referrer-Policy`
- [ ] `https://synergypharma.lk/sitemap.xml` and `/robots.txt` load and
      reference the production domain, not localhost
- [ ] Run the site through Chrome DevTools Lighthouse (Performance,
      Accessibility, SEO tabs) on the deployed URL and address anything below
      ~90

---

## 14. How to update the website after deployment

Standard Git-based workflow — no manual server steps:

1. Create a branch, make changes, open a PR against `main`.
2. Vercel/Netlify automatically builds a **preview deployment** for every PR
   — review it before merging.
3. Merge to `main` → production redeploys automatically within ~1-2 minutes.
4. If you added/changed a job posting directly via `src/data/jobs.json` in
   code (rather than the admin panel), remember the seed script only inserts
   rows when the table is empty — edit jobs through the **admin panel**
   (`/careers/admin`) in production, not by editing the JSON file, since the
   JSON file is only a one-time initial seed.

---

## 15. How to rollback

- **Vercel**: Project → Deployments → find the last known-good deployment →
  **⋯ → Promote to Production**. Instant, no rebuild needed.
- **Netlify**: Site → Deploys → select a prior deploy → **Publish deploy**.
- **Git-level rollback**: `git revert <bad-commit>` and push — triggers a
  fresh deploy of the reverted code. Prefer this over `git reset --hard` so
  history stays intact.
- **Database rollback**: if a bad deploy also corrupted data, restore the
  most recent good database snapshot per §9 into a new instance, verify it,
  then repoint `DATABASE_URL` at it.

---

## 16. Backup and disaster recovery procedure

1. **Source code**: already safe — it's in Git/GitHub. To fully rebuild from
   scratch: clone the repo, run `npm install`, set all env vars from §4,
   run `npm run db:setup`, deploy.
2. **Database**: automated provider snapshots per §9. In a full-loss
   scenario, restore the latest snapshot to a new instance and repoint
   `DATABASE_URL`.
3. **Uploaded CVs**: stored in your S3-compatible bucket — enable bucket
   versioning (§9) so accidental deletes are recoverable; for full
   disaster recovery, enable cross-region replication if your provider
   supports it (recommended once the portal has real applicant volume).
4. **Secrets** (`AUTH_SECRET`, `ADMIN_PASSWORD`, SMTP/DB/S3 credentials):
   keep a copy in a password manager (e.g. 1Password/Bitwarden shared
   vault) outside of the hosting dashboard, so you're not locked out if you
   lose access to Vercel/Netlify itself.
5. **Recovery time estimate**: with secrets backed up and the DB snapshot
   restore taking a few minutes, a full redeploy from zero should take well
   under an hour.
