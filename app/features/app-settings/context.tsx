"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

interface AppSettingsContextType {
  debugMode: boolean;
  setDebugMode: (enabled: boolean) => void;
  toggleDebugMode: () => void;
}

const AppSettingsContext = createContext<AppSettingsContextType | null>(null);

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const [debugMode, setDebugMode] = useState(false);

  const toggleDebugMode = () => setDebugMode((prev) => !prev);

  return (
    <AppSettingsContext.Provider
      value={{
        debugMode,
        setDebugMode,
        toggleDebugMode,
      }}
    >
      {children}
    </AppSettingsContext.Provider>
  );
}

export function useAppSettings() {
  const context = useContext(AppSettingsContext);
  if (!context) {
    throw new Error("useAppSettings must be used within AppSettingsProvider");
  }
  return context;
}
