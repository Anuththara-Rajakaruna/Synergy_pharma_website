"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { FIELD_LIMITS } from "@/lib/careers/constants";
import { formatDate } from "@/lib/careers/format";
import { formatDeadlineDate, validateEmail, type FieldErrors } from "@/lib/careers/validation";
import type { AuditLogEntry, Paginated } from "@/types/careers";
import { ADMIN_EVENTS, adminFetch, buildQuery, isAbortError, toAdminApiError, useAdminQuery } from "./api";
import { IconChevronRight, IconClipboardList, IconClose, IconDownload, IconFunnel, IconRefresh } from "./icons";
import {
  Badge,
  EmptyState,
  ErrorBanner,
  Notice,
  Pagination,
  SelectField,
  SkeletonRows,
  Spinner,
  TextField,
  pluralize,
  type BadgeTone,
} from "./ui";

const PAGE_SIZE = 25;
const OBJECT_ID = /^[a-f0-9]{24}$/i;
// Record identifiers GET /api/admin/audit accepts as entityType/entityId filters.
const FILTERABLE_ENTITY_TYPE = /^[a-z_]{1,40}$/;
const FILTERABLE_ENTITY_ID = /^[A-Za-z0-9_.:-]{1,120}$/;

// Values are the action prefixes accepted by GET /api/admin/audit?action=.
const ACTION_GROUPS = [
  { value: "auth", label: "Sign-ins & passwords" },
  { value: "user", label: "Team accounts" },
  { value: "job", label: "Job postings" },
  { value: "application", label: "Applications" },
  { value: "talent", label: "Talent pool" },
  { value: "document", label: "Document downloads" },
  { value: "candidate", label: "Candidate data exports" },
  { value: "retention", label: "Retention purges" },
] as const;

type ActionGroup = (typeof ACTION_GROUPS)[number]["value"];

const ENTITY_TYPES = [
  { value: "admin_user", label: "Team account" },
  { value: "job", label: "Job posting" },
  { value: "application", label: "Application" },
  { value: "talent", label: "Talent profile" },
  { value: "document", label: "Document" },
  { value: "candidate", label: "Candidate" },
] as const;

type EntityType = (typeof ENTITY_TYPES)[number]["value"];

const ACTION_LABELS: Record<string, string> = {
  "auth.login": "Signed in",
  "auth.login_failed": "Failed sign-in",
  "auth.logout": "Signed out",
  "auth.password_change": "Changed own password",
  "user.create": "Created account",
  "user.update": "Updated account",
  "user.reset_password": "Reset password",
  "job.create": "Created job",
  "job.update": "Edited job",
  "job.publish": "Published job",
  "job.unpublish": "Unpublished job",
  "job.close": "Closed job",
  "job.reopen": "Reopened job",
  "job.archive": "Archived job",
  "job.restore": "Restored job",
  "job.delete": "Deleted job",
  "application.submit": "Application received",
  "application.view": "Viewed application",
  "application.status_change": "Changed status",
  "application.note_add": "Added note",
  "application.archive": "Archived application",
  "application.restore": "Restored application",
  "application.move_to_talent_pool": "Moved to talent pool",
  "application.purge": "Deleted application",
  "application.export": "Exported applications",
  "talent.create": "Added to talent pool",
  "talent.submit": "Talent profile received",
  "talent.view": "Viewed talent profile",
  "talent.update": "Updated talent profile",
  "talent.note_add": "Added note",
  "talent.archive": "Archived talent profile",
  "talent.restore": "Restored talent profile",
  "talent.apply_to_job": "Considered for a job",
  "talent.purge": "Deleted talent profile",
  "document.download": "Downloaded document",
  "candidate.export": "Exported candidate data",
  "retention.purge": "Retention deletion",
};

const GROUP_TONES: Record<string, BadgeTone> = {
  auth: "slate",
  user: "purple",
  job: "teal",
  application: "blue",
  talent: "indigo",
  document: "sky",
  candidate: "amber",
  retention: "rose",
};

// Actions after which the record no longer exists, so it can't be opened.
const REMOVAL_ACTIONS: ReadonlySet<string> = new Set(["application.purge", "talent.purge", "retention.purge", "job.delete"]);
const ALERT_ACTIONS: ReadonlySet<string> = new Set(["auth.login_failed", "application.purge", "talent.purge", "retention.purge", "job.delete"]);

function isActionGroup(value: string): value is ActionGroup {
  return ACTION_GROUPS.some((group) => group.value === value);
}

function isEntityType(value: string): value is EntityType {
  return ENTITY_TYPES.some((type) => type.value === value);
}

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

function actionTone(action: string): BadgeTone {
  if (ALERT_ACTIONS.has(action)) return "red";
  return GROUP_TONES[action.split(".")[0]] ?? "slate";
}

function entityTypeLabel(type: string): string {
  return ENTITY_TYPES.find((entry) => entry.value === type)?.label ?? type;
}

// Entries written without a signed-in user: public submissions, sign-in failures and
// scheduled maintenance.
function systemActorLabel(action: string): string {
  if (action === "auth.login_failed") return "Unknown (not signed in)";
  if (action === "application.submit" || action === "talent.submit") return "Candidate via website";
  if (action === "retention.purge") return "System (retention schedule)";
  return "System";
}

type RecordFilter = { entityType: string; entityId: string };

export function AuditPanel() {
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <div className="adm-stack">
      <ActivityLogCard refreshKey={refreshKey} />
      <DataProtectionCard onExported={() => setRefreshKey((value) => value + 1)} />
    </div>
  );
}

// ── Activity log ─────────────────────────────────────────────────────────────

function ActivityLogCard({ refreshKey }: { refreshKey: number }) {
  const headingId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const [today] = useState(() => formatDeadlineDate(new Date()));
  const [actionGroup, setActionGroup] = useState<ActionGroup | "">("");
  const [entityType, setEntityType] = useState<EntityType | "">("");
  const [record, setRecord] = useState<RecordFilter | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);

  const rangeError = from && to && from > to ? "The end date must be on or after the start date." : null;
  const path = rangeError
    ? null
    : `/api/admin/audit${buildQuery({
        page,
        limit: PAGE_SIZE,
        action: actionGroup || undefined,
        entityType: record ? record.entityType || undefined : entityType || undefined,
        entityId: record?.entityId,
        from: from || undefined,
        to: to || undefined,
      })}`;
  const { data, error, loading, reload } = useAdminQuery<Paginated<AuditLogEntry>>(path, [refreshKey]);

  const filtered = Boolean(actionGroup || entityType || record || from || to);
  const entries = data?.items ?? null;

  // The log can shrink under a stale page number (for example after narrowing filters in another
  // tab); step back to the last page that exists.
  if (data && page > Math.max(1, data.pageCount)) setPage(Math.max(1, data.pageCount));

  function updateFilter(apply: () => void) {
    apply();
    setPage(1);
  }

  function clearFilters() {
    setActionGroup("");
    setEntityType("");
    setRecord(null);
    setFrom("");
    setTo("");
    setPage(1);
  }

  function changePage(next: number) {
    setPage(next);
    const section = sectionRef.current;
    if (section && section.getBoundingClientRect().top < 0) section.scrollIntoView({ block: "start" });
  }

  function showRecordHistory(entry: AuditLogEntry) {
    updateFilter(() => {
      setActionGroup("");
      setEntityType(isEntityType(entry.entityType) ? entry.entityType : "");
      setRecord({ entityType: entry.entityType, entityId: entry.entityId });
    });
  }

  let content: ReactNode;
  if (rangeError) {
    content = <Notice tone="warning">Fix the date range to see activity.</Notice>;
  } else if (entries === null && error) {
    content = <ErrorBanner title="Couldn't load the activity log." error={error} onRetry={reload} />;
  } else if (entries === null || data === null) {
    content = <SkeletonRows rows={5} label="Loading activity…" />;
  } else if (entries.length === 0) {
    content = filtered ? (
      <EmptyState
        icon={<IconFunnel className="adm-icon" />}
        title="No activity matches your filters."
        description="Try a different action, record type or date range."
        action={
          <button type="button" className="adm-btn adm-btn-secondary" onClick={clearFilters}>
            Clear filters
          </button>
        }
      />
    ) : (
      <EmptyState
        icon={<IconClipboardList className="adm-icon" />}
        title="No activity recorded yet."
        description="Sign-ins, changes to jobs and candidates, downloads and exports appear here."
      />
    );
  } else {
    const rowProps = (entry: AuditLogEntry) => ({
      entry,
      recordFiltered: record !== null && record.entityId === entry.entityId && record.entityType === entry.entityType,
      onShowHistory: () => showRecordHistory(entry),
    });
    content = (
      <>
        {error ? <ErrorBanner title="Couldn't refresh the activity log." error={error} onRetry={reload} /> : null}
        <div className="adm-table-wrap adm-only-desktop">
          <table className="adm-table" aria-busy={loading || undefined}>
            <caption className="adm-sr-only">Activity log, newest first</caption>
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">User</th>
                <th scope="col">Action</th>
                <th scope="col">Summary</th>
                <th scope="col">IP address</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <AuditTableRow key={entry.id} {...rowProps(entry)} />
              ))}
            </tbody>
          </table>
        </div>
        <ul className="adm-cards adm-only-mobile" aria-label="Activity log, newest first" aria-busy={loading || undefined}>
          {entries.map((entry) => (
            <AuditCard key={entry.id} {...rowProps(entry)} />
          ))}
        </ul>
        <Pagination
          page={data.page}
          pageCount={data.pageCount}
          total={data.total}
          onPage={changePage}
          disabled={loading}
          itemLabel={["entry", "entries"]}
        />
      </>
    );
  }

  const resultText = rangeError
    ? ""
    : data === null
      ? loading
        ? "Loading activity…"
        : ""
      : `${pluralize(data.total, "entry", "entries")}${filtered ? " match your filters" : ""}`;

  return (
    <section ref={sectionRef} className="adm-card adm-panel" aria-labelledby={headingId}>
      <div className="adm-panel-header">
        <div className="adm-panel-heading">
          <p className="adm-eyebrow">Activity Log</p>
          <h2 id={headingId} className="adm-title">
            Who did what, and when
          </h2>
          <p className="adm-results" aria-live="polite">
            {resultText}
          </p>
        </div>
        <div className="adm-panel-actions">
          {filtered ? (
            <button type="button" className="adm-btn adm-btn-ghost" onClick={clearFilters}>
              <IconClose className="adm-icon" strokeWidth={2.5} />
              Clear filters
            </button>
          ) : null}
          <button
            type="button"
            className="adm-btn adm-btn-secondary"
            onClick={reload}
            disabled={loading || path === null}
            aria-busy={loading || undefined}
          >
            {loading ? <Spinner size="sm" /> : <IconRefresh className="adm-icon" />}
            Refresh
          </button>
        </div>
      </div>

      <div className="adm-toolbar" role="search" aria-label="Filter the activity log">
        <SelectField
          label="Action"
          value={actionGroup}
          onChange={(event) => {
            const value = event.target.value;
            updateFilter(() => setActionGroup(isActionGroup(value) ? value : ""));
          }}
          placeholder="All actions"
          options={ACTION_GROUPS}
        />
        <SelectField
          label="Record type"
          value={record ? (isEntityType(record.entityType) ? record.entityType : "") : entityType}
          onChange={(event) => {
            const value = event.target.value;
            updateFilter(() => {
              setRecord(null);
              setEntityType(isEntityType(value) ? value : "");
            });
          }}
          placeholder="All record types"
          options={ENTITY_TYPES}
        />
        <TextField
          label="From"
          type="date"
          value={from}
          max={to || today}
          onChange={(event) => updateFilter(() => setFrom(event.target.value))}
          error={data === null ? error?.fields?.from : undefined}
        />
        <TextField
          label="To"
          type="date"
          value={to}
          min={from || undefined}
          max={today}
          onChange={(event) => updateFilter(() => setTo(event.target.value))}
          error={rangeError ?? (data === null ? error?.fields?.to : undefined)}
        />
      </div>

      {record ? (
        <ul className="adm-chips" aria-label="Record filter">
          <li className="adm-chip">
            <span>
              Showing history of {entityTypeLabel(record.entityType).toLowerCase()} <span className="adm-mono">{record.entityId}</span>
            </span>
            <button type="button" className="adm-chip-remove" onClick={() => updateFilter(() => setRecord(null))} aria-label="Show all records">
              <IconClose className="adm-icon" strokeWidth={2.5} />
            </button>
          </li>
        </ul>
      ) : null}

      {content}
    </section>
  );
}

type AuditRowProps = {
  entry: AuditLogEntry;
  recordFiltered: boolean;
  onShowHistory: () => void;
};

function EntryTime({ at }: { at: string }) {
  return <time dateTime={at}>{formatDate(at, { withTime: true })}</time>;
}

function ActionBadge({ action }: { action: string }) {
  return <Badge tone={actionTone(action)}>{actionLabel(action)}</Badge>;
}

function Actor({ entry, compact = false }: { entry: AuditLogEntry; compact?: boolean }) {
  if (!entry.actorName) return <span className="adm-muted">{systemActorLabel(entry.action)}</span>;
  if (compact) return <span>{entry.actorName}</span>;
  return (
    <span className="adm-user-text">
      <span className="adm-cell-strong">{entry.actorName}</span>
      {entry.actorEmail ? <span className="adm-text-sm adm-muted">{entry.actorEmail}</span> : null}
    </span>
  );
}

function openRecord(entry: AuditLogEntry) {
  const event = entry.entityType === "application" ? ADMIN_EVENTS.openApplication : ADMIN_EVENTS.openTalent;
  window.dispatchEvent(new CustomEvent(event, { detail: { id: entry.entityId } }));
}

// Links from an entry to the record it concerns: its full history here, and for applications and
// talent profiles that still exist, the record itself.
function RecordLinks({ entry, recordFiltered, onShowHistory }: AuditRowProps) {
  if (!entry.entityId || entry.entityId === "unknown") return null;
  const filterable = FILTERABLE_ENTITY_TYPE.test(entry.entityType) && FILTERABLE_ENTITY_ID.test(entry.entityId);
  const openable =
    (entry.entityType === "application" || entry.entityType === "talent") &&
    OBJECT_ID.test(entry.entityId) &&
    !REMOVAL_ACTIONS.has(entry.action);
  return (
    <span className="adm-cluster">
      <span className="adm-text-sm adm-muted">
        {entityTypeLabel(entry.entityType)} <span className="adm-mono">{entry.entityId}</span>
      </span>
      {recordFiltered || !filterable ? null : (
        <button type="button" className="adm-btn adm-btn-link adm-btn-sm" onClick={onShowHistory}>
          History<span className="adm-sr-only"> of this {entityTypeLabel(entry.entityType).toLowerCase()}</span>
        </button>
      )}
      {openable ? (
        <button type="button" className="adm-btn adm-btn-link adm-btn-sm" onClick={() => openRecord(entry)}>
          Open<span className="adm-sr-only"> {entityTypeLabel(entry.entityType).toLowerCase()}</span>
          <IconChevronRight className="adm-icon" />
        </button>
      ) : null}
    </span>
  );
}

function AuditTableRow(props: AuditRowProps) {
  const { entry } = props;
  return (
    <tr>
      <td className="adm-cell-nowrap">
        <EntryTime at={entry.at} />
      </td>
      <td>
        <Actor entry={entry} />
      </td>
      <td>
        <ActionBadge action={entry.action} />
        <div className="adm-mono adm-muted" style={{ overflowWrap: "anywhere" }}>
          {entry.action}
        </div>
      </td>
      <td>
        <div className="adm-user-text">
          <span>{entry.summary}</span>
          <RecordLinks {...props} />
        </div>
      </td>
      <td className="adm-cell-nowrap">
        <span className="adm-mono">{entry.ip ?? "—"}</span>
      </td>
    </tr>
  );
}

function AuditCard(props: AuditRowProps) {
  const { entry } = props;
  return (
    <li className="adm-record-card">
      <div className="adm-record-card-header">
        <ActionBadge action={entry.action} />
        <span className="adm-record-card-meta">
          <EntryTime at={entry.at} />
        </span>
      </div>
      <p className="adm-record-card-title">{entry.summary}</p>
      <p className="adm-record-card-meta">
        By <Actor entry={entry} compact />
        {entry.ip ? (
          <>
            {" "}
            · IP <span className="adm-mono">{entry.ip}</span>
          </>
        ) : null}
      </p>
      <RecordLinks {...props} />
    </li>
  );
}

// ── Data protection requests ─────────────────────────────────────────────────

type ExportSummary = { email: string; fileName: string; applications: number; talentProfiles: number };

function countArray(value: unknown, key: string): number {
  if (!value || typeof value !== "object") return 0;
  const list = (value as Record<string, unknown>)[key];
  return Array.isArray(list) ? list.length : 0;
}

// Saves the export through a temporary object URL so failures (no records, expired session)
// can be reported on the page instead of as a failed browser download.
function saveJsonFile(data: unknown, fileName: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Some browsers start reading the object URL only after the click handler returns.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function DataProtectionCard({ onExported }: { onExported: () => void }) {
  const headingId = useId();
  const inputId = useId();
  const formErrorId = useId();
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [notFoundEmail, setNotFoundEmail] = useState<string | null>(null);
  const [lastExport, setLastExport] = useState<ExportSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => controllerRef.current?.abort();
  }, []);

  function focusLater(id: string) {
    window.requestAnimationFrame(() => document.getElementById(id)?.focus());
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    const errors: FieldErrors = {};
    const value = validateEmail(email, errors, "email", "Candidate email address");
    setNotFoundEmail(null);
    setLastExport(null);
    setFormError(null);
    if (errors.email) {
      setFieldError(errors.email);
      focusLater(inputId);
      return;
    }

    setFieldError(null);
    setBusy(true);
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const data = await adminFetch<unknown>(`/api/admin/candidates/export${buildQuery({ email: value })}`, { signal: controller.signal });
      const fileName = `candidate-data-${formatDeadlineDate(new Date())}.json`;
      saveJsonFile(data, fileName);
      const summary: ExportSummary = {
        email: value,
        fileName,
        applications: countArray(data, "applications"),
        talentProfiles: countArray(data, "talentPoolProfiles"),
      };
      setLastExport(summary);
      onExported();
    } catch (err) {
      if (controller.signal.aborted || isAbortError(err)) return;
      const apiError = toAdminApiError(err);
      if (apiError.code === "no_records") {
        setNotFoundEmail(value);
        focusLater(inputId);
      } else if (apiError.fields?.email) {
        setFieldError(apiError.fields.email);
        focusLater(inputId);
      } else {
        setFormError(apiError.message);
        focusLater(formErrorId);
      }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return (
    <section className="adm-card adm-panel" aria-labelledby={headingId}>
      <div className="adm-panel-header">
        <div className="adm-panel-heading">
          <p className="adm-eyebrow">Data protection requests</p>
          <h2 id={headingId} className="adm-title">
            Candidate data access and portability
          </h2>
        </div>
      </div>

      <p className="adm-subtitle">
        Sri Lanka&apos;s Personal Data Protection Act, No. 9 of 2022 (PDPA) gives candidates the right to access the personal data we hold
        about them. Where the EU General Data Protection Regulation (GDPR) applies, they may also ask to receive that data in a structured,
        machine-readable format (data portability).
      </p>
      <p className="adm-subtitle">
        Enter the email address the candidate applied with to download everything linked to it as a JSON file: applications, talent pool
        profiles, status history, HR notes, the names and sizes of uploaded documents, and notification email records. The CV files
        themselves are not included; download them from the candidate&apos;s record if they ask for copies.
      </p>

      <ul className="adm-subtitle list-disc space-y-1 pl-5">
        <li>Confirm the requester&apos;s identity first, for example by replying to the email address on file.</li>
        <li>The file contains personal data. Share it only through a secure channel and delete your copy once the request is closed.</li>
        <li>Every export is recorded in the activity log.</li>
      </ul>

      <form method="post" className="adm-form" style={{ maxWidth: "36rem" }} onSubmit={handleSubmit} noValidate aria-busy={busy || undefined}>
        {formError ? (
          <div id={formErrorId} className="adm-form-error" role="alert" tabIndex={-1}>
            {formError}
          </div>
        ) : null}
        <TextField
          id={inputId}
          label="Candidate email address"
          type="email"
          inputMode="email"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            setFieldError(null);
            setNotFoundEmail(null);
          }}
          maxLength={FIELD_LIMITS.email}
          required
          // Read-only rather than disabled while the export runs, so keyboard focus stays put.
          readOnly={busy}
          error={fieldError}
        />
        <div className="adm-cluster">
          <button type="submit" className="adm-btn adm-btn-primary" disabled={busy} aria-busy={busy || undefined}>
            {busy ? <Spinner size="sm" /> : <IconDownload className="adm-icon" />}
            {busy ? "Preparing…" : "Download data (JSON)"}
          </button>
        </div>
      </form>

      {/* Always mounted so the outcome is announced; visually hidden while empty. */}
      <div aria-live="polite" className={notFoundEmail || lastExport ? "adm-stack" : "adm-sr-only"}>
        {notFoundEmail ? (
          <Notice>
            No applications or talent pool profiles were found for <strong>{notFoundEmail}</strong>. Check the spelling, or ask the candidate
            which email address they used.
          </Notice>
        ) : null}
        {lastExport ? (
          <Notice tone="success">
            Downloaded <strong>{lastExport.fileName}</strong> for {lastExport.email}: {pluralize(lastExport.applications, "application")} and{" "}
            {pluralize(lastExport.talentProfiles, "talent pool profile")}.
          </Notice>
        ) : null}
      </div>

      <Notice>
        <p>
          <strong>Erasure requests (right to erasure):</strong> search for the candidate&apos;s email address in the Applications and Talent
          Pool tabs (include archived records), archive each of their records, then choose <strong>Permanently delete</strong> on each
          archived record. This removes the record, its uploaded documents and the related notification emails, and can&apos;t be undone.
          The activity log keeps a note of the deletion without the candidate&apos;s personal details.
        </p>
      </Notice>
    </section>
  );
}
