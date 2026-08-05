"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export const usePortfolioSelectionStore = create(
  persist(
    (set) => ({
      selectedPortfolioId: null,
      selectedPortfolioName: null,

      setSelectedPortfolio: (id, name) => set({ selectedPortfolioId: id, selectedPortfolioName: name }),
      clearSelectedPortfolio: () => set({ selectedPortfolioId: null, selectedPortfolioName: null }),
    }),
    { name: "portfolio-selection" }
  )
);
