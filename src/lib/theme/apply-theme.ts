import { isUiTheme, type UiTheme, UI_THEME_STORAGE_KEY } from "./types";

export function readStoredUiTheme(): UiTheme {
  if (typeof window === "undefined") return "classic";
  try {
    const stored = window.localStorage.getItem(UI_THEME_STORAGE_KEY);
    return isUiTheme(stored) ? stored : "classic";
  } catch {
    return "classic";
  }
}

export function applyUiTheme(theme: UiTheme) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.colorScheme =
    theme === "glass" ? "dark" : "light";
}

export function persistUiTheme(theme: UiTheme) {
  try {
    window.localStorage.setItem(UI_THEME_STORAGE_KEY, theme);
  } catch {
    /* ignore quota / private mode */
  }
}

/** Inline in <head> to avoid FOUC before React hydrates. */
export const UI_THEME_BOOTSTRAP_SCRIPT = `(()=>{try{var k=${JSON.stringify(UI_THEME_STORAGE_KEY)};var t=localStorage.getItem(k);if(t!=="glass"&&t!=="classic")t="classic";document.documentElement.setAttribute("data-theme",t);document.documentElement.style.colorScheme=t==="glass"?"dark":"light";}catch(e){document.documentElement.setAttribute("data-theme","classic");document.documentElement.style.colorScheme="light";}})();`;
