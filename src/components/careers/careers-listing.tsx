"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { AlertTriangle, Inbox, RefreshCw } from "lucide-react";
import { CAREER_DEPARTMENTS, CAREER_DEPARTMENT_SET } from "@/components/careers/department-options";
import { CAREERS_SORT_OPTIONS, CareersFilterBar, type CareersSortOrder } from "@/components/careers/careers-filter-bar";
import { JobCard } from "@/components/careers/job-card";
import type { Job } from "@/types/careers";
import "./careers-public.css";

type CareersListingProps = {
  // Open jobs from the server render, newest first. The page is dynamic, so these are fresh
  // and are the only data source (no client refetch).
  initialJobs: Job[];
  // True when the server could not load jobs; renders an inline retry card instead.
  loadError?: boolean;
  // ISO time of the server render, used for "Posted …" and deadline labels.
  renderedAt: string;
};

const SEARCH_DEBOUNCE_MS = 250;

type UrlChanges = Partial<Record<"q" | "dept" | "type" | "loc" | "sort", string | null>>;

// Updates the query string without a server round trip; Next.js keeps useSearchParams in sync
// with history.replaceState.
function writeUrlParams(changes: UrlChanges) {
  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(changes)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  const query = params.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
}

function readSortOrder(value: string | null): CareersSortOrder {
  return CAREERS_SORT_OPTIONS.find((option) => option.value === value)?.value ?? "newest";
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function searchTerms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

function deadlineTime(job: Job): number {
  if (!job.applicationDeadline) return Number.POSITIVE_INFINITY;
  const time = Date.parse(job.applicationDeadline);
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
}

export function CareersListing({ initialJobs, loadError = false, renderedAt }: CareersListingProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isRetrying, startRetry] = useTransition();

  // URL values seed local state once; from then on local state is the source of truth and
  // is mirrored back to the URL. Unknown values are ignored when filtering below.
  const [searchInput, setSearchInput] = useState(() => searchParams.get("q") ?? "");
  const [query, setQuery] = useState(() => (searchParams.get("q") ?? "").trim());
  const [department, setDepartment] = useState(() => searchParams.get("dept") ?? "");
  const [jobType, setJobType] = useState(() => searchParams.get("type") ?? "");
  const [location, setLocation] = useState(() => searchParams.get("loc") ?? "");
  const [sortOrder, setSortOrder] = useState<CareersSortOrder>(() => readSortOrder(searchParams.get("sort")));

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const timers = searchTimer;
    return () => {
      if (timers.current) clearTimeout(timers.current);
    };
  }, []);

  const jobs = initialJobs;
  const now = useMemo(() => new Date(renderedAt), [renderedAt]);

  const departments = useMemo(() => {
    const present = new Set(jobs.map((job) => job.department).filter(Boolean));
    const preferred = CAREER_DEPARTMENTS.filter((name) => present.has(name));
    const others = uniqueSorted([...present].filter((name) => !CAREER_DEPARTMENT_SET.has(name)));
    return [...preferred, ...others];
  }, [jobs]);
  const jobTypes = useMemo(() => uniqueSorted(jobs.map((job) => job.type)), [jobs]);
  const locations = useMemo(() => uniqueSorted(jobs.map((job) => job.location)), [jobs]);

  const activeDepartment = departments.includes(department) ? department : "";
  const activeJobType = jobTypes.includes(jobType) ? jobType : "";
  const activeLocation = locations.includes(location) ? location : "";

  const searchIndex = useMemo(
    () =>
      new Map(
        jobs.map((job) => [
          job.id,
          [job.title, job.department, job.location, job.experience, job.description].join(" ").toLowerCase(),
        ])
      ),
    [jobs]
  );

  const filteredJobs = useMemo(() => {
    const terms = searchTerms(query);
    const matches = jobs.filter((job) => {
      if (activeDepartment && job.department !== activeDepartment) return false;
      if (activeJobType && job.type !== activeJobType) return false;
      if (activeLocation && job.location !== activeLocation) return false;
      if (terms.length === 0) return true;
      const haystack = searchIndex.get(job.id) ?? "";
      return terms.every((term) => haystack.includes(term));
    });
    // Array.prototype.sort is stable, so ties keep the server's newest-first order.
    if (sortOrder === "az") {
      return [...matches].sort((a, b) => a.title.localeCompare(b.title, "en", { sensitivity: "base" }));
    }
    if (sortOrder === "closing") {
      return [...matches].sort((a, b) => deadlineTime(a) - deadlineTime(b));
    }
    return matches;
  }, [jobs, searchIndex, query, activeDepartment, activeJobType, activeLocation, sortOrder]);

  const hasActiveFilters =
    searchInput.trim().length > 0 || Boolean(activeDepartment || activeJobType || activeLocation) || sortOrder !== "newest";

  function cancelPendingSearch() {
    if (searchTimer.current) {
      clearTimeout(searchTimer.current);
      searchTimer.current = null;
    }
  }

  function handleSearchChange(value: string) {
    setSearchInput(value);
    cancelPendingSearch();
    searchTimer.current = setTimeout(() => {
      searchTimer.current = null;
      const trimmed = value.trim();
      setQuery(trimmed);
      writeUrlParams({ q: trimmed || null });
    }, SEARCH_DEBOUNCE_MS);
  }

  function handleDepartmentChange(value: string) {
    setDepartment(value);
    writeUrlParams({ dept: value || null });
  }

  function handleJobTypeChange(value: string) {
    setJobType(value);
    writeUrlParams({ type: value || null });
  }

  function handleLocationChange(value: string) {
    setLocation(value);
    writeUrlParams({ loc: value || null });
  }

  function handleSortChange(value: CareersSortOrder) {
    setSortOrder(value);
    writeUrlParams({ sort: value === "newest" ? null : value });
  }

  function clearFilters() {
    cancelPendingSearch();
    setSearchInput("");
    setQuery("");
    setDepartment("");
    setJobType("");
    setLocation("");
    setSortOrder("newest");
    writeUrlParams({ q: null, dept: null, type: null, loc: null, sort: null });
  }

  if (loadError) {
    return (
      <div className="careers-listing-notice careers-listing-notice-error" role="alert">
        <span className="careers-notice-icon" aria-hidden="true">
          <AlertTriangle className="h-5 w-5" />
        </span>
        <h3 className="careers-notice-title">We couldn&apos;t load open roles</h3>
        <p className="careers-notice-text">
          Something went wrong while loading our current openings. Please try again in a moment.
        </p>
        <div className="careers-notice-actions">
          <button
            type="button"
            className="careers-listing-action"
            onClick={() => startRetry(() => router.refresh())}
            disabled={isRetrying}
          >
            <RefreshCw className={`h-4 w-4${isRetrying ? " animate-spin" : ""}`} aria-hidden="true" />
            {isRetrying ? "Trying again…" : "Try again"}
          </button>
          <a href="#talent-pool" className="careers-notice-link">
            Or join our talent pool
          </a>
        </div>
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} className="careers-listing-notice">
        <span className="careers-notice-icon" aria-hidden="true">
          <Inbox className="h-5 w-5" />
        </span>
        <h3 className="careers-notice-title">No open roles right now</h3>
        <p className="careers-notice-text">
          We don&apos;t have any vacancies at the moment. Share your CV with our talent pool and we&apos;ll
          contact you when a role that matches your experience opens.
        </p>
        <div className="careers-notice-actions">
          <a href="#talent-pool" className="button-link">
            Join Talent Pool
          </a>
        </div>
      </motion.div>
    );
  }

  const total = jobs.length;
  const resultText =
    filteredJobs.length === total
      ? `${total} open ${total === 1 ? "role" : "roles"}`
      : `Showing ${filteredJobs.length} of ${total} open ${total === 1 ? "role" : "roles"}`;

  return (
    <div className="space-y-6">
      <CareersFilterBar
        searchTerm={searchInput}
        department={activeDepartment}
        departments={departments}
        jobType={activeJobType}
        jobTypes={jobTypes}
        location={activeLocation}
        locations={locations}
        sortOrder={sortOrder}
        hasActiveFilters={hasActiveFilters}
        onSearchChange={handleSearchChange}
        onDepartmentChange={handleDepartmentChange}
        onJobTypeChange={handleJobTypeChange}
        onLocationChange={handleLocationChange}
        onSortChange={handleSortChange}
        onClear={clearFilters}
      />

      <p className="careers-results-count" role="status" aria-live="polite" aria-atomic="true">
        {resultText}
      </p>

      {filteredJobs.length > 0 ? (
        <motion.div layout className="space-y-4">
          {filteredJobs.map((job, index) => (
            <JobCard key={job.id} job={job} index={index} now={now} />
          ))}
        </motion.div>
      ) : (
        <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} className="careers-listing-notice">
          <h3 className="careers-notice-title">No jobs found</h3>
          <p className="careers-notice-text">
            Try broadening your search or clear the active filters to explore all currently open roles.
          </p>
          <div className="careers-notice-actions">
            <button type="button" onClick={clearFilters} className="careers-listing-action">
              Clear Filters
            </button>
          </div>
        </motion.div>
      )}
    </div>
  );
}
