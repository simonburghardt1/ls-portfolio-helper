"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/app/lib/api";
import PageHeader from "@/app/components/PageHeader";
import KpiCard from "@/app/components/KpiCard";
import Badge from "@/app/components/Badge";
import Button from "@/app/components/Button";

function pct(v) {
  if (v == null || isNaN(v)) return null;
  return v * 100;
}

export default function BasketsPage() {
  const router = useRouter();
  const { data: baskets, isLoading, isError, error } = useQuery({
    queryKey: ["baskets"],
    queryFn: () => api.get("/api/baskets"),
  });

  return (
    <div style={{ padding: "28px 32px", minHeight: "100vh", background: "var(--bg-base)", color: "var(--text-primary)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28 }}>
        <PageHeader
          title="Baskets"
          subtitle="Custom and system Baskets. Click a card for its performance chart."
          style={{ marginBottom: 0 }}
        />
        <Link href="/portfolio/markets/baskets/new" style={{ textDecoration: "none" }}>
          <Button variant="primary">+ Add Basket</Button>
        </Link>
      </div>

      {isLoading && (
        <div style={{ color: "var(--text-secondary)", fontSize: 14, padding: "40px 0", textAlign: "center" }}>
          Loading…
        </div>
      )}

      {isError && (
        <div style={{ background: "var(--bg-surface)", border: "1px solid var(--negative)", padding: "12px 16px", marginBottom: 20, fontSize: 13, color: "var(--negative)" }}>
          {error?.message || "Could not load Baskets."}
        </div>
      )}

      {!isLoading && !isError && baskets?.length === 0 && (
        <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", padding: "40px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 14, color: "var(--text-secondary)" }}>No Baskets yet.</div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 6 }}>
            Use <strong>+ Add Basket</strong> to create your first one.
          </div>
        </div>
      )}

      {!isLoading && !isError && baskets?.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
          {baskets.map((b) => {
            const changePct = pct(b.nav_change_pct);
            return (
              <KpiCard
                key={b.id}
                id={b.id}
                onClick={(id) => router.push(`/portfolio/markets/baskets/${id}`)}
                label={
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <span>{b.name}</span>
                    {b.user_id == null ? (
                      <Badge variant="disabled">SYSTEM</Badge>
                    ) : (
                      <Badge variant="neutral">CUSTOM</Badge>
                    )}
                  </div>
                }
                formatted={b.latest_nav != null ? b.latest_nav.toFixed(2) : "—"}
                change={changePct}
                changeLabel="1D"
                good_direction="up"
                caption={changePct == null ? "No prior-day NAV yet" : undefined}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
