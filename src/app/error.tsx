"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
        background: "linear-gradient(135deg, #f0f8ff 0%, #e8f4fd 100%)",
        fontFamily: "inherit",
        textAlign: "center",
      }}
    >
      <div
        style={{
          width: "4rem",
          height: "4rem",
          borderRadius: "1.25rem",
          background: "linear-gradient(135deg, #c0392b, #e74c3c)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: "1.5rem",
          boxShadow: "0 12px 28px rgba(192, 57, 43, 0.3)",
        }}
      >
        <svg width="28" height="28" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9.303 3.376c.866 1.5-.217 3.374-1.948 3.374H4.645c-1.73 0-2.813-1.874-1.948-3.374L10.051 3.378c.866-1.5 3.032-1.5 3.898 0L21.303 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
      </div>

      <p
        style={{
          fontSize: "0.72rem",
          fontWeight: 800,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "#e74c3c",
          marginBottom: "0.75rem",
        }}
      >
        Something went wrong
      </p>

      <h1
        style={{
          fontSize: "clamp(1.6rem, 4vw, 2.4rem)",
          fontWeight: 900,
          color: "#0a1f35",
          lineHeight: 1.2,
          marginBottom: "1rem",
          maxWidth: "500px",
        }}
      >
        An unexpected error occurred.
      </h1>

      <p
        style={{
          fontSize: "1rem",
          color: "#4d6578",
          lineHeight: 1.7,
          maxWidth: "420px",
          marginBottom: "2rem",
        }}
      >
        We apologise for the inconvenience. Please try again or return to the careers portal.
      </p>

      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", justifyContent: "center" }}>
        <button
          type="button"
          onClick={reset}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.85rem 1.75rem",
            borderRadius: "1rem",
            background: "linear-gradient(135deg, #055f7c, #1075bd)",
            color: "white",
            fontWeight: 700,
            fontSize: "0.82rem",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            border: "none",
            cursor: "pointer",
            boxShadow: "0 12px 28px rgba(16, 117, 189, 0.3)",
          }}
        >
          Try again
        </button>
        <Link
          href="/careers"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.85rem 1.75rem",
            borderRadius: "1rem",
            background: "transparent",
            color: "#1075bd",
            fontWeight: 700,
            fontSize: "0.82rem",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            textDecoration: "none",
            border: "1.5px solid #c4dff0",
          }}
        >
          Back to Careers
        </Link>
      </div>
    </main>
  );
}
