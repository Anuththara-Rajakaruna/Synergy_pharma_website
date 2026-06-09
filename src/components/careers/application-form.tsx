"use client";

import Link from "next/link";
import { FormEvent, startTransition, useEffect, useState } from "react";
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
  consentGiven: boolean;
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const stepLabels = ["Details", "Role & CV", "Review"];

export function ApplicationForm({ job }: ApplicationFormProps) {
  const storageKey = `synergy-apply-draft-${job.id}`;

  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>({
    name: "",
    email: "",
    phone: "",
    position: job.title,
    coverLetter: "",
    consentGiven: false,
  });
  const [cv, setCv] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Restore autosaved draft on mount
  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<FormState>;
        setForm((current) => ({
          ...current,
          name: parsed.name ?? current.name,
          email: parsed.email ?? current.email,
          phone: parsed.phone ?? current.phone,
          coverLetter: parsed.coverLetter ?? current.coverLetter,
        }));
      }
    } catch {
      window.sessionStorage.removeItem(storageKey);
    }
  }, [storageKey]);

  // Autosave on field change (exclude File — not serializable)
  useEffect(() => {
    try {
      window.sessionStorage.setItem(
        storageKey,
        JSON.stringify({
          name: form.name,
          email: form.email,
          phone: form.phone,
          coverLetter: form.coverLetter,
        })
      );
    } catch {
      // sessionStorage may be unavailable in some environments
    }
  }, [form.name, form.email, form.phone, form.coverLetter, storageKey]);

  function handleFileChange(file: File | null) {
    setFileError("");
    if (!file) {
      setCv(null);
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setFileError("File is too large. Please upload a PDF under 10 MB.");
      setCv(null);
      return;
    }
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      setFileError("CV uploads must be PDF files.");
      setCv(null);
      return;
    }
    setCv(file);
  }

  function validateCurrentStep(currentStep: number) {
    if (currentStep === 0) {
      if (!form.name.trim() || !form.email.trim() || !form.phone.trim()) {
        return "Please complete your name, email, and phone number.";
      }
    }
    if (currentStep === 1) {
      if (!form.position.trim() || !cv) {
        return "Please confirm the position and upload your CV.";
      }
      if (fileError) return fileError;
    }
    if (currentStep === 2) {
      if (!form.consentGiven) {
        return "Please read and accept the privacy policy to continue.";
      }
    }
    return "";
  }

  function handleNext() {
    const nextError = validateCurrentStep(step);
    setError(nextError);
    if (!nextError) {
      setStep((current) => Math.min(current + 1, 2));
    }
  }

  function handlePrevious() {
    setError("");
    setStep((current) => Math.max(current - 1, 0));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const stepError = validateCurrentStep(2);
    if (stepError) {
      setError(stepError);
      return;
    }
    if (!cv) {
      setError("Please upload your CV before submitting.");
      setStep(1);
      return;
    }

    const payload = new FormData();
    payload.set("name", form.name);
    payload.set("email", form.email);
    payload.set("phone", form.phone);
    payload.set("position", form.position);
    payload.set("jobId", job.id);
    payload.set("coverLetter", form.coverLetter);
    payload.set("consentGiven", "true");
    payload.set("cv", cv);

    setIsSubmitting(true);
    setError("");
    setSuccessMessage("");

    startTransition(async () => {
      try {
        const response = await fetch("/api/apply", { method: "POST", body: payload });
        const result = (await response.json()) as { error?: string; message?: string };

        if (!response.ok) {
          setError(result.error ?? "We couldn't submit your application.");
          return;
        }

        setSuccessMessage(result.message ?? "Application submitted successfully.");
        window.sessionStorage.removeItem(storageKey);
        setForm({ name: "", email: "", phone: "", position: job.title, coverLetter: "", consentGiven: false });
        setCv(null);
        setStep(0);
      } catch {
        setError("We couldn't submit your application right now. Please try again.");
      } finally {
        setIsSubmitting(false);
      }
    });
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
          {step === 0 ? (
            <div className="career-form-grid">
              <label className="careers-field">
                <span>Full name <span aria-hidden="true">*</span></span>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))}
                />
              </label>
              <label className="careers-field">
                <span>Email <span aria-hidden="true">*</span></span>
                <input
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => setForm((c) => ({ ...c, email: e.target.value }))}
                />
              </label>
              <label className="careers-field">
                <span>Phone <span aria-hidden="true">*</span></span>
                <input
                  type="tel"
                  required
                  value={form.phone}
                  onChange={(e) => setForm((c) => ({ ...c, phone: e.target.value }))}
                />
              </label>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="career-form-grid">
              <label className="careers-field">
                <span>Position <span aria-hidden="true">*</span></span>
                <input
                  type="text"
                  required
                  value={form.position}
                  onChange={(e) => setForm((c) => ({ ...c, position: e.target.value }))}
                />
              </label>
              <div className="careers-field">
                <span id="cv-label">CV upload (PDF) <span aria-hidden="true">*</span></span>
                <span id="cv-hint" className="text-xs text-[#5f89a4]">PDF files only, maximum 10 MB</span>
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  required
                  aria-labelledby="cv-label"
                  aria-describedby="cv-hint"
                  onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
                />
                {fileError ? (
                  <p role="alert" className="career-form-message career-form-error mt-1">{fileError}</p>
                ) : null}
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="career-form-grid career-form-grid-single">
              <label className="careers-field">
                <span>Cover letter (optional)</span>
                <textarea
                  rows={7}
                  value={form.coverLetter}
                  onChange={(e) => setForm((c) => ({ ...c, coverLetter: e.target.value }))}
                  placeholder="Share a brief introduction, motivation, or relevant experience."
                />
              </label>
              <div className="career-application-review">
                <div>
                  <strong>Applying for</strong>
                  <span>{form.position || job.title}</span>
                </div>
                <div>
                  <strong>CV file</strong>
                  <span>{cv?.name ?? "Not uploaded yet"}</span>
                </div>
              </div>
              <label className="careers-field careers-field-checkbox">
                <input
                  type="checkbox"
                  required
                  checked={form.consentGiven}
                  onChange={(e) => setForm((c) => ({ ...c, consentGiven: e.target.checked }))}
                />
                <span>
                  I have read and agree to the{" "}
                  <Link href="/privacy-policy" target="_blank" className="underline text-[#1075bd]">
                    Privacy Policy
                  </Link>{" "}
                  and consent to Synergy Pharma processing my personal data for recruitment purposes.{" "}
                  <span aria-hidden="true">*</span>
                </span>
              </label>
            </div>
          ) : null}

          {error ? <p role="alert" className="career-form-message career-form-error">{error}</p> : null}
          {successMessage ? <p role="status" className="career-form-message career-form-success">{successMessage}</p> : null}

          <div className="career-form-actions">
            <button type="button" className="career-secondary-button" onClick={handlePrevious} disabled={step === 0}>
              Back
            </button>
            {step < 2 ? (
              <button type="button" onClick={handleNext}>Continue</button>
            ) : (
              <button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Submitting..." : "Submit Application"}
              </button>
            )}
          </div>
        </form>
      </div>
    </section>
  );
}
