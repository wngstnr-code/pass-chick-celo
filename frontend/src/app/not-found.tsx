export default function NotFound() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "24px",
        background:
          "linear-gradient(180deg, #1b2435 0%, #24324a 100%)",
        color: "#f4f7ff",
        textAlign: "center",
      }}
    >
      <div>
        <h1 style={{ fontSize: "2rem", marginBottom: "12px" }}>Page Not Found</h1>
        <p style={{ opacity: 0.85 }}>
          The page you requested does not exist.
        </p>
      </div>
    </main>
  );
}
