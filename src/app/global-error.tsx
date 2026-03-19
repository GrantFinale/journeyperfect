"use client"

export const dynamic = "force-dynamic"

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, -apple-system, sans-serif",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          margin: 0,
          background: "#f8f9fa",
        }}
      >
        <div style={{ textAlign: "center", padding: "2rem", maxWidth: "400px" }}>
          <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>✈️</div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 600, color: "#111", marginBottom: "0.75rem" }}>
            Something went wrong
          </h1>
          <p style={{ color: "#666", marginBottom: "1.5rem", lineHeight: 1.6 }}>
            An unexpected error occurred. Your trip data is safe.
          </p>
          <button
            onClick={() => reset()}
            style={{
              background: "#4f46e5",
              color: "#fff",
              border: "none",
              borderRadius: "0.5rem",
              padding: "0.625rem 1.5rem",
              cursor: "pointer",
              fontSize: "0.875rem",
              fontWeight: 500,
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
