"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { CAREER_DEPARTMENTS, FIELD_LIMITS, JOB_TYPES, type JobType } from "@/lib/careers/constants";
import { formatDate } from "@/lib/careers/format";
import {
  formatDeadlineDate,
  normalizeList,
  parseDeadlineDate,
  slugify,
  validateJobInput,
} from "@/lib/careers/validation";
import type { AdminJob, JobEditorPayload } from "@/types/careers";
import { adminFetch, toAdminApiError } from "./api";
import { ConfirmDialog, JobStatusBadge, Modal, Notice, SelectField, Spinner, TextAreaField, TextField, pluralize } from "./ui";

type EditorValues = {
  slug: string;
  title: string;
  department: string;
  location: string;
  type: JobType;
  experience: string;
  applicationDeadline: string;
  description: string;
  responsibilities: string;
  requirements: string;
  qualifications: string;
  benefits: string;
};

type FieldName = keyof EditorValues;
type SaveIntent = "draft" | "published" | "update";

// Visual order of the form; used to focus the first field with an error.
const FIELD_ORDER: readonly FieldName[] = [
  "title",
  "slug",
  "department",
  "location",
  "type",
  "experience",
  "applicationDeadline",
  "description",
  "responsibilities",
  "requirements",
  "qualifications",
  "benefits",
];

const FIELD_LABELS: Record<FieldName, string> = {
  slug: "Job ID",
  title: "Job title",
  department: "Department",
  location: "Location",
  type: "Employment type",
  experience: "Experience",
  applicationDeadline: "Application deadline",
  description: "Description",
  responsibilities: "Responsibilities",
  requirements: "Requirements",
  qualifications: "Qualifications",
  benefits: "Benefits",
};

const TYPE_OPTIONS = JOB_TYPES.map((type) => ({ value: type, label: type }));

function isFieldName(value: string): value is FieldName {
  return (FIELD_ORDER as readonly string[]).includes(value);
}

function isJobType(value: string): value is JobType {
  return (JOB_TYPES as readonly string[]).includes(value);
}

function valuesFromJob(job: AdminJob | null): EditorValues {
  if (!job) {
    return {
      slug: "",
      title: "",
      department: "",
      location: "",
      type: "Full-time",
      experience: "",
      applicationDeadline: "",
      description: "",
      responsibilities: "",
      requirements: "",
      qualifications: "",
      benefits: "",
    };
  }
  return {
    slug: job.id,
    title: job.title,
    department: job.department,
    location: job.location,
    type: job.type,
    experience: job.experience,
    applicationDeadline: job.applicationDeadline ? formatDeadlineDate(job.applicationDeadline) : "",
    description: job.description,
    responsibilities: job.responsibilities.join("\n"),
    requirements: job.requirements.join("\n"),
    qualifications: job.qualifications.join("\n"),
    benefits: job.benefits.join("\n"),
  };
}

function withoutKey(errors: Record<string, string>, key: string): Record<string, string> {
  if (!(key in errors)) return errors;
  const next = { ...errors };
  delete next[key];
  return next;
}

function listCount(text: string): number {
  return normalizeList(text)?.length ?? 0;
}

function isPastDeadline(value: string): boolean {
  const deadline = parseDeadlineDate(value);
  return deadline !== null && deadline.getTime() < Date.now();
}

// The job ID a new job will get: what the user typed, or the title-based default.
function effectiveSlug(values: EditorValues): string {
  return values.slug.trim().toLowerCase() || slugify(values.title);
}

function buildPayload(values: EditorValues, isEdit: boolean): JobEditorPayload {
  return {
    ...(isEdit ? {} : { slug: effectiveSlug(values) }),
    title: values.title,
    department: values.department,
    location: values.location,
    type: values.type,
    experience: values.experience,
    description: values.description,
    responsibilities: normalizeList(values.responsibilities) ?? [],
    requirements: normalizeList(values.requirements) ?? [],
    qualifications: normalizeList(values.qualifications) ?? [],
    benefits: normalizeList(values.benefits) ?? [],
    applicationDeadline: values.applicationDeadline || null,
  };
}

export type JobEditorProps = {
  open: boolean;
  // null creates a new job.
  job: AdminJob | null;
  // Errors to show when the editor opens, e.g. a failed publish from the jobs list.
  initialError?: { message: string; fields?: Record<string, string> } | null;
  departmentSuggestions?: string[];
  onClose: () => void;
  onSaved: (job: AdminJob, outcome: { created: boolean }) => void;
};

export function JobEditor({ open, ...props }: JobEditorProps) {
  if (!open) return null;
  // Mounting the dialog only while open gives every session a fresh form state.
  return <JobEditorDialog {...props} />;
}

function JobEditorDialog({ job, initialError, departmentSuggestions = [], onClose, onSaved }: Omit<JobEditorProps, "open">) {
  const isEdit = job !== null;
  const [initialValues] = useState(() => valuesFromJob(job));
  const [values, setValues] = useState(initialValues);
  const [slugEdited, setSlugEdited] = useState(isEdit);
  const [errors, setErrors] = useState<Record<string, string>>(initialError?.fields ?? {});
  const [formError, setFormError] = useState<string | null>(initialError?.message ?? null);
  const [saving, setSaving] = useState<SaveIntent | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const formId = useId();
  const idPrefix = useId();
  const departmentListId = useId();
  const titleRef = useRef<HTMLInputElement>(null);
  const formErrorRef = useRef<HTMLDivElement>(null);

  const dirty = FIELD_ORDER.some((field) => values[field] !== initialValues[field]);
  const fieldId = (field: FieldName) => `${idPrefix}-${field}`;

  // Warn before a reload or tab close throws away unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty]);

  // Errors passed in when the editor opens (a failed publish) get focus like submit errors.
  useEffect(() => {
    if (!initialError) return;
    const first = FIELD_ORDER.find((field) => initialError.fields?.[field]);
    const target = first ? document.getElementById(`${idPrefix}-${first}`) : formErrorRef.current;
    target?.focus();
  }, [initialError, idPrefix]);

  const departments = Array.from(new Set([...CAREER_DEPARTMENTS, ...departmentSuggestions.map((item) => item.trim()).filter(Boolean)])).sort(
    (a, b) => a.localeCompare(b)
  );

  function setField<K extends FieldName>(field: K, value: EditorValues[K]) {
    setValues((current) => {
      const next = { ...current, [field]: value };
      if (field === "title" && !slugEdited && !isEdit) next.slug = slugify(String(value));
      return next;
    });
    setErrors((current) => {
      let next = withoutKey(current, field);
      if (field === "title" && !slugEdited) next = withoutKey(next, "slug");
      return next;
    });
  }

  function handleSlugChange(raw: string) {
    const slug = raw.toLowerCase().replace(/\s+/g, "-");
    // Clearing the field hands the job ID back to the automatic title-based value.
    setSlugEdited(slug !== "");
    setValues((current) => ({ ...current, slug }));
    setErrors((current) => withoutKey(current, "slug"));
  }

  function requestClose() {
    if (saving) return;
    if (dirty) setConfirmDiscard(true);
    else onClose();
  }

  function focusFirstError(fieldErrors: Record<string, string>) {
    const first = FIELD_ORDER.find((field) => fieldErrors[field]);
    // Wait for the error messages to render so aria-describedby points at real content.
    window.requestAnimationFrame(() => {
      const target = first ? document.getElementById(fieldId(first)) : formErrorRef.current;
      target?.focus();
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const intent: SaveIntent = isEdit ? "update" : submitter?.getAttribute("data-intent") === "published" ? "published" : "draft";

    const payload = buildPayload(values, isEdit);
    const result = validateJobInput(payload, isEdit ? "update" : "create");
    const clientErrors: Record<string, string> = result.ok ? {} : { ...result.errors };
    const goingLive = intent === "published" || (isEdit && job.status === "published" && values.applicationDeadline !== initialValues.applicationDeadline);
    if (goingLive && !clientErrors.applicationDeadline && isPastDeadline(values.applicationDeadline)) {
      clientErrors.applicationDeadline = "The application deadline has passed. Choose a future date or clear the deadline.";
    }
    if (Object.keys(clientErrors).length > 0) {
      setErrors(clientErrors);
      setFormError(
        intent === "published" ? "This job can't be published yet. Fix the highlighted fields and try again." : "Please fix the highlighted fields."
      );
      focusFirstError(clientErrors);
      return;
    }

    setSaving(intent);
    setErrors({});
    setFormError(null);
    try {
      const response = isEdit
        ? await adminFetch<{ job: AdminJob }>(`/api/admin/jobs/${encodeURIComponent(job.id)}`, { method: "PATCH", json: payload })
        : await adminFetch<{ job: AdminJob }>("/api/admin/jobs", { method: "POST", json: { ...payload, status: intent } });
      onSaved(response.job, { created: !isEdit });
    } catch (err) {
      const apiError = toAdminApiError(err);
      const fieldErrors = apiError.fields ?? {};
      setErrors(fieldErrors);
      setFormError(apiError.message);
      setSaving(null);
      focusFirstError(fieldErrors);
    }
  }

  const otherErrors = Object.entries(errors).filter(([field, message]) => !isFieldName(field) && message !== formError);
  const deadlinePast = values.applicationDeadline !== "" && isPastDeadline(values.applicationDeadline);
  const slugPreview = (isEdit ? values.slug : effectiveSlug(values)) || "job-id";

  const description = isEdit ? (
    <span className="adm-job-editor-meta">
      <JobStatusBadge status={job.status} isOpen={job.isOpen} />
      <span>
        Created {formatDate(job.createdAt)}
        {job.createdByName ? ` by ${job.createdByName}` : ""}
      </span>
      <span>
        Last updated {formatDate(job.updatedAt, { withTime: true })}
        {job.updatedByName ? ` by ${job.updatedByName}` : ""}
      </span>
    </span>
  ) : (
    "New jobs can be saved as a draft for review or published straight away."
  );

  const footer = (
    <>
      <button type="button" className="adm-btn adm-btn-secondary" onClick={requestClose} disabled={saving !== null}>
        Cancel
      </button>
      <span className="adm-footer-spacer" />
      {isEdit ? (
        <button type="submit" form={formId} className="adm-btn adm-btn-primary" disabled={saving !== null} aria-busy={saving !== null || undefined}>
          {saving ? <Spinner size="sm" /> : null}
          {saving ? "Saving…" : "Save changes"}
        </button>
      ) : (
        <>
          <button
            type="submit"
            form={formId}
            data-intent="draft"
            className="adm-btn adm-btn-secondary"
            disabled={saving !== null}
            aria-busy={saving === "draft" || undefined}
          >
            {saving === "draft" ? <Spinner size="sm" /> : null}
            {saving === "draft" ? "Saving…" : "Save as draft"}
          </button>
          <button
            type="submit"
            form={formId}
            data-intent="published"
            className="adm-btn adm-btn-primary"
            disabled={saving !== null}
            aria-busy={saving === "published" || undefined}
          >
            {saving === "published" ? <Spinner size="sm" /> : null}
            {saving === "published" ? "Publishing…" : "Publish"}
          </button>
        </>
      )}
    </>
  );

  return (
    <>
      <Modal
        open
        size="xl"
        title={isEdit ? `Edit “${job.title}”` : "Add a job posting"}
        description={description}
        onClose={requestClose}
        dismissible={saving === null}
        closeOnBackdrop={false}
        initialFocusRef={titleRef}
        footer={footer}
      >
        <form method="post" id={formId} className="adm-form" onSubmit={handleSubmit} noValidate aria-busy={saving !== null}>
          {formError ? (
            <div ref={formErrorRef} className="adm-form-error" role="alert" tabIndex={-1}>
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

          {isEdit && job.status === "published" ? (
            job.isOpen ? (
              <Notice>This job is live on the careers site. Saved changes appear there immediately.</Notice>
            ) : (
              <Notice tone="warning">
                The application deadline has passed, so this job is hidden from the careers site. Set a later deadline (or clear it) to show it again,
                or close the job.
              </Notice>
            )
          ) : null}

          <fieldset className="adm-fieldset adm-form-grid" disabled={saving !== null}>
            <legend className="adm-sr-only">Job details</legend>
            <TextField
              ref={titleRef}
              id={fieldId("title")}
              label={FIELD_LABELS.title}
              className="adm-span-2"
              value={values.title}
              onChange={(event) => setField("title", event.target.value)}
              maxLength={FIELD_LIMITS.jobTitle}
              required
              autoComplete="off"
              placeholder="e.g. Quality Assurance Specialist"
              error={errors.title}
              counter
            />

            {isEdit ? (
              <TextField
                id={fieldId("slug")}
                label={FIELD_LABELS.slug}
                className="adm-span-2"
                value={values.slug}
                readOnly
                hint="The job ID is part of the public link and can't be changed."
                error={errors.slug}
              />
            ) : (
              <TextField
                id={fieldId("slug")}
                label={FIELD_LABELS.slug}
                className="adm-span-2"
                value={values.slug}
                onChange={(event) => handleSlugChange(event.target.value)}
                maxLength={FIELD_LIMITS.jobSlugMax}
                required
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="e.g. quality-assurance-specialist"
                hint={
                  <>
                    Public link: <span className="adm-mono adm-slug-preview">/careers/{slugPreview}</span>.{" "}
                    {slugEdited ? "Lowercase letters, numbers and hyphens only." : "Generated from the title until you edit it."} It can&apos;t be
                    changed after the job is created.
                  </>
                }
                error={errors.slug}
              />
            )}

            <TextField
              id={fieldId("department")}
              label={FIELD_LABELS.department}
              value={values.department}
              onChange={(event) => setField("department", event.target.value)}
              list={departmentListId}
              maxLength={FIELD_LIMITS.department}
              required
              autoComplete="off"
              placeholder="Choose or type a department"
              error={errors.department}
            />
            <datalist id={departmentListId}>
              {departments.map((department) => (
                <option key={department} value={department} />
              ))}
            </datalist>

            <TextField
              id={fieldId("location")}
              label={FIELD_LABELS.location}
              value={values.location}
              onChange={(event) => setField("location", event.target.value)}
              maxLength={FIELD_LIMITS.location}
              required
              autoComplete="off"
              placeholder="e.g. Colombo, Sri Lanka"
              error={errors.location}
            />

            <SelectField
              id={fieldId("type")}
              label={FIELD_LABELS.type}
              value={values.type}
              onChange={(event) => {
                if (isJobType(event.target.value)) setField("type", event.target.value);
              }}
              options={TYPE_OPTIONS}
              required
              error={errors.type}
            />

            <TextField
              id={fieldId("experience")}
              label={FIELD_LABELS.experience}
              optional
              value={values.experience}
              onChange={(event) => setField("experience", event.target.value)}
              maxLength={FIELD_LIMITS.experience}
              autoComplete="off"
              placeholder="e.g. 2+ years in pharmaceutical quality assurance"
              error={errors.experience}
            />

            <TextField
              id={fieldId("applicationDeadline")}
              label={FIELD_LABELS.applicationDeadline}
              optional
              type="date"
              value={values.applicationDeadline}
              onChange={(event) => setField("applicationDeadline", event.target.value)}
              hint={
                deadlinePast
                  ? "This date has already passed. A job with a past deadline can't be published and is hidden from the careers site."
                  : "Applications close at the end of this day (Sri Lanka time). Leave empty for no deadline."
              }
              error={errors.applicationDeadline}
            />

            <TextAreaField
              id={fieldId("description")}
              label={FIELD_LABELS.description}
              className="adm-span-2"
              rows={8}
              value={values.description}
              onChange={(event) => setField("description", event.target.value)}
              maxLength={FIELD_LIMITS.jobDescription}
              required
              placeholder="Overview of the role, the team and what success looks like…"
              hint="Separate paragraphs with a blank line."
              error={errors.description}
              counter
            />

            <ListField
              id={fieldId("responsibilities")}
              label={FIELD_LABELS.responsibilities}
              value={values.responsibilities}
              onChange={(value) => setField("responsibilities", value)}
              placeholder={"Lead QA testing cycles\nReview and update SOPs"}
              error={errors.responsibilities}
            />
            <ListField
              id={fieldId("requirements")}
              label={FIELD_LABELS.requirements}
              value={values.requirements}
              onChange={(value) => setField("requirements", value)}
              placeholder={"BSc in Pharmacy or Chemistry\nStrong attention to detail"}
              error={errors.requirements}
            />
            <ListField
              id={fieldId("qualifications")}
              label={FIELD_LABELS.qualifications}
              optional
              value={values.qualifications}
              onChange={(value) => setField("qualifications", value)}
              placeholder={"BSc in Chemistry or a related field\nGMP certification"}
              error={errors.qualifications}
            />
            <ListField
              id={fieldId("benefits")}
              label={FIELD_LABELS.benefits}
              optional
              value={values.benefits}
              onChange={(value) => setField("benefits", value)}
              placeholder={"Medical insurance\nStructured training programme"}
              error={errors.benefits}
            />
          </fieldset>
        </form>
      </Modal>

      <ConfirmDialog
        open={confirmDiscard}
        title="Discard unsaved changes?"
        message="Your edits to this job haven't been saved and will be lost."
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        tone="danger"
        onConfirm={() => {
          setConfirmDiscard(false);
          onClose();
        }}
        onCancel={() => setConfirmDiscard(false)}
      />
    </>
  );
}

function ListField({
  id,
  label,
  value,
  onChange,
  placeholder,
  error,
  optional = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  error?: string;
  optional?: boolean;
}) {
  const count = listCount(value);
  return (
    <TextAreaField
      id={id}
      label={label}
      optional={optional}
      rows={5}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      required={!optional}
      placeholder={placeholder}
      hint={`One item per line · ${pluralize(count, "item")} (up to ${FIELD_LIMITS.listItems}, ${FIELD_LIMITS.listItem} characters each)`}
      error={error}
    />
  );
}
