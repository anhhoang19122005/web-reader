"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { ReadingAtmosphere } from "../components/ReadingAtmosphere";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return <QueryClientProvider client={queryClient}><ReadingAtmosphere />{children}</QueryClientProvider>;
}
