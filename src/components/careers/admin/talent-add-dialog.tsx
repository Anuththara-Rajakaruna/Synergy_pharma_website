"use client";

import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode, type RefObject } from "react";
import {
  ApiRequestError,
  UploadCache,
  UploadError,
  describeRequestFailure,
  fileDescriptor,
  uploadDocuments,
  type UploadSelection,
} from "@/components/careers/upload-client";
import { CAREER_DEPARTMENTS, FIELD_LIMITS, UPLOAD_LIMITS } from "@/lib/careers/constants";
import { formatFileSize } from "@/lib/careers/format";
import { describeFileProblem, validateHrTalentInput } from "@/lib/careers/validation";
import type { HrTalentPayload, TalentDetail } from "@/types/careers";
import { ADMIN_EVENTS, adminFetch, toAdminApiError } from "./api";
import { IconDocument, IconPaperClip, IconTrash } from "./icons";
import { CheckboxField, ConfirmDialog, IconButton, Modal, Notice, Spinner, TagInput, TextAreaField, TextField } from "./ui";

type FormValues = {
  name: string;
  email: string;
  phone: string;
  areaOfInterest: string;
  note: string;
};

type FieldName = "name" | "email" | "phone" | "areaOfInterest" | "tags" | "cv" | "supporting" | "note" | "consentConfirmed";

// Visual order of the form; used to focus the first field with an error.
const FIELD_ORDER: readonly FieldName[] = ["name", "email", "phone", "areaOfInterest", "tags", "cv", "supporting", "note", "consentConfirmed"];

const EMPTY_VALUES: FormValues = { name: "", email: "", phone: "", areaOfInterest: "", note: "" };

type Phase = "idle" | "uploading" | "saving";

const MB = 1024 * 1024;

function isFieldName(value: string): value is FieldName {
  return (FIELD_ORDER as readonly string[]).includes(value);
}

function withoutKeys(errors: Record<string, string>, ...keys: string[]): Record<string, string> {
  if (!keys.some((key) => key in errors)) return errors;
  const next = { ...errors };
  for (const key of keys) delete next[key];
  return next;
}

function fileProblem(file: File, kind: "cv" | "supporting"): string | null {
  return describeFileProblem(fileDescriptor(file), kind);
}

export type TalentAddDialogProps = {
  open: boolean;
  tagSuggestions?: string[];
  onClose: () => void;
  onCreated: (talent: TalentDetail) => void;
  // Shows the existing profile when the email address is already in the talent pool.
  onFindExisting?: (email: string) => void;
};

export function TalentAddDialog({ open, ...props }: TalentAddDialogProps) {
  if (!open) return null;
  // Mounting only while open gives every session a fresh form (no candidate data is kept).
  return <TalentAddForm {...props} />;
}

function TalentAddForm({ tagSuggestions = [], onClose, onCreated, onFindExisting }: Omit<TalentAddDialogProps, "open">) {
  const [values, setValues] = useState<FormValues>(EMPTY_VALUES);
  const [tags, setTags] = useState<string[]>([]);
  const [cv, setCv] = useState<File | null>(null);
  const [supporting, setSupporting] = useState<File[]>([]);
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<ReactNode>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [uploadCache] = useState(() => new UploadCache());
  const abortRef = useRef<AbortController | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const formErrorRef = useRef<HTMLDivElement>(null);
  const cvInputRef = useRef<HTMLInputElement>(null);
  const supportingInputRef = useRef<HTMLInputElement>(null);
  const formId = useId();
  const idPrefix = useId();
  const areaListId = useId();

  const busy = phase !== "idle";
  const fieldId = (field: FieldName) => `${idPrefix}-${field}`;
  const dirty =
    Object.values(values).some((value) => value.trim() !== "") || tags.length > 0 || cv !== null || supporting.length > 0 || consent;

  // Cancel an upload that is still running when the dialog goes away.
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  // Warn before a reload or tab close throws away the unsaved form.
  useEffect(() => {
    if (!dirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty]);

  function setField<K extends keyof FormValues>(field: K, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => withoutKeys(current, field));
  }

  function requestClose() {
    if (busy) return;
    if (dirty) setConfirmDiscard(true);
    else onClose();
  }

  function focusFirstError(fieldErrors: Record<string, string>) {
    const first = FIELD_ORDER.find((field) => fieldErrors[field]);
    // Wait for the messages to render so aria-describedby points at real content.
    window.requestAnimationFrame(() => {
      const target = first ? document.getElementById(fieldId(first)) : formErrorRef.current;
      target?.focus();
    });
  }

  function handleCvChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    // Reset so choosing the same file again still fires a change event.
    event.target.value = "";
    if (!file) return;
    const problem = fileProblem(file, "cv");
    if (problem) {
      setErrors((current) => ({ ...current, cv: problem }));
      return;
    }
    setCv(file);
    setErrors((current) => withoutKeys(current, "cv", "supporting"));
  }

  function handleSupportingChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    const problems: string[] = [];
    const accepted: File[] = [];
    for (const file of files) {
      const problem = fileProblem(file, "supporting");
      if (problem) problems.push(problem);
      else accepted.push(file);
    }
    const room = UPLOAD_LIMITS.maxSupportingDocuments - supporting.length;
    const added = accepted.slice(0, Math.max(0, room));
    if (accepted.length > added.length) {
      problems.push(`You can attach up to ${UPLOAD_LIMITS.maxSupportingDocuments} supporting documents.`);
    }
    if (added.length > 0) setSupporting((current) => [...current, ...added]);
    setErrors((current) => {
      const next = withoutKeys(current, "supporting");
      return problems.length > 0 ? { ...next, supporting: problems[0] } : next;
    });
  }

  function removeSupporting(index: number) {
    setSupporting((current) => current.filter((_, position) => position !== index));
    setErrors((current) => withoutKeys(current, "supporting"));
  }

  function validate(): Record<string, string> {
    const result = validateHrTalentInput({
      name: values.name,
      email: values.email,
      phone: values.phone,
      areaOfInterest: values.areaOfInterest,
      tags,
      note: values.note,
      consentConfirmed: consent,
      uploads: null,
    });
    const clientErrors: Record<string, string> = result.ok ? {} : { ...result.errors };
    if (cv) {
      const problem = fileProblem(cv, "cv");
      if (problem) clientErrors.cv = problem;
    }
    if (supporting.length > 0 && !cv) {
      clientErrors.cv = "Attach the candidate's CV to include supporting documents.";
    }
    if (supporting.length > UPLOAD_LIMITS.maxSupportingDocuments) {
      clientErrors.supporting = `You can attach up to ${UPLOAD_LIMITS.maxSupportingDocuments} supporting documents.`;
    }
    return clientErrors;
  }

  function showErrors(fieldErrors: Record<string, string>, message: ReactNode) {
    setErrors(fieldErrors);
    setFormError(message);
    focusFirstError(fieldErrors);
  }

  function handleUploadFailure(err: unknown) {
    if (err instanceof UploadError) {
      if (err.reason === "aborted") {
        setNotice("Upload cancelled. Nothing was saved.");
        return;
      }
      showErrors({}, err.message);
      return;
    }
    if (err instanceof ApiRequestError) {
      if (err.status === 401) {
        const loginHref = `/careers/admin/login?from=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`;
        showErrors(
          {},
          <>
            Your session has ended, so the documents couldn&apos;t be uploaded.{" "}
            <a className="adm-link" href={loginHref}>
              Sign in again
            </a>
            .
          </>
        );
        return;
      }
      if (err.status === 403 && err.code === "password_change_required") {
        window.dispatchEvent(new CustomEvent(ADMIN_EVENTS.passwordChangeRequired));
        showErrors({}, "Change your password before adding candidates.");
        return;
      }
      if (err.code === "aborted") {
        setNotice("Upload cancelled. Nothing was saved.");
        return;
      }
      if (err.status === 400) {
        showErrors({}, err.fields.files ?? err.message);
        return;
      }
    }
    showErrors(
      {},
      describeRequestFailure(err, {
        fallback: "The documents couldn't be uploaded. Please try again.",
        unavailable: "Document storage is temporarily unavailable. Try again in a few minutes, or add the candidate without documents.",
      })
    );
  }

  function handleSaveFailure(err: unknown) {
    const apiError = toAdminApiError(err);
    const fieldErrors = { ...(apiError.fields ?? {}) };

    if (apiError.code === "upload_expired" || apiError.code === "upload_missing" || apiError.code === "invalid_file") {
      // The server consumed or rejected these upload ids; the next attempt uploads again.
      uploadCache.clear();
      if (apiError.code === "invalid_file") {
        if (fieldErrors.supporting) setSupporting([]);
        else {
          setCv(null);
          if (!fieldErrors.cv) fieldErrors.cv = apiError.message;
        }
      }
      showErrors(fieldErrors, apiError.message);
      return;
    }

    if (apiError.status === 409 && apiError.code === "duplicate_talent_profile") {
      const email = values.email.trim();
      showErrors(
        { email: fieldErrors.email ?? apiError.message },
        <>
          {apiError.message}
          {onFindExisting && email ? (
            <>
              {" "}
              <button type="button" className="adm-btn adm-btn-link adm-btn-sm" onClick={() => onFindExisting(email)}>
                Show the existing profile
              </button>
            </>
          ) : null}
        </>
      );
      return;
    }

    showErrors(fieldErrors, apiError.message);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setNotice(null);

    const clientErrors = validate();
    if (Object.keys(clientErrors).length > 0) {
      showErrors(clientErrors, "Please fix the highlighted fields.");
      return;
    }

    const selections: UploadSelection[] = [
      ...(cv ? [{ kind: "cv" as const, file: cv }] : []),
      ...supporting.map((file) => ({ kind: "supporting" as const, file })),
    ];
    setErrors({});
    setFormError(null);

    let uploads: HrTalentPayload["uploads"] = null;
    if (selections.length > 0) {
      const controller = new AbortController();
      abortRef.current = controller;
      setProgress(0);
      setPhase("uploading");
      try {
        const uploaded = await uploadDocuments("admin_talent", selections, {
          signal: controller.signal,
          cache: uploadCache,
          onProgress: (update) => setProgress(update.fraction),
        });
        uploads = {
          cv: uploaded.find((document) => document.kind === "cv")?.uploadId ?? "",
          supporting: uploaded.filter((document) => document.kind === "supporting").map((document) => document.uploadId),
        };
      } catch (err) {
        setPhase("idle");
        handleUploadFailure(err);
        return;
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    }

    setPhase("saving");
    const payload: HrTalentPayload = {
      name: values.name,
      email: values.email,
      phone: values.phone,
      areaOfInterest: values.areaOfInterest,
      tags,
      note: values.note,
      consentConfirmed: consent,
      uploads,
    };
    try {
      const response = await adminFetch<{ talent: TalentDetail }>("/api/admin/talent-pool", { method: "POST", json: payload });
      uploadCache.clear();
      onCreated(response.talent);
    } catch (err) {
      setPhase("idle");
      handleSaveFailure(err);
    }
  }

  const otherErrors = Object.entries(errors).filter(([field]) => !isFieldName(field));
  const percent = Math.round(progress * 100);
  const supportingFull = supporting.length >= UPLOAD_LIMITS.maxSupportingDocuments;

  const footer = (
    <>
      {phase === "uploading" ? (
        <button type="button" className="adm-btn adm-btn-secondary" onClick={() => abortRef.current?.abort()}>
          Cancel upload
        </button>
      ) : (
        <button type="button" className="adm-btn adm-btn-secondary" onClick={requestClose} disabled={busy}>
          Cancel
        </button>
      )}
      <span className="adm-footer-spacer" />
      <button type="submit" form={formId} className="adm-btn adm-btn-primary" disabled={busy} aria-busy={busy || undefined}>
        {busy ? <Spinner size="sm" /> : null}
        {phase === "uploading" ? "Uploading…" : phase === "saving" ? "Saving…" : "Add candidate"}
      </button>
    </>
  );

  return (
    <>
      <Modal
        open
        size="lg"
        title="Add a candidate"
        description="Add someone to the talent pool, for example a referral or a CV received by email."
        onClose={requestClose}
        dismissible={!busy}
        closeOnBackdrop={false}
        initialFocusRef={nameRef}
        footer={footer}
      >
        <form method="post" id={formId} className="adm-form" onSubmit={handleSubmit} noValidate aria-busy={busy || undefined}>
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
          {notice ? <Notice>{notice}</Notice> : null}

          <fieldset className="adm-fieldset adm-form-grid" disabled={busy}>
            <legend className="adm-sr-only">Candidate details</legend>
            <TextField
              ref={nameRef}
              id={fieldId("name")}
              label="Full name"
              className="adm-span-2"
              value={values.name}
              onChange={(event) => setField("name", event.target.value)}
              maxLength={FIELD_LIMITS.name}
              required
              autoComplete="off"
              error={errors.name}
            />
            <TextField
              id={fieldId("email")}
              label="Email address"
              type="email"
              inputMode="email"
              value={values.email}
              onChange={(event) => setField("email", event.target.value)}
              maxLength={FIELD_LIMITS.email}
              required
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              hint="Used to prevent duplicate profiles. It can't be changed later."
              error={errors.email}
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
              placeholder="e.g. +94 77 123 4567"
              error={errors.phone}
            />
            <TextField
              id={fieldId("areaOfInterest")}
              label="Area of interest"
              className="adm-span-2"
              value={values.areaOfInterest}
              onChange={(event) => setField("areaOfInterest", event.target.value)}
              list={areaListId}
              maxLength={FIELD_LIMITS.areaOfInterest}
              required
              autoComplete="off"
              placeholder="Choose a department or type an area"
              error={errors.areaOfInterest}
            />
            <datalist id={areaListId}>
              {CAREER_DEPARTMENTS.map((department) => (
                <option key={department} value={department} />
              ))}
            </datalist>

            <div className="adm-span-2">
              <TagInput
                id={fieldId("tags")}
                value={tags}
                onChange={(next) => {
                  setTags(next);
                  setErrors((current) => withoutKeys(current, "tags"));
                }}
                suggestions={tagSuggestions}
                disabled={busy}
                hint={`Skills or keywords HR can filter by. Press Enter or comma to add (up to ${FIELD_LIMITS.tags}).`}
                error={errors.tags}
              />
            </div>

            <div className="adm-span-2 adm-stack">
              <p className="adm-form-section-title">Documents (optional)</p>

              <FilePicker
                id={fieldId("cv")}
                label="CV"
                hint={`One PDF, up to ${UPLOAD_LIMITS.cvMaxBytes / MB} MB.`}
                buttonLabel={cv ? "Replace CV" : "Choose CV"}
                inputRef={cvInputRef}
                multiple={false}
                disabled={busy}
                error={errors.cv}
                onChange={handleCvChange}
              >
                {cv ? (
                  <ul className="adm-doc-list" aria-label="Selected CV">
                    <SelectedFile
                      file={cv}
                      disabled={busy}
                      onRemove={() => {
                        setCv(null);
                        setErrors((current) => withoutKeys(current, "cv"));
                      }}
                    />
                  </ul>
                ) : null}
              </FilePicker>

              <FilePicker
                id={fieldId("supporting")}
                label="Supporting documents"
                hint={`Up to ${UPLOAD_LIMITS.maxSupportingDocuments} PDFs, ${UPLOAD_LIMITS.supportingMaxBytes / MB} MB each (certificates, references). A CV is required to attach them.`}
                buttonLabel="Add documents"
                inputRef={supportingInputRef}
                multiple
                disabled={busy || supportingFull}
                error={errors.supporting}
                onChange={handleSupportingChange}
              >
                {supporting.length > 0 ? (
                  <ul className="adm-doc-list" aria-label="Selected supporting documents">
                    {supporting.map((file, index) => (
                      <SelectedFile key={`${file.name}-${file.size}-${file.lastModified}-${index}`} file={file} disabled={busy} onRemove={() => removeSupporting(index)} />
                    ))}
                  </ul>
                ) : null}
              </FilePicker>

              {phase === "uploading" ? (
                <div className="grid gap-1.5" aria-live="polite">
                  <span className="text-[0.8rem] font-semibold text-[#42677f]">Uploading documents… {percent}%</span>
                  <div
                    role="progressbar"
                    aria-label="Document upload progress"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percent}
                    className="h-2 w-full overflow-hidden rounded-full bg-[#e0ecf5]"
                  >
                    <div className="h-full rounded-full bg-[#055f7c] transition-[width] duration-200 ease-out" style={{ width: `${percent}%` }} />
                  </div>
                </div>
              ) : null}
            </div>

            <TextAreaField
              id={fieldId("note")}
              label="HR note"
              optional
              className="adm-span-2"
              rows={4}
              value={values.note}
              onChange={(event) => setField("note", event.target.value)}
              maxLength={FIELD_LIMITS.hrNote}
              placeholder="How you met the candidate, referral details, first impressions…"
              hint="Visible to the recruitment team only."
              error={errors.note}
              counter
            />

            <CheckboxField
              id={fieldId("consentConfirmed")}
              className="adm-span-2"
              checked={consent}
              onChange={(event) => {
                setConsent(event.target.checked);
                setErrors((current) => withoutKeys(current, "consentConfirmed"));
              }}
              required
              label="The candidate agreed to have their details and documents kept on file for future opportunities."
              hint="Only add people who have given their consent. Their data is kept according to the careers privacy policy."
              error={errors.consentConfirmed}
            />
          </fieldset>
        </form>
      </Modal>

      <ConfirmDialog
        open={confirmDiscard}
        title="Discard this candidate?"
        message="The details you entered haven't been saved and will be lost."
        confirmLabel="Discard"
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

function FilePicker({
  id,
  label,
  hint,
  buttonLabel,
  inputRef,
  multiple,
  disabled,
  error,
  onChange,
  children,
}: {
  id: string;
  label: string;
  hint: string;
  buttonLabel: string;
  inputRef: RefObject<HTMLInputElement | null>;
  multiple: boolean;
  disabled: boolean;
  error?: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  children?: ReactNode;
}) {
  const labelId = `${id}-label`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <div className="adm-field">
      <span id={labelId} className="adm-label">
        {label}
      </span>
      <div className="adm-cluster">
        {/* The native input stays hidden; this button opens its file chooser. */}
        <button
          id={id}
          type="button"
          className="adm-btn adm-btn-secondary adm-btn-sm"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          aria-labelledby={`${labelId} ${id}`}
          aria-describedby={[hintId, error ? errorId : ""].filter(Boolean).join(" ")}
        >
          <IconPaperClip className="adm-icon" />
          {buttonLabel}
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple={multiple}
        onChange={onChange}
        disabled={disabled}
        hidden
        tabIndex={-1}
        aria-hidden="true"
      />
      {children}
      <div id={hintId} className="adm-hint">
        {hint}
      </div>
      {error ? (
        <p id={errorId} className="adm-field-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function SelectedFile({ file, disabled, onRemove }: { file: File; disabled: boolean; onRemove: () => void }) {
  return (
    <li className="adm-doc">
      <span className="adm-doc-name">
        <IconDocument className="adm-icon" />
        <span>
          {file.name}
          <span className="adm-muted adm-text-sm"> · {formatFileSize(file.size)}</span>
        </span>
      </span>
      <IconButton
        label={`Remove ${file.name}`}
        tone="danger"
        icon={<IconTrash className="adm-icon" />}
        onClick={onRemove}
        disabled={disabled}
      />
    </li>
  );
}
