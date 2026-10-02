"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { ReadingAtmosphere } from "../components/ReadingAtmosphere";
import { PreferencesSync } from "../components/PreferencesSync";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return <QueryClientProvider client={queryClient}><PreferencesSync /><ReadingAtmosphere />{children}</QueryClientProvider>;
}
