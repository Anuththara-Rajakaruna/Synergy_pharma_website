"use client";

import Link from "next/link";
import { DragEvent, FormEvent, startTransition, useEffect, useRef, useState } from "react";
import { CAREER_DEPARTMENTS } from "@/components/careers/department-options";

type TalentPoolState = {
  name: string;
  email: string;
  phone: string;
  areaOfInterest: string;
  notes: string;
  consentGiven: boolean;
};

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const STORAGE_KEY = "synergy-talent-draft";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[\d\s\-().]{7,20}$/;

export function TalentPoolForm() {
  const [form, setForm] = useState<TalentPoolState>({
    name: "",
    email: "",
    phone: "",
    areaOfInterest: "",
    notes: "",
    consentGiven: false,
  });
  const [cv, setCv] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<TalentPoolState>;
        setForm((c) => ({
          ...c,
          name: parsed.name ?? c.name,
          email: parsed.email ?? c.email,
          phone: parsed.phone ?? c.phone,
          areaOfInterest: parsed.areaOfInterest ?? c.areaOfInterest,
          notes: parsed.notes ?? c.notes,
        }));
      }
    } catch {
      window.sessionStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ name: form.name, email: form.email, phone: form.phone, areaOfInterest: form.areaOfInterest, notes: form.notes })
      );
    } catch {
      // sessionStorage may be unavailable in some environments
    }
  }, [form.name, form.email, form.phone, form.areaOfInterest, form.notes]);

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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!form.name.trim() || !form.email.trim() || !form.phone.trim() || !form.areaOfInterest.trim() || !cv) {
      setError("Please complete the required fields and attach your CV.");
      setMessage("");
      return;
    }
    if (!EMAIL_RE.test(form.email.trim())) {
      setError("Please enter a valid email address.");
      setMessage("");
      return;
    }
    if (!PHONE_RE.test(form.phone.trim())) {
      setError("Please enter a valid phone number (e.g. +94 77 000 0000).");
      setMessage("");
      return;
    }
    if (fileError) { setError(fileError); return; }
    if (!form.consentGiven) {
      setError("Please read and accept the privacy policy to submit your profile.");
      setMessage("");
      return;
    }

    const payload = new FormData();
    payload.set("name", form.name);
    payload.set("email", form.email);
    payload.set("phone", form.phone);
    payload.set("areaOfInterest", form.areaOfInterest);
    payload.set("notes", form.notes);
    payload.set("consentGiven", "true");
    payload.set("cv", cv);

    setIsSubmitting(true);
    setError("");
    setMessage("");

    startTransition(async () => {
      try {
        const response = await fetch("/api/talent-pool", { method: "POST", body: payload });
        const result = (await response.json()) as { error?: string; message?: string };
        if (!response.ok) { setError(result.error ?? "We couldn't submit your profile."); return; }
        setMessage(result.message ?? "Talent profile submitted successfully.");
        setForm({ name: "", email: "", phone: "", areaOfInterest: "", notes: "", consentGiven: false });
        setCv(null);
        window.sessionStorage.removeItem(STORAGE_KEY);
      } catch {
        setError("We couldn't submit your profile right now. Please try again.");
      } finally {
        setIsSubmitting(false);
      }
    });
  }

  return (
    <form className="talent-pool-form" onSubmit={handleSubmit}>
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
        <label className="careers-field">
          <span>Area of interest <span aria-hidden="true">*</span></span>
          <select
            required
            value={form.areaOfInterest}
            onChange={(e) => setForm((c) => ({ ...c, areaOfInterest: e.target.value }))}
          >
            <option value="">Select a department</option>
            {CAREER_DEPARTMENTS.map((dept) => (
              <option key={dept} value={dept}>{dept}</option>
            ))}
          </select>
        </label>
        <label className="careers-field careers-field-full">
          <span>Notes (optional)</span>
          <textarea
            rows={5}
            value={form.notes}
            onChange={(e) => setForm((c) => ({ ...c, notes: e.target.value }))}
            placeholder="Tell us what kind of opportunity you're looking for."
          />
        </label>
        <div className="careers-field careers-field-full">
          <span id="tp-cv-label">Upload CV (PDF) <span aria-hidden="true">*</span></span>
          <div
            role="button"
            tabIndex={0}
            aria-labelledby="tp-cv-label"
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
            aria-labelledby="tp-cv-label"
            style={{ display: "none" }}
            onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
          />
          {fileError ? (
            <p role="alert" className="career-form-message career-form-error mt-1">{fileError}</p>
          ) : null}
        </div>
        <label className="careers-field careers-field-full careers-field-checkbox">
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

      {error ? <p role="alert" className="career-form-message career-form-error">{error}</p> : null}
      {message ? <p role="status" className="career-form-message career-form-success">{message}</p> : null}

      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Submitting..." : "Submit to Talent Pool"}
      </button>
    </form>
  );
}
