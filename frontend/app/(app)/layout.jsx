"use client";

import Sidebar from "@/app/components/Sidebar";
import { useRequireAuth } from "@/app/hooks/useRequireAuth";

export default function AppLayout({ children }) {
  const { isAuthenticated, hasHydrated } = useRequireAuth();

  if (!hasHydrated) return null;
  if (!isAuthenticated) return null;

  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        maxWidth: "calc(50vw + 720px)",
        margin: "0 auto",
        background: "var(--bg-base)",
        borderLeft: "1px solid var(--border)",
        borderRight: "1px solid var(--border)",
      }}
    >
      <Sidebar />
      <main style={{ flex: 1, overflow: "auto" }}>
        {children}
      </main>
    </div>
  );
}
