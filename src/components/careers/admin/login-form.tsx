"use client";

import { useRef, useState, type FormEvent } from "react";
import { isValidEmail } from "@/lib/careers/validation";

type FieldName = "email" | "password";
type FieldErrors = Partial<Record<FieldName, string>>;

type LoginFormProps = {
  // Sanitized on the server: always a same-origin /careers/admin path.
  redirectTo: string;
};

type ParsedError = { code: string | null; message: string | null; fields: FieldErrors };

async function parseError(response: Response): Promise<ParsedError> {
  try {
    const data: unknown = await response.json();
    if (!data || typeof data !== "object") return { code: null, message: null, fields: {} };
    const record = data as Record<string, unknown>;
    const fields: FieldErrors = {};
    if (record.fields && typeof record.fields === "object") {
      const raw = record.fields as Record<string, unknown>;
      if (typeof raw.email === "string") fields.email = raw.email;
      if (typeof raw.password === "string") fields.password = raw.password;
    }
    return {
      code: typeof record.code === "string" ? record.code : null,
      message: typeof record.error === "string" ? record.error : null,
      fields,
    };
  } catch {
    return { code: null, message: null, fields: {} };
  }
}

function retryAfterMinutes(response: Response): number | null {
  const seconds = Number.parseInt(response.headers.get("Retry-After") ?? "", 10);
  return Number.isFinite(seconds) && seconds > 0 ? Math.max(1, Math.ceil(seconds / 60)) : null;
}

function describeFailure(response: Response, parsed: ParsedError): string {
  if (response.status === 400) return parsed.message ?? "Please check your email address and password.";
  if (response.status === 401) return "Invalid email or password.";
  if (response.status === 403) return "Your sign-in request was blocked. Refresh the page and try again.";
  if (response.status === 429) {
    if (parsed.code === "account_locked" && parsed.message) return parsed.message;
    const minutes = retryAfterMinutes(response);
    return minutes
      ? `Too many sign-in attempts. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`
      : "Too many sign-in attempts. Please wait a few minutes and try again.";
  }
  if (response.status >= 500) return "Sign-in is temporarily unavailable. Please try again shortly.";
  return "Sign-in failed. Please try again.";
}

const inputClassName =
  "h-12 w-full rounded-2xl border border-[#d8eaf3] bg-[#f7fbfd] px-4 text-[0.98rem] text-[#12334a] outline-none transition-all duration-200 focus:border-[#57a6d8] focus:bg-white focus:shadow-[0_0_0_4px_rgba(16,117,189,0.12)] aria-[invalid=true]:border-red-300";

const labelClassName = "block text-[0.72rem] font-bold uppercase tracking-[0.16em] text-[#42677f] mb-2";

export function LoginForm({ redirectTo }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  function focusFirstInvalid(errors: FieldErrors) {
    if (errors.email) emailRef.current?.focus();
    else if (errors.password) passwordRef.current?.focus();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const trimmedEmail = email.trim();
    const errors: FieldErrors = {};
    if (!trimmedEmail) errors.email = "Enter your email address.";
    else if (!isValidEmail(trimmedEmail)) errors.email = "Please enter a valid email address.";
    if (!password) errors.password = "Enter your password.";
    setFieldErrors(errors);
    if (errors.email || errors.password) {
      setError("");
      focusFirstInvalid(errors);
      return;
    }

    setIsSubmitting(true);
    setError("");

    let response: Response;
    try {
      response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ email: trimmedEmail, password }),
      });
    } catch {
      setError("Unable to connect. Check your connection and try again.");
      setIsSubmitting(false);
      return;
    }

    if (response.ok) {
      // Stay in the submitting state while the browser navigates away.
      window.location.assign(redirectTo);
      return;
    }

    const parsed = await parseError(response);
    const nextFieldErrors = response.status === 400 ? parsed.fields : {};
    setFieldErrors(nextFieldErrors);
    setError(describeFailure(response, parsed));
    setIsSubmitting(false);
    if (response.status === 401) {
      setPassword("");
      passwordRef.current?.focus();
    } else {
      focusFirstInvalid(nextFieldErrors);
    }
  }

  const emailDescribedBy = [fieldErrors.email ? "login-email-error" : null, error ? "login-error" : null].filter(Boolean).join(" ");
  const passwordDescribedBy = [fieldErrors.password ? "login-password-error" : null, error ? "login-error" : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f0f7fc] px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="rounded-[28px] border border-white/70 bg-white shadow-[0_32px_80px_rgba(7,25,38,0.14)] p-8">
          <div className="text-center mb-8">
            <p
              className="text-[0.72rem] font-bold uppercase tracking-[0.22em] text-[#1075bd] mb-2"
              style={{ fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.22em", color: "#1075bd", margin: "0 0 0.5rem" }}
            >
              Synergy Pharma
            </p>
            <h1 className="text-2xl font-bold text-[#0a1f35]" style={{ fontSize: "1.5rem", lineHeight: 1.25, fontWeight: 700, color: "#0a1f35", margin: 0, textAlign: "center" }}>
              Admin Portal
            </h1>
            <p className="mt-2 text-sm text-[#4d6578]" style={{ fontSize: "0.875rem", color: "#4d6578", margin: "0.5rem 0 0" }}>
              Sign in with your staff account to continue
            </p>
          </div>

          <form method="post" onSubmit={handleSubmit} className="space-y-5" noValidate aria-busy={isSubmitting}>
            <div>
              <label htmlFor="login-email" className={labelClassName}>
                Email address
              </label>
              <input
                ref={emailRef}
                id="login-email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                readOnly={isSubmitting}
                required
                maxLength={254}
                aria-invalid={fieldErrors.email ? true : undefined}
                aria-describedby={emailDescribedBy || undefined}
                className={inputClassName}
                placeholder="name@synergypharma.lk"
              />
              {fieldErrors.email ? (
                <p id="login-email-error" className="mt-2 text-[0.8rem] text-red-700">
                  {fieldErrors.email}
                </p>
              ) : null}
            </div>

            <div>
              <label htmlFor="login-password" className={labelClassName}>
                Password
              </label>
              <div className="relative">
                <input
                  ref={passwordRef}
                  id="login-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  readOnly={isSubmitting}
                  required
                  aria-invalid={fieldErrors.password ? true : undefined}
                  aria-describedby={passwordDescribedBy || undefined}
                  className={`${inputClassName} pr-12`}
                  placeholder="Your password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg text-[#5f89a4] hover:text-[#1075bd] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1075bd] transition-colors"
                  style={{ marginTop: 0, background: "none", boxShadow: "none", padding: "0.25rem" }}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  aria-controls="login-password"
                >
                  {showPassword ? (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  )}
                </button>
              </div>
              {fieldErrors.password ? (
                <p id="login-password-error" className="mt-2 text-[0.8rem] text-red-700">
                  {fieldErrors.password}
                </p>
              ) : null}
            </div>

            {error ? (
              <p id="login-error" role="alert" className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full h-12 rounded-2xl bg-[#1075bd] text-white text-[0.76rem] font-bold uppercase tracking-[0.16em] shadow-[0_12px_28px_rgba(16,117,189,0.28)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-[#0c68a7] disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1075bd]"
            >
              {isSubmitting ? "Signing in…" : "Sign In"}
            </button>
          </form>

          <p className="mt-6 text-center text-[0.72rem] text-[#587285]">
            Forgot your password? Ask a portal administrator to reset it.
          </p>
        </div>
      </div>
    </div>
  );
}
