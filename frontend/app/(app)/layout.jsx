"use client";

import { useEffect } from "react";
import Sidebar from "@/app/components/Sidebar";
import { useRequireAuth } from "@/app/hooks/useRequireAuth";
import { useAuthStore } from "@/app/store/authStore";
import { api } from "@/app/lib/api";

export default function AppLayout({ children }) {
  const { token, hasHydrated, allowed } = useRequireAuth();
  const setAuth = useAuthStore((s) => s.setAuth);

  // Refresh the stored user once per load, so role changes (is_admin) reach an existing
  // session without signing out and in again. A stale/invalid token is cleared by api.get.
  useEffect(() => {
    if (!hasHydrated || !token) return;
    api.get("/api/auth/me").then((me) => setAuth(token, me)).catch(() => {});
  }, [hasHydrated, token, setAuth]);

  if (!hasHydrated) return null;
  if (!allowed) return null;

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
