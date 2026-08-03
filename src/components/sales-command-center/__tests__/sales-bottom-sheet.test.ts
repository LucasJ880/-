/**
 * 手机端 SalesBottomSheet 渲染/样式契约
 * 运行：npx tsx src/components/sales-command-center/__tests__/sales-bottom-sheet.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SALES_BOTTOM_SHEET_OVERLAY_CLASS,
  SALES_BOTTOM_SHEET_PANEL_CLASS,
} from "../sales-bottom-sheet";

let pass = 0;
let fail = 0;

function ok(cond: boolean, name: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

const srcPath = join(
  process.cwd(),
  "src/components/sales-command-center/sales-bottom-sheet.tsx",
);
const src = readFileSync(srcPath, "utf8");

console.log("\n== SalesBottomSheet 分层与不透明契约 ==");

ok(src.includes("createPortal"), "使用 createPortal 挂到 body");
ok(src.includes("lockAppScroll"), "打开时锁定页面滚动");
ok(src.includes('aria-modal="true"'), "dialog aria-modal");
ok(src.includes("Escape"), "支持 Escape 关闭");

ok(
  SALES_BOTTOM_SHEET_OVERLAY_CLASS.includes("ui-z-dialog-overlay"),
  "遮罩 z-index = dialog-overlay（高于 tabbar）",
);
ok(
  SALES_BOTTOM_SHEET_PANEL_CLASS.includes("ui-z-dialog-panel"),
  "面板 z-index = dialog-panel",
);
ok(
  SALES_BOTTOM_SHEET_OVERLAY_CLASS.includes("bg-black/45") ||
    SALES_BOTTOM_SHEET_OVERLAY_CLASS.includes("bg-black/"),
  "遮罩有独立半透明黑底",
);
ok(
  !SALES_BOTTOM_SHEET_OVERLAY_CLASS.includes("opacity-40") &&
    !SALES_BOTTOM_SHEET_OVERLAY_CLASS.includes("opacity-30"),
  "遮罩不用低 opacity 类吞子节点",
);

ok(
  SALES_BOTTOM_SHEET_PANEL_CLASS.includes("--card-bg"),
  "面板使用 --card-bg（非未定义的 --card）",
);
ok(
  /backgroundColor:\s*["']var\(--card-bg/.test(src),
  "面板含 inline 不透明 backgroundColor 兜底",
);
ok(
  !SALES_BOTTOM_SHEET_PANEL_CLASS.includes("var(--card)"),
  "面板不再使用未定义的 var(--card)",
);
ok(
  SALES_BOTTOM_SHEET_PANEL_CLASS.includes("opacity-100"),
  "面板显式 opacity-100",
);
ok(
  SALES_BOTTOM_SHEET_PANEL_CLASS.includes("max-h-[85dvh]"),
  "面板限制最大高度可滚动",
);
ok(
  SALES_BOTTOM_SHEET_PANEL_CLASS.includes("safe-area-inset-bottom"),
  "面板含底部 safe-area padding",
);

// 反模式：同一父级同时 opacity + 包住 content
ok(!/fixed inset-0[^>]{0,120}opacity-[0-9]+[^>]*>\s*\{?children/s.test(src), "无 opacity 父级包裹 children 的反模式");
ok(
  !src.includes('z-[var(--ui-z-tabbar)]'),
  "不再把 sheet 放到与底栏相同的 z-tabbar",
);

// 客户列表仍使用该组件
const listSrc = readFileSync(
  join(process.cwd(), "src/app/(main)/sales/customer-list.tsx"),
  "utf8",
);
ok(listSrc.includes("SalesBottomSheet"), "客户列表仍走 SalesBottomSheet");
ok(listSrc.includes("onOpenActions"), "三点菜单打开 actions sheet");

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
