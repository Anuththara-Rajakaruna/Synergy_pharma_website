"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { DocumentUploadField, FieldError, FormField, UploadProgress, describedBy } from "@/components/careers/form-shared";
import {
  ApiRequestError,
  UploadCache,
  describeRequestFailure,
  fileDescriptor,
  isAbortError,
  postJson,
  uploadDocuments,
} from "@/components/careers/upload-client";
import { CAREER_DEPARTMENTS, CAREER_DEPARTMENT_SET, FIELD_LIMITS, UPLOAD_LIMITS } from "@/lib/careers/constants";
import {
  describeFileProblem,
  hasControlCharacters,
  validateEmail,
  validatePersonName,
  validatePhone,
  type FieldErrors,
} from "@/lib/careers/validation";
import type { SubmissionResponse, TalentSubmitPayload } from "@/types/careers";

type TalentPoolState = {
  name: string;
  email: string;
  phone: string;
  areaOfInterest: string;
  notes: string;
  consentGiven: boolean;
};

type Phase = "idle" | "uploading" | "submitting";

const INITIAL_FORM: TalentPoolState = {
  name: "",
  email: "",
  phone: "",
  areaOfInterest: "",
  notes: "",
  consentGiven: false,
};

// On-screen order, used to focus the first invalid field.
const FIELD_ORDER = ["name", "email", "phone", "areaOfInterest", "notes", "cv", "supporting", "consentGiven"] as const;
const FIELD_SET: ReadonlySet<string> = new Set(FIELD_ORDER);
const SUBMIT_BUTTON_ID = "talent-submit";
const SUCCESS_HEADING_ID = "talent-success-heading";
// The submission verifies and copies every uploaded file before it responds.
const SUBMIT_TIMEOUT_MS = 90_000;
const UPLOAD_ERROR_CODES = new Set(["invalid_file", "upload_expired", "upload_missing"]);
const CV_MAX_MB = Math.round(UPLOAD_LIMITS.cvMaxBytes / (1024 * 1024));
const SUPPORTING_MAX_MB = Math.round(UPLOAD_LIMITS.supportingMaxBytes / (1024 * 1024));
// Written by earlier versions of this form; see the cleanup effect below.
const LEGACY_DRAFT_KEY = "synergy-talent-draft";

function fieldId(field: string): string {
  return `talent-${field}`;
}

// Same rules as the API (shared validators) for immediate feedback.
function validateTalentForm(form: TalentPoolState, cv: File | null, supporting: File[]): FieldErrors {
  const errors: FieldErrors = {};
  validatePersonName(form.name, errors);
  validateEmail(form.email, errors);
  validatePhone(form.phone, errors);
  if (!form.areaOfInterest) errors.areaOfInterest = "Please choose an area of interest.";
  else if (!CAREER_DEPARTMENT_SET.has(form.areaOfInterest)) errors.areaOfInterest = "Please choose an area of interest from the list.";

  const notes = form.notes.replace(/\r\n/g, "\n").trim();
  if (notes.length > FIELD_LIMITS.candidateNotes) {
    errors.notes = `Notes must be ${FIELD_LIMITS.candidateNotes} characters or fewer.`;
  } else if (hasControlCharacters(notes, true)) {
    errors.notes = "Notes contain characters that are not allowed.";
  }

  const cvProblem = cv ? describeFileProblem(fileDescriptor(cv), "cv") : "Please upload your CV.";
  if (cvProblem) errors.cv = cvProblem;
  if (supporting.length > UPLOAD_LIMITS.maxSupportingDocuments) {
    errors.supporting = `Upload at most ${UPLOAD_LIMITS.maxSupportingDocuments} supporting documents.`;
  } else {
    for (const file of supporting) {
      const problem = describeFileProblem(fileDescriptor(file), "supporting");
      if (problem) {
        errors.supporting = `${file.name}: ${problem}`;
        break;
      }
    }
  }

  if (!form.consentGiven) errors.consentGiven = "Please read and accept the privacy policy to submit your profile.";
  return errors;
}

export function TalentPoolForm() {
  const [form, setForm] = useState<TalentPoolState>(INITIAL_FORM);
  const [cv, setCv] = useState<File | null>(null);
  const [supporting, setSupporting] = useState<File[]>([]);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [submitted, setSubmitted] = useState<{ reference: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const uploadCacheRef = useRef<UploadCache | null>(null);
  const pendingFocusRef = useRef<string | null>(null);
  const busy = phase !== "idle";

  // Earlier versions kept an unsent draft (name, email, phone, notes) in sessionStorage.
  // Personal data must not linger in shared browsers, so remove anything left behind.
  useEffect(() => {
    try {
      window.sessionStorage.removeItem(LEGACY_DRAFT_KEY);
    } catch {
      // Storage can be unavailable (privacy mode); nothing to clean up then.
    }
  }, []);

  // Moves focus after the render that shows the target (invalid field, success heading, etc.).
  useEffect(() => {
    const target = pendingFocusRef.current;
    if (!target) return;
    pendingFocusRef.current = null;
    document.getElementById(target)?.focus();
  });

  useEffect(() => {
    const controller = abortRef;
    return () => controller.current?.abort();
  }, []);

  useEffect(() => {
    if (!busy) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [busy]);

  function uploadCache(): UploadCache {
    uploadCacheRef.current ??= new UploadCache();
    return uploadCacheRef.current;
  }

  function updateField<K extends keyof TalentPoolState>(key: K, value: TalentPoolState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldError(key, "");
  }

  function setFieldError(field: string, message: string) {
    setFieldErrors((current) => {
      if (!message && !current[field]) return current;
      const next = { ...current };
      if (message) next[field] = message;
      else delete next[field];
      return next;
    });
  }

  function showFieldErrors(errors: FieldErrors) {
    setFieldErrors(errors);
    const first = FIELD_ORDER.find((field) => errors[field]);
    if (first) pendingFocusRef.current = fieldId(first);
  }

  function handleCancel() {
    abortRef.current?.abort();
  }

  function handleFailure(error: unknown, stage: "upload" | "submit") {
    if (isAbortError(error)) {
      setNotice("Upload cancelled. Your details are still here, so you can submit again when you're ready.");
      return;
    }

    if (error instanceof ApiRequestError) {
      if (error.status === 400 && UPLOAD_ERROR_CODES.has(error.code)) {
        uploadCache().clear();
        const field = error.fields.supporting && !error.fields.cv ? "supporting" : "cv";
        if (field === "cv") setCv(null);
        else setSupporting([]);
        setFieldErrors((current) => ({ ...current, [field]: error.fields[field] ?? error.message }));
        setFormError(
          field === "cv"
            ? "There was a problem with your CV. Please attach it again, then submit your profile."
            : "There was a problem with a supporting document. Please attach your supporting documents again, then submit your profile."
        );
        pendingFocusRef.current = fieldId(field);
        return;
      }

      const knownFieldErrors = Object.fromEntries(Object.entries(error.fields).filter(([field]) => FIELD_SET.has(field)));
      if (error.status === 400 && Object.keys(knownFieldErrors).length > 0) {
        setFormError("Please correct the highlighted fields and try again.");
        showFieldErrors(knownFieldErrors);
        return;
      }
      if (error.status === 409 && error.code === "duplicate_talent_profile") {
        setFormError(error.message);
        return;
      }
      if (error.code === "timeout" && stage === "submit") {
        setFormError(
          "This is taking longer than expected, and your profile may still have been received. Please wait a minute before trying again. If it was received, you'll see a message saying your email address is already in our talent pool."
        );
        return;
      }
    }

    setFormError(
      describeRequestFailure(error, {
        fallback: "We couldn't submit your profile right now. Please try again.",
        unavailable: "Our talent pool is temporarily unavailable. Please try again in a few minutes.",
      })
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    const errors = validateTalentForm(form, cv, supporting);
    if (Object.keys(errors).length > 0 || !cv) {
      setFormError("");
      setNotice("");
      showFieldErrors(errors);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    let stage: "upload" | "submit" = "upload";
    setFieldErrors({});
    setFormError("");
    setNotice("");
    setProgress(0);
    setPhase("uploading");

    try {
      const uploaded = await uploadDocuments(
        "talent_pool",
        [{ kind: "cv", file: cv }, ...supporting.map((file) => ({ kind: "supporting" as const, file }))],
        { signal: controller.signal, cache: uploadCache(), onProgress: (update) => setProgress(update.fraction) }
      );

      stage = "submit";
      setPhase("submitting");
      const payload: TalentSubmitPayload = {
        name: form.name,
        email: form.email,
        phone: form.phone,
        areaOfInterest: form.areaOfInterest,
        notes: form.notes,
        consentGiven: true,
        uploads: {
          cv: uploaded.find((document) => document.kind === "cv")?.uploadId ?? "",
          supporting: uploaded.filter((document) => document.kind === "supporting").map((document) => document.uploadId),
        },
      };
      const result = await postJson<SubmissionResponse>("/api/talent-pool", payload, { timeoutMs: SUBMIT_TIMEOUT_MS });

      uploadCache().clear();
      setForm(INITIAL_FORM);
      setCv(null);
      setSupporting([]);
      setSubmitted({ reference: typeof result.reference === "string" ? result.reference : "" });
      pendingFocusRef.current = SUCCESS_HEADING_ID;
    } catch (error) {
      // The submit button was focused and got disabled; return focus there unless a field takes it.
      pendingFocusRef.current = SUBMIT_BUTTON_ID;
      handleFailure(error, stage);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setPhase("idle");
    }
  }

  if (submitted) {
    return (
      <div>
        <h3 id={SUCCESS_HEADING_ID} tabIndex={-1} className="careers-success-title careers-focus-target">
          Thank you for joining our talent pool.
        </h3>
        <div className="career-form-message career-form-success careers-success-panel">
          {submitted.reference ? (
            <p className="careers-success-reference">
              Your reference: <strong>{submitted.reference}</strong>
            </p>
          ) : null}
          <p>Your profile has been submitted successfully. Please keep this reference in case you need to contact us.</p>
          <h4>What happens next</h4>
          <ul className="careers-success-steps">
            <li>Our HR team keeps your CV on file for future openings.</li>
            <li>When a role that matches your experience opens, we will contact you by email or phone.</li>
          </ul>
        </div>
        <div className="careers-success-actions">
          <Link href="/careers#open-positions" className="button-link">
            View open positions
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form method="post" className="talent-pool-form" onSubmit={handleSubmit} noValidate>
      <fieldset className="careers-form-fieldset" disabled={busy}>

        <div className="career-form-grid">
          <FormField id={fieldId("name")} label="Full name" required error={fieldErrors.name}>
            {(control) => (
              <input
                {...control}
                type="text"
                name="name"
                autoComplete="name"
                maxLength={FIELD_LIMITS.name}
                value={form.name}
                onChange={(event) => updateField("name", event.target.value)}
              />
            )}
          </FormField>
          <FormField id={fieldId("email")} label="Email" required error={fieldErrors.email}>
            {(control) => (
              <input
                {...control}
                type="email"
                name="email"
                autoComplete="email"
                inputMode="email"
                spellCheck={false}
                maxLength={FIELD_LIMITS.email}
                value={form.email}
                onChange={(event) => updateField("email", event.target.value)}
              />
            )}
          </FormField>
          <FormField id={fieldId("phone")} label="Phone" required hint="Include country code, e.g. +94 77 123 4567" error={fieldErrors.phone}>
            {(control) => (
              <input
                {...control}
                type="tel"
                name="phone"
                autoComplete="tel"
                placeholder="+94 77 000 0000"
                value={form.phone}
                onChange={(event) => updateField("phone", event.target.value)}
              />
            )}
          </FormField>
          <FormField id={fieldId("areaOfInterest")} label="Area of interest" required error={fieldErrors.areaOfInterest}>
            {(control) => (
              <select
                {...control}
                name="areaOfInterest"
                value={form.areaOfInterest}
                onChange={(event) => updateField("areaOfInterest", event.target.value)}
              >
                <option value="">Select a department</option>
                {CAREER_DEPARTMENTS.map((department) => (
                  <option key={department} value={department}>
                    {department}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField
            id={fieldId("notes")}
            label="Notes"
            optional
            counter={{ length: form.notes.length, max: FIELD_LIMITS.candidateNotes }}
            error={fieldErrors.notes}
            className="careers-field-full"
          >
            {(control) => (
              <textarea
                {...control}
                name="notes"
                rows={5}
                maxLength={FIELD_LIMITS.candidateNotes}
                value={form.notes}
                onChange={(event) => updateField("notes", event.target.value)}
                placeholder="Tell us what kind of opportunity you're looking for."
              />
            )}
          </FormField>
          <DocumentUploadField
            id={fieldId("cv")}
            kind="cv"
            label="Upload CV (PDF)"
            required
            files={cv ? [cv] : []}
            onChange={(files) => setCv(files[0] ?? null)}
            error={fieldErrors.cv}
            onErrorChange={(message) => setFieldError("cv", message)}
            disabled={busy}
            prompt="Drag & drop your CV here"
            hint={`or click to browse — PDF only, max ${CV_MAX_MB} MB`}
          />
          <DocumentUploadField
            id={fieldId("supporting")}
            kind="supporting"
            label="Supporting documents (PDF)"
            files={supporting}
            onChange={setSupporting}
            error={fieldErrors.supporting}
            onErrorChange={(message) => setFieldError("supporting", message)}
            disabled={busy}
            prompt="Add certificates or other supporting documents"
            hint={`or click to browse — up to ${UPLOAD_LIMITS.maxSupportingDocuments} PDFs, max ${SUPPORTING_MAX_MB} MB each`}
          />
          <div className="careers-field careers-field-full">
            <label className="careers-field-checkbox" htmlFor={fieldId("consentGiven")}>
              <input
                id={fieldId("consentGiven")}
                type="checkbox"
                name="consentGiven"
                required
                checked={form.consentGiven}
                onChange={(event) => updateField("consentGiven", event.target.checked)}
                aria-invalid={fieldErrors.consentGiven ? true : undefined}
                aria-describedby={describedBy(fieldErrors.consentGiven && `${fieldId("consentGiven")}-error`)}
              />
              <span>
                I have read and agree to the{" "}
                <Link href="/privacy-policy" target="_blank" rel="noopener noreferrer" className="underline text-[#1075bd] careers-consent-link">
                  Privacy Policy<span className="careers-sr-only"> (opens in a new tab)</span>
                </Link>{" "}
                and consent to Synergy Pharma processing my personal data for recruitment purposes.{" "}
                <span aria-hidden="true">*</span>
              </span>
            </label>
            <FieldError id={`${fieldId("consentGiven")}-error`} message={fieldErrors.consentGiven} />
          </div>
        </div>
      </fieldset>

      {formError ? (
        <p role="alert" className="career-form-message career-form-error">
          {formError}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="career-form-message careers-form-notice">
          {notice}
        </p>
      ) : null}
      {phase !== "idle" ? (
        <UploadProgress
          id="talent-progress"
          phase={phase}
          fraction={progress}
          submittingLabel="Submitting your profile"
          onCancel={handleCancel}
        />
      ) : null}

      <button id={SUBMIT_BUTTON_ID} type="submit" className="careers-form-submit" disabled={busy}>
        {busy ? "Submitting..." : "Submit to Talent Pool"}
      </button>
    </form>
  );
}
