"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { ApiRequestError, postJson, retryAfterText } from "@/components/careers/upload-client";
import { FIELD_LIMITS } from "@/lib/careers/constants";
import { validateContactSubmission } from "@/lib/careers/validation";

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

// On-screen order, used to focus the first invalid field.
const FIELD_ORDER: (keyof ContactFormState)[] = ["fullName", "company", "email", "phone", "subject", "message"];
const SUBMIT_TIMEOUT_MS = 30_000;
const SUCCESS_MESSAGE = "Thank you for reaching out. Our team will get back to you shortly.";
const FAILURE_MESSAGE =
  "We couldn't send your message right now. Please try again, or email us directly at info@synergypharma.lk.";
const INVALID_MESSAGE = "Please correct the highlighted fields and try again.";

// Keeps only errors for fields this form shows (the API keys errors by these field names).
function pickFieldErrors(errors: Record<string, string>): FieldErrors {
  const result: FieldErrors = {};
  for (const key of FIELD_ORDER) {
    if (errors[key]) result[key] = errors[key];
  }
  return result;
}

function fieldId(key: keyof ContactFormState): string {
  return `contact-${key}`;
}

function errorId(key: keyof ContactFormState): string {
  return `contact-${key}-error`;
}

export function ContactForm() {
  const [form, setForm] = useState<ContactFormState>(INITIAL_STATE);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const pendingFocusRef = useRef<string | null>(null);

  // Moves focus to the first invalid field once its error is rendered.
  useEffect(() => {
    const target = pendingFocusRef.current;
    if (!target) return;
    pendingFocusRef.current = null;
    document.getElementById(target)?.focus();
  });

  function updateField<K extends keyof ContactFormState>(key: K, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
    if (fieldErrors[key]) {
      setFieldErrors((current) => ({ ...current, [key]: undefined }));
    }
  }

  function showFieldErrors(errors: FieldErrors) {
    setFieldErrors(errors);
    setStatus("error");
    setStatusMessage(INVALID_MESSAGE);
    const first = FIELD_ORDER.find((key) => errors[key]);
    if (first) pendingFocusRef.current = fieldId(first);
  }

  function invalidProps(key: keyof ContactFormState) {
    return {
      "aria-invalid": fieldErrors[key] ? ("true" as const) : ("false" as const),
      "aria-describedby": fieldErrors[key] ? errorId(key) : undefined,
    };
  }

  function renderError(key: keyof ContactFormState) {
    return fieldErrors[key] ? (
      <p id={errorId(key)} className="contact-field-error">
        {fieldErrors[key]}
      </p>
    ) : null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    // Same validator as the API, so messages match whichever side catches a problem.
    const result = validateContactSubmission(form);
    if (!result.ok) {
      showFieldErrors(pickFieldErrors(result.errors));
      return;
    }

    setIsSubmitting(true);
    setFieldErrors({});
    setStatus("idle");
    setStatusMessage("");

    try {
      const response = await postJson<{ success?: boolean; message?: unknown }>(
        "/api/contact",
        form,
        { timeoutMs: SUBMIT_TIMEOUT_MS }
      );
      setStatus("success");
      setStatusMessage(typeof response.message === "string" && response.message ? response.message : SUCCESS_MESSAGE);
      setForm(INITIAL_STATE);
    } catch (error) {
      if (error instanceof ApiRequestError) {
        const errors = pickFieldErrors(error.fields);
        if (error.status === 400 && Object.keys(errors).length > 0) {
          showFieldErrors(errors);
          return;
        }
        setStatus("error");
        if (error.status === 429) {
          setStatusMessage(
            `You have sent several messages recently. Please try again ${retryAfterText(error.retryAfterSeconds)}, or email us directly at info@synergypharma.lk.`
          );
          return;
        }
        if (error.status === 503) {
          setStatusMessage(
            error.code === "contact_unavailable"
              ? error.message
              : "Our messaging service is temporarily unavailable. Please try again shortly, or email us directly at info@synergypharma.lk."
          );
          return;
        }
      }
      setStatus("error");
      setStatusMessage(FAILURE_MESSAGE);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form method="post" className="contact-form" onSubmit={handleSubmit} noValidate>
      <div className="contact-form-grid">
        <div className="contact-field">
          <label htmlFor={fieldId("fullName")} className="contact-field-label">
            Full Name <span className="required-mark" aria-hidden="true">*</span>
          </label>
          <input
            id={fieldId("fullName")}
            type="text"
            name="fullName"
            autoComplete="name"
            required
            maxLength={FIELD_LIMITS.name}
            value={form.fullName}
            onChange={(e) => updateField("fullName", e.target.value)}
            {...invalidProps("fullName")}
          />
          {renderError("fullName")}
        </div>

        <div className="contact-field">
          <label htmlFor={fieldId("company")} className="contact-field-label">
            Company / Organization
          </label>
          <input
            id={fieldId("company")}
            type="text"
            name="company"
            autoComplete="organization"
            maxLength={FIELD_LIMITS.name}
            value={form.company}
            onChange={(e) => updateField("company", e.target.value)}
            {...invalidProps("company")}
          />
          {renderError("company")}
        </div>

        <div className="contact-field">
          <label htmlFor={fieldId("email")} className="contact-field-label">
            Email Address <span className="required-mark" aria-hidden="true">*</span>
          </label>
          <input
            id={fieldId("email")}
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            spellCheck={false}
            required
            maxLength={FIELD_LIMITS.email}
            value={form.email}
            onChange={(e) => updateField("email", e.target.value)}
            {...invalidProps("email")}
          />
          {renderError("email")}
        </div>

        <div className="contact-field">
          <label htmlFor={fieldId("phone")} className="contact-field-label">
            Phone Number
          </label>
          <input
            id={fieldId("phone")}
            type="tel"
            name="phone"
            autoComplete="tel"
            value={form.phone}
            onChange={(e) => updateField("phone", e.target.value)}
            {...invalidProps("phone")}
          />
          {renderError("phone")}
        </div>

        <div className="contact-field contact-field-full">
          <label htmlFor={fieldId("subject")} className="contact-field-label">
            Subject <span className="required-mark" aria-hidden="true">*</span>
          </label>
          <input
            id={fieldId("subject")}
            type="text"
            name="subject"
            required
            maxLength={FIELD_LIMITS.contactSubject}
            value={form.subject}
            onChange={(e) => updateField("subject", e.target.value)}
            {...invalidProps("subject")}
          />
          {renderError("subject")}
        </div>

        <div className="contact-field contact-field-full">
          <label htmlFor={fieldId("message")} className="contact-field-label">
            Message <span className="required-mark" aria-hidden="true">*</span>
          </label>
          <textarea
            id={fieldId("message")}
            name="message"
            rows={6}
            required
            maxLength={FIELD_LIMITS.contactMessage}
            value={form.message}
            onChange={(e) => updateField("message", e.target.value)}
            {...invalidProps("message")}
          />
          {renderError("message")}
        </div>
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
