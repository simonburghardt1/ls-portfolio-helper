"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, LogOut } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuthStore } from "@/app/store/authStore";

const NAV = [
  {
    section: "Macro Economics",
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
          { label: "ISM Services",               href: "/macro/leading/ism-services" },
          { label: "Consumer Confidence",        href: "/macro/leading/consumer-confidence" },
          { label: "US Building Permits",        href: "/macro/leading/building-permits" },
          { label: "NFIB Optimism",              href: "/macro/leading/nfib-optimism" },
          { label: "CoT Data",                   href: "/macro/leading/cot-data" },
          { label: "Commodity Prices",           href: "/macro/leading/commodities" },
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
        label: "Markets",
        items: [
          { label: "Market Regime",       href: "/portfolio/market-regime" },
          { label: "Heatmap",             href: "/portfolio/heatmap" },
          { label: "High Beta Momentum",  href: "/portfolio/markets/high-beta-momentum" },
          { label: "Seasonality",         href: "/portfolio/markets/seasonality", soon: true },
        ],
      },
      {
        label: "Portfolio",
        items: [
          { label: "Portfolio Overview",       href: "/portfolio/overview" },
          { label: "Portfolio Construction",   href: "/portfolio" },
          { label: "Distribution of Returns",  href: "/portfolio/distribution-of-returns", soon: true },
          { label: "Backtesting",              href: "/portfolio/backtesting" },
          { label: "Volatility & Correlation", href: "/portfolio/risk/volatility" },
          { label: "Beta",                     href: "/portfolio/risk/beta",       soon: true },
        ],
      },
    ],
  },
  {
    section: "Trading Statistics",
    groups: [{ label: null, items: [{ label: "Track Record", href: "/portfolio/track-record" }] }],
  },
  {
    section: "Admin",
    groups: [
      {
        label: null,
        items: [
          { label: "Data Import",             href: "/admin/data-import" },
          { label: "ISM URL Import",          href: "/admin/ism" },
          { label: "ISM Services URL Import", href: "/admin/ism-services" },
          { label: "High Beta Momentum",      href: "/admin/high-beta-momentum" },
          { label: "Indicator Refresh",       href: "/admin/indicators" },
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

  useEffect(() => {
    try {
      const stored = localStorage.getItem("sidebar-collapsed-groups");
      if (stored) setCollapsed(JSON.parse(stored));
    } catch {}
  }, []);

  function toggleGroup(key) {
    setCollapsed((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem("sidebar-collapsed-groups", JSON.stringify(next)); } catch {}
      return next;
    });
  }

  function handleLogout() {
    logout();
    router.push("/login");
  }

  return (
    <aside style={{
      width: "var(--sidebar-width)",
      minHeight: "100vh",
      background: "var(--bg-surface)",
      borderRight: "1px solid var(--border)",
      display: "flex",
      flexDirection: "column",
      flexShrink: 0,
      overflowY: "auto",
    }}>
      {/* Brand */}
      <div style={{ padding: "26px 22px 22px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <div style={{ fontSize: 15, color: "var(--text-primary)", fontWeight: 700, letterSpacing: "0.06em", marginBottom: 4 }}>
          LS PLATFORM
        </div>
        <div style={{ fontSize: 11, color: "var(--text-secondary)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Trading &amp; Portfolio
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: "18px 14px 24px" }}>
        {NAV.map((block) => (
          <div key={block.section} style={sectionWrapperStyle}>
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
                    <div key={groupKey} style={groupWrapperStyle}>

                      {group.label && (group.href ? (
                        <div style={{ display: "flex", alignItems: "center" }}>
                          <Link href={group.href} style={{ textDecoration: "none", flex: 1 }}>
                            <div style={{ ...groupHeaderStyle, color: pathname === group.href ? "var(--text-primary)" : groupHeaderStyle.color }}>
                              {isOpen
                                ? <ChevronDown size={12} style={{ flexShrink: 0, color: "var(--text-secondary)" }} />
                                : <ChevronRight size={12} style={{ flexShrink: 0, color: "var(--text-secondary)" }} />
                              }
                              <span style={{ flex: 1, textAlign: "left" }}>{group.label}</span>
                            </div>
                          </Link>
                          <button
                            onClick={() => toggleGroup(groupKey)}
                            style={{ background: "transparent", border: "none", cursor: "pointer", padding: "4px 6px", color: "var(--text-secondary)" }}
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
                            ? <ChevronDown size={12} style={{ flexShrink: 0, color: "var(--text-secondary)" }} />
                            : <ChevronRight size={12} style={{ flexShrink: 0, color: "var(--text-secondary)" }} />
                          }
                          <span style={{ flex: 1, textAlign: "left" }}>{group.label}</span>
                        </button>
                      ))}

                      {(group.label == null || isOpen) && (
                        <div style={group.label ? itemsWrapperStyle : undefined}>
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
      <div style={{ padding: "16px 18px 20px", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
        {user && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 3 }}>Signed in as</div>
            <div style={{ fontSize: 13.5, color: "var(--text-primary)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {user.email}
            </div>
          </div>
        )}
        <button
          onClick={handleLogout}
          style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "8px 4px", background: "transparent", border: "none", borderRadius: "var(--radius-none)", color: "var(--text-secondary)", fontSize: 13, cursor: "pointer" }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-primary)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-secondary)"; }}
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
    <span style={{ fontSize: 9.5, fontWeight: "var(--text-label-weight)", color: "var(--text-disabled)", background: "var(--bg-elevated)", border: "1px solid var(--border)", padding: "2px 6px", letterSpacing: "var(--text-label-tracking)", flexShrink: 0 }}>
      SOON
    </span>
  );
}

const sectionWrapperStyle = { marginBottom: 22 };

const sectionLabelStyle = {
  fontSize: "var(--text-nav-section-label-size)",
  fontWeight: "var(--text-nav-section-label-weight)",
  color: "var(--text-secondary)",
  letterSpacing: "var(--text-nav-section-label-tracking)",
  padding: "4px 10px 10px",
  textTransform: "uppercase",
  opacity: 0.85,
};

const groupWrapperStyle = { marginBottom: 14 };

const groupHeaderStyle = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  gap: 7,
  padding: "6px 10px",
  background: "transparent",
  border: "none",
  borderRadius: "var(--radius-none)",
  color: "var(--text-secondary)",
  fontSize: "var(--text-nav-group-header-size)",
  fontWeight: "var(--text-nav-group-header-weight)",
  cursor: "pointer",
};

const itemsWrapperStyle = { paddingLeft: "var(--nav-item-indent)" };

function sectionItemStyle(disabled) {
  return {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "9px 12px",
    fontSize: "var(--text-nav-item-size)",
    color: disabled ? "var(--text-disabled)" : "var(--text-secondary)",
    cursor: "default",
  };
}

function itemStyle(isActive, disabled) {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    padding: "9px 12px",
    marginBottom: 2,
    fontSize: "var(--text-nav-item-size)",
    lineHeight: "var(--text-nav-item-line-height)",
    borderRadius: isActive ? "var(--radius-nav-active)" : "var(--radius-none)",
    background: isActive ? "var(--nav-active-surface)" : "transparent",
    color: disabled ? "var(--text-disabled)" : isActive ? "var(--text-primary)" : "var(--text-secondary)",
    fontWeight: isActive ? 600 : 400,
    cursor: disabled ? "default" : "pointer",
    transition: "background 0.1s, color 0.1s",
  };
}
