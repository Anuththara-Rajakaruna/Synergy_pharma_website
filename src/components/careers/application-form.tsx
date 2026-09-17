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
import { FIELD_LIMITS, UPLOAD_LIMITS } from "@/lib/careers/constants";
import { formatDate } from "@/lib/careers/format";
import {
  describeFileProblem,
  hasControlCharacters,
  validateEmail,
  validateOptionalUrl,
  validatePersonName,
  validatePhone,
  type FieldErrors,
} from "@/lib/careers/validation";
import type { ApplicationSubmitPayload, Job, SubmissionResponse } from "@/types/careers";

type ApplicationFormProps = {
  job: Job;
};

type FormState = {
  name: string;
  email: string;
  phone: string;
  linkedIn: string;
  portfolio: string;
  coverLetter: string;
  consentGiven: boolean;
};

type Phase = "idle" | "uploading" | "submitting";

const INITIAL_FORM: FormState = {
  name: "",
  email: "",
  phone: "",
  linkedIn: "",
  portfolio: "",
  coverLetter: "",
  consentGiven: false,
};

const stepLabels = ["Details", "Role & CV", "Review"];
const LAST_STEP = stepLabels.length - 1;
// Which step shows each field, in on-screen order (used to route and focus errors).
const STEP_FIELDS: readonly (readonly string[])[] = [
  ["name", "email", "phone"],
  ["linkedIn", "portfolio", "cv", "supporting"],
  ["coverLetter", "consentGiven"],
];
const STEP_HEADING_ID = "apply-step-heading";
const SUBMIT_BUTTON_ID = "apply-submit";
const SUCCESS_HEADING_ID = "apply-success-heading";
// The submission verifies and copies every uploaded file before it responds.
const SUBMIT_TIMEOUT_MS = 90_000;
const UPLOAD_ERROR_CODES = new Set(["invalid_file", "upload_expired", "upload_missing"]);
const CV_MAX_MB = Math.round(UPLOAD_LIMITS.cvMaxBytes / (1024 * 1024));
const SUPPORTING_MAX_MB = Math.round(UPLOAD_LIMITS.supportingMaxBytes / (1024 * 1024));

function fieldId(field: string): string {
  return `apply-${field}`;
}

function stepOfField(field: string): number | null {
  const index = STEP_FIELDS.findIndex((fields) => fields.includes(field));
  return index === -1 ? null : index;
}

// Same rules as the API (shared validators), checked per step for immediate feedback.
function validateStep(step: number, form: FormState, cv: File | null, supporting: File[]): FieldErrors {
  const errors: FieldErrors = {};
  if (step === 0) {
    validatePersonName(form.name, errors);
    validateEmail(form.email, errors);
    validatePhone(form.phone, errors);
  } else if (step === 1) {
    validateOptionalUrl(form.linkedIn, errors, "linkedIn", "LinkedIn", { hostSuffix: "linkedin.com" });
    validateOptionalUrl(form.portfolio, errors, "portfolio", "portfolio");
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
  } else {
    const coverLetter = form.coverLetter.replace(/\r\n/g, "\n").trim();
    if (coverLetter.length > FIELD_LIMITS.coverLetter) {
      errors.coverLetter = `Cover letter must be ${FIELD_LIMITS.coverLetter} characters or fewer.`;
    } else if (hasControlCharacters(coverLetter, true)) {
      errors.coverLetter = "Cover letter contains characters that are not allowed.";
    }
    if (!form.consentGiven) errors.consentGiven = "Please read and accept the privacy policy to continue.";
  }
  return errors;
}

export function ApplicationForm({ job }: ApplicationFormProps) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [cv, setCv] = useState<File | null>(null);
  const [supporting, setSupporting] = useState<File[]>([]);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [jobClosed, setJobClosed] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [submitted, setSubmitted] = useState<{ reference: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const uploadCacheRef = useRef<UploadCache | null>(null);
  const pendingFocusRef = useRef<string | null>(null);
  const busy = phase !== "idle";

  // Earlier versions kept an unsent draft (name, email, phone, cover letter) in sessionStorage.
  // Personal data must not linger in shared browsers, so remove anything left behind.
  useEffect(() => {
    try {
      window.sessionStorage.removeItem(`synergy-apply-draft-${job.id}`);
    } catch {
      // Storage can be unavailable (privacy mode); nothing to clean up then.
    }
  }, [job.id]);

  // Moves focus after the render that shows the target (step heading, invalid field, etc.).
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

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
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

  function goToStep(next: number, focusTarget: string = STEP_HEADING_ID) {
    pendingFocusRef.current = focusTarget;
    setStep(next);
  }

  // Shows errors, replacing earlier ones for `replaceSteps`, then moves to the first step with an
  // error and focuses its first invalid field.
  function showFieldErrors(errors: FieldErrors, replaceSteps: number[]) {
    setFieldErrors((current) => {
      const next = { ...current };
      for (const index of replaceSteps) {
        for (const field of STEP_FIELDS[index]) delete next[field];
      }
      return { ...next, ...errors };
    });
    const steps = Object.keys(errors).map((field) => stepOfField(field) ?? step);
    const targetStep = steps.length > 0 ? Math.min(...steps) : step;
    const firstField = STEP_FIELDS[targetStep].find((field) => errors[field]);
    pendingFocusRef.current = firstField ? fieldId(firstField) : STEP_HEADING_ID;
    if (targetStep !== step) setStep(targetStep);
  }

  function handleNext() {
    if (busy) return;
    const errors = validateStep(step, form, cv, supporting);
    if (Object.keys(errors).length > 0) {
      showFieldErrors(errors, [step]);
      return;
    }
    setFieldErrors((current) => {
      const next = { ...current };
      for (const field of STEP_FIELDS[step]) delete next[field];
      return next;
    });
    if (!jobClosed) setFormError("");
    setNotice("");
    goToStep(Math.min(step + 1, LAST_STEP));
  }

  function handlePrevious() {
    if (busy || step === 0) return;
    if (!jobClosed) setFormError("");
    setNotice("");
    goToStep(step - 1);
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
            ? "There was a problem with your CV. Please attach it again, then continue to submit your application."
            : "There was a problem with a supporting document. Please attach your supporting documents again, then continue to submit your application."
        );
        goToStep(1, fieldId(field));
        return;
      }

      const knownFieldErrors = Object.fromEntries(Object.entries(error.fields).filter(([field]) => stepOfField(field) !== null));
      if (error.status === 400 && Object.keys(knownFieldErrors).length > 0) {
        setFormError("Please correct the highlighted fields, then submit your application again.");
        showFieldErrors(knownFieldErrors, []);
        return;
      }
      if (error.status === 404 && error.code === "job_not_found") {
        setJobClosed(true);
        setFormError(error.message);
        return;
      }
      if (error.status === 409 && error.code === "duplicate_application") {
        setFormError(error.message);
        return;
      }
      if (error.code === "timeout" && stage === "submit") {
        setFormError(
          "This is taking longer than expected, and your application may still have been received. Please wait a minute before trying again. If it was received, you'll see a message saying you have already applied."
        );
        return;
      }
    }

    setFormError(
      describeRequestFailure(error, {
        fallback: "We couldn't submit your application right now. Please try again.",
        unavailable: "Our application system is temporarily unavailable. Please try again in a few minutes.",
      })
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || jobClosed) return;
    // Enter in a text field on an earlier step submits the form; treat it as Continue.
    if (step < LAST_STEP) {
      handleNext();
      return;
    }

    for (let index = 0; index <= LAST_STEP; index += 1) {
      const errors = validateStep(index, form, cv, supporting);
      if (Object.keys(errors).length > 0) {
        showFieldErrors(errors, [index]);
        return;
      }
    }
    if (!cv) return;

    const controller = new AbortController();
    abortRef.current = controller;
    let stage: "upload" | "submit" = "upload";
    setFormError("");
    setNotice("");
    setProgress(0);
    setPhase("uploading");

    try {
      const uploaded = await uploadDocuments(
        "application",
        [{ kind: "cv", file: cv }, ...supporting.map((file) => ({ kind: "supporting" as const, file }))],
        { signal: controller.signal, cache: uploadCache(), onProgress: (update) => setProgress(update.fraction) }
      );

      stage = "submit";
      setPhase("submitting");
      const payload: ApplicationSubmitPayload = {
        jobId: job.id,
        name: form.name,
        email: form.email,
        phone: form.phone,
        coverLetter: form.coverLetter,
        linkedIn: form.linkedIn,
        portfolio: form.portfolio,
        consentGiven: true,
        uploads: {
          cv: uploaded.find((document) => document.kind === "cv")?.uploadId ?? "",
          supporting: uploaded.filter((document) => document.kind === "supporting").map((document) => document.uploadId),
        },
      };
      const result = await postJson<SubmissionResponse>("/api/apply", payload, { timeoutMs: SUBMIT_TIMEOUT_MS });

      uploadCache().clear();
      setForm(INITIAL_FORM);
      setCv(null);
      setSupporting([]);
      setFieldErrors({});
      setSubmitted({ reference: typeof result.reference === "string" ? result.reference : "" });
      pendingFocusRef.current = SUCCESS_HEADING_ID;
    } catch (error) {
      // The submit button was focused and got disabled; return focus there unless a field or
      // step takes it.
      pendingFocusRef.current = SUBMIT_BUTTON_ID;
      handleFailure(error, stage);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setPhase("idle");
    }
  }

  if (submitted) {
    return (
      <section className="career-apply-section">
        <div className="career-apply-card">
          <div className="portfolio-header careers-success-header">
            <p className="portfolio-eyebrow">Application Received</p>
            <h2 id={SUCCESS_HEADING_ID} tabIndex={-1} className="portfolio-header h2 careers-focus-target">
              Thank you for applying.
            </h2>
            <p className="portfolio-subtitle">Your application for {job.title} has been submitted successfully.</p>
          </div>
          <div className="career-form-message career-form-success careers-success-panel">
            {submitted.reference ? (
              <p className="careers-success-reference">
                Your reference: <strong>{submitted.reference}</strong>
              </p>
            ) : null}
            <p>Please keep this reference in case you need to contact us about your application.</p>
            <h3>What happens next</h3>
            <ul className="careers-success-steps">
              <li>Our HR team reviews every application carefully.</li>
              <li>If your profile matches the role, we will contact you by email or phone about the next steps.</li>
            </ul>
          </div>
          <div className="careers-success-actions">
            <Link href="/careers" className="button-link">
              Browse more roles
            </Link>
          </div>
        </div>
      </section>
    );
  }

  const coverLetterLength = form.coverLetter.length;

  return (
    <section className="career-apply-section">
      <div className="career-apply-card">
        <div className="portfolio-header">
          <p className="portfolio-eyebrow">Apply Now</p>
          <h2 className="portfolio-header h2">Submit your application in three quick steps.</h2>
          <p className="portfolio-subtitle">
            We review every application with care. Share your details, upload your CV, and tell us
            a little about your fit for the role.
          </p>
          {job.applicationDeadline ? (
            <p className="careers-form-deadline">Applications close on {formatDate(job.applicationDeadline)}.</p>
          ) : null}
        </div>

        <ol className="career-progress" aria-label="Application progress">
          {stepLabels.map((label, index) => (
            <li
              key={label}
              className={`career-progress-step ${index <= step ? "active" : ""}`}
              aria-current={index === step ? "step" : undefined}
            >
              <span aria-hidden="true">{index + 1}</span>
              <p>{label}</p>
              {index < LAST_STEP ? <i className="career-progress-connector" aria-hidden="true" /> : null}
            </li>
          ))}
        </ol>

        <form method="post" className="career-form" onSubmit={handleSubmit} noValidate>
          <h3 id={STEP_HEADING_ID} tabIndex={-1} className="careers-sr-only">
            Step {step + 1} of {stepLabels.length}: {stepLabels[step]}
          </h3>

          <fieldset className="careers-form-fieldset" disabled={busy}>

            {step === 0 ? (
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
                <FormField
                  id={fieldId("phone")}
                  label="Phone"
                  required
                  hint="Include country code, e.g. +94 77 123 4567"
                  error={fieldErrors.phone}
                >
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
              </div>
            ) : null}

            {step === 1 ? (
              <div className="career-form-grid">
                <FormField id={fieldId("position")} label="Position">
                  {(control) => <input {...control} type="text" value={job.title} readOnly />}
                </FormField>
                <FormField id={fieldId("linkedIn")} label="LinkedIn profile URL" optional error={fieldErrors.linkedIn}>
                  {(control) => (
                    <input
                      {...control}
                      type="url"
                      name="linkedIn"
                      inputMode="url"
                      autoComplete="url"
                      autoCapitalize="none"
                      spellCheck={false}
                      maxLength={FIELD_LIMITS.url}
                      placeholder="https://linkedin.com/in/yourprofile"
                      value={form.linkedIn}
                      onChange={(event) => updateField("linkedIn", event.target.value)}
                    />
                  )}
                </FormField>
                <FormField id={fieldId("portfolio")} label="Portfolio / Website URL" optional error={fieldErrors.portfolio}>
                  {(control) => (
                    <input
                      {...control}
                      type="url"
                      name="portfolio"
                      inputMode="url"
                      autoComplete="url"
                      autoCapitalize="none"
                      spellCheck={false}
                      maxLength={FIELD_LIMITS.url}
                      placeholder="https://yourwebsite.com"
                      value={form.portfolio}
                      onChange={(event) => updateField("portfolio", event.target.value)}
                    />
                  )}
                </FormField>
                <DocumentUploadField
                  id={fieldId("cv")}
                  kind="cv"
                  label="CV upload (PDF)"
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
              </div>
            ) : null}

            {step === 2 ? (
              <div className="career-form-grid career-form-grid-single">
                <FormField
                  id={fieldId("coverLetter")}
                  label="Cover letter"
                  optional
                  counter={{ length: coverLetterLength, max: FIELD_LIMITS.coverLetter }}
                  error={fieldErrors.coverLetter}
                  className="careers-field-full"
                >
                  {(control) => (
                    <textarea
                      {...control}
                      name="coverLetter"
                      rows={7}
                      maxLength={FIELD_LIMITS.coverLetter}
                      value={form.coverLetter}
                      onChange={(event) => updateField("coverLetter", event.target.value)}
                      placeholder="Share a brief introduction, motivation, or relevant experience."
                    />
                  )}
                </FormField>
                <div className="career-application-review careers-field-full">
                  <div>
                    <strong>Applying for</strong>
                    <span className="careers-review-value">{job.title}</span>
                  </div>
                  <div>
                    <strong>Your details</strong>
                    <span className="careers-review-value">{form.name.trim()}</span>
                    <span className="careers-review-value">{form.email.trim()}</span>
                    <span className="careers-review-value">{form.phone.trim()}</span>
                  </div>
                  <div>
                    <strong>CV file</strong>
                    <span className="careers-review-value">{cv?.name ?? "Not uploaded yet"}</span>
                  </div>
                  {supporting.length > 0 ? (
                    <div>
                      <strong>Supporting documents</strong>
                      {supporting.map((file, index) => (
                        <span key={`${index}-${file.name}`} className="careers-review-value">
                          {file.name}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {form.linkedIn.trim() ? (
                    <div>
                      <strong>LinkedIn</strong>
                      <span className="careers-review-value">{form.linkedIn.trim()}</span>
                    </div>
                  ) : null}
                  {form.portfolio.trim() ? (
                    <div>
                      <strong>Portfolio</strong>
                      <span className="careers-review-value">{form.portfolio.trim()}</span>
                    </div>
                  ) : null}
                </div>
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
            ) : null}
          </fieldset>

          {formError ? (
            <p role="alert" className="career-form-message career-form-error">
              {formError}
              {jobClosed ? (
                <>
                  {" "}
                  <Link href="/careers" className="careers-form-message-link">
                    Browse open roles
                  </Link>
                </>
              ) : null}
            </p>
          ) : null}
          {notice ? (
            <p role="status" className="career-form-message careers-form-notice">
              {notice}
            </p>
          ) : null}
          {phase !== "idle" ? (
            <UploadProgress
              id="apply-progress"
              phase={phase}
              fraction={progress}
              submittingLabel="Submitting your application"
              onCancel={handleCancel}
            />
          ) : null}

          <div className="career-form-actions">
            <button key="back" type="button" className="career-secondary-button" onClick={handlePrevious} disabled={step === 0 || busy}>
              Back
            </button>
            {/* Distinct keys: reusing one element while its type flips from "button" to "submit"
                inside the click would submit the form immediately. */}
            {step < LAST_STEP ? (
              <button key="continue" type="button" onClick={handleNext} disabled={busy}>
                Continue
              </button>
            ) : (
              <button key="submit" id={SUBMIT_BUTTON_ID} type="submit" disabled={busy || jobClosed}>
                {busy ? "Submitting..." : "Submit Application"}
              </button>
            )}
          </div>
        </form>
      </div>
    </section>
  );
}
