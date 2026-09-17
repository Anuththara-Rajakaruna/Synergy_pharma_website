"use client";

// Detail drawer for one application: candidate profile, documents, cover letter, status changes
// with history, HR notes, email delivery, and the talent pool / archive / erasure actions.

import { useId, useState, type CSSProperties, type FormEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import {
  APPLICATION_STATUSES,
  APPLICATION_STATUS_LABELS,
  FIELD_LIMITS,
  type ApplicationSource,
  type ApplicationStatus,
} from "@/lib/careers/constants";
import { formatDate, formatFileSize } from "@/lib/careers/format";
import { isApplicationStatus } from "@/lib/careers/validation";
import type {
  AdminJob,
  AdminSessionUser,
  ApplicationDetail,
  ApplicationStatusChangePayload,
  ArchivePayload,
  DocumentInfo,
  EmailDeliveryInfo,
  MoveToTalentPoolPayload,
  MoveToTalentPoolResponse,
  NoteInfo,
  NotePayload,
  StatusHistoryEntry,
} from "@/types/careers";
import { ADMIN_EVENTS, adminFetch, toAdminApiError, useAdminQuery, type AdminApiError } from "./api";
import {
  IconArchive,
  IconDocument,
  IconDownload,
  IconExternalLink,
  IconIdentification,
  IconMail,
  IconRefresh,
  IconRestore,
  IconTrash,
  IconUserGroup,
  IconUserPlus,
} from "./icons";
import {
  ApplicationStatusBadge,
  Badge,
  CheckboxField,
  ConfirmDialog,
  Drawer,
  EmptyState,
  ErrorBanner,
  JobStatusBadge,
  Modal,
  Notice,
  SelectField,
  SkeletonRows,
  Spinner,
  TagInput,
  TextAreaField,
  formatName,
  pluralize,
  useToast,
  type BadgeTone,
} from "./ui";

const OBJECT_ID = /^[a-f0-9]{24}$/i;

export function isApplicationId(value: string | null | undefined): value is string {
  return typeof value === "string" && OBJECT_ID.test(value);
}

const SOURCE_LABELS: Record<ApplicationSource, string> = {
  website: "Careers website",
  talent_pool: "Added from the talent pool",
  legacy: "Imported from the previous system",
};

const DOCUMENT_KIND_LABELS: Record<DocumentInfo["kind"], string> = {
  cv: "CV",
  supporting: "Supporting document",
};

const EMAIL_TEMPLATE_LABELS = new Map<string, string>([
  ["application_received", "Application confirmation to the candidate"],
  ["hr_new_application", "New application alert to HR"],
  ["application_status_update", "Status update to the candidate"],
]);

const EMAIL_STATUS_META: Record<EmailDeliveryInfo["status"], { label: string; tone: BadgeTone }> = {
  pending: { label: "Queued", tone: "amber" },
  sending: { label: "Sending", tone: "sky" },
  sent: { label: "Sent", tone: "green" },
  failed: { label: "Failed", tone: "red" },
  skipped: { label: "Not sent", tone: "slate" },
};

// Keeps a trailing icon on the text line without turning the link into a full-width block.
const INLINE_ICON_LINK: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.3rem",
  maxWidth: "100%",
  overflowWrap: "anywhere",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function statusLabel(status: ApplicationStatus): string {
  return APPLICATION_STATUS_LABELS[status] ?? status;
}

function emailTemplateLabel(template: string): string {
  const known = EMAIL_TEMPLATE_LABELS.get(template);
  if (known) return known;
  const words = template.replace(/[_-]+/g, " ").trim();
  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : "Email";
}

// The local part is encoded so characters such as "?" or "&" cannot alter the mailto URL.
function mailtoHref(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return `mailto:${encodeURIComponent(email)}`;
  return `mailto:${encodeURIComponent(email.slice(0, at))}@${email.slice(at + 1)}`;
}

function telHref(phone: string): string | null {
  const digits = phone.replace(/[^\d+]/g, "");
  return digits ? `tel:${digits}` : null;
}

// Candidate-supplied links are only rendered as links when they are plain http(s) URLs.
function safeWebUrl(value: string | null): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

function documentHref(doc: DocumentInfo): string {
  return doc.downloadUrl.startsWith("/api/admin/documents/") ? doc.downloadUrl : `/api/admin/documents/${encodeURIComponent(doc.id)}`;
}

function talentProfileHref(id: string): string {
  return `/careers/admin?tab=talent&talent=${encodeURIComponent(id)}`;
}

// Plain left clicks switch tabs in place; modified clicks keep the normal link behaviour.
function openTalentProfile(event: ReactMouseEvent<HTMLAnchorElement>, id: string): void {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  window.dispatchEvent(new CustomEvent(ADMIN_EVENTS.openTalent, { detail: { id } }));
}

function timeValue(iso: string): number {
  const value = Date.parse(iso);
  return Number.isNaN(value) ? 0 : value;
}

// Newest first; entries with the same timestamp keep "last recorded first" order.
function newestFirst<T>(items: readonly T[], time: (item: T) => string): T[] {
  return items
    .map((item, index) => ({ item, index, at: timeValue(time(item)) }))
    .sort((a, b) => b.at - a.at || b.index - a.index)
    .map((entry) => entry.item);
}

function focusById(id: string): void {
  window.requestAnimationFrame(() => document.getElementById(id)?.focus());
}

// ── Drawer ───────────────────────────────────────────────────────────────────

export type ApplicationDetailDrawerProps = {
  // null keeps the drawer closed.
  applicationId: string | null;
  currentUser: AdminSessionUser;
  // Jobs from /api/admin/jobs?status=all (null while loading), used to link to live postings.
  jobs: AdminJob[] | null;
  onClose: () => void;
  // Called after any change to the application so lists and dashboard counts refresh.
  onChanged: () => void;
};

export function ApplicationDetailDrawer({ applicationId, ...props }: ApplicationDetailDrawerProps) {
  if (!applicationId) return null;
  // Keyed so switching applications never shows one record's form state under another.
  return <ApplicationDetailView key={applicationId} applicationId={applicationId} {...props} />;
}

type DialogKind = "talent" | "archive" | "restore" | "purge";

type LocalDetail = { detail: ApplicationDetail; basis: unknown };

type ViewProps = Omit<ApplicationDetailDrawerProps, "applicationId"> & { applicationId: string };

function ApplicationDetailView({ applicationId, currentUser, jobs, onClose, onChanged }: ViewProps) {
  const toast = useToast();
  const query = useAdminQuery<{ application: ApplicationDetail }>(`/api/admin/applications/${encodeURIComponent(applicationId)}`);
  // Mutations return the updated record; it replaces the fetched copy until the next fetch
  // completes, so saving never triggers another read (and another audit "view" entry).
  const [local, setLocal] = useState<LocalDetail | null>(null);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [purging, setPurging] = useState(false);

  const fetched = query.data?.application ?? null;
  const detail = local && local.basis === query.data ? local.detail : fetched;
  const isAdmin = currentUser.role === "admin";
  const locked = query.loading || restoring || purging;

  function applyUpdate(next: ApplicationDetail) {
    setLocal({ detail: next, basis: query.data });
    onChanged();
  }

  // Shared handling for errors that mean the record changed underneath us.
  function handleSharedError(apiError: AdminApiError): boolean {
    if (apiError.status === 404) {
      toast.error("This application no longer exists. It may have been permanently deleted.");
      onChanged();
      onClose();
      return true;
    }
    if (apiError.status === 409 && ["status_conflict", "archived", "not_archived"].includes(apiError.code)) {
      toast.error(apiError.message);
      query.reload();
      onChanged();
      return true;
    }
    return false;
  }

  async function handleRestore() {
    if (!detail || restoring) return;
    setRestoring(true);
    try {
      const payload: ArchivePayload = { archived: false };
      const response = await adminFetch<{ application: ApplicationDetail }>(
        `/api/admin/applications/${encodeURIComponent(detail.id)}/archive`,
        { method: "POST", json: payload }
      );
      setDialog(null);
      toast.success(`Application ${response.application.reference} was restored.`);
      applyUpdate(response.application);
    } catch (err) {
      setDialog(null);
      const apiError = toAdminApiError(err);
      if (!handleSharedError(apiError)) toast.error(apiError.message);
    } finally {
      setRestoring(false);
    }
  }

  async function handlePurge() {
    if (!detail || purging) return;
    setPurging(true);
    try {
      await adminFetch<{ success: true }>(`/api/admin/applications/${encodeURIComponent(detail.id)}`, { method: "DELETE" });
      setDialog(null);
      toast.success(`Application ${detail.reference} and its documents were permanently deleted.`);
      onChanged();
      onClose();
    } catch (err) {
      setDialog(null);
      setPurging(false);
      const apiError = toAdminApiError(err);
      if (!handleSharedError(apiError)) toast.error(apiError.message);
    }
  }

  const job = detail && jobs ? (jobs.find((item) => item.id === detail.jobId) ?? null) : null;

  let body: ReactNode;
  if (!detail) {
    if (query.error?.status === 404) {
      body = (
        <EmptyState
          icon={<IconIdentification className="adm-icon" />}
          title="Application not found"
          description="It may have been permanently deleted, or the link is incorrect."
          action={
            <button type="button" className="adm-btn adm-btn-secondary" onClick={onClose}>
              Close
            </button>
          }
        />
      );
    } else if (query.error) {
      body = <ErrorBanner title="Couldn't load this application." error={query.error} onRetry={query.reload} />;
    } else {
      body = <SkeletonRows rows={5} label="Loading application…" />;
    }
  } else {
    body = (
      <>
        {query.error ? <ErrorBanner title="Couldn't refresh this application." error={query.error} onRetry={query.reload} /> : null}
        {detail.archived ? <ArchivedNotice detail={detail} isAdmin={isAdmin} /> : null}
        <CandidateSection detail={detail} job={job} />
        <DocumentsSection documents={detail.documents} />
        <DetailSection title="Cover letter">
          {detail.coverLetter.trim() ? (
            <p className="adm-prose adm-quote">{detail.coverLetter}</p>
          ) : (
            <p className="adm-hint">No cover letter was provided.</p>
          )}
        </DetailSection>
        <DetailSection title="Status">
          {detail.archived ? (
            <p className="adm-hint">Restore this application to change its status.</p>
          ) : (
            <StatusChangeForm detail={detail} disabled={locked} onUpdated={applyUpdate} onSharedError={handleSharedError} />
          )}
        </DetailSection>
        <StatusHistorySection entries={detail.statusHistory} />
        <NotesSection detail={detail} disabled={locked} onUpdated={applyUpdate} onSharedError={handleSharedError} />
        <EmailsSection emails={detail.emails} refreshing={query.loading} onRefresh={query.reload} />
      </>
    );
  }

  const subtitle = detail ? (
    <span className="adm-cluster">
      <span className="adm-mono">{detail.reference}</span>
      <span aria-hidden="true">·</span>
      {job?.isOpen ? (
        <a className="adm-link" style={INLINE_ICON_LINK} href={`/careers/${encodeURIComponent(detail.jobId)}`} target="_blank" rel="noopener noreferrer">
          {detail.jobTitle}
          <IconExternalLink className="adm-icon" />
          <span className="adm-sr-only"> (opens the job posting in a new tab)</span>
        </a>
      ) : (
        <span>{detail.jobTitle}</span>
      )}
      <ApplicationStatusBadge status={detail.status} />
      {detail.archived ? <Badge tone="gray">Archived</Badge> : null}
      {detail.inTalentPool ? <Badge tone="teal">In talent pool</Badge> : null}
    </span>
  ) : query.loading ? (
    "Loading…"
  ) : undefined;

  const footer = detail ? (
    <>
      {!detail.archived ? (
        <button type="button" className="adm-btn adm-btn-secondary" onClick={() => setDialog("talent")} disabled={locked}>
          <IconUserPlus className="adm-icon" />
          {detail.inTalentPool ? "Update talent profile" : "Move to talent pool"}
        </button>
      ) : null}
      {detail.archived ? (
        <button type="button" className="adm-btn adm-btn-secondary" onClick={() => setDialog("restore")} disabled={locked}>
          <IconRestore className="adm-icon" />
          Restore
        </button>
      ) : (
        <button type="button" className="adm-btn adm-btn-secondary" onClick={() => setDialog("archive")} disabled={locked}>
          <IconArchive className="adm-icon" />
          Archive
        </button>
      )}
      <span className="adm-footer-spacer" />
      {isAdmin && detail.archived ? (
        <button type="button" className="adm-btn adm-btn-danger" onClick={() => setDialog("purge")} disabled={locked}>
          <IconTrash className="adm-icon" />
          Delete permanently
        </button>
      ) : null}
    </>
  ) : undefined;

  return (
    <>
      <Drawer open title={detail ? formatName(detail.name) : "Application"} subtitle={subtitle} onClose={onClose} footer={footer}>
        {body}
      </Drawer>

      {detail && dialog === "talent" ? (
        <MoveToTalentPoolDialog
          detail={detail}
          onClose={() => setDialog(null)}
          onMoved={(result) => applyUpdate({ ...detail, inTalentPool: true, talentPoolEntryId: result.talentPoolEntryId })}
          onSharedError={(apiError) => {
            if (!handleSharedError(apiError)) return false;
            setDialog(null);
            return true;
          }}
        />
      ) : null}

      {detail && dialog === "archive" ? (
        <ArchiveDialog
          detail={detail}
          isAdmin={isAdmin}
          onClose={() => setDialog(null)}
          onArchived={(next) => {
            setDialog(null);
            toast.success(`Application ${next.reference} was archived.`);
            applyUpdate(next);
          }}
          onSharedError={(apiError) => {
            if (!handleSharedError(apiError)) return false;
            setDialog(null);
            return true;
          }}
        />
      ) : null}

      <ConfirmDialog
        open={detail !== null && dialog === "restore"}
        title="Restore this application?"
        message={
          detail ? (
            <>
              The application from <strong>{formatName(detail.name)}</strong> ({detail.reference}) will return to the active list and can be updated
              again.
            </>
          ) : (
            ""
          )
        }
        confirmLabel="Restore"
        tone="primary"
        busy={restoring}
        onConfirm={handleRestore}
        onCancel={() => setDialog(null)}
      />

      <ConfirmDialog
        open={detail !== null && isAdmin && dialog === "purge"}
        title="Delete this application permanently?"
        message={
          detail ? (
            <>
              This erases the application from <strong>{formatName(detail.name)}</strong> ({detail.reference}): contact details, cover letter,
              documents, notes, status history and email records. It cannot be undone. A talent pool profile, if any, is kept.
            </>
          ) : (
            ""
          )
        }
        confirmLabel="Delete permanently"
        tone="danger"
        requireText="DELETE"
        busy={purging}
        onConfirm={handlePurge}
        onCancel={() => setDialog(null)}
      />
    </>
  );
}

// ── Sections ─────────────────────────────────────────────────────────────────

function DetailSection({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  const headingId = useId();
  return (
    <section className="adm-section" aria-labelledby={headingId}>
      <div className="adm-section-header">
        <h3 id={headingId} className="adm-section-title">
          {title}
        </h3>
        {actions}
      </div>
      {children}
    </section>
  );
}

function ArchivedNotice({ detail, isAdmin }: { detail: ApplicationDetail; isAdmin: boolean }) {
  return (
    <Notice tone="warning">
      <p>
        Archived {formatDate(detail.archivedAt, { withTime: true })}
        {detail.archivedByName ? ` by ${detail.archivedByName}` : ""}.
        {detail.archiveReason ? ` Reason: ${detail.archiveReason}` : ""}
      </p>
      <p>
        Archived applications are read-only. Restore it to change the status, add notes or move the candidate to the talent pool.
        {isAdmin ? " Administrators can also delete it permanently." : ""}
      </p>
    </Notice>
  );
}

function ExternalLink({ value }: { value: string | null }) {
  if (!value) return <>—</>;
  const url = safeWebUrl(value);
  if (!url) return <span className="adm-muted">{value}</span>;
  const text = url.href.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  return (
    <a className="adm-link" style={INLINE_ICON_LINK} href={url.href} target="_blank" rel="noopener noreferrer">
      {text}
      <IconExternalLink className="adm-icon" />
      <span className="adm-sr-only"> (opens in a new tab)</span>
    </a>
  );
}

function CandidateSection({ detail, job }: { detail: ApplicationDetail; job: AdminJob | null }) {
  const phoneLink = detail.phone ? telHref(detail.phone) : null;
  return (
    <DetailSection title="Candidate">
      <dl className="adm-dl">
        <dt>Email</dt>
        <dd>
          <a className="adm-link" href={mailtoHref(detail.email)}>
            {detail.email}
          </a>
        </dd>
        <dt>Phone</dt>
        <dd>
          {detail.phone ? (
            phoneLink ? (
              <a className="adm-link" href={phoneLink}>
                {detail.phone}
              </a>
            ) : (
              detail.phone
            )
          ) : (
            "—"
          )}
        </dd>
        <dt>LinkedIn</dt>
        <dd>
          <ExternalLink value={detail.linkedIn} />
        </dd>
        <dt>Portfolio</dt>
        <dd>
          <ExternalLink value={detail.portfolio} />
        </dd>
        <dt>Applied for</dt>
        <dd>
          <span className="adm-cluster">
            <span>
              {detail.jobTitle}
              {detail.department ? <span className="adm-muted"> · {detail.department}</span> : null}
            </span>
            {job ? <JobStatusBadge status={job.status} isOpen={job.isOpen} /> : null}
            {!detail.jobStillExists ? <Badge tone="gray">Posting deleted</Badge> : null}
          </span>
        </dd>
        <dt>Job ID</dt>
        <dd>
          <span className="adm-mono">{detail.jobId}</span>
        </dd>
        <dt>Source</dt>
        <dd>{SOURCE_LABELS[detail.source] ?? detail.source}</dd>
        <dt>Submitted</dt>
        <dd>{formatDate(detail.createdAt, { withTime: true })}</dd>
        <dt>Consent</dt>
        <dd>
          {detail.consentGiven
            ? `Given${detail.consentAt ? ` ${formatDate(detail.consentAt, { withTime: true })}` : ""}`
            : "Not recorded"}
        </dd>
        <dt>Talent pool</dt>
        <dd>
          {detail.talentPoolEntryId ? (
            <a
              className="adm-link" style={INLINE_ICON_LINK}
              href={talentProfileHref(detail.talentPoolEntryId)}
              onClick={(event) => {
                if (detail.talentPoolEntryId) openTalentProfile(event, detail.talentPoolEntryId);
              }}
            >
              <IconUserGroup className="adm-icon" />
              Open talent profile
            </a>
          ) : detail.inTalentPool ? (
            "Linked to a talent profile"
          ) : (
            "Not in the talent pool"
          )}
        </dd>
        <dt>Last updated</dt>
        <dd>{formatDate(detail.updatedAt, { withTime: true })}</dd>
      </dl>
    </DetailSection>
  );
}

function DocumentsSection({ documents }: { documents: DocumentInfo[] }) {
  return (
    <DetailSection title={`Documents (${documents.length})`}>
      {documents.length === 0 ? (
        <p className="adm-hint">No documents are stored for this application.</p>
      ) : (
        <ul className="adm-doc-list">
          {documents.map((doc) => {
            const size = doc.size === null ? null : formatFileSize(doc.size);
            return (
              <li key={doc.id} className="adm-doc">
                <div className="adm-stack" style={{ gap: "0.15rem", minWidth: 0 }}>
                  <span className="adm-doc-name">
                    <IconDocument className="adm-icon" />
                    {doc.originalName}
                  </span>
                  <span className="adm-hint">
                    {DOCUMENT_KIND_LABELS[doc.kind] ?? doc.kind}
                    {size ? ` · ${size}` : ""} · Uploaded {formatDate(doc.uploadedAt)}
                  </span>
                </div>
                <a className="adm-btn adm-btn-secondary adm-btn-sm" href={documentHref(doc)} aria-label={`Download ${doc.originalName}`}>
                  <IconDownload className="adm-icon" />
                  Download
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </DetailSection>
  );
}

type SharedErrorHandler = (apiError: AdminApiError) => boolean;

type StatusFieldErrors = Partial<Record<"status" | "note" | "candidateMessage", string>>;

function StatusChangeForm({
  detail,
  disabled,
  onUpdated,
  onSharedError,
}: {
  detail: ApplicationDetail;
  disabled: boolean;
  onUpdated: (next: ApplicationDetail) => void;
  onSharedError: SharedErrorHandler;
}) {
  const toast = useToast();
  const idPrefix = useId();
  const [target, setTarget] = useState<ApplicationStatus | "">("");
  const [note, setNote] = useState("");
  const [notify, setNotify] = useState(false);
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<StatusFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // A status chosen before the record changed elsewhere may now be the current one.
  const selected: ApplicationStatus | "" = target !== detail.status ? target : "";
  const canNotify = selected !== "" && selected !== "submitted";
  const sendEmail = canNotify && notify;
  const statusId = `${idPrefix}-status`;
  const noteId = `${idPrefix}-note`;
  const messageId = `${idPrefix}-message`;
  const formErrorId = `${idPrefix}-form-error`;

  const options = APPLICATION_STATUSES.filter((status) => status !== detail.status).map((status) => ({
    value: status,
    label: statusLabel(status),
  }));

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || disabled) return;
    if (!selected) {
      setErrors({ status: "Choose the new status." });
      setFormError(null);
      focusById(statusId);
      return;
    }

    const payload: ApplicationStatusChangePayload = {
      status: selected,
      expectedStatus: detail.status,
      note: note.trim(),
      notifyCandidate: sendEmail,
      candidateMessage: sendEmail ? message.trim() : "",
    };

    setSaving(true);
    setErrors({});
    setFormError(null);
    try {
      const response = await adminFetch<{ application: ApplicationDetail }>(
        `/api/admin/applications/${encodeURIComponent(detail.id)}/status`,
        { method: "POST", json: payload }
      );
      setTarget("");
      setNote("");
      setNotify(false);
      setMessage("");
      toast.success(`Status changed to ${statusLabel(selected)}.${sendEmail ? " The candidate will be emailed." : ""}`);
      onUpdated(response.application);
    } catch (err) {
      const apiError = toAdminApiError(err);
      if (onSharedError(apiError)) return;
      const fields = apiError.fields ?? {};
      const next: StatusFieldErrors = {
        status: fields.status ?? fields.expectedStatus,
        note: fields.note,
        candidateMessage: fields.candidateMessage,
      };
      setErrors(next);
      const known = new Set(Object.values(next).filter(Boolean));
      setFormError(known.has(apiError.message) ? null : apiError.message);
      if (next.status) focusById(statusId);
      else if (next.note) focusById(noteId);
      else if (next.candidateMessage) focusById(messageId);
      else focusById(formErrorId);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form method="post" className="adm-form" onSubmit={handleSubmit} noValidate aria-busy={saving || undefined}>
      <fieldset className="adm-fieldset adm-form" disabled={saving || disabled}>
        <legend className="adm-sr-only">Change the application status</legend>
        <p className="adm-hint">
          Current status: <strong>{statusLabel(detail.status)}</strong>, since {formatDate(detail.statusChangedAt, { withTime: true })}.
        </p>
        <SelectField
          id={statusId}
          label="New status"
          placeholder="Choose a status"
          value={selected}
          options={options}
          error={errors.status}
          onChange={(event) => {
            const value = event.target.value;
            setTarget(isApplicationStatus(value) ? value : "");
            setErrors((current) => ({ ...current, status: undefined }));
          }}
        />
        <TextAreaField
          id={noteId}
          label="Internal note"
          optional
          rows={3}
          value={note}
          maxLength={FIELD_LIMITS.statusNote}
          counter
          hint="Saved in the status history. Never sent to the candidate."
          error={errors.note}
          onChange={(event) => {
            setNote(event.target.value);
            setErrors((current) => ({ ...current, note: undefined }));
          }}
        />
        <CheckboxField
          label="Email the candidate about this update"
          checked={sendEmail}
          disabled={!canNotify}
          hint={
            selected === "submitted"
              ? "No email is sent when an application is moved back to Submitted."
              : "Sends the standard status email for the new status to the candidate's address."
          }
          onChange={(event) => setNotify(event.target.checked)}
        />
        {sendEmail ? (
          <TextAreaField
            id={messageId}
            label="Message to the candidate"
            optional
            rows={4}
            value={message}
            maxLength={FIELD_LIMITS.candidateMessage}
            counter
            hint="Added to the status email. Leave empty to send the standard wording only."
            error={errors.candidateMessage}
            onChange={(event) => {
              setMessage(event.target.value);
              setErrors((current) => ({ ...current, candidateMessage: undefined }));
            }}
          />
        ) : null}
        {formError ? (
          <p id={formErrorId} className="adm-form-error" role="alert" tabIndex={-1}>
            {formError}
          </p>
        ) : null}
        <div className="adm-cluster">
          <button type="submit" className="adm-btn adm-btn-primary" aria-busy={saving || undefined}>
            {saving ? <Spinner size="sm" /> : null}
            {saving ? "Updating…" : "Update status"}
          </button>
        </div>
      </fieldset>
    </form>
  );
}

function StatusHistorySection({ entries }: { entries: StatusHistoryEntry[] }) {
  const sorted = newestFirst(entries, (entry) => entry.changedAt);
  return (
    <DetailSection title="Status history">
      {sorted.length === 0 ? (
        <p className="adm-hint">No status changes have been recorded.</p>
      ) : (
        <ol className="adm-timeline">
          {sorted.map((entry) => (
            <li key={entry.id} className="adm-timeline-item">
              <p className="adm-timeline-title">
                {entry.from === null ? (
                  <>Application received as {statusLabel(entry.to)}</>
                ) : (
                  <>
                    {statusLabel(entry.from)} <span aria-hidden="true">→</span>
                    <span className="adm-sr-only"> changed to </span> {statusLabel(entry.to)}
                  </>
                )}
              </p>
              <p className="adm-timeline-meta">
                {formatDate(entry.changedAt, { withTime: true })}
                {entry.changedByName ? ` · ${entry.changedByName}` : ""}
              </p>
              {entry.note ? <p className="adm-prose">{entry.note}</p> : null}
              {entry.candidateNotified ? (
                <span className="adm-job-fact">
                  <IconMail className="adm-icon" />
                  Candidate emailed
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </DetailSection>
  );
}

function NotesSection({
  detail,
  disabled,
  onUpdated,
  onSharedError,
}: {
  detail: ApplicationDetail;
  disabled: boolean;
  onUpdated: (next: ApplicationDetail) => void;
  onSharedError: SharedErrorHandler;
}) {
  const toast = useToast();
  const noteFieldId = useId();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const notes: NoteInfo[] = newestFirst(detail.notes, (note) => note.createdAt);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || disabled) return;
    const body = draft.trim();
    if (!body) {
      setError("Write a note before saving.");
      focusById(noteFieldId);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload: NotePayload = { body };
      const response = await adminFetch<{ application: ApplicationDetail }>(
        `/api/admin/applications/${encodeURIComponent(detail.id)}/notes`,
        { method: "POST", json: payload }
      );
      setDraft("");
      toast.success("Note added.");
      onUpdated(response.application);
    } catch (err) {
      const apiError = toAdminApiError(err);
      if (onSharedError(apiError)) return;
      setError(apiError.fields?.body ?? apiError.message);
      focusById(noteFieldId);
    } finally {
      setSaving(false);
    }
  }

  return (
    <DetailSection title={`HR notes (${detail.notes.length})`}>
      {notes.length === 0 ? (
        <p className="adm-hint">No notes yet.</p>
      ) : (
        <ul className="adm-list">
          {notes.map((note) => (
            <li key={note.id} className="adm-note">
              <p className="adm-prose">{note.body}</p>
              <p className="adm-note-meta">
                {formatName(note.authorName, "Unknown")} · {formatDate(note.createdAt, { withTime: true })}
              </p>
            </li>
          ))}
        </ul>
      )}
      {detail.archived ? (
        <p className="adm-hint">Restore this application to add notes.</p>
      ) : (
        <form method="post" className="adm-form" onSubmit={handleSubmit} noValidate aria-busy={saving || undefined}>
          <fieldset className="adm-fieldset adm-form" disabled={saving || disabled}>
            <legend className="adm-sr-only">Add a note</legend>
            <TextAreaField
              id={noteFieldId}
              label="Add a note"
              rows={3}
              value={draft}
              maxLength={FIELD_LIMITS.hrNote}
              counter
              hint="Visible to the HR team only. Notes can't be edited or removed."
              error={error}
              onChange={(event) => {
                setDraft(event.target.value);
                setError(null);
              }}
            />
            <div className="adm-cluster">
              <button type="submit" className="adm-btn adm-btn-secondary" aria-busy={saving || undefined}>
                {saving ? <Spinner size="sm" /> : null}
                {saving ? "Saving…" : "Add note"}
              </button>
            </div>
          </fieldset>
        </form>
      )}
    </DetailSection>
  );
}

function EmailsSection({ emails, refreshing, onRefresh }: { emails: EmailDeliveryInfo[]; refreshing: boolean; onRefresh: () => void }) {
  const sorted = newestFirst(emails, (email) => email.createdAt);
  const failed = emails.filter((email) => email.status === "failed").length;
  return (
    <DetailSection
      title="Emails"
      actions={
        <button type="button" className="adm-btn adm-btn-ghost adm-btn-sm" onClick={onRefresh} disabled={refreshing} aria-busy={refreshing || undefined}>
          {refreshing ? <Spinner size="sm" /> : <IconRefresh className="adm-icon" />}
          Refresh
        </button>
      }
    >
      {failed > 0 ? (
        <Notice tone="warning">
          {pluralize(failed, "email")} to or about this candidate could not be delivered. Contact the candidate directly if needed.
        </Notice>
      ) : null}
      {sorted.length === 0 ? (
        <p className="adm-hint">No emails have been recorded for this application.</p>
      ) : (
        <ul className="adm-doc-list">
          {sorted.map((email) => {
            const meta = EMAIL_STATUS_META[email.status] ?? { label: email.status, tone: "slate" as BadgeTone };
            return (
              <li key={email.id} className="adm-doc">
                <div className="adm-stack" style={{ gap: "0.15rem", minWidth: 0 }}>
                  <span className="adm-doc-name">
                    <IconMail className="adm-icon" />
                    {emailTemplateLabel(email.template)}
                  </span>
                  <span className="adm-hint">
                    Queued {formatDate(email.createdAt, { withTime: true })}
                    {email.sentAt ? ` · Sent ${formatDate(email.sentAt, { withTime: true })}` : ""}
                    {email.attempts > 0 ? ` · ${pluralize(email.attempts, "attempt")}` : ""}
                  </span>
                </div>
                <Badge tone={meta.tone} dot>
                  {meta.label}
                </Badge>
              </li>
            );
          })}
        </ul>
      )}
      <p className="adm-hint">Emails are sent in the background and retried automatically when delivery fails.</p>
    </DetailSection>
  );
}

// ── Dialogs ──────────────────────────────────────────────────────────────────

function MoveToTalentPoolDialog({
  detail,
  onClose,
  onMoved,
  onSharedError,
}: {
  detail: ApplicationDetail;
  onClose: () => void;
  onMoved: (result: MoveToTalentPoolResponse) => void;
  onSharedError: SharedErrorHandler;
}) {
  const toast = useToast();
  const formId = useId();
  const noteId = useId();
  const tagsId = useId();
  const formErrorId = useId();
  const tagSuggestions = useAdminQuery<{ tags: string[] }>("/api/admin/talent-pool/tags");
  const [tags, setTags] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<{ tags?: string; note?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<MoveToTalentPoolResponse | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setErrors({});
    setFormError(null);
    try {
      const payload: MoveToTalentPoolPayload = { tags, note: note.trim() };
      const response = await adminFetch<MoveToTalentPoolResponse>(
        `/api/admin/applications/${encodeURIComponent(detail.id)}/talent-pool`,
        { method: "POST", json: payload }
      );
      setResult(response);
      toast.success(response.created ? "Candidate added to the talent pool." : "Linked to the candidate's existing talent profile.");
      onMoved(response);
      focusById(`${formId}-result`);
    } catch (err) {
      const apiError = toAdminApiError(err);
      if (onSharedError(apiError)) return;
      const fields = apiError.fields ?? {};
      setErrors({ tags: fields.tags, note: fields.note });
      setFormError(fields.tags || fields.note ? null : apiError.message);
      if (fields.tags) focusById(tagsId);
      else if (fields.note) focusById(noteId);
      else focusById(formErrorId);
    } finally {
      setSaving(false);
    }
  }

  const footer = result ? (
    <>
      <a
        className="adm-btn adm-btn-secondary"
        href={talentProfileHref(result.talentPoolEntryId)}
        onClick={(event) => openTalentProfile(event, result.talentPoolEntryId)}
      >
        <IconUserGroup className="adm-icon" />
        Open talent profile
      </a>
      <button type="button" className="adm-btn adm-btn-primary" onClick={onClose}>
        Done
      </button>
    </>
  ) : (
    <>
      <button type="button" className="adm-btn adm-btn-secondary" onClick={onClose} disabled={saving}>
        Cancel
      </button>
      <button type="submit" form={formId} className="adm-btn adm-btn-primary" disabled={saving} aria-busy={saving || undefined}>
        {saving ? <Spinner size="sm" /> : <IconUserPlus className="adm-icon" />}
        {saving ? "Saving…" : "Add to talent pool"}
      </button>
    </>
  );

  return (
    <Modal
      open
      size="md"
      title="Move to talent pool"
      description={
        <>
          {formatName(detail.name)} · {detail.reference}
        </>
      }
      onClose={onClose}
      dismissible={!saving}
      footer={footer}
    >
      {result ? (
        <div id={`${formId}-result`} tabIndex={-1} className="adm-stack">
          <Notice tone="success">
            {result.created ? (
              <p>A new talent profile was created with this application&apos;s contact details and documents.</p>
            ) : (
              <p>Linked to existing talent profile. The application, tags and note were added to the candidate&apos;s profile.</p>
            )}
          </Notice>
        </div>
      ) : (
        <form method="post" id={formId} className="adm-form" onSubmit={handleSubmit} noValidate aria-busy={saving || undefined}>
          <fieldset className="adm-fieldset adm-form" disabled={saving}>
            <legend className="adm-sr-only">Talent pool details</legend>
            {detail.inTalentPool ? (
              <Notice>
                <p>This candidate already has a talent profile. Tags and the note below are added to that profile.</p>
              </Notice>
            ) : (
              <p className="adm-hint">
                A talent profile is created from this application (or the candidate&apos;s existing profile is reused), so HR can consider them for future
                roles. Their documents are copied to the profile.
              </p>
            )}
            <TagInput
              id={tagsId}
              label="Tags"
              value={tags}
              onChange={(next) => {
                setTags(next);
                setErrors((current) => ({ ...current, tags: undefined }));
              }}
              suggestions={tagSuggestions.data?.tags ?? []}
              error={errors.tags}
              disabled={saving}
            />
            <TextAreaField
              id={noteId}
              label="Note for the talent profile"
              optional
              rows={3}
              value={note}
              maxLength={FIELD_LIMITS.hrNote}
              counter
              error={errors.note}
              onChange={(event) => {
                setNote(event.target.value);
                setErrors((current) => ({ ...current, note: undefined }));
              }}
            />
            {formError ? (
              <p id={formErrorId} className="adm-form-error" role="alert" tabIndex={-1}>
                {formError}
              </p>
            ) : null}
          </fieldset>
        </form>
      )}
    </Modal>
  );
}

function ArchiveDialog({
  detail,
  isAdmin,
  onClose,
  onArchived,
  onSharedError,
}: {
  detail: ApplicationDetail;
  isAdmin: boolean;
  onClose: () => void;
  onArchived: (next: ApplicationDetail) => void;
  onSharedError: SharedErrorHandler;
}) {
  const formId = useId();
  const reasonId = useId();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const payload: ArchivePayload = { archived: true, reason: reason.trim() };
      const response = await adminFetch<{ application: ApplicationDetail }>(
        `/api/admin/applications/${encodeURIComponent(detail.id)}/archive`,
        { method: "POST", json: payload }
      );
      onArchived(response.application);
    } catch (err) {
      const apiError = toAdminApiError(err);
      setSaving(false);
      if (onSharedError(apiError)) return;
      setError(apiError.fields?.reason ?? apiError.message);
      focusById(reasonId);
    }
  }

  return (
    <Modal
      open
      size="sm"
      title="Archive this application?"
      description={
        <>
          {formatName(detail.name)} · {detail.reference}
        </>
      }
      onClose={onClose}
      dismissible={!saving}
      footer={
        <>
          <button type="button" className="adm-btn adm-btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" form={formId} className="adm-btn adm-btn-primary" disabled={saving} aria-busy={saving || undefined}>
            {saving ? <Spinner size="sm" /> : <IconArchive className="adm-icon" />}
            {saving ? "Archiving…" : "Archive"}
          </button>
        </>
      }
    >
      <form method="post" id={formId} className="adm-form" onSubmit={handleSubmit} noValidate aria-busy={saving || undefined}>
        <fieldset className="adm-fieldset adm-form" disabled={saving}>
          <legend className="adm-sr-only">Archive details</legend>
          <p className="adm-hint">
            The application is hidden from the default list and becomes read-only. Nothing is deleted, and it can be restored at any time.
            {isAdmin ? " Archived applications can be deleted permanently for erasure requests." : ""}
          </p>
          <TextAreaField
            id={reasonId}
            label="Reason"
            optional
            rows={3}
            value={reason}
            maxLength={FIELD_LIMITS.archiveReason}
            counter
            error={error}
            onChange={(event) => {
              setReason(event.target.value);
              setError(null);
            }}
          />
        </fieldset>
      </form>
    </Modal>
  );
}
