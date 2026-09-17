"use client";

// Applications tab: server-side filtered and paginated list (table on desktop, cards on
// phones), CSV export of the current filters, and the application detail drawer.

import { useEffect, useEffectEvent, useId, useRef, useState, type ReactNode } from "react";
import {
  APPLICATION_STATUSES,
  APPLICATION_STATUS_LABELS,
  JOB_STATUSES,
  JOB_STATUS_LABELS,
  PAGE_SIZE_DEFAULT,
  type ApplicationStatus,
} from "@/lib/careers/constants";
import { formatDate } from "@/lib/careers/format";
import { isApplicationStatus, isValidJobSlug } from "@/lib/careers/validation";
import type { AdminJob, AdminSessionUser, ApplicationListItem, Paginated } from "@/types/careers";
import { ADMIN_AUTO_REFRESH_MS, ADMIN_EVENTS, buildQuery, useAdminQuery } from "./api";
import { ApplicationDetailDrawer, isApplicationId } from "./application-detail";
import { IconDownload, IconEye, IconIdentification, IconRefresh } from "./icons";
import {
  ApplicationStatusBadge,
  Badge,
  EmptyState,
  ErrorBanner,
  Pagination,
  SearchInput,
  SelectField,
  SkeletonRows,
  Spinner,
  TextField,
  cx,
  formatName,
  pluralize,
} from "./ui";

type ArchivedFilter = "exclude" | "only" | "include";
type SortOption = "newest" | "oldest" | "status_changed";

type Filters = {
  q: string;
  status: ApplicationStatus | "";
  job: string;
  from: string;
  to: string;
  archived: ArchivedFilter;
  sort: SortOption;
};

const DEFAULT_FILTERS: Filters = {
  q: "",
  status: "",
  job: "",
  from: "",
  to: "",
  archived: "exclude",
  sort: "newest",
};

const STATUS_OPTIONS = APPLICATION_STATUSES.map((status) => ({ value: status, label: APPLICATION_STATUS_LABELS[status] }));

const ARCHIVED_OPTIONS: { value: ArchivedFilter; label: string }[] = [
  { value: "exclude", label: "Exclude archived" },
  { value: "only", label: "Archived only" },
  { value: "include", label: "Include archived" },
];

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "status_changed", label: "Status recently changed" },
];

// Server-side cap on exported rows (see the export route).
const EXPORT_ROW_LIMIT = 5000;
const DATE_VALUE = /^\d{4}-\d{2}-\d{2}$/;

function isArchivedFilter(value: string): value is ArchivedFilter {
  return ARCHIVED_OPTIONS.some((option) => option.value === value);
}

function isSortOption(value: string): value is SortOption {
  return SORT_OPTIONS.some((option) => option.value === value);
}

function dateInputValue(value: string): string {
  return DATE_VALUE.test(value) ? value : "";
}

function hasActiveFilters(filters: Filters): boolean {
  return (
    filters.q.trim() !== "" ||
    filters.status !== "" ||
    filters.job !== "" ||
    filters.from !== "" ||
    filters.to !== "" ||
    filters.archived !== "exclude"
  );
}

export type ApplicationsPanelProps = {
  currentUser: AdminSessionUser;
  // Opened in the detail drawer on mount (deep links from emails and the talent pool).
  initialApplicationId?: string;
  // Called after any change so the dashboard counts refresh.
  onChanged?: () => void;
};

export function ApplicationsPanel({ currentUser, initialApplicationId, onChanged }: ApplicationsPanelProps) {
  const headingId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState<string | null>(() => (isApplicationId(initialApplicationId) ? initialApplicationId : null));
  const [shownList, setShownList] = useState<Paginated<ApplicationListItem> | null>(null);

  const jobsQuery = useAdminQuery<{ items: AdminJob[] }>(`/api/admin/jobs${buildQuery({ status: "all" })}`);
  const jobs = jobsQuery.data?.items ?? null;

  const rangeInvalid = filters.from !== "" && filters.to !== "" && filters.from > filters.to;
  const filterParams = {
    q: filters.q.trim() || undefined,
    status: filters.status || undefined,
    job: filters.job || undefined,
    from: filters.from || undefined,
    // An end date before the start date is flagged on the field and left out of the query.
    to: rangeInvalid ? undefined : filters.to || undefined,
    archived: filters.archived === "exclude" ? undefined : filters.archived,
    sort: filters.sort === "newest" ? undefined : filters.sort,
  };
  const list = useAdminQuery<Paginated<ApplicationListItem>>(
    `/api/admin/applications${buildQuery({ ...filterParams, page: page > 1 ? page : undefined, limit: PAGE_SIZE_DEFAULT })}`,
    [],
    // New submissions appear without a manual refresh while HR has this tab open.
    { autoRefreshMs: ADMIN_AUTO_REFRESH_MS }
  );
  const exportHref = `/api/admin/applications/export${buildQuery(filterParams)}`;
  const filtersActive = hasActiveFilters(filters);

  // Keep the previous page on screen while the next one loads instead of flashing a skeleton.
  if (list.data && list.data !== shownList) setShownList(list.data);
  const data = list.data ?? (list.loading ? shownList : null);
  const stale = list.data === null && data !== null;

  // Archiving or deleting the last row of the last page leaves the page out of range; step back.
  if (list.data && list.data.items.length === 0 && list.data.total > 0 && page > Math.max(1, list.data.pageCount)) {
    setPage(Math.max(1, list.data.pageCount));
  }

  // Mirror the open application in the URL so the view can be refreshed or shared with a colleague.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (detailId) {
      if (url.searchParams.get("application") === detailId && url.searchParams.get("tab") === "applications") return;
      url.searchParams.set("tab", "applications");
      url.searchParams.set("application", detailId);
    } else {
      if (!url.searchParams.has("application")) return;
      url.searchParams.delete("application");
    }
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [detailId]);

  // "View applicants" on a job row: show that job's applications with the other filters reset.
  const handleFilterEvent = useEffectEvent((event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    const detail: unknown = event.detail;
    if (!detail || typeof detail !== "object") return;
    const record = detail as Record<string, unknown>;
    const job = typeof record.job === "string" && isValidJobSlug(record.job) ? record.job : "";
    const status = isApplicationStatus(record.status) ? record.status : "";
    if (!job && !status) return;
    setFilters({ ...DEFAULT_FILTERS, job, status });
    setPage(1);
  });

  useEffect(() => {
    const listener = (event: Event) => handleFilterEvent(event);
    window.addEventListener(ADMIN_EVENTS.filterApplications, listener);
    return () => window.removeEventListener(ADMIN_EVENTS.filterApplications, listener);
  }, []);

  function updateFilters(patch: Partial<Filters>) {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  }

  function clearFilters() {
    setFilters(DEFAULT_FILTERS);
    setPage(1);
  }

  function handlePage(next: number) {
    setPage(Math.max(1, next));
    const section = sectionRef.current;
    if (section && section.getBoundingClientRect().top < 0) section.scrollIntoView({ block: "start" });
  }

  function refresh() {
    list.reload();
    jobsQuery.reload();
  }

  function handleDetailChanged() {
    list.reload();
    onChanged?.();
  }

  let content: ReactNode;
  if (!data) {
    content = list.error ? (
      <ErrorBanner title="Couldn't load applications." error={list.error} onRetry={list.reload} />
    ) : (
      <SkeletonRows rows={5} label="Loading applications…" />
    );
  } else if (data.items.length === 0) {
    if (list.loading || (data.total > 0 && page > Math.max(1, data.pageCount))) {
      content = <SkeletonRows rows={5} label="Loading applications…" />;
    } else if (filtersActive) {
      content = (
        <>
          {list.error ? <ErrorBanner title="Couldn't refresh applications." error={list.error} onRetry={list.reload} /> : null}
          <EmptyState
            icon={<IconIdentification className="adm-icon" />}
            title="No applications match your filters."
            description="Try a different search, status, job or date range."
            action={
              <button type="button" className="adm-btn adm-btn-secondary" onClick={clearFilters}>
                Clear filters
              </button>
            }
          />
        </>
      );
    } else {
      content = (
        <>
          {list.error ? <ErrorBanner title="Couldn't refresh applications." error={list.error} onRetry={list.reload} /> : null}
          <EmptyState
            icon={<IconIdentification className="adm-icon" />}
            title="No applications yet."
            description="Applications submitted on the careers site will appear here."
          />
        </>
      );
    }
  } else {
    content = (
      <>
        {list.error ? <ErrorBanner title="Couldn't refresh applications." error={list.error} onRetry={list.reload} /> : null}
        <div className="adm-stack" aria-busy={list.loading || undefined} style={stale ? { opacity: 0.6 } : undefined}>
          <ApplicationsTable items={data.items} onView={setDetailId} />
          <ApplicationCards items={data.items} onView={setDetailId} />
        </div>
        <Pagination
          page={page}
          pageCount={data.pageCount}
          total={data.total}
          onPage={handlePage}
          disabled={list.loading}
          itemLabel={["application", "applications"]}
        />
      </>
    );
  }

  let resultText = "";
  if (data && !stale) {
    resultText = `${pluralize(data.total, "application")}${filtersActive ? " match your filters" : ""}`;
    if (data.total > EXPORT_ROW_LIMIT) resultText += ` · CSV export includes the first ${EXPORT_ROW_LIMIT.toLocaleString("en-GB")}`;
  } else if (list.loading) {
    resultText = "Loading applications…";
  }

  const canExport = !(data && !stale && data.total === 0);

  return (
    <section ref={sectionRef} className="adm-card adm-panel" aria-labelledby={headingId}>
      <div className="adm-panel-header">
        <div className="adm-panel-heading">
          <p className="adm-eyebrow">Applications</p>
          <h2 id={headingId} className="adm-title">
            Review candidates
          </h2>
          <p className="adm-results" aria-live="polite">
            {resultText}
          </p>
        </div>
        <div className="adm-panel-actions">
          <button type="button" className="adm-btn adm-btn-secondary" onClick={refresh} disabled={list.loading} aria-busy={list.loading || undefined}>
            {list.loading ? <Spinner size="sm" /> : <IconRefresh className="adm-icon" />}
            Refresh
          </button>
          {canExport ? (
            <a className="adm-btn adm-btn-secondary" href={exportHref} download>
              <IconDownload className="adm-icon" />
              Export CSV
            </a>
          ) : (
            <button type="button" className="adm-btn adm-btn-secondary" disabled>
              <IconDownload className="adm-icon" />
              Export CSV
            </button>
          )}
        </div>
      </div>

      <div className="adm-toolbar" role="search" aria-label="Filter applications">
        <SearchInput
          className="adm-toolbar-grow"
          label="Search"
          placeholder="Candidate name or email"
          value={filters.q}
          onChange={(q) => updateFilters({ q })}
          debounceMs={300}
        />
        <SelectField
          label="Status"
          value={filters.status}
          placeholder="All statuses"
          options={STATUS_OPTIONS}
          onChange={(event) => {
            const value = event.target.value;
            updateFilters({ status: isApplicationStatus(value) ? value : "" });
          }}
        />
        <SelectField
          label="Job"
          value={filters.job}
          placeholder="All jobs"
          hint={jobsQuery.error && !jobs ? "Couldn't load the job list." : undefined}
          onChange={(event) => {
            const value = event.target.value;
            updateFilters({ job: isValidJobSlug(value) ? value : "" });
          }}
        >
          <JobFilterOptions jobs={jobs} selected={filters.job} />
        </SelectField>
        <TextField
          type="date"
          label="Submitted from"
          value={filters.from}
          max={filters.to || undefined}
          onChange={(event) => updateFilters({ from: dateInputValue(event.target.value) })}
        />
        <TextField
          type="date"
          label="Submitted to"
          value={filters.to}
          min={filters.from || undefined}
          error={rangeInvalid ? "The end date must be on or after the start date." : undefined}
          onChange={(event) => updateFilters({ to: dateInputValue(event.target.value) })}
        />
        <SelectField
          label="Archived"
          value={filters.archived}
          options={ARCHIVED_OPTIONS}
          onChange={(event) => {
            const value = event.target.value;
            if (isArchivedFilter(value)) updateFilters({ archived: value });
          }}
        />
        <SelectField
          label="Sort"
          value={filters.sort}
          options={SORT_OPTIONS}
          onChange={(event) => {
            const value = event.target.value;
            if (isSortOption(value)) updateFilters({ sort: value });
          }}
        />
        {filtersActive ? (
          <div className="adm-toolbar-actions">
            <button type="button" className="adm-btn adm-btn-ghost adm-btn-sm" onClick={clearFilters}>
              Clear filters
            </button>
          </div>
        ) : null}
      </div>

      {content}

      <ApplicationDetailDrawer
        applicationId={detailId}
        currentUser={currentUser}
        jobs={jobs}
        onClose={() => setDetailId(null)}
        onChanged={handleDetailChanged}
      />
    </section>
  );
}

// Jobs grouped by status. A job selected before the list loads (or one that no longer exists)
// keeps an option so the select never silently shows "All jobs" while filtering by it.
function JobFilterOptions({ jobs, selected }: { jobs: AdminJob[] | null; selected: string }) {
  const all = jobs ?? [];
  const known = all.some((job) => job.id === selected);
  const titleCounts = new Map<string, number>();
  for (const job of all) titleCounts.set(job.title, (titleCounts.get(job.title) ?? 0) + 1);
  const groups = JOB_STATUSES.map((status) => ({
    status,
    items: all.filter((job) => job.status === status).sort((a, b) => a.title.localeCompare(b.title)),
  })).filter((group) => group.items.length > 0);

  return (
    <>
      {selected && !known ? <option value={selected}>{selected}</option> : null}
      {groups.map((group) => (
        <optgroup key={group.status} label={JOB_STATUS_LABELS[group.status]}>
          {group.items.map((job) => (
            <option key={job.id} value={job.id}>
              {(titleCounts.get(job.title) ?? 0) > 1 ? `${job.title} (${job.id})` : job.title}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}

function RecordBadges({ item }: { item: ApplicationListItem }) {
  return (
    <span className="adm-badge-group">
      <ApplicationStatusBadge status={item.status} />
      {item.archived ? <Badge tone="gray">Archived</Badge> : null}
      {item.inTalentPool ? <Badge tone="teal">Talent pool</Badge> : null}
    </span>
  );
}

function ViewButton({ item, onView, block = false }: { item: ApplicationListItem; onView: (id: string) => void; block?: boolean }) {
  return (
    <button type="button" className={cx("adm-btn adm-btn-secondary adm-btn-sm", block && "adm-btn-block")} onClick={() => onView(item.id)}>
      <IconEye className="adm-icon" />
      View
      <span className="adm-sr-only"> application from {formatName(item.name)}</span>
    </button>
  );
}

function ApplicationsTable({ items, onView }: { items: ApplicationListItem[]; onView: (id: string) => void }) {
  return (
    <div className="adm-table-wrap adm-only-desktop">
      <table className="adm-table">
        <caption className="adm-sr-only">Applications</caption>
        <thead>
          <tr>
            <th scope="col">Reference</th>
            <th scope="col">Candidate</th>
            <th scope="col">Job</th>
            <th scope="col">Submitted</th>
            <th scope="col">Status</th>
            <th scope="col">Documents</th>
            <th scope="col">
              <span className="adm-sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td className="adm-cell-nowrap">
                <span className="adm-mono">{item.reference}</span>
              </td>
              <td>
                <div className="adm-cell-strong">{formatName(item.name)}</div>
                <div className="adm-muted adm-text-sm">{item.email}</div>
              </td>
              <td>
                <div>{item.jobTitle}</div>
                {item.department ? <div className="adm-muted adm-text-sm">{item.department}</div> : null}
              </td>
              <td className="adm-cell-nowrap" title={formatDate(item.createdAt, { withTime: true })}>
                {formatDate(item.createdAt)}
              </td>
              <td>
                <RecordBadges item={item} />
              </td>
              <td className="adm-cell-nowrap">
                <div>{pluralize(item.documentCount, "document")}</div>
                {item.noteCount > 0 ? <div className="adm-muted adm-text-sm">{pluralize(item.noteCount, "note")}</div> : null}
              </td>
              <td className="adm-cell-actions">
                <ViewButton item={item} onView={onView} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ApplicationCards({ items, onView }: { items: ApplicationListItem[]; onView: (id: string) => void }) {
  return (
    <ul className="adm-cards adm-only-mobile" aria-label="Applications">
      {items.map((item) => (
        <li key={item.id} className="adm-record-card">
          <div className="adm-record-card-header">
            <h3 className="adm-record-card-title">{formatName(item.name)}</h3>
            <RecordBadges item={item} />
          </div>
          <p className="adm-record-card-meta">
            {item.jobTitle}
            {item.department ? ` · ${item.department}` : ""}
          </p>
          <p className="adm-record-card-meta">{item.email}</p>
          <p className="adm-record-card-meta">
            <span className="adm-mono">{item.reference}</span> · Submitted {formatDate(item.createdAt)} ·{" "}
            {pluralize(item.documentCount, "document")}
            {item.noteCount > 0 ? ` · ${pluralize(item.noteCount, "note")}` : ""}
          </p>
          <div className="adm-record-card-actions">
            <ViewButton item={item} onView={onView} block />
          </div>
        </li>
      ))}
    </ul>
  );
}
