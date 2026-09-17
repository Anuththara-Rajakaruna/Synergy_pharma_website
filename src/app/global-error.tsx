"use client";

import { useEffect } from "react";

// Replaces the root layout when it fails to render, so globals.css, the site header and footer
// are unavailable here: everything is styled inline.

const FONT_STACK =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "Noto Sans Sinhala", "Noto Sans Tamil", sans-serif';

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: FONT_STACK, color: "#0a1f35", background: "#f0f8ff" }}>
        <title>Something went wrong | Synergy Pharmaceutical Corporation</title>
        <main
          style={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "2rem",
            boxSizing: "border-box",
            background: "linear-gradient(135deg, #f0f8ff 0%, #e8f4fd 100%)",
            textAlign: "center",
          }}
        >
          <p
            style={{
              margin: "0 0 2rem",
              fontSize: "0.78rem",
              fontWeight: 800,
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              color: "#055f7c",
            }}
          >
            Synergy Pharmaceutical Corporation
          </p>

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
            <svg width="28" height="28" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth={1.8} aria-hidden="true">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m9.303 3.376c.866 1.5-.217 3.374-1.948 3.374H4.645c-1.73 0-2.813-1.874-1.948-3.374L10.051 3.378c.866-1.5 3.032-1.5 3.898 0L21.303 16.126zM12 15.75h.007v.008H12v-.008z"
              />
            </svg>
          </div>

          <p
            style={{
              margin: "0 0 0.75rem",
              fontSize: "0.72rem",
              fontWeight: 800,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "#c0392b",
            }}
          >
            Something went wrong
          </p>

          <h1
            style={{
              margin: "0 0 1rem",
              fontSize: "clamp(1.6rem, 4vw, 2.4rem)",
              fontWeight: 900,
              lineHeight: 1.2,
              maxWidth: "500px",
            }}
          >
            The website could not be displayed.
          </h1>

          <p style={{ margin: "0 0 0.75rem", fontSize: "1rem", color: "#4d6578", lineHeight: 1.7, maxWidth: "440px" }}>
            We apologise for the inconvenience. Please try again in a moment or return to the homepage.
          </p>

          {error.digest ? (
            <p style={{ margin: "0 0 2rem", fontSize: "0.8rem", color: "#5f7f95", lineHeight: 1.6, maxWidth: "440px" }}>
              If the problem continues, contact us and quote reference{" "}
              <code style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", color: "#42677f" }}>
                {error.digest}
              </code>
              .
            </p>
          ) : (
            <div style={{ height: "1.25rem" }} />
          )}

          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", justifyContent: "center" }}>
            <button
              type="button"
              onClick={() => retry()}
              style={{
                padding: "0.85rem 1.75rem",
                borderRadius: "1rem",
                background: "linear-gradient(135deg, #055f7c, #1075bd)",
                color: "white",
                fontFamily: FONT_STACK,
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
            {/* A full page load (not client navigation) so the broken root layout is rebuilt. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              style={{
                padding: "0.85rem 1.75rem",
                borderRadius: "1rem",
                color: "#1075bd",
                fontWeight: 700,
                fontSize: "0.82rem",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                textDecoration: "none",
                border: "1.5px solid #c4dff0",
              }}
            >
              Back to Home
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
