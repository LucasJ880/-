"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import type { Messages, Locale } from "./messages";
import { zh } from "./zh";
import { en } from "./en";

const LOCALES: Record<Locale, Messages> = { zh, en };

const LOCALE_LABELS: Record<Locale, string> = {
  zh: "中文",
  en: "English",
};

const STORAGE_KEY = "qingyan-locale";

function getInitialLocale(): Locale {
  if (typeof window === "undefined") return "zh";
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "zh" || stored === "en") return stored;
  return "zh";
}

interface LocaleContextValue {
  locale: Locale;
  m: Messages;
  setLocale: (locale: Locale) => void;
  localeLabel: string;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: "zh",
  m: zh,
  setLocale: () => {},
  localeLabel: "中文",
});

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getInitialLocale);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    localStorage.setItem(STORAGE_KEY, l);
  }, []);

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      m: LOCALES[locale],
      setLocale,
      localeLabel: LOCALE_LABELS[locale],
    }),
    [locale, setLocale],
  );

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

export function useLocale() {
  return useContext(LocaleContext);
}

export { LOCALE_LABELS };
export type { Locale };
