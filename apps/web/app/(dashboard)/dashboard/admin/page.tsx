// Platform admin — same (dashboard) route group as owner/staff, gated by a stricter
// PLATFORM_ADMIN-only guard per ARCHITECTURE.md §2. Placeholder for Phase 1.
export default function AdminDashboardPage() {
  return (
    <main style={{ padding: "3rem 1.5rem" }}>
      <h1>Platform admin</h1>
      <p>Admin dashboard — placeholder, not yet implemented.</p>
    </main>
  );
}
