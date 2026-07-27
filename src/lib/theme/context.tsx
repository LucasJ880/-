"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  applyUiTheme,
  persistUiTheme,
  readStoredUiTheme,
} from "./apply-theme";
import {
  UI_THEME_DESCRIPTIONS,
  UI_THEME_LABELS,
  type UiTheme,
} from "./types";

interface ThemeContextValue {
  theme: UiTheme;
  setTheme: (theme: UiTheme) => void;
  themeLabel: string;
  themeDescription: string;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "classic",
  setTheme: () => {},
  themeLabel: UI_THEME_LABELS.classic,
  themeDescription: UI_THEME_DESCRIPTIONS.classic,
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<UiTheme>("classic");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const initial = readStoredUiTheme();
    setThemeState(initial);
    applyUiTheme(initial);
    setReady(true);
  }, []);

  const setTheme = useCallback((next: UiTheme) => {
    setThemeState(next);
    applyUiTheme(next);
    persistUiTheme(next);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme,
      themeLabel: UI_THEME_LABELS[theme],
      themeDescription: UI_THEME_DESCRIPTIONS[theme],
    }),
    [theme, setTheme],
  );

  return (
    <ThemeContext.Provider value={value}>
      <div data-theme-ready={ready ? "1" : "0"} className="contents">
        {children}
      </div>
    </ThemeContext.Provider>
  );
}

export function useUiTheme() {
  return useContext(ThemeContext);
}
