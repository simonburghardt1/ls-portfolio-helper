"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/app/lib/api";
import { useAuthStore } from "@/app/store/authStore";

export default function LoginPage() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);

  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { access_token } = await api.post("/api/auth/login", form);
      const me = await fetch("http://localhost:8000/api/auth/me", {
        headers: { Authorization: `Bearer ${access_token}` },
      }).then((r) => r.json());
      setAuth(access_token, me);
      router.push("/");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ minHeight: "100vh", background: "#020617", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 400, padding: "0 24px" }}>
        <div style={{ marginBottom: 32, textAlign: "center" }}>
          <h1 style={{ color: "#e5e7eb", fontSize: 28, margin: "0 0 8px 0" }}>Welcome back</h1>
          <p style={{ color: "#6b7280", margin: 0, fontSize: 14 }}>Sign in to your account</p>
        </div>

        <form onSubmit={handleSubmit} style={{ background: "#0f172a", border: "1px solid #1f2937", borderRadius: 16, padding: 28 }}>
          <div style={{ marginBottom: 18 }}>
            <label style={labelStyle}>Email</label>
            <input
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              style={inputStyle}
              placeholder="you@example.com"
            />
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={labelStyle}>Password</label>
            <input
              type="password"
              required
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              style={inputStyle}
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div style={{ background: "#450a0a", border: "1px solid #991b1b", borderRadius: 8, padding: "10px 14px", color: "#fca5a5", fontSize: 14, marginBottom: 18 }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={loading} style={btnStyle}>
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <p style={{ textAlign: "center", color: "#6b7280", fontSize: 14, marginTop: 20 }}>
          No account?{" "}
          <Link href="/register" style={{ color: "#93c5fd", textDecoration: "none" }}>
            Create one
          </Link>
        </p>
      </div>
    </main>
  );
}

const labelStyle = {
  display: "block",
  color: "#9ca3af",
  fontSize: 13,
  marginBottom: 6,
  fontWeight: 500,
};

const inputStyle = {
  width: "100%",
  background: "#020617",
  border: "1px solid #374151",
  borderRadius: 8,
  padding: "10px 12px",
  color: "#e5e7eb",
  fontSize: 14,
  outline: "none",
  boxSizing: "border-box",
};

const btnStyle = {
  width: "100%",
  background: "#2563eb",
  color: "white",
  border: "none",
  borderRadius: 8,
  padding: "11px 0",
  fontSize: 15,
  fontWeight: 600,
  cursor: "pointer",
};
