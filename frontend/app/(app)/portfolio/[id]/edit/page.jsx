"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/app/lib/api";
import PortfolioForm from "@/app/components/PortfolioForm";
import Page from "@/app/components/Page";
import StateMessage from "@/app/components/StateMessage";

export default function EditPortfolioPage() {
  const id = Number(useParams().id);
  const router = useRouter();
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState(null);

  const { data: portfolios, isLoading, isError } = useQuery({
    queryKey: ["portfolios"],
    queryFn: () => api.get("/api/portfolios"),
  });
  const portfolio = portfolios?.find((p) => p.id === id);

  const update = useMutation({
    mutationFn: (payload) => api.put(`/api/portfolios/${id}`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portfolios"] });
      router.push("/portfolio");
    },
    onError: (err) => setServerError(err),
  });

  if (isLoading) return <Page><StateMessage kind="loading" /></Page>;
  if (isError || !portfolio) return <Page><StateMessage kind="error">Could not load this portfolio.</StateMessage></Page>;

  return (
    <PortfolioForm
      key={portfolio.id}
      title={`Edit ${portfolio.name}`}
      initialName={portfolio.name}
      initialPositions={portfolio.positions}
      submitLabel="Save changes"
      onSubmit={(payload) => { setServerError(null); update.mutate(payload); }}
      isPending={update.isPending}
      serverError={serverError}
    />
  );
}
