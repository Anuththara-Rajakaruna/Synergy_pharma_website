"use client";

import Link from "next/link";
import { DragEvent, FormEvent, startTransition, useEffect, useRef, useState } from "react";
import { Job } from "@/types/careers";

type ApplicationFormProps = {
  job: Job;
};

type FormState = {
  name: string;
  email: string;
  phone: string;
  position: string;
  linkedIn: string;
  portfolio: string;
  coverLetter: string;
  consentGiven: boolean;
};

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const stepLabels = ["Details", "Role & CV", "Review"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[\d\s\-().]{7,20}$/;

export function ApplicationForm({ job }: ApplicationFormProps) {
  const storageKey = `synergy-apply-draft-${job.id}`;

  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>({
    name: "",
    email: "",
    phone: "",
    position: job.title,
    linkedIn: "",
    portfolio: "",
    coverLetter: "",
    consentGiven: false,
  });
  const [cv, setCv] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    try {
      window.sessionStorage.setItem(
        storageKey,
        JSON.stringify({ name: form.name, email: form.email, phone: form.phone, coverLetter: form.coverLetter })
      );
    } catch {
      // sessionStorage may be unavailable in some environments
    }
  }, [form.name, form.email, form.phone, form.coverLetter, storageKey]);

  function handleFileChange(file: File | null) {
    setFileError("");
    if (!file) { setCv(null); return; }
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

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0] ?? null;
    handleFileChange(file);
  }

  function validateCurrentStep(currentStep: number) {
    if (currentStep === 0) {
      if (!form.name.trim() || !form.email.trim() || !form.phone.trim()) {
        return "Please complete your name, email, and phone number.";
      }
      if (!EMAIL_RE.test(form.email.trim())) {
        return "Please enter a valid email address.";
      }
      if (!PHONE_RE.test(form.phone.trim())) {
        return "Please enter a valid phone number (e.g. +94 77 000 0000).";
      }
    }
    if (currentStep === 1) {
      if (!form.position.trim() || !cv) return "Please confirm the position and upload your CV.";
      if (fileError) return fileError;
    }
    if (currentStep === 2) {
      if (!form.consentGiven) return "Please read and accept the privacy policy to continue.";
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
    const stepError = validateCurrentStep(2);
    if (stepError) { setError(stepError); return; }
    if (!cv) { setError("Please upload your CV before submitting."); setStep(1); return; }

    const payload = new FormData();
    payload.set("name", form.name);
    payload.set("email", form.email);
    payload.set("phone", form.phone);
    payload.set("position", form.position);
    payload.set("jobId", job.id);
    payload.set("coverLetter", form.coverLetter);
    payload.set("consentGiven", "true");
    payload.set("cv", cv);
    if (form.linkedIn) payload.set("linkedIn", form.linkedIn);
    if (form.portfolio) payload.set("portfolio", form.portfolio);

    setIsSubmitting(true);
    setError("");
    setSuccessMessage("");

    startTransition(async () => {
      try {
        const response = await fetch("/api/apply", { method: "POST", body: payload });
        const result = (await response.json()) as { error?: string; message?: string };
        if (!response.ok) { setError(result.error ?? "We couldn't submit your application."); return; }
        setSuccessMessage(result.message ?? "Application submitted successfully.");
        window.sessionStorage.removeItem(storageKey);
        setForm({ name: "", email: "", phone: "", position: job.title, linkedIn: "", portfolio: "", coverLetter: "", consentGiven: false });
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
    <section className="career-apply-section">
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
                  placeholder="+94 77 000 0000"
                  value={form.phone}
                  onChange={(e) => setForm((c) => ({ ...c, phone: e.target.value }))}
                />
                <span className="text-xs text-[#7d97a9] mt-1">Include country code, e.g. +94 77 123 4567</span>
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
              <label className="careers-field">
                <span>LinkedIn profile URL <span className="text-[#7d97a9] font-normal">(optional)</span></span>
                <input
                  type="url"
                  placeholder="https://linkedin.com/in/yourprofile"
                  value={form.linkedIn}
                  onChange={(e) => setForm((c) => ({ ...c, linkedIn: e.target.value }))}
                />
              </label>
              <label className="careers-field">
                <span>Portfolio / Website URL <span className="text-[#7d97a9] font-normal">(optional)</span></span>
                <input
                  type="url"
                  placeholder="https://yourwebsite.com"
                  value={form.portfolio}
                  onChange={(e) => setForm((c) => ({ ...c, portfolio: e.target.value }))}
                />
              </label>
              <div className="careers-field careers-field-full">
                <span id="cv-label">CV upload (PDF) <span aria-hidden="true">*</span></span>
                <div
                  role="button"
                  tabIndex={0}
                  aria-labelledby="cv-label"
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  onKeyDown={(e) => e.key === "Enter" || e.key === " " ? fileInputRef.current?.click() : undefined}
                  style={{
                    border: `2px dashed ${isDragging ? "#1075bd" : "#c4dff0"}`,
                    borderRadius: "1rem",
                    padding: "1.5rem",
                    textAlign: "center",
                    cursor: "pointer",
                    background: isDragging ? "#edf6fd" : "#f7fbfd",
                    transition: "all 0.2s",
                    marginTop: "0.35rem",
                  }}
                >
                  {cv ? (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.75rem" }}>
                      <span style={{ fontSize: "1.25rem" }}>📄</span>
                      <div style={{ textAlign: "left" }}>
                        <p style={{ fontWeight: 600, color: "#0a1f35", margin: 0, fontSize: "0.9rem" }}>{cv.name}</p>
                        <p style={{ color: "#7d97a9", margin: "0.15rem 0 0", fontSize: "0.75rem" }}>
                          {(cv.size / 1024).toFixed(0)} KB
                        </p>
                      </div>
                      <button
                        type="button"
                        aria-label="Remove CV"
                        onClick={(e) => { e.stopPropagation(); setCv(null); setFileError(""); }}
                        style={{
                          marginLeft: "auto",
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          color: "#5f89a4",
                          fontSize: "1.1rem",
                          lineHeight: 1,
                          padding: "0.25rem",
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ) : (
                    <div>
                      <p style={{ color: "#1075bd", fontWeight: 600, margin: 0, fontSize: "0.9rem" }}>
                        Drag &amp; drop your CV here
                      </p>
                      <p style={{ color: "#7d97a9", margin: "0.35rem 0 0", fontSize: "0.78rem" }}>
                        or click to browse — PDF only, max 10 MB
                      </p>
                    </div>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  style={{ display: "none" }}
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
                {form.linkedIn ? (
                  <div>
                    <strong>LinkedIn</strong>
                    <span style={{ wordBreak: "break-all" }}>{form.linkedIn}</span>
                  </div>
                ) : null}
                {form.portfolio ? (
                  <div>
                    <strong>Portfolio</strong>
                    <span style={{ wordBreak: "break-all" }}>{form.portfolio}</span>
                  </div>
                ) : null}
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
