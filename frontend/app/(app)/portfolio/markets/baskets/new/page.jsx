"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/app/lib/api";
import BasketForm from "@/app/components/BasketForm";

export default function NewBasketPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState(null);

  const createBasket = useMutation({
    mutationFn: (payload) => api.post("/api/baskets", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["baskets"] });
      router.push("/portfolio/markets/baskets");
    },
    onError: (err) => setServerError(err.message || "Save failed."),
  });

  return (
    <BasketForm
      title="Add Basket"
      subtitle="Name it, add 5–20 tickers, and choose how holdings are weighted."
      submitLabel="Save Basket"
      onSubmit={(payload) => {
        setServerError(null);
        createBasket.mutate(payload);
      }}
      isPending={createBasket.isPending}
      serverError={serverError}
    />
  );
}
