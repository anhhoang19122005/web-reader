"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { ReadingAtmosphere } from "../components/ReadingAtmosphere";
import { PwaSupport } from "../components/PwaSupport";
import { PreferencesSync } from "../components/PreferencesSync";
import { ThemePicker } from "../components/ThemePicker";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return <QueryClientProvider client={queryClient}><PreferencesSync /><PwaSupport /><ReadingAtmosphere />{children}<ThemePicker /></QueryClientProvider>;
}
