"use client";

import { FormEvent, useState } from "react";

type ContactFormState = {
  fullName: string;
  company: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
};

type FieldErrors = Partial<Record<keyof ContactFormState, string>>;

const INITIAL_STATE: ContactFormState = {
  fullName: "",
  company: "",
  email: "",
  phone: "",
  subject: "",
  message: "",
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(form: ContactFormState): FieldErrors {
  const errors: FieldErrors = {};

  if (!form.fullName.trim()) {
    errors.fullName = "Please enter your full name.";
  }

  if (!form.email.trim()) {
    errors.email = "Please enter your email address.";
  } else if (!EMAIL_PATTERN.test(form.email.trim())) {
    errors.email = "Please enter a valid email address.";
  }

  if (!form.subject.trim()) {
    errors.subject = "Please enter a subject.";
  }

  if (!form.message.trim()) {
    errors.message = "Please enter your message.";
  }

  return errors;
}

export function ContactForm() {
  const [form, setForm] = useState<ContactFormState>(INITIAL_STATE);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [statusMessage, setStatusMessage] = useState("");

  function updateField<K extends keyof ContactFormState>(key: K, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
    if (fieldErrors[key]) {
      setFieldErrors((current) => ({ ...current, [key]: undefined }));
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const errors = validate(form);
    setFieldErrors(errors);

    if (Object.keys(errors).length > 0) {
      setStatus("error");
      setStatusMessage("Please correct the highlighted fields and try again.");
      return;
    }

    setIsSubmitting(true);
    setStatus("idle");
    setStatusMessage("");

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      if (!response.ok) {
        throw new Error("Request failed");
      }

      setStatus("success");
      setStatusMessage("Thank you for reaching out. Our team will get back to you shortly.");
      setForm(INITIAL_STATE);
      setFieldErrors({});
    } catch {
      setStatus("error");
      setStatusMessage(
        "We couldn't send your message right now. Please try again, or email us directly at info@synergypharma.lk."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="contact-form" onSubmit={handleSubmit} noValidate>
      <div className="contact-form-grid">
        <label className="contact-field">
          <span className="contact-field-label">
            Full Name <span className="required-mark" aria-hidden="true">*</span>
          </span>
          <input
            type="text"
            name="fullName"
            autoComplete="name"
            required
            value={form.fullName}
            onChange={(e) => updateField("fullName", e.target.value)}
            aria-invalid={fieldErrors.fullName ? "true" : "false"}
            aria-describedby={fieldErrors.fullName ? "contact-fullName-error" : undefined}
          />
          {fieldErrors.fullName ? (
            <p id="contact-fullName-error" role="alert" className="contact-field-error">
              {fieldErrors.fullName}
            </p>
          ) : null}
        </label>

        <label className="contact-field">
          <span className="contact-field-label">Company / Organization</span>
          <input
            type="text"
            name="company"
            autoComplete="organization"
            value={form.company}
            onChange={(e) => updateField("company", e.target.value)}
          />
        </label>

        <label className="contact-field">
          <span className="contact-field-label">
            Email Address <span className="required-mark" aria-hidden="true">*</span>
          </span>
          <input
            type="email"
            name="email"
            autoComplete="email"
            required
            value={form.email}
            onChange={(e) => updateField("email", e.target.value)}
            aria-invalid={fieldErrors.email ? "true" : "false"}
            aria-describedby={fieldErrors.email ? "contact-email-error" : undefined}
          />
          {fieldErrors.email ? (
            <p id="contact-email-error" role="alert" className="contact-field-error">
              {fieldErrors.email}
            </p>
          ) : null}
        </label>

        <label className="contact-field">
          <span className="contact-field-label">Phone Number</span>
          <input
            type="tel"
            name="phone"
            autoComplete="tel"
            value={form.phone}
            onChange={(e) => updateField("phone", e.target.value)}
          />
        </label>

        <label className="contact-field contact-field-full">
          <span className="contact-field-label">
            Subject <span className="required-mark" aria-hidden="true">*</span>
          </span>
          <input
            type="text"
            name="subject"
            required
            value={form.subject}
            onChange={(e) => updateField("subject", e.target.value)}
            aria-invalid={fieldErrors.subject ? "true" : "false"}
            aria-describedby={fieldErrors.subject ? "contact-subject-error" : undefined}
          />
          {fieldErrors.subject ? (
            <p id="contact-subject-error" role="alert" className="contact-field-error">
              {fieldErrors.subject}
            </p>
          ) : null}
        </label>

        <label className="contact-field contact-field-full">
          <span className="contact-field-label">
            Message <span className="required-mark" aria-hidden="true">*</span>
          </span>
          <textarea
            name="message"
            rows={6}
            required
            value={form.message}
            onChange={(e) => updateField("message", e.target.value)}
            aria-invalid={fieldErrors.message ? "true" : "false"}
            aria-describedby={fieldErrors.message ? "contact-message-error" : undefined}
          />
          {fieldErrors.message ? (
            <p id="contact-message-error" role="alert" className="contact-field-error">
              {fieldErrors.message}
            </p>
          ) : null}
        </label>
      </div>

      {status === "error" ? (
        <p role="alert" className="contact-form-message contact-form-error">
          {statusMessage}
        </p>
      ) : null}
      {status === "success" ? (
        <p role="status" className="contact-form-message contact-form-success">
          {statusMessage}
        </p>
      ) : null}

      <button type="submit" className="contact-submit-button" disabled={isSubmitting}>
        {isSubmitting ? "Sending..." : "Send Message"}
      </button>
    </form>
  );
}
