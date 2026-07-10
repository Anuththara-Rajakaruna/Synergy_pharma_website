import type { MetadataRoute } from "next";
import { getPublishedJobs } from "@/lib/careers";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const jobs = await getPublishedJobs();

  const jobEntries: MetadataRoute.Sitemap = jobs.map((job) => ({
    url: `https://synergypharma.lk/careers/${job.id}`,
    lastModified: new Date(),
    changeFrequency: "weekly",
    priority: 0.8,
  }));

  return [
    {
      url: "https://synergypharma.lk",
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 1,
    },
    {
      url: "https://synergypharma.lk/careers",
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.9,
    },
    ...jobEntries,
  ];
}
