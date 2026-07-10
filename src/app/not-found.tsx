import Link from "next/link";

export default function NotFound() {
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
          background: "linear-gradient(135deg, #055f7c, #1075bd)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: "1.5rem",
          boxShadow: "0 12px 28px rgba(5, 95, 124, 0.3)",
        }}
      >
        <svg width="28" height="28" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
      </div>

      <p
        style={{
          fontSize: "0.72rem",
          fontWeight: 800,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "#1075bd",
          marginBottom: "0.75rem",
        }}
      >
        404 — Page not found
      </p>

      <h1
        style={{
          fontSize: "clamp(1.8rem, 5vw, 2.8rem)",
          fontWeight: 900,
          color: "#0a1f35",
          lineHeight: 1.15,
          marginBottom: "1rem",
          maxWidth: "560px",
        }}
      >
        This page does not exist.
      </h1>

      <p
        style={{
          fontSize: "1rem",
          color: "#4d6578",
          lineHeight: 1.7,
          maxWidth: "440px",
          marginBottom: "2rem",
        }}
      >
        The URL you followed may be outdated or the page may have been moved.
        Head back to our careers portal to explore open opportunities.
      </p>

      <Link
        href="/careers"
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
          textDecoration: "none",
          boxShadow: "0 12px 28px rgba(16, 117, 189, 0.3)",
          transition: "transform 0.2s, box-shadow 0.2s",
        }}
      >
        Back to Careers
      </Link>
    </main>
  );
}
