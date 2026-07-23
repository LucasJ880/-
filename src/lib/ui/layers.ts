/**
 * 移动端 / Overlay z-index 规范（Mobile-2）
 * 禁止业务页随意使用 z-[999] / z-[9999]，除非文档说明。
 */

export const UI_LAYERS = {
  content: 0,
  sticky: 20,
  tabbar: 30,
  popover: 40,
  drawerOverlay: 50,
  drawerPanel: 60,
  dialogOverlay: 70,
  dialogPanel: 80,
  toast: 90,
  critical: 100,
} as const;

export type UiLayer = keyof typeof UI_LAYERS;

/** Tailwind 任意值：z-[var(--ui-z-dialog-panel)] */
export const UI_Z_CSS_VARS = {
  "--ui-z-sticky": String(UI_LAYERS.sticky),
  "--ui-z-tabbar": String(UI_LAYERS.tabbar),
  "--ui-z-popover": String(UI_LAYERS.popover),
  "--ui-z-drawer-overlay": String(UI_LAYERS.drawerOverlay),
  "--ui-z-drawer-panel": String(UI_LAYERS.drawerPanel),
  "--ui-z-dialog-overlay": String(UI_LAYERS.dialogOverlay),
  "--ui-z-dialog-panel": String(UI_LAYERS.dialogPanel),
  "--ui-z-toast": String(UI_LAYERS.toast),
  "--ui-z-critical": String(UI_LAYERS.critical),
} as const;
