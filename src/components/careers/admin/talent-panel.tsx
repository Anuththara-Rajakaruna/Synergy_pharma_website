"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { CAREER_DEPARTMENTS, PAGE_SIZE_DEFAULT, TALENT_SOURCES, TALENT_SOURCE_LABELS, type TalentSource } from "@/lib/careers/constants";
import { formatDate } from "@/lib/careers/format";
import type { AdminSessionUser, Paginated, TalentDetail, TalentListItem } from "@/types/careers";
import { ADMIN_AUTO_REFRESH_MS, buildQuery, useAdminQuery } from "./api";
import { IconBriefcase, IconPaperClip, IconRefresh, IconUserGroup, IconUserPlus } from "./icons";
import { TalentAddDialog } from "./talent-add-dialog";
import { TALENT_SOURCE_TONES, TalentDetailDrawer } from "./talent-detail";
import {
  Badge,
  EmptyState,
  ErrorBanner,
  Pagination,
  SearchInput,
  SelectField,
  SkeletonRows,
  Spinner,
  TextField,
  formatName,
  pluralize,
  useToast,
  type SelectOption,
} from "./ui";

type ArchivedFilter = "exclude" | "only" | "include";

type Filters = {
  q: string;
  area: string;
  tag: string;
  source: "" | TalentSource;
  from: string;
  to: string;
  archived: ArchivedFilter;
};

const DEFAULT_FILTERS: Filters = { q: "", area: "", tag: "", source: "", from: "", to: "", archived: "exclude" };

const AREA_OPTIONS: readonly SelectOption[] = [
  { value: "", label: "All areas" },
  ...CAREER_DEPARTMENTS.map((department) => ({ value: department, label: department })),
];

const SOURCE_OPTIONS: readonly SelectOption[] = [
  { value: "", label: "All sources" },
  ...TALENT_SOURCES.map((source) => ({ value: source, label: TALENT_SOURCE_LABELS[source] })),
];

const ARCHIVED_OPTIONS: readonly { value: ArchivedFilter; label: string }[] = [
  { value: "exclude", label: "Active profiles" },
  { value: "only", label: "Archived only" },
  { value: "include", label: "Active and archived" },
];

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const DATE_VALUE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ROW_TAGS = 3;

function isTalentSource(value: string): value is TalentSource {
  return (TALENT_SOURCES as readonly string[]).includes(value);
}

function isArchivedFilter(value: string): value is ArchivedFilter {
  return ARCHIVED_OPTIONS.some((option) => option.value === value);
}

function isFiltered(filters: Filters): boolean {
  return (Object.keys(DEFAULT_FILTERS) as (keyof Filters)[]).some((key) => filters[key] !== DEFAULT_FILTERS[key]);
}

// Keeps the open profile in the address bar so a refresh or a shared link reopens it.
function writeTalentToUrl(id: string | null): void {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("talent", id);
  else url.searchParams.delete("talent");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

export type TalentPanelProps = {
  currentUser: AdminSessionUser;
  initialTalentId?: string;
  onChanged?: () => void;
};

export function TalentPanel({ currentUser, initialTalentId, onChanged }: TalentPanelProps) {
  const toast = useToast();
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    initialTalentId && OBJECT_ID.test(initialTalentId) ? initialTalentId : null
  );
  const [addOpen, setAddOpen] = useState(false);
  const [lastLoadedPage, setLastLoadedPage] = useState<Paginated<TalentListItem> | null>(null);
  const sectionRef = useRef<HTMLElement>(null);

  const trimmedQuery = filters.q.trim();
  const from = DATE_VALUE.test(filters.from) ? filters.from : "";
  const to = DATE_VALUE.test(filters.to) ? filters.to : "";
  const dateRangeError = from && to && from > to ? "The end date is before the start date." : null;

  const list = useAdminQuery<Paginated<TalentListItem>>(
    `/api/admin/talent-pool${buildQuery({
      q: trimmedQuery || undefined,
      area: filters.area || undefined,
      tag: filters.tag || undefined,
      source: filters.source || undefined,
      from: from || undefined,
      to: to || undefined,
      archived: filters.archived === "exclude" ? undefined : filters.archived,
      page,
      limit: PAGE_SIZE_DEFAULT,
    })}`,
    [],
    { autoRefreshMs: ADMIN_AUTO_REFRESH_MS }
  );
  const tagsQuery = useAdminQuery<{ tags: string[] }>("/api/admin/talent-pool/tags");
  const reloadList = list.reload;
  const reloadTags = tagsQuery.reload;

  // Keep the last page visible (marked busy) while the next page or filter result loads.
  if (list.data && list.data !== lastLoadedPage) setLastLoadedPage(list.data);
  const data = list.data ?? (list.loading ? lastLoadedPage : null);

  // A page that no longer exists (e.g. after archiving the last profile on it): step back.
  if (list.data && list.data.items.length === 0 && list.data.total > 0 && page > list.data.pageCount) {
    setPage(Math.max(1, list.data.pageCount));
  }

  useEffect(() => {
    if (initialTalentId && OBJECT_ID.test(initialTalentId)) writeTalentToUrl(initialTalentId);
  }, [initialTalentId]);

  const tagNames = tagsQuery.data?.tags ?? [];
  // The selected tag stays selectable even if no active profile uses it any more.
  const tagChoices = filters.tag && !tagNames.includes(filters.tag) ? [filters.tag, ...tagNames] : tagNames;
  const tagOptions: SelectOption[] = [{ value: "", label: "All tags" }, ...tagChoices.map((tag) => ({ value: tag, label: tag }))];
  const filtered = isFiltered(filters);

  function updateFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((current) => (current[key] === value ? current : { ...current, [key]: value }));
    setPage(1);
  }

  function clearFilters() {
    setFilters(DEFAULT_FILTERS);
    setPage(1);
  }

  function goToPage(next: number) {
    setPage(next);
    const section = sectionRef.current;
    if (section && section.getBoundingClientRect().top < 0) {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      section.scrollIntoView({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
    }
  }

  function openProfile(id: string) {
    setSelectedId(id);
    writeTalentToUrl(id);
  }

  function closeProfile() {
    setSelectedId(null);
    writeTalentToUrl(null);
  }

  function refreshAll() {
    reloadList();
    reloadTags();
  }

  function handleChanged() {
    refreshAll();
    onChanged?.();
  }

  function handleDeleted() {
    closeProfile();
    handleChanged();
  }

  function handleCreated(talent: TalentDetail) {
    setAddOpen(false);
    toast.success(`${formatName(talent.name)} was added to the talent pool.`);
    handleChanged();
    openProfile(talent.id);
  }

  function handleFindExisting(email: string) {
    setAddOpen(false);
    setFilters({ ...DEFAULT_FILTERS, q: email, archived: "include" });
    setPage(1);
  }

  let content: ReactNode;
  if (data === null && list.error) {
    content = <ErrorBanner title="Couldn't load the talent pool." error={list.error} onRetry={reloadList} />;
  } else if (data === null) {
    content = <SkeletonRows rows={5} label="Loading talent pool…" />;
  } else if (data.items.length === 0 && data.total === 0) {
    content = filtered ? (
      <EmptyState
        icon={<IconUserGroup className="adm-icon" />}
        title="No candidates match your filters."
        description="Try a different search term, area, tag or date range."
        action={
          <button type="button" className="adm-btn adm-btn-secondary" onClick={clearFilters}>
            Clear filters
          </button>
        }
      />
    ) : (
      <EmptyState
        icon={<IconUserGroup className="adm-icon" />}
        title="No talent pool profiles yet."
        description="Profiles appear here when candidates join the talent pool on the careers site, when HR moves an applicant here, or when you add someone manually."
        action={
          <button type="button" className="adm-btn adm-btn-primary" onClick={() => setAddOpen(true)}>
            <IconUserPlus className="adm-icon" />
            Add candidate
          </button>
        }
      />
    );
  } else {
    const busy = list.loading;
    content = (
      <>
        {list.error ? <ErrorBanner title="Couldn't refresh the talent pool." error={list.error} onRetry={reloadList} /> : null}
        <div className={busy ? "opacity-60 transition-opacity" : "transition-opacity"} aria-busy={busy || undefined}>
          <TalentTable items={data.items} onOpen={openProfile} />
          <TalentCards items={data.items} onOpen={openProfile} />
        </div>
        <Pagination
          page={page}
          pageCount={data.pageCount}
          total={data.total}
          onPage={goToPage}
          disabled={busy}
          itemLabel={["profile", "profiles"]}
        />
      </>
    );
  }

  const resultText = data
    ? `${pluralize(data.total, "profile")}${filtered ? " match your filters" : filters.archived === "exclude" ? " in the talent pool" : ""}`
    : list.loading
      ? "Loading talent pool…"
      : "";

  return (
    <section ref={sectionRef} className="adm-card adm-panel" aria-labelledby="admin-talent-heading">
      <div className="adm-panel-header">
        <div className="adm-panel-heading">
          <p className="adm-eyebrow">Talent Pool</p>
          <h2 id="admin-talent-heading" className="adm-title">
            Candidate profiles
          </h2>
          <p className="adm-results" aria-live="polite">
            {resultText}
          </p>
        </div>
        <div className="adm-panel-actions">
          <button
            type="button"
            className="adm-btn adm-btn-secondary"
            onClick={refreshAll}
            disabled={list.loading}
            aria-busy={list.loading || undefined}
          >
            {list.loading ? <Spinner size="sm" /> : <IconRefresh className="adm-icon" />}
            Refresh
          </button>
          <button type="button" className="adm-btn adm-btn-primary" onClick={() => setAddOpen(true)} aria-haspopup="dialog">
            <IconUserPlus className="adm-icon" />
            Add candidate
          </button>
        </div>
      </div>

      <div className="adm-toolbar" role="search" aria-label="Filter the talent pool">
        <SearchInput
          className="adm-toolbar-grow"
          label="Search"
          placeholder="Name, email, area or tag"
          value={filters.q}
          onChange={(value) => updateFilter("q", value)}
          debounceMs={300}
        />
        <SelectField label="Area of interest" value={filters.area} onChange={(event) => updateFilter("area", event.target.value)} options={AREA_OPTIONS} />
        <SelectField
          label="Tag"
          value={filters.tag}
          onChange={(event) => updateFilter("tag", event.target.value)}
          options={tagOptions}
          hint={tagsQuery.error ? "Couldn't load tags." : undefined}
        />
        <SelectField
          label="Source"
          value={filters.source}
          onChange={(event) => {
            const value = event.target.value;
            updateFilter("source", isTalentSource(value) ? value : "");
          }}
          options={SOURCE_OPTIONS}
        />
        <TextField
          label="Added from"
          type="date"
          value={filters.from}
          max={to || undefined}
          onChange={(event) => updateFilter("from", event.target.value)}
        />
        <TextField
          label="Added to"
          type="date"
          value={filters.to}
          min={from || undefined}
          onChange={(event) => updateFilter("to", event.target.value)}
          error={dateRangeError}
        />
        <SelectField
          label="Profile status"
          value={filters.archived}
          onChange={(event) => {
            if (isArchivedFilter(event.target.value)) updateFilter("archived", event.target.value);
          }}
          options={ARCHIVED_OPTIONS}
        />
        {filtered ? (
          <div className="adm-toolbar-actions">
            <button type="button" className="adm-btn adm-btn-ghost" onClick={clearFilters}>
              Clear filters
            </button>
          </div>
        ) : null}
      </div>

      {content}

      <TalentAddDialog
        open={addOpen}
        tagSuggestions={tagNames}
        onClose={() => setAddOpen(false)}
        onCreated={handleCreated}
        onFindExisting={handleFindExisting}
      />

      <TalentDetailDrawer
        talentId={selectedId}
        currentUser={currentUser}
        tagSuggestions={tagNames}
        onClose={closeProfile}
        onChanged={handleChanged}
        onDeleted={handleDeleted}
      />
    </section>
  );
}

// ── Rows ─────────────────────────────────────────────────────────────────────

function SourceBadge({ source }: { source: TalentSource }) {
  return <Badge tone={TALENT_SOURCE_TONES[source] ?? "slate"}>{TALENT_SOURCE_LABELS[source] ?? source}</Badge>;
}

function TagChips({ tags, area }: { tags: string[]; area?: string }) {
  const visible = tags.slice(0, MAX_ROW_TAGS);
  const hidden = tags.length - visible.length;
  if (!area && tags.length === 0) return <span className="adm-muted">—</span>;
  return (
    <ul className="adm-chips" aria-label={area ? "Area of interest and tags" : "Tags"}>
      {area ? (
        <li className="adm-badge" data-tone="sky">
          {area}
        </li>
      ) : null}
      {visible.map((tag) => (
        <li key={tag} className="adm-chip adm-chip-static">
          <span>{tag}</span>
        </li>
      ))}
      {hidden > 0 ? (
        <li className="adm-chip adm-chip-static" title={tags.slice(MAX_ROW_TAGS).join(", ")}>
          <span>+{hidden} more</span>
        </li>
      ) : null}
    </ul>
  );
}

function RecordCounts({ item }: { item: TalentListItem }) {
  return (
    <span className="adm-cluster adm-text-sm adm-muted">
      <span className="inline-flex items-center gap-1" title={pluralize(item.documentCount, "document")}>
        <IconPaperClip className="adm-icon" />
        {item.documentCount.toLocaleString("en-GB")}
        <span className="adm-sr-only">{item.documentCount === 1 ? " document" : " documents"}</span>
      </span>
      <span className="inline-flex items-center gap-1" title={pluralize(item.applicationCount, "application")}>
        <IconBriefcase className="adm-icon" />
        {item.applicationCount.toLocaleString("en-GB")}
        <span className="adm-sr-only">{item.applicationCount === 1 ? " application" : " applications"}</span>
      </span>
    </span>
  );
}

function TalentTable({ items, onOpen }: { items: TalentListItem[]; onOpen: (id: string) => void }) {
  return (
    <div className="adm-table-wrap adm-only-desktop">
      <table className="adm-table">
        <caption className="adm-sr-only">Talent pool profiles</caption>
        <thead>
          <tr>
            <th scope="col">Candidate</th>
            <th scope="col">Area of interest</th>
            <th scope="col">Tags</th>
            <th scope="col">Source</th>
            <th scope="col">Added</th>
            <th scope="col">Files / Apps</th>
            <th scope="col">
              <span className="adm-sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const name = formatName(item.name);
            return (
              <tr key={item.id}>
                <td>
                  <div className="grid min-w-0 gap-0.5">
                    <span className="adm-cluster">
                      <span className="adm-cell-strong">{name}</span>
                      {item.archived ? <Badge tone="gray">Archived</Badge> : null}
                    </span>
                    <span className="adm-text-sm adm-muted break-all">{item.email}</span>
                  </div>
                </td>
                <td>
                  {item.areaOfInterest ? (
                    <span className="adm-chip adm-chip-static">
                      <span>{item.areaOfInterest}</span>
                    </span>
                  ) : (
                    <span className="adm-muted">—</span>
                  )}
                </td>
                <td>
                  <TagChips tags={item.tags} />
                </td>
                <td className="adm-cell-nowrap">
                  <SourceBadge source={item.source} />
                </td>
                <td className="adm-cell-nowrap">
                  <time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time>
                </td>
                <td className="adm-cell-nowrap">
                  <RecordCounts item={item} />
                </td>
                <td className="adm-cell-actions">
                  <button
                    type="button"
                    className="adm-btn adm-btn-secondary adm-btn-sm"
                    onClick={() => onOpen(item.id)}
                    aria-haspopup="dialog"
                    aria-label={`View profile of ${name}`}
                  >
                    View
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TalentCards({ items, onOpen }: { items: TalentListItem[]; onOpen: (id: string) => void }) {
  return (
    <ul className="adm-cards adm-only-mobile" aria-label="Talent pool profiles">
      {items.map((item) => {
        const name = formatName(item.name);
        return (
          <li key={item.id} className="adm-record-card">
            <div className="adm-record-card-header">
              <p className="adm-record-card-title">{name}</p>
              <span className="adm-badge-group">
                {item.archived ? <Badge tone="gray">Archived</Badge> : null}
                <SourceBadge source={item.source} />
              </span>
            </div>
            <p className="adm-record-card-meta">
              {item.email}
              {item.phone ? ` · ${item.phone}` : ""}
            </p>
            <TagChips tags={item.tags} area={item.areaOfInterest} />
            <div className="adm-record-card-meta adm-cluster">
              <span>
                Added <time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time>
              </span>
              <RecordCounts item={item} />
            </div>
            <div className="adm-record-card-actions">
              <button
                type="button"
                className="adm-btn adm-btn-secondary adm-btn-sm adm-btn-block"
                onClick={() => onOpen(item.id)}
                aria-haspopup="dialog"
                aria-label={`View profile of ${name}`}
              >
                View profile
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
