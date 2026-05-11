"use client";

import { FormEvent, startTransition, useState } from "react";
import { CAREER_DEPARTMENTS } from "@/components/careers/department-options";

type TalentPoolState = {
  name: string;
  email: string;
  phone: string;
  areaOfInterest: string;
  notes: string;
  cv: File | null;
};

const initialState: TalentPoolState = {
  name: "",
  email: "",
  phone: "",
  areaOfInterest: "",
  notes: "",
  cv: null,
};

export function TalentPoolForm() {
  const [form, setForm] = useState<TalentPoolState>(initialState);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!form.name.trim() || !form.email.trim() || !form.phone.trim() || !form.areaOfInterest.trim() || !form.cv) {
      setError("Please complete the required fields and attach your CV.");
      setMessage("");
      return;
    }

    const isPdf = form.cv.type === "application/pdf" || form.cv.name.toLowerCase().endsWith(".pdf");

    if (!isPdf) {
      setError("Talent pool uploads must be provided as PDF files.");
      setMessage("");
      return;
    }

    const payload = new FormData();
    payload.set("name", form.name);
    payload.set("email", form.email);
    payload.set("phone", form.phone);
    payload.set("areaOfInterest", form.areaOfInterest);
    payload.set("notes", form.notes);
    payload.set("cv", form.cv);

    setIsSubmitting(true);
    setError("");
    setMessage("");

    startTransition(async () => {
      try {
        const response = await fetch("/api/talent-pool", {
          method: "POST",
          body: payload,
        });
        const result = (await response.json()) as { error?: string; message?: string };

        if (!response.ok) {
          setError(result.error ?? "We couldn't submit your profile.");
          return;
        }

        setMessage(result.message ?? "Talent profile submitted successfully.");
        setForm(initialState);
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
          <span>Full name</span>
          <input
            type="text"
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
          />
        </label>
        <label className="careers-field">
          <span>Email</span>
          <input
            type="email"
            value={form.email}
            onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
          />
        </label>
        <label className="careers-field">
          <span>Phone</span>
          <input
            type="tel"
            value={form.phone}
            onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
          />
        </label>
        <label className="careers-field">
          <span>Area of interest</span>
          <select
            value={form.areaOfInterest}
            onChange={(event) => setForm((current) => ({ ...current, areaOfInterest: event.target.value }))}
          >
            <option value="">Select a department</option>
            {CAREER_DEPARTMENTS.map((department) => (
              <option key={department} value={department}>
                {department}
              </option>
            ))}
          </select>
        </label>
        <label className="careers-field careers-field-full">
          <span>Notes (optional)</span>
          <textarea
            rows={5}
            value={form.notes}
            onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
            placeholder="Tell us what kind of opportunity you're looking for."
          />
        </label>
        <label className="careers-field careers-field-full">
          <span>Upload CV (PDF)</span>
          <input
            type="file"
            accept="application/pdf,.pdf"
            onChange={(event) => setForm((current) => ({ ...current, cv: event.target.files?.[0] ?? null }))}
          />
        </label>
      </div>

      {error ? <p className="career-form-message career-form-error">{error}</p> : null}
      {message ? <p className="career-form-message career-form-success">{message}</p> : null}

      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Submitting..." : "Submit to Talent Pool"}
      </button>
    </form>
  );
}
