/**
 * 主题框架基础校验
 * 运行：npx tsx src/lib/theme/__tests__/theme.test.ts
 */

import {
  isUiTheme,
  UI_THEMES,
  UI_THEME_LABELS,
  UI_THEME_STORAGE_KEY,
} from "../types";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) {
    pass++;
    console.log(`✓ ${name}`);
  } else {
    fail++;
    console.error(`✗ ${name}`);
  }
}

ok(UI_THEMES.length === 2, "两种主题");
ok(UI_THEMES.includes("classic") && UI_THEMES.includes("glass"), "classic + glass");
ok(isUiTheme("classic") && isUiTheme("glass"), "isUiTheme 接受合法值");
ok(!isUiTheme("dark") && !isUiTheme("") && !isUiTheme(null), "isUiTheme 拒绝非法值");
ok(UI_THEME_LABELS.classic === "经典版", "经典版文案");
ok(UI_THEME_LABELS.glass === "新视觉版", "新视觉版文案");
ok(UI_THEME_STORAGE_KEY === "qingyan-ui-theme", "localStorage key 稳定");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
