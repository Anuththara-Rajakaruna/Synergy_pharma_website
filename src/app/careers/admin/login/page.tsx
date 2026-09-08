"use client";

import { FormEvent, Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

function LoginForm() {
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError("");

    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const result = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(result.error ?? "Login failed. Please try again.");
        return;
      }

      const from = searchParams.get("from") ?? "/careers/admin";
      window.location.href = from;
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f0f7fc] px-4">
      <div className="w-full max-w-sm">
        <div className="rounded-[28px] border border-white/70 bg-white shadow-[0_32px_80px_rgba(7,25,38,0.14)] p-8">
          <div className="text-center mb-8">
            <p className="text-[0.72rem] font-bold uppercase tracking-[0.22em] text-[#1075bd] mb-2">
              Synergy Pharma
            </p>
            <h1 className="text-2xl font-bold text-[#0a1f35]">Admin Portal</h1>
            <p className="mt-2 text-sm text-[#4d6578]">Enter your password to continue</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label
                htmlFor="password"
                className="block text-[0.72rem] font-bold uppercase tracking-[0.16em] text-[#42677f] mb-2"
              >
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  aria-invalid={!!error}
                  aria-describedby={error ? "login-error" : undefined}
                  className="h-12 w-full rounded-2xl border border-[#d8eaf3] bg-[#f7fbfd] px-4 pr-12 text-[0.98rem] text-[#12334a] outline-none transition-all duration-200 focus:border-[#57a6d8] focus:bg-white focus:shadow-[0_0_0_4px_rgba(16,117,189,0.12)]"
                  placeholder="Admin password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#5f89a4] hover:text-[#1075bd] transition-colors"
                  style={{ marginTop: 0, background: "none", boxShadow: "none", padding: "0.25rem" }}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {error ? (
              <p
                id="login-error"
                role="alert"
                className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700"
              >
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full h-12 rounded-2xl bg-[#1075bd] text-white text-[0.76rem] font-bold uppercase tracking-[0.16em] shadow-[0_12px_28px_rgba(16,117,189,0.28)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-[#0c68a7] disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSubmitting ? "Signing in…" : "Sign In"}
            </button>
          </form>

          <p className="mt-6 text-center text-[0.72rem] text-[#8ba8bb]">
            Password is set via <code className="font-mono text-[#1075bd]">ADMIN_PASSWORD</code> in <code className="font-mono text-[#1075bd]">.env.local</code>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
