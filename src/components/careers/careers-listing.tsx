"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Job } from "@/types/careers";
import { CareersFilterBar } from "@/components/careers/careers-filter-bar";
import { JobCard } from "@/components/careers/job-card";
import { CAREER_DEPARTMENTS, CAREER_DEPARTMENT_SET } from "@/components/careers/department-options";

type CareersListingProps = {
  initialJobs: Job[];
};

const allDepartmentsLabel = "All departments";
const storageKey = "synergy-careers-filters";

type SavedFilters = {
  searchTerm: string;
  department: string;
};

export function CareersListing({ initialJobs }: CareersListingProps) {
  const [jobs, setJobs] = useState<Job[]>(initialJobs);
  const [searchTerm, setSearchTerm] = useState("");
  const [department, setDepartment] = useState(allDepartmentsLabel);
  const [isLoading, setIsLoading] = useState(initialJobs.length === 0);
  const [hasFetched, setHasFetched] = useState(false);
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const isFiltering = deferredSearchTerm !== searchTerm;

  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(storageKey);

      if (!saved) {
        return;
      }

      const parsed = JSON.parse(saved) as SavedFilters;
      setSearchTerm(parsed.searchTerm ?? "");
      setDepartment(parsed.department ?? allDepartmentsLabel);
    } catch {
      window.sessionStorage.removeItem(storageKey);
    }
  }, []);

  useEffect(() => {
    window.sessionStorage.setItem(storageKey, JSON.stringify({ searchTerm, department }));
  }, [searchTerm, department]);

  useEffect(() => {
    let ignore = false;

    async function loadJobs() {
      setIsLoading(true);

      try {
        const response = await fetch("/api/jobs", { cache: "no-store" });
        const result = (await response.json()) as Job[];

        if (!ignore) {
          setJobs(result);
        }
      } catch {
        if (!ignore) {
          setJobs(initialJobs);
        }
      } finally {
        if (!ignore) {
          setIsLoading(false);
          setHasFetched(true);
        }
      }
    }

    void loadJobs();

    return () => {
      ignore = true;
    };
  }, [initialJobs]);

  const departments = useMemo(() => {
    const uniqueDepartments = Array.from(new Set(jobs.map((job) => job.department)));
    const preferredDepartments = CAREER_DEPARTMENTS.filter((department) =>
      uniqueDepartments.includes(department)
    );
    const remainingDepartments = uniqueDepartments
      .filter((department) => !CAREER_DEPARTMENT_SET.has(department))
      .sort((left, right) => left.localeCompare(right));

    return [allDepartmentsLabel, ...preferredDepartments, ...remainingDepartments];
  }, [jobs]);

  const filteredJobs = useMemo(() => {
    const normalizedSearch = deferredSearchTerm.trim().toLowerCase();

    return jobs.filter((job) => {
      const matchesSearch =
        !normalizedSearch ||
        job.title.toLowerCase().includes(normalizedSearch) ||
        job.description.toLowerCase().includes(normalizedSearch);
      const matchesDepartment = department === allDepartmentsLabel || job.department === department;
      return matchesSearch && matchesDepartment;
    });
  }, [deferredSearchTerm, department, jobs]);

  useEffect(() => {
    if (!hasFetched || !resultsRef.current) {
      return;
    }

    resultsRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [deferredSearchTerm, department, hasFetched]);

  const hasActiveFilters = searchTerm.trim().length > 0 || department !== allDepartmentsLabel;
  const showSkeleton = isLoading || isFiltering;

  return (
    <>
      <div className="space-y-6" ref={resultsRef}>
        <CareersFilterBar
          searchTerm={searchTerm}
          department={department}
          departments={departments}
          hasActiveFilters={hasActiveFilters}
          onSearchChange={setSearchTerm}
          onDepartmentChange={setDepartment}
          onClear={() => {
            setSearchTerm("");
            setDepartment(allDepartmentsLabel);
          }}
        />

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
          <motion.div
            layout
            className="space-y-4"
          >
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
              onClick={() => {
                setSearchTerm("");
                setDepartment(allDepartmentsLabel);
              }}
              className="mt-6 inline-flex items-center justify-center rounded-2xl bg-[#1075bd] px-5 py-3 text-[0.76rem] font-bold uppercase tracking-[0.16em] text-white shadow-[0_14px_30px_rgba(16,117,189,0.24)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-[#0c68a7]"
            >
              Clear Filters
            </button>
          </motion.div>
        )}
      </div>
    </>
  );
}
