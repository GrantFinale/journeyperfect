export default function Custom500() {
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", margin: 0, background: "#f9fafb" }}>
      <div style={{ textAlign: "center" }}>
        <h1 style={{ fontSize: "3rem", fontWeight: "bold", color: "#111827", marginBottom: "0.5rem" }}>500</h1>
        <p style={{ color: "#6b7280", marginBottom: "1.5rem" }}>Something went wrong</p>
        <a href="/" style={{ color: "#4f46e5", textDecoration: "none", fontWeight: 500 }}>← Go home</a>
      </div>
    </div>
  )
}
