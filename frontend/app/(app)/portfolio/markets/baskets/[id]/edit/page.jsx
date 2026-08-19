"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/app/lib/api";
import BasketForm from "@/app/components/BasketForm";

export default function EditBasketPage() {
  const { id } = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState(null);

  const { data: basket, isLoading, isError } = useQuery({
    queryKey: ["basket", id],
    queryFn: () => api.get(`/api/baskets/${id}`),
  });

  const updateBasket = useMutation({
    mutationFn: (payload) => api.put(`/api/baskets/${id}`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["baskets"] });
      queryClient.invalidateQueries({ queryKey: ["basket", id] });
      queryClient.invalidateQueries({ queryKey: ["basket-series", id] });
      router.push(`/portfolio/markets/baskets/${id}`);
    },
    onError: (err) => setServerError(err.message || "Save failed."),
  });

  if (isLoading) {
    return (
      <div style={{ padding: "28px 32px", minHeight: "100vh", background: "var(--bg-base)", color: "var(--text-secondary)", textAlign: "center" }}>
        Loading…
      </div>
    );
  }

  if (isError || !basket) {
    return (
      <div style={{ padding: "28px 32px", minHeight: "100vh", background: "var(--bg-base)" }}>
        <div style={{ background: "var(--bg-surface)", border: "1px solid var(--negative)", padding: "12px 16px", fontSize: 13, color: "var(--negative)" }}>
          Could not load this Basket.
        </div>
      </div>
    );
  }

  return (
    <BasketForm
      title={`Edit ${basket.name}`}
      subtitle="Changes take effect from the next trading day — today's chart and holdings are unaffected until then."
      initialName={basket.name}
      initialWeightingMethod={basket.weighting_method}
      initialTickers={basket.tickers}
      submitLabel="Save Changes"
      savingLabel="Saving…"
      onSubmit={(payload) => {
        setServerError(null);
        updateBasket.mutate(payload);
      }}
      isPending={updateBasket.isPending}
      serverError={serverError}
      cancelHref={`/portfolio/markets/baskets/${id}`}
    />
  );
}
