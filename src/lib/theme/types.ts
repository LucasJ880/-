export const UI_THEMES = ["classic", "glass"] as const;

export type UiTheme = (typeof UI_THEMES)[number];

export const UI_THEME_STORAGE_KEY = "qingyan-ui-theme";

export const UI_THEME_LABELS: Record<UiTheme, string> = {
  classic: "经典版",
  glass: "新视觉版",
};

export const UI_THEME_DESCRIPTIONS: Record<UiTheme, string> = {
  classic: "当前青砚宣纸浅色工作台，稳定默认。",
  glass: "深色玻璃拟态风格，强调层次与霓虹点缀（实验性）。",
};

export function isUiTheme(value: unknown): value is UiTheme {
  return value === "classic" || value === "glass";
}
