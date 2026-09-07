-- Synergy careers portal — production schema.
-- Apply with: npm run db:setup (see scripts/db-setup.mjs), or manually via psql.

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  department TEXT NOT NULL,
  location TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('Full-time', 'Internship')),
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'closed')),
  description TEXT NOT NULL,
  responsibilities JSONB NOT NULL DEFAULT '[]',
  requirements JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  position TEXT NOT NULL,
  job_id TEXT NOT NULL,
  cover_letter TEXT NOT NULL DEFAULT '',
  cv_file_name TEXT NOT NULL,
  cv_file_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewing', 'shortlisted', 'rejected', 'hired')),
  notes TEXT NOT NULL DEFAULT '',
  consent_given BOOLEAN NOT NULL DEFAULT false,
  linked_in TEXT,
  portfolio TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (email, job_id)
);

CREATE TABLE IF NOT EXISTS talent_pool (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL,
  area_of_interest TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  cv_file_name TEXT NOT NULL,
  cv_file_path TEXT NOT NULL,
  consent_given BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_applications_job_id ON applications (job_id);
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications (status);
CREATE INDEX IF NOT EXISTS idx_applications_created_at ON applications (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_talent_pool_created_at ON talent_pool (created_at DESC);

-- job_id is intentionally NOT a foreign key: deleting a job must never cascade-delete
-- the applicant records tied to it. Applicant/talent-pool data is retained independently
-- of job posting lifecycle.
