import { OPEN_POSITIONS, type OpenPosition } from "@/data/open-positions";
import type { Job } from "@/types/careers";

// Temporary source for the public careers pages (the listing and the detail page), used while the
// Google Sheets data store is not in use. These functions mirror the store's (listOpenJobs,
// getOpenJob and listRelatedOpenJobs in ./server/jobs), so going back to the store is a change of
// import and call in src/app/careers/(listing)/page.tsx and src/app/careers/[id]/page.tsx, and no
// component changes.
//
// publishedAt is null so the cards show no "Posted ..." line, rather than a date nobody set; the
// list keeps the order of OPEN_POSITIONS. `requirements` is left empty: the seed only carries one
// because the store will not publish a job without it, and it repeats the qualifications.

const UPDATED_AT = "2026-09-19T00:00:00.000Z";

function toJob(position: OpenPosition): Job {
  return {
    id: position.slug,
    title: position.title,
    department: position.department,
    location: position.location,
    type: position.type,
    experience: position.experience,
    summary: position.summary,
    description: position.description,
    contactPhone: position.contactPhone,
    applyEmail: position.applyEmail,
    responsibilities: [...position.responsibilities],
    requirements: [],
    qualifications: [...position.qualifications],
    benefits: [...position.benefits],
    applicationDeadline: null,
    publishedAt: null,
    updatedAt: UPDATED_AT,
  };
}

export async function listStaticOpenJobs(): Promise<Job[]> {
  return OPEN_POSITIONS.map(toJob);
}

// Null for an unknown or malformed slug, which the detail page turns into the site's 404.
export async function getStaticOpenJob(slug: string): Promise<Job | null> {
  if (typeof slug !== "string") return null;
  const wanted = slug.trim().toLowerCase();
  const position = OPEN_POSITIONS.find((item) => item.slug === wanted);
  return position ? toJob(position) : null;
}

export async function listStaticRelatedOpenJobs(department: string, excludeSlug: string, limit = 3): Promise<Job[]> {
  if (typeof department !== "string" || !department.trim()) return [];
  return OPEN_POSITIONS.filter((item) => item.department === department && item.slug !== excludeSlug)
    .slice(0, Math.max(limit, 0))
    .map(toJob);
}
