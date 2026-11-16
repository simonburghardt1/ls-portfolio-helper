"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/app/lib/api";
import BasketForm from "@/app/components/BasketForm";
import Page from "@/app/components/Page";

// useSearchParams needs a Suspense boundary in the App Router
export default function NewBasketPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <NewBasketContent />
    </Suspense>
  );
}

// /baskets/new                 → empty form
// /baskets/new?copyFrom=<id>   → form pre-filled from that Basket ("Copy Basket" in the detail page's ⋯ menu)
function NewBasketContent() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const copyFrom = useSearchParams().get("copyFrom");
  const [serverError, setServerError] = useState(null);

  const { data: source, isLoading, isError } = useQuery({
    queryKey: ["basket", copyFrom],
    queryFn: () => api.get(`/api/baskets/${copyFrom}`),
    enabled: !!copyFrom,
  });

  const createBasket = useMutation({
    mutationFn: (payload) => api.post("/api/baskets", payload),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["baskets"] });
      // A copy is usually followed by a look at how it differs from the original
      router.push(copyFrom && created?.id != null ? `/portfolio/markets/baskets/${created.id}` : "/portfolio/markets/baskets");
    },
    onError: (err) => setServerError(err),
  });

  const formProps = {
    onSubmit: (payload) => {
      setServerError(null);
      createBasket.mutate(payload);
    },
    isPending: createBasket.isPending,
    serverError,
  };

  if (!copyFrom) {
    return (
      <BasketForm
        title="Add Basket"
        subtitle="Name it, add 5–20 tickers, and choose how holdings are weighted."
        submitLabel="Save Basket"
        {...formProps}
      />
    );
  }

  if (isLoading) return <LoadingState />;

  if (isError || !source) {
    return (
      <Page>
        <div style={{ background: "var(--bg-surface)", border: "1px solid var(--negative)", padding: "12px 16px", fontSize: 13, color: "var(--negative)" }}>
          Could not load the Basket to copy.
        </div>
      </Page>
    );
  }

  return (
    <BasketForm
      key={source.id} // BasketForm reads its initial* props only on mount
      title={`Copy ${source.name}`}
      subtitle="Pre-filled from the original — rename it, swap a few tickers, and save as a new Basket."
      initialName={`${source.name} Copy`}
      initialWeightingMethod={source.weighting_method}
      initialTickers={source.tickers}
      submitLabel="Save Copy"
      cancelHref={`/portfolio/markets/baskets/${source.id}`}
      {...formProps}
    />
  );
}

function LoadingState() {
  return (
    <Page style={{ color: "var(--text-secondary)", textAlign: "center" }}>
      Loading…
    </Page>
  );
}
