"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Job } from "@/types/careers";
import { CareersFilterBar } from "@/components/careers/careers-filter-bar";
import { JobCard } from "@/components/careers/job-card";
import { CAREER_DEPARTMENTS, CAREER_DEPARTMENT_SET } from "@/components/careers/department-options";

type CareersListingProps = {
  initialJobs: Job[];
};

const allDepartmentsLabel = "All departments";
const allTypesLabel = "All types";
const allLocationsLabel = "All locations";

export function CareersListing({ initialJobs }: CareersListingProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [jobs, setJobs] = useState<Job[]>(initialJobs);
  const [isLoading, setIsLoading] = useState(initialJobs.length === 0);

  const searchTerm = searchParams.get("q") ?? "";
  const department = searchParams.get("dept") ?? allDepartmentsLabel;
  const jobType = searchParams.get("type") ?? allTypesLabel;
  const location = searchParams.get("loc") ?? allLocationsLabel;
  const [sortOrder, setSortOrder] = useState<"newest" | "az">("newest");

  const deferredSearchTerm = useDeferredValue(searchTerm);
  const isFiltering = deferredSearchTerm !== searchTerm;

  function updateParam(key: string, value: string, defaultValue: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === defaultValue || value === "") {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  function clearFilters() {
    router.replace("?", { scroll: false });
    setSortOrder("newest");
  }

  useEffect(() => {
    let ignore = false;
    async function loadJobs() {
      // Don't show loading skeletons when we already have SSR data — refresh silently
      try {
        const response = await fetch("/api/jobs", { cache: "no-store" });
        const result = (await response.json()) as Job[];
        if (!ignore) setJobs(result);
      } catch {
        if (!ignore) setJobs(initialJobs);
      } finally {
        if (!ignore) setIsLoading(false);
      }
    }
    void loadJobs();
    return () => { ignore = true; };
  }, [initialJobs]);

  const departments = useMemo(() => {
    const unique = Array.from(new Set(jobs.map((j) => j.department)));
    const preferred = CAREER_DEPARTMENTS.filter((d) => unique.includes(d));
    const remaining = unique.filter((d) => !CAREER_DEPARTMENT_SET.has(d)).sort((a, b) => a.localeCompare(b));
    return [allDepartmentsLabel, ...preferred, ...remaining];
  }, [jobs]);

  const locations = useMemo(() => {
    const unique = Array.from(new Set(jobs.map((j) => j.location)));
    return [allLocationsLabel, ...unique.sort((a, b) => a.localeCompare(b))];
  }, [jobs]);

  const jobTypes = useMemo(() => {
    const unique = Array.from(new Set(jobs.map((j) => j.type)));
    return [allTypesLabel, ...unique.sort((a, b) => a.localeCompare(b))];
  }, [jobs]);

  const filteredJobs = useMemo(() => {
    const q = deferredSearchTerm.trim().toLowerCase();
    const filtered = jobs.filter((job) => {
      const matchesSearch = !q || job.title.toLowerCase().includes(q) || job.description.toLowerCase().includes(q);
      const matchesDept = department === allDepartmentsLabel || job.department === department;
      const matchesType = jobType === allTypesLabel || job.type === jobType;
      const matchesLoc = location === allLocationsLabel || job.location === location;
      return matchesSearch && matchesDept && matchesType && matchesLoc;
    });
    if (sortOrder === "az") {
      return [...filtered].sort((a, b) => a.title.localeCompare(b.title));
    }
    return filtered;
  }, [deferredSearchTerm, department, jobType, location, jobs, sortOrder]);

  const hasActiveFilters =
    searchTerm.trim().length > 0 ||
    department !== allDepartmentsLabel ||
    jobType !== allTypesLabel ||
    location !== allLocationsLabel ||
    sortOrder !== "newest";

  const showSkeleton = isLoading || isFiltering;

  return (
    <div className="space-y-6">
      <CareersFilterBar
        searchTerm={searchTerm}
        department={department}
        departments={departments}
        jobType={jobType}
        jobTypes={jobTypes}
        sortOrder={sortOrder}
        location={location}
        locations={locations}
        hasActiveFilters={hasActiveFilters}
        onSearchChange={(v) => updateParam("q", v, "")}
        onDepartmentChange={(v) => updateParam("dept", v, allDepartmentsLabel)}
        onJobTypeChange={(v) => updateParam("type", v, allTypesLabel)}
        onSortChange={setSortOrder}
        onLocationChange={(v) => updateParam("loc", v, allLocationsLabel)}
        onClear={clearFilters}
      />

      <div aria-live="polite" aria-relevant="additions removals">
        {showSkeleton ? (
          <div className="space-y-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className="animate-pulse rounded-[28px] border border-[#e0ebf3] bg-white px-6 py-5 shadow-[0_16px_34px_rgba(17,58,83,0.08)] md:px-7 md:py-5"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="h-6 w-28 rounded-full bg-[#dcecf5]" />
                    <div className="mt-4 h-7 w-3/5 rounded-xl bg-[#dcecf5]" />
                    <div className="mt-3 h-4 w-full rounded-full bg-[#e6f2f8]" />
                    <div className="mt-2.5 h-4 w-5/6 rounded-full bg-[#e6f2f8]" />
                  </div>
                  <div className="flex flex-col gap-3 lg:w-52.5 lg:items-end">
                    <div className="h-9 w-9 rounded-full bg-[#e6f2f8]" />
                    <div className="h-4 w-32 rounded-full bg-[#e6f2f8]" />
                    <div className="h-12 w-40 rounded-2xl bg-[#dcecf5]" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : filteredJobs.length > 0 ? (
          <motion.div layout className="space-y-4">
            {filteredJobs.map((job, index) => (
              <JobCard key={job.id} job={job} index={index} />
            ))}
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-[30px] border border-dashed border-[#c9dce8] bg-white/70 px-6 py-12 text-center shadow-[0_18px_42px_rgba(17,58,83,0.07)]"
          >
            <h3 className="text-[1.45rem] font-bold text-[#0a1f35]">No jobs found</h3>
            <p className="mx-auto mt-3 max-w-xl text-[0.98rem] leading-7 text-[#4d6578]">
              Try broadening your search or clear the active filters to explore all currently open roles.
            </p>
            <button
              type="button"
              onClick={clearFilters}
              className="mt-6 inline-flex items-center justify-center rounded-2xl bg-[#1075bd] px-5 py-3 text-[0.76rem] font-bold uppercase tracking-[0.16em] text-white shadow-[0_14px_30px_rgba(16,117,189,0.24)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-[#0c68a7]"
            >
              Clear Filters
            </button>
          </motion.div>
        )}
      </div>
    </div>
  );
}
