import type { MetadataRoute } from "next";
import { listOpenJobs } from "@/lib/careers/server/jobs";
import { logger } from "@/lib/logger";
import { SITE_URL } from "@/lib/site";
import type { Job } from "@/types/careers";

// Job postings are read from the database, so this must render per request rather than being
// baked into the build output.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // If the database is briefly unreachable, still serve the static pages rather than failing
  // the whole sitemap for crawlers.
  let jobs: Job[] = [];
  try {
    jobs = await listOpenJobs();
  } catch (err) {
    logger.error("sitemap.jobs_unavailable", { err });
  }

  // Only open postings are listed; lastModified is the posting's real update time. Static pages
  // omit lastModified instead of reporting the request time on every crawl.
  const jobEntries: MetadataRoute.Sitemap = jobs.map((job) => ({
    url: `${SITE_URL}/careers/${job.id}`,
    lastModified: new Date(job.updatedAt),
    changeFrequency: "weekly",
    priority: 0.8,
  }));

  return [
    { url: SITE_URL, changeFrequency: "monthly", priority: 1 },
    { url: `${SITE_URL}/about`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/products`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/quality`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/facility`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/careers`, changeFrequency: "daily", priority: 0.9 },
    ...jobEntries,
    { url: `${SITE_URL}/contact`, changeFrequency: "yearly", priority: 0.5 },
    { url: `${SITE_URL}/privacy-policy`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
