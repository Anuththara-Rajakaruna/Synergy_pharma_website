"use client";

import type { Metadata } from "next";
import Image from "next/image";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (!response.ok) {
        const result = (await response.json()) as { error?: string };
        setError(result.error ?? "Login failed.");
        return;
      }

      router.push("/careers/admin");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="admin-login-page">
      <div className="admin-login-card">
        <div className="admin-login-brand">
          <Image src="/logo.png" alt="Synergy Pharmaceuticals" width={140} height={40} priority />
        </div>

        <div className="admin-login-header">
          <p className="eyebrow">Careers Portal</p>
          <h1>Admin Sign In</h1>
        </div>
        <form className="career-form" onSubmit={handleSubmit} autoComplete="on">
          <div className="career-form-grid" style={{ gridTemplateColumns: "1fr" }}>
            <label className="careers-field">
              <span>Username</span>
              <input
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={isLoading}
                required
              />
            </label>
            <label className="careers-field">
              <span>Password</span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
                required
              />
            </label>
          </div>
          {error ? <p className="career-form-message career-form-error">{error}</p> : null}

          <div className="career-form-actions" style={{ justifyContent: "flex-end" }}>
            <button type="submit" disabled={isLoading}>
              {isLoading ? "Signing in…" : "Sign In"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
