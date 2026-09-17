"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";
import { CAREER_DEPARTMENTS, FIELD_LIMITS, JOB_STATUS_LABELS, TALENT_SOURCE_LABELS, type JobStatus } from "@/lib/careers/constants";
import { formatDate, formatFileSize } from "@/lib/careers/format";
import { hasControlCharacters, validatePersonName, validatePhone, type FieldErrors } from "@/lib/careers/validation";
import type {
  AdminJob,
  AdminSessionUser,
  DocumentInfo,
  TalentApplyPayload,
  TalentApplyResponse,
  TalentDetail,
  TalentUpdatePayload,
} from "@/types/careers";
import { ADMIN_EVENTS, adminFetch, buildQuery, toAdminApiError, useAdminQuery, type AdminApiError } from "./api";
import {
  IconArchive,
  IconBriefcase,
  IconChat,
  IconClock,
  IconDocument,
  IconDownload,
  IconExternalLink,
  IconMail,
  IconPencil,
  IconPhone,
  IconRestore,
  IconShieldCheck,
  IconTag,
  IconTrash,
  IconUserCircle,
} from "./icons";
import {
  ApplicationStatusBadge,
  Badge,
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
  TextField,
  formatName,
  pluralize,
  useToast,
  type BadgeTone,
} from "./ui";

// ── Helpers ──────────────────────────────────────────────────────────────────

const DOCUMENT_URL_PREFIX = "/api/admin/documents/";

const ACTIVITY_LABELS: Record<string, string> = {
  created: "Profile created",
  profile_updated: "Profile updated",
  tags_changed: "Tags changed",
  note_added: "HR note added",
  archived: "Profile archived",
  restored: "Profile restored",
  applied_to_job: "Considered for a job",
  application_linked: "Application linked",
  application_deleted: "Linked application deleted",
};

export const TALENT_SOURCE_TONES: Record<TalentDetail["source"], BadgeTone> = {
  self_submitted: "sky",
  application: "indigo",
  hr_added: "teal",
  legacy: "slate",
};

function activityLabel(action: string): string {
  const known = ACTIVITY_LABELS[action];
  if (known) return known;
  const text = action.replace(/[_.]+/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "Update";
}

function timeValue(iso: string | null | undefined): number {
  const value = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(value) ? value : 0;
}

function newestFirst<T>(items: readonly T[], at: (item: T) => string): T[] {
  return [...items].sort((a, b) => timeValue(at(b)) - timeValue(at(a)));
}

// Mutation responses are shown immediately; a refetch replaces them only when it is at least as new.
function newestDetail(fromMutation: TalentDetail | null, fromQuery: TalentDetail | null): TalentDetail | null {
  if (!fromMutation) return fromQuery;
  if (!fromQuery) return fromMutation;
  return timeValue(fromMutation.updatedAt) > timeValue(fromQuery.updatedAt) ? fromMutation : fromQuery;
}

// Only ever link to the admin download endpoint, never to an arbitrary stored URL.
function documentHref(doc: DocumentInfo): string {
  return doc.downloadUrl.startsWith(DOCUMENT_URL_PREFIX) ? doc.downloadUrl : `${DOCUMENT_URL_PREFIX}${encodeURIComponent(doc.id)}`;
}

function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

function sameTags(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((tag) => b.includes(tag));
}

function withoutKey(errors: Record<string, string>, key: string): Record<string, string> {
  if (!(key in errors)) return errors;
  const next = { ...errors };
  delete next[key];
  return next;
}

export function openApplicationInAdmin(applicationId: string): void {
  window.dispatchEvent(new CustomEvent(ADMIN_EVENTS.openApplication, { detail: { id: applicationId } }));
}

// Errors that mean the profile changed or disappeared elsewhere; the view must be refreshed.
function isStaleProfileError(error: AdminApiError): boolean {
  if (error.status === 404) return error.code !== "job_not_found";
  return error.status === 409 && (error.code === "archived" || error.code === "talent_conflict" || error.code === "not_archived");
}

// adminFetch already redirects (401) or opens the password dialog (403 password_change_required).
function isHandledGlobally(error: AdminApiError): boolean {
  return error.status === 401 || (error.status === 403 && error.code === "password_change_required");
}

// ── Drawer ───────────────────────────────────────────────────────────────────

export type TalentDetailDrawerProps = {
  // null keeps the drawer closed.
  talentId: string | null;
  currentUser: AdminSessionUser;
  tagSuggestions?: string[];
  onClose: () => void;
  // Something on the profile changed: list rows, tag suggestions and dashboard counts may be stale.
  onChanged: () => void;
  // The profile was permanently deleted.
  onDeleted: () => void;
};

export function TalentDetailDrawer({ talentId, ...props }: TalentDetailDrawerProps) {
  if (!talentId) return null;
  // Keyed so switching profiles never shows one candidate's data under another's heading.
  return <TalentDetailView key={talentId} talentId={talentId} {...props} />;
}

type DialogKind = "edit" | "consider" | "archive" | "restore" | "purge";

function TalentDetailView({
  talentId,
  currentUser,
  tagSuggestions = [],
  onClose,
  onChanged,
  onDeleted,
}: Omit<TalentDetailDrawerProps, "talentId"> & { talentId: string }) {
  const toast = useToast();
  const path = `/api/admin/talent-pool/${encodeURIComponent(talentId)}`;
  const query = useAdminQuery<{ talent: TalentDetail }>(path);
  const [latest, setLatest] = useState<TalentDetail | null>(null);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [purging, setPurging] = useState(false);

  const talent = newestDetail(latest, query.data?.talent ?? null);
  const missing = query.error?.status === 404;
  const isAdmin = currentUser.role === "admin";
  const reloadProfile = query.reload;

  function applyDetail(next: TalentDetail) {
    setLatest(next);
    onChanged();
  }

  function reportFailure(err: unknown): void {
    const apiError = toAdminApiError(err);
    if (isHandledGlobally(apiError)) return;
    toast.error(apiError.message);
    if (isStaleProfileError(apiError)) {
      reloadProfile();
      onChanged();
    }
  }

  function handleStale(message: string) {
    setDialog(null);
    toast.error(message);
    reloadProfile();
    onChanged();
  }

  async function saveTags(tags: string[]): Promise<string | null> {
    try {
      const response = await adminFetch<{ talent: TalentDetail }>(path, { method: "PATCH", json: { tags } satisfies TalentUpdatePayload });
      applyDetail(response.talent);
      toast.success("Tags saved.");
      return null;
    } catch (err) {
      const apiError = toAdminApiError(err);
      if (apiError.status === 400) return apiError.fields?.tags ?? apiError.message;
      reportFailure(err);
      return null;
    }
  }

  async function addNote(body: string): Promise<string | null> {
    try {
      const response = await adminFetch<{ talent: TalentDetail }>(`${path}/notes`, { method: "POST", json: { body } });
      applyDetail(response.talent);
      toast.success("Note added.");
      return null;
    } catch (err) {
      const apiError = toAdminApiError(err);
      if (apiError.status === 400) return apiError.fields?.body ?? apiError.message;
      reportFailure(err);
      return null;
    }
  }

  async function restore() {
    if (restoring) return;
    setRestoring(true);
    try {
      const response = await adminFetch<{ talent: TalentDetail }>(`${path}/archive`, { method: "POST", json: { archived: false } });
      setDialog(null);
      applyDetail(response.talent);
      toast.success("Profile restored.");
    } catch (err) {
      setDialog(null);
      reportFailure(err);
    } finally {
      setRestoring(false);
    }
  }

  async function purge() {
    if (purging) return;
    setPurging(true);
    try {
      await adminFetch<{ success: true }>(path, { method: "DELETE" });
      toast.success("The profile and its documents were permanently deleted.");
      onDeleted();
    } catch (err) {
      setDialog(null);
      setPurging(false);
      reportFailure(err);
    }
  }

  function handleApplied(applicationId: string, jobTitle: string) {
    setDialog(null);
    toast.success(
      <>
        Application created for <strong>{jobTitle}</strong>.{" "}
        <button type="button" className="adm-btn adm-btn-link adm-btn-sm" onClick={() => openApplicationInAdmin(applicationId)}>
          Open application
        </button>
      </>,
      { durationMs: 10000 }
    );
    // The apply endpoint returns only the new application id; fetch the updated profile.
    reloadProfile();
    onChanged();
  }

  let body: ReactNode;
  if (missing) {
    body = (
      <EmptyState
        icon={<IconUserCircle className="adm-icon" />}
        title="This profile is no longer available."
        description="It may have been permanently deleted. Close this panel to return to the talent pool."
      />
    );
  } else if (!talent && query.error) {
    body = <ErrorBanner title="Couldn't load this profile." error={query.error} onRetry={reloadProfile} />;
  } else if (!talent) {
    body = <SkeletonRows rows={5} label="Loading profile…" />;
  } else {
    body = (
      <ProfileBody
        talent={talent}
        isAdmin={isAdmin}
        tagSuggestions={tagSuggestions}
        refreshError={query.error}
        onRetry={reloadProfile}
        onSaveTags={saveTags}
        onAddNote={addNote}
      />
    );
  }

  const footer =
    talent && !missing ? (
      talent.archived ? (
        <>
          {isAdmin ? (
            <button type="button" className="adm-btn adm-btn-danger" onClick={() => setDialog("purge")} disabled={purging || restoring}>
              <IconTrash className="adm-icon" />
              Delete permanently
            </button>
          ) : null}
          <span className="adm-footer-spacer" />
          <button type="button" className="adm-btn adm-btn-primary" onClick={() => setDialog("restore")} disabled={purging || restoring}>
            <IconRestore className="adm-icon" />
            Restore profile
          </button>
        </>
      ) : (
        <>
          <button type="button" className="adm-btn adm-btn-secondary" onClick={() => setDialog("archive")}>
            <IconArchive className="adm-icon" />
            Archive
          </button>
          <span className="adm-footer-spacer" />
          <button type="button" className="adm-btn adm-btn-secondary" onClick={() => setDialog("edit")}>
            <IconPencil className="adm-icon" />
            Edit profile
          </button>
          <button type="button" className="adm-btn adm-btn-primary" onClick={() => setDialog("consider")}>
            <IconBriefcase className="adm-icon" />
            Consider for a job
          </button>
        </>
      )
    ) : undefined;

  const subtitle =
    talent && !missing ? (
      <span className="adm-cluster">
        <Badge tone={TALENT_SOURCE_TONES[talent.source] ?? "slate"}>{TALENT_SOURCE_LABELS[talent.source] ?? talent.source}</Badge>
        {talent.archived ? <Badge tone="gray">Archived</Badge> : null}
        <span>
          {talent.areaOfInterest} · Added {formatDate(talent.createdAt)}
        </span>
      </span>
    ) : undefined;

  return (
    <>
      <Drawer
        open
        title={talent && !missing ? formatName(talent.name) : missing ? "Profile not found" : "Talent profile"}
        subtitle={subtitle}
        onClose={onClose}
        footer={footer}
      >
        {body}
      </Drawer>

      {talent && dialog === "edit" ? (
        <EditProfileDialog
          talent={talent}
          onClose={() => setDialog(null)}
          onSaved={(next) => {
            setDialog(null);
            applyDetail(next);
            toast.success("Profile updated.");
          }}
          onStale={handleStale}
        />
      ) : null}

      {talent && dialog === "consider" ? (
        <ConsiderForJobDialog talent={talent} onClose={() => setDialog(null)} onApplied={handleApplied} onStale={handleStale} />
      ) : null}

      {talent && dialog === "archive" ? (
        <ArchiveDialog
          talent={talent}
          onClose={() => setDialog(null)}
          onArchived={(next) => {
            setDialog(null);
            applyDetail(next);
            toast.success("Profile archived.");
          }}
          onStale={handleStale}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(talent) && dialog === "restore"}
        title="Restore this profile?"
        message={
          <>
            <strong>{formatName(talent?.name)}</strong> will appear in the talent pool again and can be edited and considered for jobs.
          </>
        }
        confirmLabel="Restore"
        tone="primary"
        busy={restoring}
        onConfirm={restore}
        onCancel={() => setDialog(null)}
      />

      <ConfirmDialog
        open={Boolean(talent) && dialog === "purge"}
        title="Permanently delete this profile?"
        message={
          <>
            All data for <strong>{formatName(talent?.name)}</strong> in the talent pool will be erased: contact details, tags, notes, activity
            and every stored document. Linked applications are kept but no longer point to this profile. This can&apos;t be undone.
          </>
        }
        confirmLabel="Delete permanently"
        tone="danger"
        requireText="DELETE"
        busy={purging}
        onConfirm={purge}
        onCancel={() => setDialog(null)}
      />
    </>
  );
}

// ── Profile body ─────────────────────────────────────────────────────────────

type ProfileBodyProps = {
  talent: TalentDetail;
  isAdmin: boolean;
  tagSuggestions: string[];
  refreshError: AdminApiError | null;
  onRetry: () => void;
  onSaveTags: (tags: string[]) => Promise<string | null>;
  onAddNote: (body: string) => Promise<string | null>;
};

function ProfileBody({ talent, isAdmin, tagSuggestions, refreshError, onRetry, onSaveTags, onAddNote }: ProfileBodyProps) {
  const name = formatName(talent.name);
  const notes = newestFirst(talent.notes, (note) => note.createdAt);
  const activity = newestFirst(talent.activity, (entry) => entry.at);
  const applications = newestFirst(talent.applications, (application) => application.createdAt);
  const readOnly = talent.archived;

  return (
    <div className="adm-stack">
      {refreshError ? <ErrorBanner title="Couldn't refresh this profile." error={refreshError} onRetry={onRetry} /> : null}

      {talent.archived ? (
        <Notice tone="warning">
          <p>
            Archived {formatDate(talent.archivedAt, { withTime: true })}
            {talent.archivedByName ? ` by ${talent.archivedByName}` : ""}.
            {talent.archiveReason ? ` Reason: ${talent.archiveReason}` : ""}
          </p>
          <p>
            Restore the profile to edit it, add notes or consider the candidate for a job.
            {isAdmin ? " To erase the candidate's data, use Delete permanently." : ""}
          </p>
        </Notice>
      ) : null}

      <div>
        <Section title="Profile">
          <dl className="adm-dl">
            <dt>Email</dt>
            <dd>
              <a className="adm-link inline-flex items-center gap-1.5 break-all" href={`mailto:${talent.email}`}>
                <IconMail className="adm-icon" />
                {talent.email}
              </a>
            </dd>
            <dt>Phone</dt>
            <dd>
              {talent.phone ? (
                <a className="adm-link inline-flex items-center gap-1.5 break-all" href={telHref(talent.phone)}>
                  <IconPhone className="adm-icon" />
                  {talent.phone}
                </a>
              ) : (
                "—"
              )}
            </dd>
            <dt>Area of interest</dt>
            <dd>
              <span className="adm-chip adm-chip-static">
                <span>{talent.areaOfInterest || "—"}</span>
              </span>
            </dd>
            <dt>Source</dt>
            <dd>
              <span className="adm-cluster">
                <span>{TALENT_SOURCE_LABELS[talent.source] ?? talent.source}</span>
                {talent.sourceApplicationId ? (
                  <button
                    type="button"
                    className="adm-btn adm-btn-link adm-btn-sm"
                    onClick={() => {
                      if (talent.sourceApplicationId) openApplicationInAdmin(talent.sourceApplicationId);
                    }}
                  >
                    View source application
                    <IconExternalLink className="adm-icon" />
                  </button>
                ) : null}
              </span>
            </dd>
            <dt>Consent</dt>
            <dd>
              {talent.consentGiven ? (
                <span className="adm-cluster">
                  <IconShieldCheck className="adm-icon" />
                  {talent.consentAt ? `Given ${formatDate(talent.consentAt, { withTime: true })}` : "Given"}
                </span>
              ) : (
                <Badge tone="amber">Not recorded</Badge>
              )}
            </dd>
            <dt>Added</dt>
            <dd>{formatDate(talent.createdAt, { withTime: true })}</dd>
            <dt>Last updated</dt>
            <dd>{formatDate(talent.updatedAt, { withTime: true })}</dd>
          </dl>
        </Section>

        <Section title="Tags">
          {readOnly ? (
            talent.tags.length > 0 ? (
              <ul className="adm-chips" aria-label="Tags">
                {talent.tags.map((tag) => (
                  <li key={tag} className="adm-chip adm-chip-static">
                    <span>{tag}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="adm-hint">No tags.</p>
            )
          ) : (
            <TagsEditor key={`${talent.id}|${talent.tags.join(",")}`} tags={talent.tags} suggestions={tagSuggestions} onSave={onSaveTags} />
          )}
        </Section>

        <Section title={`Documents (${talent.documents.length})`}>
          {talent.documents.length > 0 ? (
            <ul className="adm-doc-list">
              {talent.documents.map((doc) => (
                <DocumentRow key={doc.id} doc={doc} candidateName={name} />
              ))}
            </ul>
          ) : (
            <p className="adm-hint">No documents on file.</p>
          )}
        </Section>

        <Section title="Candidate's message">
          {talent.candidateNotes ? (
            <div className="adm-quote">
              <p className="adm-prose">{talent.candidateNotes}</p>
            </div>
          ) : (
            <p className="adm-hint">The candidate didn&apos;t include a message.</p>
          )}
        </Section>

        <Section title={`HR notes (${talent.notes.length})`}>
          {readOnly ? null : <NoteForm onSubmit={onAddNote} />}
          {notes.length > 0 ? (
            <ul className="adm-list" aria-label="HR notes, newest first">
              {notes.map((note) => (
                <li key={note.id} className="adm-note">
                  <p className="adm-prose">{note.body}</p>
                  <p className="adm-note-meta">
                    {formatName(note.authorName, "Unknown")} · <time dateTime={note.createdAt}>{formatDate(note.createdAt, { withTime: true })}</time>
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="adm-hint">No HR notes yet.</p>
          )}
        </Section>

        <Section title={`Applications (${Math.max(talent.applicationCount, applications.length)})`}>
          {applications.length > 0 ? (
            <>
              <ul className="adm-list" aria-label="Linked applications">
                {applications.map((application) => (
                  <li key={application.id} className="adm-row">
                    <div className="adm-row-main">
                      <span className="adm-row-icon" aria-hidden="true">
                        <IconBriefcase className="adm-icon" />
                      </span>
                      <div className="min-w-0">
                        <p className="adm-row-title">{application.jobTitle}</p>
                        <p className="adm-row-meta">
                          Applied {formatDate(application.createdAt)} · <span className="adm-mono">{application.jobId}</span>
                        </p>
                      </div>
                    </div>
                    <div className="adm-row-actions">
                      <ApplicationStatusBadge status={application.status} />
                      {application.archived ? <Badge tone="gray">Archived</Badge> : null}
                      <button
                        type="button"
                        className="adm-btn adm-btn-secondary adm-btn-sm"
                        onClick={() => openApplicationInAdmin(application.id)}
                        aria-label={`Open application for ${application.jobTitle}`}
                      >
                        Open
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              {talent.applicationCount > applications.length ? (
                <p className="adm-hint">Showing the {pluralize(applications.length, "most recent application")}.</p>
              ) : null}
            </>
          ) : (
            <p className="adm-hint">
              {readOnly ? "No applications are linked to this profile." : "No applications yet. Use “Consider for a job” to add this candidate to a role."}
            </p>
          )}
        </Section>

        <Section title="Activity">
          {activity.length > 0 ? (
            <ol className="adm-timeline" aria-label="Profile activity, newest first">
              {activity.map((entry) => (
                <li key={entry.id} className="adm-timeline-item">
                  <p className="adm-timeline-title">{activityLabel(entry.action)}</p>
                  {entry.detail ? <p className="adm-timeline-meta">{entry.detail}</p> : null}
                  <p className="adm-timeline-meta">
                    {entry.actorName ? `${entry.actorName} · ` : ""}
                    <time dateTime={entry.at}>{formatDate(entry.at, { withTime: true })}</time>
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="adm-hint">No activity recorded.</p>
          )}
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section className="adm-section" aria-labelledby={headingId}>
      <div className="adm-section-header">
        <h3 id={headingId} className="adm-section-title">
          {title}
        </h3>
      </div>
      {children}
    </section>
  );
}

function DocumentRow({ doc, candidateName }: { doc: DocumentInfo; candidateName: string }) {
  const kind = doc.kind === "cv" ? "CV" : "Supporting document";
  const facts = [kind, doc.size !== null ? formatFileSize(doc.size) : null, `Uploaded ${formatDate(doc.uploadedAt)}`].filter(Boolean).join(" · ");
  return (
    <li className="adm-doc">
      <span className="adm-doc-name">
        <IconDocument className="adm-icon" />
        <span className="grid min-w-0">
          <span>{doc.originalName}</span>
          <span className="adm-muted adm-text-sm font-medium">{facts}</span>
        </span>
      </span>
      {/* Same-tab navigation: the endpoint redirects to a short-lived attachment download. */}
      <a className="adm-btn adm-btn-secondary adm-btn-sm" href={documentHref(doc)} aria-label={`Download ${kind.toLowerCase()} ${doc.originalName} for ${candidateName}`}>
        <IconDownload className="adm-icon" />
        Download
      </a>
    </li>
  );
}

// ── Tags editor ──────────────────────────────────────────────────────────────

function TagsEditor({ tags, suggestions, onSave }: { tags: string[]; suggestions: string[]; onSave: (tags: string[]) => Promise<string | null> }) {
  const [draft, setDraft] = useState(tags);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = !sameTags(draft, tags);

  async function handleSave() {
    if (saving || !dirty) return;
    setSaving(true);
    setError(null);
    const problem = await onSave(draft);
    setSaving(false);
    if (problem) setError(problem);
  }

  return (
    <div className="adm-stack">
      <TagInput
        value={draft}
        onChange={(next) => {
          setDraft(next);
          setError(null);
        }}
        suggestions={suggestions}
        disabled={saving}
        label="Profile tags"
        hint="Press Enter or comma to add a tag, then save."
        error={error}
      />
      {dirty ? (
        <div className="adm-cluster">
          <button type="button" className="adm-btn adm-btn-primary adm-btn-sm" onClick={() => void handleSave()} disabled={saving} aria-busy={saving || undefined}>
            {saving ? <Spinner size="sm" /> : <IconTag className="adm-icon" />}
            {saving ? "Saving…" : "Save tags"}
          </button>
          <button
            type="button"
            className="adm-btn adm-btn-ghost adm-btn-sm"
            onClick={() => {
              setDraft(tags);
              setError(null);
            }}
            disabled={saving}
          >
            Discard changes
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ── Notes ────────────────────────────────────────────────────────────────────

function NoteForm({ onSubmit }: { onSubmit: (body: string) => Promise<string | null> }) {
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const text = body.trim();
    if (!text) {
      setError("Write a note before adding it.");
      document.getElementById(fieldId)?.focus();
      return;
    }
    if (text.length > FIELD_LIMITS.hrNote) {
      setError(`Notes must be ${FIELD_LIMITS.hrNote.toLocaleString("en-GB")} characters or fewer.`);
      return;
    }
    setSaving(true);
    setError(null);
    const problem = await onSubmit(text);
    setSaving(false);
    if (problem) setError(problem);
    else setBody("");
  }

  return (
    <form method="post" className="adm-stack" onSubmit={handleSubmit} noValidate>
      <TextAreaField
        id={fieldId}
        label="Add a note"
        rows={3}
        value={body}
        onChange={(event) => {
          setBody(event.target.value);
          setError(null);
        }}
        maxLength={FIELD_LIMITS.hrNote}
        placeholder="Interview feedback, availability, salary expectations…"
        hint="Notes are visible to the recruitment team and can't be edited once added."
        disabled={saving}
        error={error}
        counter
      />
      <div className="adm-cluster">
        <button type="submit" className="adm-btn adm-btn-primary adm-btn-sm" disabled={saving || body.trim() === ""} aria-busy={saving || undefined}>
          {saving ? <Spinner size="sm" /> : <IconChat className="adm-icon" />}
          {saving ? "Adding…" : "Add note"}
        </button>
      </div>
    </form>
  );
}

// ── Edit profile ─────────────────────────────────────────────────────────────

type EditValues = { name: string; phone: string; areaOfInterest: string };
const EDIT_FIELDS: readonly (keyof EditValues)[] = ["name", "phone", "areaOfInterest"];

function EditProfileDialog({
  talent,
  onClose,
  onSaved,
  onStale,
}: {
  talent: TalentDetail;
  onClose: () => void;
  onSaved: (talent: TalentDetail) => void;
  onStale: (message: string) => void;
}) {
  const [values, setValues] = useState<EditValues>({ name: talent.name, phone: talent.phone, areaOfInterest: talent.areaOfInterest });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const formId = useId();
  const idPrefix = useId();
  const areaListId = useId();
  const fieldId = (field: keyof EditValues) => `${idPrefix}-${field}`;

  function setField(field: keyof EditValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => withoutKey(current, field));
  }

  function showErrors(fieldErrors: Record<string, string>, message: string) {
    setErrors(fieldErrors);
    setFormError(message);
    const first = EDIT_FIELDS.find((field) => fieldErrors[field]);
    if (first) window.requestAnimationFrame(() => document.getElementById(fieldId(first))?.focus());
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    const clientErrors: FieldErrors = {};
    const name = validatePersonName(values.name, clientErrors);
    const phone = validatePhone(values.phone, clientErrors);
    const areaOfInterest = values.areaOfInterest.trim();
    if (!areaOfInterest) clientErrors.areaOfInterest = "Area of interest is required.";
    else if (areaOfInterest.length > FIELD_LIMITS.areaOfInterest) {
      clientErrors.areaOfInterest = `Area of interest must be ${FIELD_LIMITS.areaOfInterest} characters or fewer.`;
    } else if (hasControlCharacters(areaOfInterest)) {
      clientErrors.areaOfInterest = "Area of interest contains characters that are not allowed.";
    }
    if (Object.keys(clientErrors).length > 0) {
      showErrors(clientErrors, "Please fix the highlighted fields.");
      return;
    }

    const patch: TalentUpdatePayload = {};
    if (name !== talent.name) patch.name = name;
    if (phone !== talent.phone) patch.phone = phone;
    if (areaOfInterest !== talent.areaOfInterest) patch.areaOfInterest = areaOfInterest;
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }

    setSaving(true);
    setErrors({});
    setFormError(null);
    try {
      const response = await adminFetch<{ talent: TalentDetail }>(`/api/admin/talent-pool/${encodeURIComponent(talent.id)}`, {
        method: "PATCH",
        json: patch,
      });
      onSaved(response.talent);
    } catch (err) {
      setSaving(false);
      const apiError = toAdminApiError(err);
      if (isHandledGlobally(apiError)) {
        setFormError(apiError.message);
        return;
      }
      if (isStaleProfileError(apiError)) {
        onStale(apiError.message);
        return;
      }
      showErrors(apiError.fields ?? {}, apiError.message);
    }
  }

  const otherErrors = Object.entries(errors).filter(([field]) => !(EDIT_FIELDS as readonly string[]).includes(field));

  return (
    <Modal
      open
      size="md"
      title="Edit profile"
      description="The email address identifies the candidate and can't be changed."
      onClose={onClose}
      dismissible={!saving}
      closeOnBackdrop={false}
      footer={
        <>
          <button type="button" className="adm-btn adm-btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" form={formId} className="adm-btn adm-btn-primary" disabled={saving} aria-busy={saving || undefined}>
            {saving ? <Spinner size="sm" /> : null}
            {saving ? "Saving…" : "Save changes"}
          </button>
        </>
      }
    >
      <form method="post" id={formId} className="adm-form" onSubmit={handleSubmit} noValidate aria-busy={saving || undefined}>
        {formError ? (
          <div className="adm-form-error" role="alert">
            {formError}
            {otherErrors.length > 0 ? (
              <ul>
                {otherErrors.map(([field, message]) => (
                  <li key={field}>{message}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        <fieldset className="adm-fieldset adm-form" disabled={saving}>
          <legend className="adm-sr-only">Profile details</legend>
          <TextField id={`${idPrefix}-email`} label="Email address" value={talent.email} readOnly />
          <TextField
            id={fieldId("name")}
            label="Full name"
            value={values.name}
            onChange={(event) => setField("name", event.target.value)}
            maxLength={FIELD_LIMITS.name}
            required
            autoComplete="off"
            data-autofocus=""
            error={errors.name}
          />
          <TextField
            id={fieldId("phone")}
            label="Phone number"
            type="tel"
            inputMode="tel"
            value={values.phone}
            onChange={(event) => setField("phone", event.target.value)}
            maxLength={FIELD_LIMITS.phoneMax}
            required
            autoComplete="off"
            error={errors.phone}
          />
          <TextField
            id={fieldId("areaOfInterest")}
            label="Area of interest"
            value={values.areaOfInterest}
            onChange={(event) => setField("areaOfInterest", event.target.value)}
            list={areaListId}
            maxLength={FIELD_LIMITS.areaOfInterest}
            required
            autoComplete="off"
            error={errors.areaOfInterest}
          />
          <datalist id={areaListId}>
            {CAREER_DEPARTMENTS.map((department) => (
              <option key={department} value={department} />
            ))}
          </datalist>
        </fieldset>
      </form>
    </Modal>
  );
}

// ── Consider for a job ───────────────────────────────────────────────────────

const JOB_GROUP_ORDER: readonly Exclude<JobStatus, "archived">[] = ["published", "closed", "draft"];

function jobOptionLabel(job: AdminJob, alreadyApplied: boolean): string {
  const parts = [job.title];
  if (job.department) parts.push(job.department);
  let label = parts.join(" · ");
  if (job.status === "published" && !job.isOpen) label += " (deadline passed)";
  if (alreadyApplied) label += " — already applied";
  return label;
}

function ConsiderForJobDialog({
  talent,
  onClose,
  onApplied,
  onStale,
}: {
  talent: TalentDetail;
  onClose: () => void;
  onApplied: (applicationId: string, jobTitle: string) => void;
  onStale: (message: string) => void;
}) {
  const jobsQuery = useAdminQuery<{ items: AdminJob[] }>(`/api/admin/jobs${buildQuery({ status: "all" })}`);
  const [jobId, setJobId] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const formId = useId();
  const jobFieldId = useId();

  const jobs = (jobsQuery.data?.items ?? []).filter((job) => job.status !== "archived");
  const appliedJobIds = new Set(talent.applications.map((application) => application.jobId));
  const selectedJob = jobs.find((job) => job.id === jobId) ?? null;
  const reloadJobs = jobsQuery.reload;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (!selectedJob) {
      setErrors({ jobId: "Choose a job." });
      document.getElementById(jobFieldId)?.focus();
      return;
    }
    if (note.trim().length > FIELD_LIMITS.hrNote) {
      setErrors({ note: `Notes must be ${FIELD_LIMITS.hrNote.toLocaleString("en-GB")} characters or fewer.` });
      return;
    }

    setSaving(true);
    setErrors({});
    setFormError(null);
    const payload: TalentApplyPayload = { jobId: selectedJob.id, ...(note.trim() ? { note: note.trim() } : {}) };
    try {
      const response = await adminFetch<TalentApplyResponse>(`/api/admin/talent-pool/${encodeURIComponent(talent.id)}/apply`, {
        method: "POST",
        json: payload,
      });
      onApplied(response.applicationId, selectedJob.title);
    } catch (err) {
      setSaving(false);
      const apiError = toAdminApiError(err);
      if (isHandledGlobally(apiError)) {
        setFormError(apiError.message);
        return;
      }
      if (apiError.code === "job_not_found" || apiError.code === "job_archived" || apiError.code === "duplicate_application") {
        setErrors({ jobId: apiError.message });
        if (apiError.code !== "duplicate_application") reloadJobs();
        document.getElementById(jobFieldId)?.focus();
        return;
      }
      if (isStaleProfileError(apiError)) {
        onStale(apiError.message);
        return;
      }
      setErrors(apiError.fields ?? {});
      setFormError(apiError.message);
    }
  }

  let jobField: ReactNode;
  if (jobsQuery.data === null && jobsQuery.error) {
    jobField = <ErrorBanner title="Couldn't load job postings." error={jobsQuery.error} onRetry={reloadJobs} />;
  } else if (jobsQuery.data === null) {
    jobField = <SkeletonRows rows={1} label="Loading job postings…" />;
  } else if (jobs.length === 0) {
    jobField = <Notice tone="warning">There are no job postings to choose from. Create a job (a draft is enough) and try again.</Notice>;
  } else {
    jobField = (
      <SelectField
        id={jobFieldId}
        label="Job"
        value={jobId}
        onChange={(event) => {
          setJobId(event.target.value);
          setErrors((current) => withoutKey(current, "jobId"));
        }}
        placeholder="Choose a job"
        required
        error={errors.jobId}
        hint="Draft, published and closed jobs are listed. Archived jobs must be restored first."
      >
        {JOB_GROUP_ORDER.map((status) => {
          const group = jobs.filter((job) => job.status === status);
          if (group.length === 0) return null;
          return (
            <optgroup key={status} label={JOB_STATUS_LABELS[status]}>
              {group.map((job) => {
                const applied = appliedJobIds.has(job.id);
                return (
                  <option key={job.id} value={job.id} disabled={applied}>
                    {jobOptionLabel(job, applied)}
                  </option>
                );
              })}
            </optgroup>
          );
        })}
      </SelectField>
    );
  }

  return (
    <Modal
      open
      size="md"
      title="Consider for a job"
      description={
        <>
          Create an application for <strong>{formatName(talent.name)}</strong> using the documents on their profile. The candidate is not emailed.
        </>
      }
      onClose={onClose}
      dismissible={!saving}
      closeOnBackdrop={false}
      footer={
        <>
          <button type="button" className="adm-btn adm-btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="submit"
            form={formId}
            className="adm-btn adm-btn-primary"
            disabled={saving || jobs.length === 0}
            aria-busy={saving || undefined}
          >
            {saving ? <Spinner size="sm" /> : <IconBriefcase className="adm-icon" />}
            {saving ? "Creating…" : "Create application"}
          </button>
        </>
      }
    >
      <form method="post" id={formId} className="adm-form" onSubmit={handleSubmit} noValidate aria-busy={saving || undefined}>
        {formError ? (
          <div className="adm-form-error" role="alert">
            {formError}
          </div>
        ) : null}
        <fieldset className="adm-fieldset adm-form" disabled={saving}>
          <legend className="adm-sr-only">Job and note</legend>
          {jobField}
          {selectedJob ? (
            <div className="adm-quote adm-cluster">
              <JobStatusBadge status={selectedJob.status} isOpen={selectedJob.isOpen} />
              <span className="adm-text-sm adm-muted">
                {[selectedJob.location, selectedJob.type].filter(Boolean).join(" · ")}
                {selectedJob.applicationDeadline ? ` · Deadline ${formatDate(selectedJob.applicationDeadline)}` : ""}
              </span>
              <span className="adm-text-sm adm-muted adm-cluster">
                <IconClock className="adm-icon" />
                {pluralize(selectedJob.applicationCount, "applicant")}
              </span>
            </div>
          ) : null}
          {talent.documents.length === 0 ? (
            <Notice tone="warning">This profile has no documents, so the application will be created without a CV.</Notice>
          ) : null}
          <TextAreaField
            label="Note for the application"
            optional
            rows={3}
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
              setErrors((current) => withoutKey(current, "note"));
            }}
            maxLength={FIELD_LIMITS.hrNote}
            placeholder="Why this candidate fits the role…"
            hint="Added to the application's HR notes."
            error={errors.note}
            counter
          />
        </fieldset>
      </form>
    </Modal>
  );
}

// ── Archive ──────────────────────────────────────────────────────────────────

function ArchiveDialog({
  talent,
  onClose,
  onArchived,
  onStale,
}: {
  talent: TalentDetail;
  onClose: () => void;
  onArchived: (talent: TalentDetail) => void;
  onStale: (message: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const formId = useId();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (reason.trim().length > FIELD_LIMITS.archiveReason) {
      setError(`The reason must be ${FIELD_LIMITS.archiveReason} characters or fewer.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await adminFetch<{ talent: TalentDetail }>(`/api/admin/talent-pool/${encodeURIComponent(talent.id)}/archive`, {
        method: "POST",
        json: { archived: true, reason: reason.trim() },
      });
      onArchived(response.talent);
    } catch (err) {
      setSaving(false);
      const apiError = toAdminApiError(err);
      if (!isHandledGlobally(apiError) && (apiError.status === 404 || apiError.status === 409)) {
        onStale(apiError.message);
        return;
      }
      setError(apiError.fields?.reason ?? apiError.message);
    }
  }

  return (
    <Modal
      open
      size="md"
      title="Archive this profile?"
      description={
        <>
          <strong>{formatName(talent.name)}</strong> will be hidden from the talent pool list and can&apos;t be edited or considered for jobs until
          restored. Nothing is deleted.
        </>
      }
      onClose={onClose}
      dismissible={!saving}
      closeOnBackdrop={false}
      footer={
        <>
          <button type="button" className="adm-btn adm-btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" form={formId} className="adm-btn adm-btn-danger" disabled={saving} aria-busy={saving || undefined}>
            {saving ? <Spinner size="sm" /> : <IconArchive className="adm-icon" />}
            {saving ? "Archiving…" : "Archive profile"}
          </button>
        </>
      }
    >
      <form method="post" id={formId} className="adm-form" onSubmit={handleSubmit} noValidate>
        <TextAreaField
          label="Reason"
          optional
          rows={3}
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
            setError(null);
          }}
          maxLength={FIELD_LIMITS.archiveReason}
          placeholder="e.g. Candidate asked not to be contacted, hired elsewhere…"
          hint="Shown in the profile's activity history."
          disabled={saving}
          data-autofocus=""
          error={error}
          counter
        />
      </form>
    </Modal>
  );
}
