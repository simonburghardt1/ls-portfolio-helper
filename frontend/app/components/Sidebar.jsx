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
          { label: "CoT Data",                   href: "/macro/leading/cot-data" },
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
          { label: "CPI & PPI",                  href: "/macro/concurrent/cpi-ppi" },
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
        href: "/portfolio",
        items: [
          { label: "Backtesting",              href: "/portfolio/backtesting" },
          { label: "Heatmap",                  href: "/portfolio/heatmap" },
          { label: "Market Regime",            href: "/portfolio/market-regime" },
          { label: "Volatility & Correlation", href: "/portfolio/risk/volatility" },
          { label: "Beta",                     href: "/portfolio/risk/beta",       soon: true },
        ],
      },
    ],
  },
  {
    section: "Trading Track Record",
    groups: [{ label: null, items: [{ label: "Track Record", href: "/portfolio/track-record" }] }],
  },
  {
    section: "Admin",
    groups: [
      {
        label: null,
        items: [
          { label: "Data Import",        href: "/admin/data-import" },
          { label: "ISM URL Import",     href: "/admin/ism" },
          { label: "Indicator Refresh",  href: "/admin/indicators" },
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
      width: 220,
      minHeight: "100vh",
      background: "var(--bg-surface)",
      borderRight: "1px solid var(--border)",
      display: "flex",
      flexDirection: "column",
      flexShrink: 0,
      overflowY: "auto",
    }}>
      {/* Logo */}
      <div style={{ padding: "24px 16px 20px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <div style={{ fontSize: 13, color: "var(--green-500)", fontWeight: 700, letterSpacing: "0.08em", marginBottom: 2 }}>
          LS PLATFORM
        </div>
        <div style={{ fontSize: 11, color: "var(--text-ghost)", letterSpacing: "0.05em" }}>
          TRADING & PORTFOLIO
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: "12px 8px" }}>
        {NAV.map((block) => (
          <div key={block.section} style={{ marginBottom: 4 }}>
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

                      {group.label && (group.href ? (
                        <div style={{ display: "flex", alignItems: "center" }}>
                          <Link href={group.href} style={{ textDecoration: "none", flex: 1 }}>
                            <div style={{ ...groupHeaderStyle, color: pathname === group.href ? "var(--text-primary)" : undefined }}>
                              {isOpen
                                ? <ChevronDown size={13} style={{ flexShrink: 0, color: "var(--text-ghost)" }} />
                                : <ChevronRight size={13} style={{ flexShrink: 0, color: "var(--text-ghost)" }} />
                              }
                              <span style={{ flex: 1, textAlign: "left" }}>{group.label}</span>
                            </div>
                          </Link>
                          <button
                            onClick={() => toggleGroup(groupKey)}
                            style={{ background: "transparent", border: "none", cursor: "pointer", padding: "4px 6px", color: "var(--text-ghost)" }}
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
                            ? <ChevronDown size={13} style={{ flexShrink: 0, color: "var(--text-ghost)" }} />
                            : <ChevronRight size={13} style={{ flexShrink: 0, color: "var(--text-ghost)" }} />
                          }
                          <span style={{ flex: 1, textAlign: "left" }}>{group.label}</span>
                        </button>
                      ))}

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
      <div style={{ padding: "12px 8px", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
        {user && (
          <div style={{ padding: "6px 8px", marginBottom: 4 }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 1 }}>Signed in as</div>
            <div style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {user.email}
            </div>
          </div>
        )}
        <button
          onClick={handleLogout}
          style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "8px", background: "transparent", border: "none", borderRadius: "var(--radius-sm)", color: "var(--text-muted)", fontSize: 13, cursor: "pointer" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-elevated)"; e.currentTarget.style.color = "var(--text-primary)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-muted)"; }}
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
    <span style={{ fontSize: 9, color: "var(--text-ghost)", background: "var(--bg-elevated)", border: "1px solid var(--border)", padding: "1px 5px", borderRadius: 3, letterSpacing: "0.05em", flexShrink: 0 }}>
      SOON
    </span>
  );
}

const sectionLabelStyle = {
  fontSize: 10,
  fontWeight: 700,
  color: "var(--text-muted)",
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
  borderRadius: "var(--radius-sm)",
  color: "var(--text-muted)",
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
    borderRadius: "var(--radius-sm)",
    fontSize: 13,
    color: disabled ? "var(--text-ghost)" : "var(--text-secondary)",
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
    borderRadius: "var(--radius-sm)",
    borderLeft: isActive ? "2px solid var(--green-500)" : "2px solid transparent",
    paddingLeft: isActive ? 6 : 8,
    fontSize: 12,
    color: disabled ? "var(--text-ghost)" : isActive ? "var(--green-400)" : "var(--text-muted)",
    background: isActive ? "var(--green-900)" : "transparent",
    cursor: disabled ? "default" : "pointer",
    marginBottom: 1,
    transition: "background 0.1s, color 0.1s",
  };
}
