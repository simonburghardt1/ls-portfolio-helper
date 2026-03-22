"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BarChart2, TrendingUp, ClipboardList, LogOut } from "lucide-react";
import { useAuthStore } from "@/app/store/authStore";

const NAV_ITEMS = [
  { href: "/", label: "Macro Dashboard", icon: TrendingUp },
  { href: "/portfolio", label: "Portfolio", icon: BarChart2 },
  { href: "/track-record", label: "Track Record", icon: ClipboardList, disabled: true },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  function handleLogout() {
    logout();
    router.push("/login");
  }

  return (
    <aside style={{
      width: 220,
      minHeight: "100vh",
      background: "#080e1a",
      borderRight: "1px solid #1f2937",
      display: "flex",
      flexDirection: "column",
      flexShrink: 0,
    }}>
      {/* Logo */}
      <div style={{
        padding: "24px 20px 20px",
        borderBottom: "1px solid #1f2937",
      }}>
        <div style={{ fontSize: 13, color: "#3b82f6", fontWeight: 700, letterSpacing: "0.08em", marginBottom: 2 }}>
          LS PLATFORM
        </div>
        <div style={{ fontSize: 11, color: "#4b5563", letterSpacing: "0.05em" }}>
          TRADING & PORTFOLIO
        </div>
      </div>

      {/* Nav items */}
      <nav style={{ flex: 1, padding: "16px 10px" }}>
        {NAV_ITEMS.map(({ href, label, icon: Icon, disabled }) => {
          const isActive = pathname === href;
          return (
            <div key={href} style={{ marginBottom: 4 }}>
              {disabled ? (
                <div style={navItemStyle(false, true)}>
                  <Icon size={16} style={{ flexShrink: 0 }} />
                  <span>{label}</span>
                  <span style={{ marginLeft: "auto", fontSize: 10, color: "#374151", background: "#111827", padding: "2px 6px", borderRadius: 4 }}>
                    soon
                  </span>
                </div>
              ) : (
                <Link href={href} style={{ textDecoration: "none" }}>
                  <div style={navItemStyle(isActive, false)}>
                    <Icon size={16} style={{ flexShrink: 0 }} />
                    <span>{label}</span>
                  </div>
                </Link>
              )}
            </div>
          );
        })}
      </nav>

      {/* User + Logout */}
      <div style={{
        padding: "16px 10px",
        borderTop: "1px solid #1f2937",
      }}>
        {user && (
          <div style={{ padding: "8px 10px", marginBottom: 4 }}>
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 2 }}>Signed in as</div>
            <div style={{ fontSize: 13, color: "#e5e7eb", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {user.full_name}
            </div>
          </div>
        )}
        <button onClick={handleLogout} style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "9px 10px",
          background: "transparent",
          border: "none",
          borderRadius: 8,
          color: "#6b7280",
          fontSize: 14,
          cursor: "pointer",
          textAlign: "left",
        }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "#111827"; e.currentTarget.style.color = "#e5e7eb"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#6b7280"; }}
        >
          <LogOut size={16} />
          <span>Logout</span>
        </button>
      </div>
    </aside>
  );
}

function navItemStyle(isActive, disabled) {
  return {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "9px 10px",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: isActive ? 600 : 400,
    color: disabled ? "#374151" : isActive ? "#e5e7eb" : "#9ca3af",
    background: isActive ? "#1e3a5f" : "transparent",
    cursor: disabled ? "default" : "pointer",
    transition: "background 0.15s, color 0.15s",
  };
}
