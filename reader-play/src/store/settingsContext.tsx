import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import type { Settings } from "../core/settings";
import { loadSettings, saveSettings } from "./db";

interface Ctx {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  replace: (s: Settings) => void;
}

const SettingsCtx = createContext<Ctx | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);
  const replace = useCallback((s: Settings) => {
    saveSettings(s);
    setSettings(s);
  }, []);
  return <SettingsCtx.Provider value={{ settings, update, replace }}>{children}</SettingsCtx.Provider>;
}

export function useSettings(): Ctx {
  const c = useContext(SettingsCtx);
  if (!c) throw new Error("useSettings fuera de SettingsProvider");
  return c;
}
