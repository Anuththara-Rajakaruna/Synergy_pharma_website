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

- Repo: `github.com/Anuththara-Rajakaruna/Synergy_Final` (already the
  `origin` remote in this working copy).
- Confirm its visibility (Settings → General) — recommend **private**,
  since it's a company production site.
- Production branch: `main`. The current work is on branch `UI` and is
  **not yet committed or pushed** — see §9, "what I need from you" — I have
  not pushed anything to your GitHub without your confirmation.

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

## 5. Environment variables (set in Vercel/Netlify, Production scope)

Same list as `.env.example` in the repo, with the production-specific
values called out:

| Variable | Production value |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | `https://www.synergypharma.lk` |
| `DATABASE_URL` | Your production Postgres connection string (§7) |
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Your production object-storage credentials (§7) |
| `AUTH_SECRET` | A **new** value — generate with `openssl rand -hex 32`. Do not reuse the dev value from `.env.local`. |
| `ADMIN_PASSWORD` | A **new**, strong password — do not reuse the dev value. |
| `HR_NOTIFICATION_EMAIL` | The real HR inbox, e.g. `hr@synergypharma.lk` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | Real SMTP credentials — see §8 |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | Your GA4 ID, or leave blank to disable analytics |

None of these are exposed to the browser except the two `NEXT_PUBLIC_`
ones (a URL and a public analytics ID — not secrets).

---

## 6. SSL / HTTPS

- Vercel/Netlify auto-issue and renew a free TLS certificate for both
  `www.synergypharma.lk` and `synergypharma.lk` once DNS points at them —
  no manual certificate work.
- HTTP → HTTPS redirect is automatic on both platforms.
- `next.config.ts` already sends `Strict-Transport-Security` (2-year
  max-age, includeSubDomains, preload).
- The admin session cookie is `secure` in production (`src/lib/auth.ts`) —
  only sent over HTTPS.
- **After cutover, verify**: `https://www.synergypharma.lk` loads with a
  valid padlock, `http://www.synergypharma.lk` redirects to https, and
  `https://synergypharma.lk` redirects to `https://www.synergypharma.lk`.

---

## 7. Database & object storage setup

1. Create a Postgres database (Neon, Supabase, or Vercel Postgres all work)
   and an S3-compatible bucket (Cloudflare R2 recommended — no egress fees).
2. Set `DATABASE_URL` and the `S3_*` variables in Vercel (§5).
3. Run the schema + seed **once**, from a machine with `DATABASE_URL`
   pointed at the production database:
   ```
   npm run db:setup
   ```
   This creates the `jobs`, `applications`, and `talent_pool` tables
   (`db/schema.sql`, safe to re-run) and seeds `jobs` from
   `src/data/jobs.json` only if the table is currently empty.
4. Enable your DB provider's automated daily backups (30-day retention
   recommended) and, if your storage provider supports it, bucket
   versioning on the CV upload bucket.

---

## 8. Contact email / SMTP setup

There's no separate "Contact Us" form — general inquiries go to
`info@synergypharma.lk` via the footer's `mailto:` link (that address is
unaffected by anything in this deployment — it's Microsoft 365, untouched).
The two forms that do send email are the **job application** and **talent
pool** forms:

1. Get SMTP credentials from a real provider (a Microsoft 365 SMTP AUTH
   app password would work naturally here, since company email is already
   on Microsoft 365 — or use SendGrid/Postmark/SES if you'd rather keep
   transactional mail separate from the mailbox).
2. Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, and
   `HR_NOTIFICATION_EMAIL` in Vercel (§5).
3. **After deploying, submit a real test application on the live site** and
   confirm both the HR inbox and the applicant's own email receive their
   messages (`src/lib/email.ts`, called from `src/app/api/apply/route.ts`
   and `src/app/api/talent-pool/route.ts`).
4. If SMTP isn't configured, submissions still save to the database — email
   sending fails silently (logged server-side) rather than blocking the
   candidate, so a misconfiguration degrades gracefully.

Spam/abuse protection already in place: 5 submissions per IP per 15 minutes
(`src/proxy.ts`), server-side field validation, PDF magic-byte verification
on uploads, a 10 MB cap, and a required consent checkbox. No SMTP
credentials or API keys are ever sent to the browser — all email sending
happens server-side in API routes.

---

## 9. What I need from you before this can go live

- [ ] **Confirm you want me to commit and push the prepared changes** to
      GitHub (branch `UI`, or straight to `main` if you'd rather) — I have
      made all the code changes locally but have not committed or pushed
      anything without your say-so.
- [ ] **Vercel (or Netlify) account** — sign up/log in, connect the GitHub
      repo (§3).
- [ ] **DreamHost DNS panel access** — to change the two A/CNAME records
      in §4 (I cannot access this from here).
- [ ] **A Postgres provider account** (Neon/Supabase/Vercel Postgres) and
      an **S3-compatible storage account** (Cloudflare R2 recommended) — I
      cannot create these on your behalf.
- [ ] **Real SMTP credentials** for `HR_NOTIFICATION_EMAIL` delivery (§8).
- [ ] Optional: a **GA4 property** if you want analytics.

---

## 10. How to update the website after deployment

1. Branch → PR against `main` → Vercel auto-builds a preview deployment for
   the PR (review it) → merge → production redeploys automatically
   (~1-2 minutes).
2. Edit job postings through the **admin panel** (`/careers/admin`) in
   production, not by editing `src/data/jobs.json` — that file is only a
   one-time seed for a brand-new database.

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

- **Source code**: safe in GitHub. Full rebuild: clone → `npm install` →
  set env vars (§5) → `npm run db:setup` → deploy.
- **Database**: automated provider snapshots (§7). Restore to a new
  instance, verify with a row-count check, then repoint `DATABASE_URL`.
- **CV uploads**: bucket versioning recoverable; enable cross-region
  replication once the portal has real applicant volume.
- **Secrets**: keep `AUTH_SECRET`, `ADMIN_PASSWORD`, DB/S3/SMTP credentials
  in a password manager outside the hosting dashboard, so losing Vercel
  access doesn't lock you out entirely.

## 13. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Site doesn't load on the new domain after DNS change | Propagation still in progress, or wrong IP/CNAME value | Wait a few minutes (TTL is 60s); re-check the exact values Vercel showed you in step 3.8 |
| Applications/jobs don't save | `DATABASE_URL` missing or unreachable, or `npm run db:setup` never run | Check Vercel function logs; re-run `npm run db:setup` against production |
| CV upload fails | `S3_*` vars missing/wrong, or bucket permissions | Check Vercel function logs for the exact S3 error |
| No confirmation/HR emails | SMTP vars missing/wrong (fails silently by design) | Check Vercel function logs for "Failed to send email"; verify SMTP credentials |
| Admin login fails in production | `ADMIN_PASSWORD`/`AUTH_SECRET` not set, or still the dev value | Set both in Vercel, redeploy |
| Company email (`@synergypharma.lk`) stops working | MX/SPF record accidentally changed | Restore MX to `synergypharma-lk.mail.protection.outlook.com` and SPF TXT to `v=spf1 include:spf.protection.outlook.com -all` |
