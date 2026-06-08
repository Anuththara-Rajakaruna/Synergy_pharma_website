"use client";

import type { Metadata } from "next";
import Link from "next/link";
import { FormEvent, useState } from "react";
import { SiteHeader } from "@/components/site-header";

type StatusResult = {
  id: string;
  name: string;
  position: string;
  status: string;
  createdAt: string;
};

const STATUS_LABELS: Record<string, { label: string; color: string; message: string }> = {
  pending: {
    label: "Under Review",
    color: "#5a6070",
    message: "Your application has been received and is in our review queue. We aim to respond within 2–3 weeks.",
  },
  reviewed: {
    label: "Reviewed",
    color: "#1a5fa8",
    message: "Your application has been reviewed by our HR team. We will be in touch if you are selected for the next stage.",
  },
  shortlisted: {
    label: "Shortlisted",
    color: "#1a7d4a",
    message: "Congratulations — you have been shortlisted! Our team will contact you shortly to discuss next steps.",
  },
  rejected: {
    label: "Application Closed",
    color: "#9b2525",
    message: "Thank you for applying. After careful review, we have decided not to proceed at this time. We encourage you to apply for future openings.",
  },
};

export default function ApplicationStatusPage() {
  const [email, setEmail] = useState("");
  const [applicationId, setApplicationId] = useState("");
  const [result, setResult] = useState<StatusResult | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(""); setResult(null); setIsLoading(true);

    try {
      const params = new URLSearchParams({ email: email.trim(), id: applicationId.trim() });
      const response = await fetch(`/api/status?${params}`);
      const data = (await response.json()) as StatusResult | { error: string };

      if (!response.ok || "error" in data) {
        setError((data as { error: string }).error ?? "Could not find your application.");
        return;
      }

      setResult(data as StatusResult);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="careers-status-page">
      <SiteHeader />

      <section className="careers-status-section">
        <div className="careers-shell">
          <div className="careers-status-card">
            <nav className="career-breadcrumb" aria-label="Breadcrumb">
              <Link href="/">Home</Link>
              <span aria-hidden="true">›</span>
              <Link href="/careers">Careers</Link>
              <span aria-hidden="true">›</span>
              <span aria-current="page">Application Status</span>
            </nav>

            <div className="careers-status-header">
              <p className="eyebrow">Application Tracking</p>
              <h1>Check your application status</h1>
              <p className="careers-subtitle">
                Enter the email address you applied with and the reference number from your confirmation email.
              </p>
            </div>

            {!result ? (
              <form className="career-form" onSubmit={handleSubmit}>
                <div className="career-form-grid">
                  <label className="careers-field">
                    <span>Email address</span>
                    <input type="email" value={email} required
                      onChange={(e) => setEmail(e.target.value)} disabled={isLoading} />
                  </label>
                  <label className="careers-field">
                    <span>Application reference number</span>
                    <input type="text" value={applicationId} required placeholder="application-..."
                      onChange={(e) => setApplicationId(e.target.value)} disabled={isLoading} />
                  </label>
                </div>

                {error ? <p className="career-form-message career-form-error">{error}</p> : null}

                <div className="career-form-actions" style={{ justifyContent: "flex-end" }}>
                  <button type="submit" disabled={isLoading}>
                    {isLoading ? "Checking…" : "Check Status"}
                  </button>
                </div>
              </form>
            ) : (
              <div className="careers-status-result">
                <div className="careers-status-result-header">
                  <p className="careers-status-name">Hi, {result.name}</p>
                  <span
                    className="careers-status-badge"
                    style={{ background: `${(STATUS_LABELS[result.status] ?? STATUS_LABELS.pending).color}18`, color: (STATUS_LABELS[result.status] ?? STATUS_LABELS.pending).color, border: `1px solid ${(STATUS_LABELS[result.status] ?? STATUS_LABELS.pending).color}40` }}
                  >
                    {(STATUS_LABELS[result.status] ?? STATUS_LABELS.pending).label}
                  </span>
                </div>

                <p className="careers-status-message">
                  {(STATUS_LABELS[result.status] ?? STATUS_LABELS.pending).message}
                </p>

                <div className="careers-status-meta">
                  <div><span>Position</span><strong>{result.position}</strong></div>
                  <div><span>Applied</span><strong>{new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(new Date(result.createdAt))}</strong></div>
                  <div><span>Reference</span><strong>{result.id}</strong></div>
                </div>

                <button type="button" className="career-secondary-button" onClick={() => { setResult(null); setEmail(""); setApplicationId(""); }}>
                  Check another application
                </button>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
