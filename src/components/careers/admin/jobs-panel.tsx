"use client";

import { useState, type ReactNode } from "react";
import { JOB_STATUS_TRANSITIONS, type JobStatus, type JobStatusAction } from "@/lib/careers/constants";
import { formatDate } from "@/lib/careers/format";
import type { AdminJob } from "@/types/careers";
import { ADMIN_AUTO_REFRESH_MS, ADMIN_EVENTS, adminFetch, buildQuery, toAdminApiError, useAdminQuery, type AdminApiError } from "./api";
import {
  IconArchive,
  IconBriefcase,
  IconCalendar,
  IconClock,
  IconExternalLink,
  IconEyeSlash,
  IconIdentification,
  IconLockClosed,
  IconLockOpen,
  IconPencil,
  IconPlus,
  IconPublish,
  IconRefresh,
  IconRestore,
  IconTrash,
} from "./icons";
import { JobEditor } from "./job-editor";
import {
  ConfirmDialog,
  EmptyState,
  ErrorBanner,
  JobStatusBadge,
  SearchInput,
  SelectField,
  SkeletonRows,
  Spinner,
  pluralize,
  useToast,
} from "./ui";

type StatusFilter = "active" | "all" | JobStatus;

const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "active", label: "Active (not archived)" },
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
  { value: "closed", label: "Closed" },
  { value: "archived", label: "Archived" },
  { value: "all", label: "All jobs" },
];

function isStatusFilter(value: string): value is StatusFilter {
  return STATUS_FILTER_OPTIONS.some((option) => option.value === value);
}

type RowAction = JobStatusAction | "delete";

type ActionMeta = {
  label: string;
  icon: ReactNode;
  variant: "primary" | "secondary" | "danger";
  success: string;
  confirm: {
    title: string;
    message: (job: AdminJob) => ReactNode;
    confirmLabel: string;
    tone: "danger" | "primary";
  } | null;
};

const ACTION_META: Record<RowAction, ActionMeta> = {
  publish: {
    label: "Publish",
    icon: <IconPublish className="adm-icon" />,
    variant: "primary",
    success: "Job published. It is now visible on the careers site.",
    confirm: {
      title: "Publish this job?",
      message: (job) => (
        <>
          <strong>{job.title}</strong> will appear on the careers site and start accepting applications.
        </>
      ),
      confirmLabel: "Publish",
      tone: "primary",
    },
  },
  reopen: {
    label: "Reopen",
    icon: <IconLockOpen className="adm-icon" />,
    variant: "primary",
    success: "Job reopened for applications.",
    confirm: {
      title: "Reopen this job?",
      message: (job) => (
        <>
          <strong>{job.title}</strong> will be published on the careers site again and accept new applications.
        </>
      ),
      confirmLabel: "Reopen",
      tone: "primary",
    },
  },
  close: {
    label: "Close",
    icon: <IconLockClosed className="adm-icon" />,
    variant: "secondary",
    success: "Job closed. It no longer accepts applications.",
    confirm: {
      title: "Close applications?",
      message: (job) => (
        <>
          <strong>{job.title}</strong> will be removed from the careers site and stop accepting applications. Existing applications are kept and
          you can reopen the job later.
        </>
      ),
      confirmLabel: "Close job",
      tone: "danger",
    },
  },
  unpublish: {
    label: "Unpublish",
    icon: <IconEyeSlash className="adm-icon" />,
    variant: "secondary",
    success: "Job moved back to drafts.",
    confirm: {
      title: "Unpublish this job?",
      message: (job) => (
        <>
          <strong>{job.title}</strong> will be removed from the careers site and moved back to drafts. Existing applications are kept.
        </>
      ),
      confirmLabel: "Unpublish",
      tone: "danger",
    },
  },
  restore: {
    label: "Restore",
    icon: <IconRestore className="adm-icon" />,
    variant: "secondary",
    success: "Job restored to drafts.",
    confirm: null,
  },
  archive: {
    label: "Archive",
    icon: <IconArchive className="adm-icon" />,
    variant: "secondary",
    success: "Job archived.",
    confirm: {
      title: "Archive this job?",
      message: (job) => (
        <>
          <strong>{job.title}</strong> will be hidden from the careers site and from the default job list. Its applications stay linked to it,
          and you can restore it later.
        </>
      ),
      confirmLabel: "Archive",
      tone: "danger",
    },
  },
  delete: {
    label: "Delete",
    icon: <IconTrash className="adm-icon" />,
    variant: "danger",
    success: "Job deleted.",
    confirm: {
      title: "Delete this job permanently?",
      message: (job) => (
        <>
          <strong>{job.title}</strong> has no applications and will be permanently deleted. This can&apos;t be undone.
        </>
      ),
      confirmLabel: "Delete job",
      tone: "danger",
    },
  },
};

// Order in which lifecycle buttons appear on a row.
const ACTION_ORDER: readonly JobStatusAction[] = ["publish", "reopen", "close", "unpublish", "restore", "archive"];
const DAY_MS = 24 * 60 * 60 * 1000;

function availableActions(job: AdminJob): RowAction[] {
  const actions: RowAction[] = ACTION_ORDER.filter((action) => JOB_STATUS_TRANSITIONS[action].from.includes(job.status));
  if (canDelete(job)) actions.push("delete");
  return actions;
}

// Mirrors the server rule: only drafts or archived jobs that never received an application.
function canDelete(job: AdminJob): boolean {
  return (job.status === "draft" || job.status === "archived") && job.applicationCount === 0;
}

function deadlineFact(job: AdminJob): { text: string; tone?: "warning" | "danger" } {
  if (!job.applicationDeadline) return { text: "No deadline" };
  const date = formatDate(job.applicationDeadline);
  const remaining = new Date(job.applicationDeadline).getTime() - Date.now();
  if (remaining < 0) return { text: `Deadline passed ${date}`, tone: job.status === "published" ? "danger" : undefined };
  if (remaining < 7 * DAY_MS && job.status === "published") return { text: `Closes ${date}`, tone: "warning" };
  return { text: `Closes ${date}` };
}

type EditorState = {
  job: AdminJob | null;
  initialError: { message: string; fields?: Record<string, string> } | null;
  // Remounts the editor when a different job (or a new create session) is opened.
  key: string;
};

type PendingAction = { job: AdminJob; action: RowAction };

export function JobsPanel({ onChanged }: { onChanged?: () => void }) {
  const toast = useToast();
  const [status, setStatus] = useState<StatusFilter>("active");
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editorSession, setEditorSession] = useState(0);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);

  const trimmedQuery = query.trim();
  const { data, error, loading, reload } = useAdminQuery<{ items: AdminJob[] }>(
    `/api/admin/jobs${buildQuery({ status, q: trimmedQuery || undefined })}`,
    [],
    { autoRefreshMs: ADMIN_AUTO_REFRESH_MS }
  );
  const jobs = data?.items ?? null;
  const filtered = status !== "active" || trimmedQuery !== "";
  const departmentSuggestions = jobs ? jobs.map((job) => job.department) : [];

  function openEditor(job: AdminJob | null, initialError: EditorState["initialError"] = null) {
    const session = editorSession + 1;
    setEditorSession(session);
    setEditor({ job, initialError, key: `${job?.id ?? "new"}-${session}` });
  }

  function clearFilters() {
    setStatus("active");
    setQuery("");
  }

  function showApplications(job: AdminJob) {
    window.dispatchEvent(new CustomEvent(ADMIN_EVENTS.filterApplications, { detail: { job: job.id } }));
  }

  function handleActionFailure(job: AdminJob, action: RowAction, apiError: AdminApiError) {
    if (apiError.code === "publish_requirements" && (action === "publish" || action === "reopen")) {
      toast.error("This job can't be published yet. Complete the highlighted fields.");
      openEditor(job, { message: apiError.message, fields: apiError.fields });
      return;
    }
    toast.error(apiError.message);
    // The job changed or vanished elsewhere; show the current state.
    if (apiError.status === 404 || apiError.status === 409) reload();
  }

  async function runAction(job: AdminJob, action: RowAction) {
    if (busyJobId) return;
    setBusyJobId(job.id);
    const path = `/api/admin/jobs/${encodeURIComponent(job.id)}`;
    try {
      if (action === "delete") await adminFetch<{ success: true }>(path, { method: "DELETE" });
      else await adminFetch<{ job: AdminJob }>(`${path}/status`, { method: "POST", json: { action } });
      setPending(null);
      toast.success(ACTION_META[action].success);
      reload();
      onChanged?.();
    } catch (err) {
      setPending(null);
      handleActionFailure(job, action, toAdminApiError(err));
    } finally {
      setBusyJobId(null);
    }
  }

  function requestAction(job: AdminJob, action: RowAction) {
    if (ACTION_META[action].confirm) setPending({ job, action });
    else void runAction(job, action);
  }

  function handleSaved(job: AdminJob, outcome: { created: boolean }) {
    setEditor(null);
    if (outcome.created) {
      toast.success(job.status === "published" ? `“${job.title}” is published.` : `“${job.title}” was saved as a draft.`);
    } else {
      toast.success(`Changes to “${job.title}” were saved.`);
    }
    reload();
    onChanged?.();
  }

  const pendingMeta = pending ? ACTION_META[pending.action] : null;

  let content: ReactNode;
  if (jobs === null && error) {
    content = <ErrorBanner title="Couldn't load job postings." error={error} onRetry={reload} />;
  } else if (jobs === null) {
    content = <SkeletonRows rows={4} label="Loading job postings…" />;
  } else if (jobs.length === 0) {
    content = filtered ? (
      <EmptyState
        icon={<IconBriefcase className="adm-icon" />}
        title="No jobs match your filters."
        description="Try a different search term or status."
        action={
          <button type="button" className="adm-btn adm-btn-secondary" onClick={clearFilters}>
            Clear filters
          </button>
        }
      />
    ) : (
      <EmptyState
        icon={<IconBriefcase className="adm-icon" />}
        title="No job postings yet."
        description="Create your first role. Save it as a draft to review it before publishing."
        action={
          <button type="button" className="adm-btn adm-btn-primary" onClick={() => openEditor(null)}>
            <IconPlus className="adm-icon" strokeWidth={2.5} />
            Add job
          </button>
        }
      />
    );
  } else {
    content = (
      <>
        {error ? <ErrorBanner title="Couldn't refresh job postings." error={error} onRetry={reload} /> : null}
        <ul className="adm-list" aria-label="Job postings" aria-busy={loading || undefined}>
          {jobs.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              busy={busyJobId === job.id}
              disabled={busyJobId !== null}
              onEdit={() => openEditor(job)}
              onAction={(action) => requestAction(job, action)}
              onShowApplications={() => showApplications(job)}
            />
          ))}
        </ul>
      </>
    );
  }

  const resultText =
    jobs === null
      ? loading
        ? "Loading job postings…"
        : ""
      : `${pluralize(jobs.length, "job")}${filtered ? " match your filters" : ""}`;

  return (
    <section className="adm-card adm-panel" aria-labelledby="admin-jobs-heading">
      <div className="adm-panel-header">
        <div className="adm-panel-heading">
          <p className="adm-eyebrow">Job Postings</p>
          <h2 id="admin-jobs-heading" className="adm-title">
            Manage roles
          </h2>
          <p className="adm-results" aria-live="polite">
            {resultText}
          </p>
        </div>
        <div className="adm-panel-actions">
          <button type="button" className="adm-btn adm-btn-secondary" onClick={reload} disabled={loading} aria-busy={loading || undefined}>
            {loading ? <Spinner size="sm" /> : <IconRefresh className="adm-icon" />}
            Refresh
          </button>
          <button type="button" className="adm-btn adm-btn-primary" onClick={() => openEditor(null)}>
            <IconPlus className="adm-icon" strokeWidth={2.5} />
            Add job
          </button>
        </div>
      </div>

      <div className="adm-toolbar" role="search" aria-label="Filter job postings">
        <SearchInput
          className="adm-toolbar-grow"
          label="Search"
          placeholder="Title, job ID, department or location"
          value={query}
          onChange={setQuery}
          debounceMs={300}
        />
        <SelectField
          label="Status"
          value={status}
          onChange={(event) => {
            if (isStatusFilter(event.target.value)) setStatus(event.target.value);
          }}
          options={STATUS_FILTER_OPTIONS}
        />
      </div>

      {content}

      <JobEditor
        key={editor?.key ?? "closed"}
        open={editor !== null}
        job={editor?.job ?? null}
        initialError={editor?.initialError ?? null}
        departmentSuggestions={departmentSuggestions}
        onClose={() => setEditor(null)}
        onSaved={handleSaved}
      />

      <ConfirmDialog
        open={pending !== null && pendingMeta?.confirm !== null}
        title={pendingMeta?.confirm?.title ?? ""}
        message={pending && pendingMeta?.confirm ? pendingMeta.confirm.message(pending.job) : ""}
        confirmLabel={pendingMeta?.confirm?.confirmLabel ?? "Confirm"}
        tone={pendingMeta?.confirm?.tone ?? "danger"}
        busy={pending !== null && busyJobId === pending.job.id}
        onConfirm={() => {
          if (pending) void runAction(pending.job, pending.action);
        }}
        onCancel={() => setPending(null)}
      />
    </section>
  );
}

type JobRowProps = {
  job: AdminJob;
  busy: boolean;
  disabled: boolean;
  onEdit: () => void;
  onAction: (action: RowAction) => void;
  onShowApplications: () => void;
};

function JobRow({ job, busy, disabled, onEdit, onAction, onShowApplications }: JobRowProps) {
  const deadline = deadlineFact(job);
  const actions = availableActions(job);
  const meta = [job.department, job.location, job.type, job.experience].filter(Boolean).join(" · ");
  const titleId = `admin-job-${job.id}`;

  return (
    <li className="adm-job" data-status={job.status} aria-labelledby={titleId} aria-busy={busy || undefined}>
      <div className="adm-row-main">
        <span className="adm-row-icon" aria-hidden="true">
          <IconBriefcase className="adm-icon" />
        </span>
        <div className="adm-job-body">
          <div className="adm-job-heading">
            <h3 id={titleId} className="adm-row-title">
              {job.title}
            </h3>
            <JobStatusBadge status={job.status} isOpen={job.isOpen} />
          </div>
          {meta ? <p className="adm-row-meta">{meta}</p> : null}
          <ul className="adm-job-facts">
            <li className="adm-job-fact">
              <IconIdentification className="adm-icon" />
              <span className="adm-sr-only">Job ID </span>
              <span className="adm-mono">{job.id}</span>
            </li>
            <li className="adm-job-fact" data-tone={deadline.tone}>
              <IconCalendar className="adm-icon" />
              {deadline.text}
            </li>
            <li className="adm-job-fact">
              <IconClock className="adm-icon" />
              Updated {formatDate(job.updatedAt)}
              {job.updatedByName ? ` by ${job.updatedByName}` : ""}
            </li>
          </ul>
          {job.status === "published" && !job.isOpen ? (
            <p className="adm-row-meta adm-job-fact" data-tone="danger">
              Hidden from the careers site because the deadline has passed. Edit the deadline or close the job.
            </p>
          ) : null}
        </div>
      </div>

      <div className="adm-job-side">
        <div className="adm-job-links">
          <button
            type="button"
            className="adm-count-btn"
            onClick={onShowApplications}
            aria-label={`View ${pluralize(job.applicationCount, "application")} for ${job.title}`}
          >
            <strong>{job.applicationCount.toLocaleString("en-GB")}</strong>
            {job.applicationCount === 1 ? "applicant" : "applicants"}
          </button>
          {job.isOpen ? (
            <a className="adm-link adm-text-sm adm-cluster" href={`/careers/${encodeURIComponent(job.id)}`} target="_blank" rel="noopener noreferrer">
              View live
              <IconExternalLink className="adm-icon" />
              <span className="adm-sr-only"> (opens in a new tab)</span>
            </a>
          ) : null}
        </div>
        <div className="adm-job-actions" role="group" aria-label={`Actions for ${job.title}`}>
          {busy ? <Spinner size="sm" label="Updating job…" /> : null}
          {job.status !== "archived" ? (
            <button type="button" className="adm-btn adm-btn-secondary adm-btn-sm" onClick={onEdit} disabled={disabled}>
              <IconPencil className="adm-icon" />
              Edit
            </button>
          ) : null}
          {actions.map((action) => {
            const actionMeta = ACTION_META[action];
            return (
              <button
                key={action}
                type="button"
                className={`adm-btn adm-btn-sm adm-btn-${actionMeta.variant}`}
                onClick={() => onAction(action)}
                disabled={disabled}
              >
                {actionMeta.icon}
                {actionMeta.label}
              </button>
            );
          })}
        </div>
      </div>
    </li>
  );
}
