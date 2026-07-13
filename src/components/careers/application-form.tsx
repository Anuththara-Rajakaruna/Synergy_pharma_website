"use client";

import { FormEvent, startTransition, useState } from "react";
import Link from "next/link";
import { Job } from "@/types/careers";

type ApplicationFormProps = {
  job: Job;
};

type FormState = {
  name: string;
  email: string;
  phone: string;
  position: string;
  coverLetter: string;
  cv: File | null;
  privacyConsent: boolean;
  // Honeypot — must stay empty; filled by bots
  website: string;
};

const initialState: FormState = {
  name: "",
  email: "",
  phone: "",
  position: "",
  coverLetter: "",
  cv: null,
  privacyConsent: false,
  website: "",
};

const stepLabels = ["Details", "Role & CV", "Review & Consent"];

export function ApplicationForm({ job }: ApplicationFormProps) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>({ ...initialState, position: job.title });
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [applicationId, setApplicationId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function validateCurrentStep(currentStep: number) {
    if (currentStep === 0) {
      if (!form.name.trim() || !form.email.trim() || !form.phone.trim()) {
        return "Please complete your name, email, and phone number.";
      }
    }

    if (currentStep === 1) {
      if (!form.position.trim() || !form.cv) {
        return "Please confirm the position and upload your CV.";
      }
      const isPdf = form.cv.type === "application/pdf" || form.cv.name.toLowerCase().endsWith(".pdf");
      if (!isPdf) return "CV uploads must be provided as PDF files.";
    }

    if (currentStep === 2) {
      if (!form.privacyConsent) {
        return "Please read and accept the Privacy Notice to continue.";
      }
    }

    return "";
  }

  function handleNext() {
    const nextError = validateCurrentStep(step);
    setError(nextError);
    if (!nextError) setStep((current) => Math.min(current + 1, 2));
  }

  function handlePrevious() {
    setError("");
    setStep((current) => Math.max(current - 1, 0));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // Honeypot check — if filled, silently succeed (it's a bot)
    if (form.website) {
      setSuccessMessage("Application submitted successfully.");
      return;
    }

    const consentError = validateCurrentStep(2);
    if (consentError) { setError(consentError); return; }

    const cvError = validateCurrentStep(1);
    if (cvError) { setError(cvError); setStep(1); return; }

    if (!form.cv) { setError("Please upload your CV before submitting."); return; }

    const payload = new FormData();
    payload.set("name", form.name);
    payload.set("email", form.email);
    payload.set("phone", form.phone);
    payload.set("position", form.position);
    payload.set("jobId", job.id);
    payload.set("coverLetter", form.coverLetter);
    payload.set("cv", form.cv);

    setIsSubmitting(true);
    setError("");

    startTransition(async () => {
      try {
        const response = await fetch("/api/apply", { method: "POST", body: payload });
        const result = (await response.json()) as { error?: string; message?: string; id?: string };

        if (!response.ok) {
          setError(result.error ?? "We couldn't submit your application.");
          return;
        }

        setSuccessMessage(result.message ?? "Application submitted successfully.");
        setApplicationId(result.id ?? "");
      } catch {
        setError("We couldn't submit your application right now. Please try again.");
      } finally {
        setIsSubmitting(false);
      }
    });
  }

  if (successMessage) {
    return (
      <section className="career-apply-section" id="apply">
        <div className="career-apply-card career-apply-success">
          <div className="career-success-icon">✓</div>
          <h2>Application submitted!</h2>
          <p>{successMessage}</p>
          {applicationId && (
            <div className="career-success-reference">
              <p className="career-success-reference-label">Your reference number</p>
              <code className="career-success-reference-id">{applicationId}</code>
              <p className="career-success-hint">
                Save this — use it with your email at{" "}
                <Link href="/careers/status">/careers/status</Link> to check your application status.
              </p>
            </div>
          )}
          <p className="career-success-hint">We&apos;ll be in touch soon. You can close this page or explore other roles.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="career-apply-section" id="apply">
      <div className="career-apply-card">
        <div className="portfolio-header">
          <p className="portfolio-eyebrow">Apply Now</p>
          <h2 className="portfolio-header h2">Submit your application in three quick steps.</h2>
          <p className="portfolio-subtitle">
            We review every application with care. Share your details, upload your CV, and tell us
            a little about your fit for the role.
          </p>
        </div>

        <div className="career-progress" aria-label="Application progress">
          {stepLabels.map((label, index) => (
            <div key={label} className={`career-progress-step ${index <= step ? "active" : ""}`}>
              <span>{index + 1}</span>
              <p>{label}</p>
              {index < stepLabels.length - 1 ? <i className="career-progress-connector" aria-hidden="true" /> : null}
            </div>
          ))}
        </div>

        <form className="career-form" onSubmit={handleSubmit}>
          {/* Honeypot field — hidden from humans, filled by bots */}
          <label className="career-honeypot" aria-hidden="true">
            <span>Leave this blank</span>
            <input
              type="text"
              name="website"
              value={form.website}
              onChange={(e) => setForm((c) => ({ ...c, website: e.target.value }))}
              tabIndex={-1}
              autoComplete="off"
            />
          </label>

          {step === 0 ? (
            <div className="career-form-grid">
              <label className="careers-field">
                <span>Full name</span>
                <input type="text" value={form.name}
                  onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))} />
              </label>
              <label className="careers-field">
                <span>Email</span>
                <input type="email" value={form.email}
                  onChange={(e) => setForm((c) => ({ ...c, email: e.target.value }))} />
              </label>
              <label className="careers-field">
                <span>Phone</span>
                <input type="tel" value={form.phone}
                  onChange={(e) => setForm((c) => ({ ...c, phone: e.target.value }))} />
              </label>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="career-form-grid">
              <div className="careers-field">
                <span>Position</span>
                <p className="careers-field-static">{form.position}</p>
              </div>
              <label className="careers-field">
                <span>CV upload (PDF, max 10 MB)</span>
                <input type="file" accept="application/pdf,.pdf"
                  onChange={(e) => setForm((c) => ({ ...c, cv: e.target.files?.[0] ?? null }))} />
              </label>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="career-form-grid career-form-grid-single">
              <label className="careers-field">
                <span>Cover letter (optional)</span>
                <textarea rows={7} value={form.coverLetter}
                  onChange={(e) => setForm((c) => ({ ...c, coverLetter: e.target.value }))}
                  placeholder="Share a brief introduction, motivation, or relevant experience." />
              </label>
              <div className="career-application-review">
                <div>
                  <strong>Applying for</strong>
                  <span>{form.position || job.title}</span>
                </div>
                <div>
                  <strong>CV file</strong>
                  <span>{form.cv?.name ?? "Not uploaded yet"}</span>
                </div>
              </div>

              {/* GDPR Consent */}
              <label className="career-consent-label">
                <input
                  type="checkbox"
                  className="career-consent-checkbox"
                  checked={form.privacyConsent}
                  onChange={(e) => setForm((c) => ({ ...c, privacyConsent: e.target.checked }))}
                  required
                />
                <span>
                  I have read and agree to the{" "}
                  <Link href="/privacy" target="_blank" rel="noopener noreferrer">
                    Privacy Notice
                  </Link>
                  {" "}and consent to Synergy Pharmaceuticals processing my personal data for recruitment purposes.
                </span>
              </label>
            </div>
          ) : null}

          {error ? <p className="career-form-message career-form-error">{error}</p> : null}

          <div className="career-form-actions">
            <button type="button" className="career-secondary-button" onClick={handlePrevious} disabled={step === 0}>
              Back
            </button>
            {step < 2 ? (
              <button type="button" onClick={handleNext}>Continue</button>
            ) : (
              <button type="submit" disabled={isSubmitting || !form.privacyConsent}>
                {isSubmitting ? "Submitting..." : "Submit Application"}
              </button>
            )}
          </div>
        </form>
      </div>
    </section>
  );
}
