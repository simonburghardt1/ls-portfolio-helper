"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, LogOut } from "lucide-react";
import { useState } from "react";
import { useAuthStore } from "@/app/store/authStore";

const NAV = [
  {
    section: "Macro-Ökonomie",
    groups: [
      {
        label: null,
        items: [
          { label: "Macro Dashboard", href: "/" },
        ],
      },
      {
        label: "Leading Indicators",
        items: [
          { label: "Bond Yields",               href: "/macro/leading/bond-yields",           soon: true },
          { label: "ISM Manufacturing",          href: "/macro/leading/ism-manufacturing" },
          { label: "ISM Non-Manufacturing",      href: "/macro/leading/ism-non-manufacturing",  soon: true },
          { label: "Consumer Confidence",        href: "/macro/leading/consumer-confidence" },
          { label: "US Building Permits",        href: "/macro/leading/building-permits" },
          { label: "NFIB Optimism",              href: "/macro/leading/nfib-optimism" },
          { label: "CoT Data",                   href: "/macro/leading/cot-data",               soon: true },
          { label: "Commodity Prices",           href: "/macro/leading/commodities",            soon: true },
          { label: "European Sentiment",         href: "/macro/leading/european-sentiment",     soon: true },
          { label: "China Manufacturing PMI",    href: "/macro/leading/china-pmi",             soon: true },
        ],
      },
      {
        label: "Concurrent Indicators",
        items: [
          { label: "GDP",                        href: "/macro/concurrent/gdp",                soon: true },
          { label: "M2 Money Supply",            href: "/macro/concurrent/m2",                 soon: true },
          { label: "CPI & PPI",                  href: "/macro/concurrent/cpi-ppi",            soon: true },
          { label: "USD Trade Weighted",         href: "/macro/concurrent/usd-trade",          soon: true },
          { label: "Employment Report",          href: "/macro/concurrent/employment",          soon: true },
          { label: "Jobless Claims",             href: "/macro/concurrent/jobless-claims",      soon: true },
        ],
      },
    ],
  },
  {
    section: "Portfolio Management",
    groups: [
      {
        label: "Portfolio",
        href: "/portfolio",   // clicking the group header navigates here
        items: [
          { label: "Backtesting",              href: "/portfolio/backtesting" },
          { label: "Heatmap",                  href: "/portfolio/heatmap" },
          { label: "Volatility & Correlation", href: "/portfolio/risk/volatility", soon: true },
          { label: "Beta",                     href: "/portfolio/risk/beta",       soon: true },
        ],
      },
    ],
  },
  {
    section: "Trading Track Record",
    soon: true,
  },
  {
    section: "Admin",
    groups: [
      {
        label: null,
        items: [
          { label: "Data Import",        href: "/admin/data-import" },
          { label: "ISM URL Import",     href: "/admin/ism" },
        ],
      },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const [collapsed, setCollapsed] = useState({});

  function toggleGroup(key) {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function handleLogout() {
    logout();
    router.push("/login");
  }

  return (
    <aside style={{
      width: 240,
      minHeight: "100vh",
      background: "#080e1a",
      borderRight: "1px solid #1f2937",
      display: "flex",
      flexDirection: "column",
      flexShrink: 0,
      overflowY: "auto",
    }}>
      {/* Logo */}
      <div style={{ padding: "24px 16px 20px", borderBottom: "1px solid #1f2937", flexShrink: 0 }}>
        <div style={{ fontSize: 13, color: "#3b82f6", fontWeight: 700, letterSpacing: "0.08em", marginBottom: 2 }}>
          LS PLATFORM
        </div>
        <div style={{ fontSize: 11, color: "#4b5563", letterSpacing: "0.05em" }}>
          TRADING & PORTFOLIO
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: "12px 8px" }}>
        {NAV.map((block) => (
          <div key={block.section} style={{ marginBottom: 4 }}>

            {/* Section header — top-level soon item */}
            {block.soon ? (
              <div style={sectionItemStyle(true)}>
                <span style={{ flex: 1 }}>{block.section}</span>
                <SoonBadge />
              </div>
            ) : (
              <>
                <div style={sectionLabelStyle}>{block.section}</div>

                {block.groups.map((group) => {
                  const groupKey = `${block.section}-${group.label}`;
                  const isOpen = collapsed[groupKey] !== true;

                  return (
                    <div key={groupKey} style={{ marginBottom: 2 }}>

                      {/* Group header (collapsible) — optionally a link if group.href is set */}
                      {group.label && (group.href ? (
                        <div style={{ display: "flex", alignItems: "center" }}>
                          <Link href={group.href} style={{ textDecoration: "none", flex: 1 }}>
                            <div style={{ ...groupHeaderStyle, color: pathname === group.href ? "#e5e7eb" : undefined }}>
                              {isOpen
                                ? <ChevronDown size={13} style={{ flexShrink: 0, color: "#6b7280" }} />
                                : <ChevronRight size={13} style={{ flexShrink: 0, color: "#6b7280" }} />
                              }
                              <span style={{ flex: 1, textAlign: "left" }}>{group.label}</span>
                            </div>
                          </Link>
                          <button
                            onClick={() => toggleGroup(groupKey)}
                            style={{ background: "transparent", border: "none", cursor: "pointer", padding: "4px 6px", color: "#4b5563" }}
                            title={isOpen ? "Collapse" : "Expand"}
                          >
                            {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => toggleGroup(groupKey)}
                          style={groupHeaderStyle}
                        >
                          {isOpen
                            ? <ChevronDown size={13} style={{ flexShrink: 0, color: "#6b7280" }} />
                            : <ChevronRight size={13} style={{ flexShrink: 0, color: "#6b7280" }} />
                          }
                          <span style={{ flex: 1, textAlign: "left" }}>{group.label}</span>
                        </button>
                      ))}

                      {/* Items */}
                      {(group.label == null || isOpen) && (
                        <div style={{ paddingLeft: group.label ? 8 : 0 }}>
                          {group.items.map((item) => {
                            const isActive = pathname === item.href;
                            if (item.soon) {
                              return (
                                <div key={item.label} style={itemStyle(false, true)}>
                                  <span style={{ flex: 1 }}>{item.label}</span>
                                  <SoonBadge />
                                </div>
                              );
                            }
                            return (
                              <Link key={item.label} href={item.href} style={{ textDecoration: "none" }}>
                                <div style={itemStyle(isActive, false)}>
                                  {item.label}
                                </div>
                              </Link>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        ))}
      </nav>

      {/* User + Logout */}
      <div style={{ padding: "12px 8px", borderTop: "1px solid #1f2937", flexShrink: 0 }}>
        {user && (
          <div style={{ padding: "6px 8px", marginBottom: 4 }}>
            <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 1 }}>Signed in as</div>
            <div style={{ fontSize: 13, color: "#e5e7eb", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {user.email}
            </div>
          </div>
        )}
        <button
          onClick={handleLogout}
          style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "8px", background: "transparent", border: "none", borderRadius: 6, color: "#6b7280", fontSize: 13, cursor: "pointer" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "#111827"; e.currentTarget.style.color = "#e5e7eb"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#6b7280"; }}
        >
          <LogOut size={14} />
          <span>Logout</span>
        </button>
      </div>
    </aside>
  );
}

function SoonBadge() {
  return (
    <span style={{ fontSize: 9, color: "#4b5563", background: "#111827", border: "1px solid #1f2937", padding: "1px 5px", borderRadius: 3, letterSpacing: "0.05em", flexShrink: 0 }}>
      SOON
    </span>
  );
}

const sectionLabelStyle = {
  fontSize: 10,
  fontWeight: 700,
  color: "#3b4c6b",
  letterSpacing: "0.08em",
  padding: "10px 8px 4px",
  textTransform: "uppercase",
};

const groupHeaderStyle = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 8px",
  background: "transparent",
  border: "none",
  borderRadius: 6,
  color: "#6b7280",
  fontSize: 12,
  fontWeight: 500,
  cursor: "pointer",
  marginBottom: 1,
};

function sectionItemStyle(disabled) {
  return {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px",
    borderRadius: 6,
    fontSize: 13,
    color: disabled ? "#374151" : "#9ca3af",
    cursor: "default",
  };
}

function itemStyle(isActive, disabled) {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    padding: "6px 8px",
    borderRadius: 6,
    fontSize: 12,
    color: disabled ? "#374151" : isActive ? "#e5e7eb" : "#9ca3af",
    background: isActive ? "#1e3a5f" : "transparent",
    cursor: disabled ? "default" : "pointer",
    marginBottom: 1,
  };
}
