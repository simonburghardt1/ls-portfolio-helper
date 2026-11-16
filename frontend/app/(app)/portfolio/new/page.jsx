"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/app/lib/api";
import PortfolioForm from "@/app/components/PortfolioForm";
import Page from "@/app/components/Page";
import StateMessage from "@/app/components/StateMessage";

// useSearchParams needs a Suspense boundary in the App Router
export default function NewPortfolioPage() {
  return (
    <Suspense fallback={<Page><StateMessage kind="loading" /></Page>}>
      <NewPortfolioContent />
    </Suspense>
  );
}

// /portfolio/new                → empty form
// /portfolio/new?copyFrom=<id>  → pre-filled from that portfolio ("Copy portfolio" in a card's ⋯ menu)
function NewPortfolioContent() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const copyFrom = Number(useSearchParams().get("copyFrom")) || null;
  const [serverError, setServerError] = useState(null);

  const { data: portfolios, isLoading } = useQuery({
    queryKey: ["portfolios"],
    queryFn: () => api.get("/api/portfolios"),
    enabled: copyFrom != null,
  });
  const source = copyFrom != null ? portfolios?.find((p) => p.id === copyFrom) : null;

  const create = useMutation({
    mutationFn: (payload) => api.post("/api/portfolios", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portfolios"] });
      router.push("/portfolio");
    },
    onError: (err) => setServerError(err),
  });

  const formProps = {
    onSubmit: (payload) => { setServerError(null); create.mutate(payload); },
    isPending: create.isPending,
    serverError,
  };

  if (copyFrom == null) {
    return <PortfolioForm title="New portfolio" submitLabel="Save portfolio" {...formProps} />;
  }
  if (isLoading) return <Page><StateMessage kind="loading" /></Page>;
  if (!source) return <Page><StateMessage kind="error">Could not load the portfolio to copy.</StateMessage></Page>;

  return (
    <PortfolioForm
      key={source.id} // initial* props are read on mount only
      title={`Copy ${source.name}`}
      initialName={`${source.name} Copy`}
      initialPositions={source.positions}
      submitLabel="Save copy"
      {...formProps}
    />
  );
}
