/**
 * 协作通知 COLLAB-2：通知跳转地址与登录回跳（design D11，spec notifications/click-targets）
 * - 取用顺序与三条规则的每一行、URL 编码、没有跳转目标
 * - next 校验、中间件生成的登录地址、锚点接回
 * - 源码断言：铃铛与通知页共用跳转函数；项目页处理 #project-discussion；中间件 / 登录页 / 选择组织页接线
 * 运行：npx tsx src/lib/notifications/__tests__/notification-href.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { installNotificationHref } from "../../install/balance";
import { PROJECT_DISCUSSION_HASH, notificationHref, notificationOrgToRemember } from "../href";
import { appendSafeHash, loginRedirectPath, safeNextPath } from "../../auth/safe-next";

let passed = 0;
let failed = 0;
function ok(cond: unknown, name: string, detail?: unknown) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}`, detail === undefined ? "" : JSON.stringify(detail));
  }
}
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
function eq(item: Parameters<typeof notificationHref>[0], want: string | null, name: string) {
  const got = notificationHref(item);
  ok(got === want, name, { got, want });
}

console.log("取用顺序");
const installItems = [
  { type: "install_completed", entityType: "blinds_order", entityId: "B1", projectId: "P1" },
  { type: "install_repair_overdue", entityType: "blinds_order", entityId: "B2" },
  { type: "install_balance_confirmed", entityType: "install_balance", entityId: "B3" },
  { type: "install_repair_submitted", entityType: "install_repair", entityId: "R1" },
  { type: "install_repair_scheduled", entityType: "install_task", entityId: "IT1" },
];
for (const item of installItems) {
  const want = installNotificationHref(item);
  ok(want !== null && notificationHref(item) === want, `1. 安装类与本次之前相同：${item.entityType}/${item.type} → ${want}`);
}
eq({ entityType: "task", entityId: "T1", projectId: "P1", activityId: "A1" }, "/tasks?open=T1", "2. entityType 规则先于项目规则");
eq({ entityType: "milestone", entityId: "X", projectId: "P1", activityId: "A1" }, "/projects/P1?activity=A1", "3. 带项目与活动");
eq({ entityType: "milestone", entityId: "X", projectId: "P1" }, "/projects/P1", "4. 只带项目");
eq({ entityType: "milestone", entityId: "X" }, null, "都没有 → 没有跳转地址");
eq({}, null, "空通知 → 没有跳转地址");
eq({ entityType: "task", entityId: null, projectId: "P1" }, "/projects/P1", "规则缺对象 id → 落到项目规则");
eq({ entityType: "project_discussion", entityId: "M1" }, null, "讨论区通知不带项目 → 没有跳转地址");

console.log("协作对象");
eq({ entityType: "task", entityId: "T1" }, "/tasks?open=T1", "task");
eq({ entityType: "project_discussion", entityId: "M1", projectId: "P1" }, "/projects/P1?tab=workbench#project-discussion", "project_discussion");
eq({ entityType: "project_files", entityId: "D1", projectId: "P1" }, "/projects/P1?tab=files", "project_files");
eq({ entityType: "tender_rfq_round", entityId: "R1", projectId: "P1" }, "/projects/P1?tab=bid#rfq-round-R1", "tender_rfq_round（T-1 询价轮次）");
eq({ entityType: "tender_rfq_round", entityId: "R1" }, null, "询价轮次通知不带项目 → 没有跳转地址");
eq({ entityType: "tender_rfq_round", projectId: "P1" }, "/projects/P1", "询价轮次通知缺轮次 id → 回落到项目");
eq({ entityType: "project", entityId: "P9" }, "/projects/P9", "project");
ok(PROJECT_DISCUSSION_HASH === "#project-discussion", "讨论区锚点常量");

console.log("业务对象");
eq({ entityType: "blinds_order", entityId: "B1" }, "/blinds-orders/B1", "blinds_order");
eq({ entityType: "approval", entityId: "AP1" }, "/capabilities/approvals/AP1", "approval");
eq({ entityType: "trade_prospect", entityId: "TP1" }, "/trade/prospects/TP1", "trade_prospect");
eq({ entityType: "trade_booth_summary", entityId: "2026-11-04" }, "/trade/booth-cards?day=2026-11-04", "trade_booth_summary");

console.log("销售与营收对象");
eq({ entityType: "muse_inquiry", entityId: "I1" }, "/sales/inquiries/I1", "muse_inquiry");
eq({ entityType: "sales_quote", entityId: "Q1" }, "/sales/quote-sheet?mode=order&quoteId=Q1", "sales_quote 不带组织");
eq({ entityType: "sales_quote", entityId: "Q1", orgId: "O1" }, "/sales/quote-sheet?mode=order&quoteId=Q1&orgId=O1", "sales_quote 带组织");
eq({ entityType: "sales_customer", entityId: "C1" }, "/sales/customers/C1", "sales_customer");
eq({ entityType: "sales_actions" }, "/sales?view=customers", "sales_actions（不需要对象 id）");
eq({ entityType: "visualizer_session", entityId: "V1" }, "/sales/visualizer/V1", "visualizer_session");
eq({ entityType: "revenue_opportunity", entityId: "RO1" }, "/revenue/RO1", "revenue_opportunity");

console.log("URL 编码");
eq({ entityType: "blinds_order", entityId: "a/b c" }, "/blinds-orders/a%2Fb%20c", "对象 id 编码");
eq({ entityType: "task", entityId: "T&1" }, "/tasks?open=T%261", "查询串里的 id 编码");
eq({ entityType: "sales_quote", entityId: "Q 1", orgId: "O&1" }, "/sales/quote-sheet?mode=order&quoteId=Q%201&orgId=O%261", "报价与组织 id 编码");
eq({ entityType: "trade_prospect", entityId: "x/y" }, "/trade/prospects/x%2Fy", "trade_prospect 编码");
eq({ projectId: "P/1", activityId: "A 1" }, "/projects/P%2F1?activity=A%201", "项目与活动 id 编码");
eq({ entityType: "project_discussion", projectId: "P/1" }, "/projects/P%2F1?tab=workbench#project-discussion", "讨论区的项目 id 编码");
eq({ entityType: "tender_rfq_round", entityId: "R1", projectId: "P/1" }, "/projects/P%2F1?tab=bid#rfq-round-R1", "询价轮次的项目 id 编码");

console.log("记住所选组织");
ok(notificationOrgToRemember({ type: "install_completed", entityType: "blinds_order", entityId: "B1", orgId: "O1" }) === "O1", "安装类 → 记住组织");
ok(notificationOrgToRemember({ entityType: "sales_quote", entityId: "Q1", orgId: "O1" }) === "O1", "报价 → 记住组织");
ok(notificationOrgToRemember({ entityType: "trade_booth_summary", entityId: "d", orgId: "O1" }) === "O1", "展会小结 → 记住组织");
ok(notificationOrgToRemember({ entityType: "approval", entityId: "AP1", orgId: "O1" }) === "O1", "审批 → 记住组织（与通知页相同）");
ok(notificationOrgToRemember({ entityType: "task", entityId: "T1", orgId: "O1" }) === null, "任务 → 不改所选组织");
ok(notificationOrgToRemember({ entityType: "approval", entityId: "AP1" }) === null, "没有组织 → 不记");

console.log("next 校验");
for (const v of ["/", "/tasks?open=T1", "/projects/P?tab=workbench#project-discussion", "/a/b?c=d&e=f", "/select-org?next=%2Ftasks"]) {
  ok(safeNextPath(v) === v, `合法：${v}`);
}
for (const v of [
  null,
  undefined,
  "",
  "tasks",
  "//evil.example",
  "/\\evil.example",
  "\\\\evil.example",
  "https://evil.example",
  "/ evil",
  "/a\tb",
  "/a\nb",
  "/a\u0000b",
  "/a\u007fb",
  "/a b",
]) {
  ok(safeNextPath(v) === "/", `非法 → /：${JSON.stringify(v)}`);
}

console.log("中间件生成的登录地址");
ok(loginRedirectPath("/tasks", "?open=T1") === "/login?next=%2Ftasks%3Fopen%3DT1", "/tasks?open=T1 → /login?next=%2Ftasks%3Fopen%3DT1");
ok(loginRedirectPath("/", "") === "/login", "原路径为 / → 不带 next");
ok(loginRedirectPath("/projects/P1", "") === "/login?next=%2Fprojects%2FP1", "不带查询串");
ok(loginRedirectPath("//evil.example", "") === "/login", "不合法的原路径 → 不带 next");

console.log("锚点接回");
ok(appendSafeHash("/projects/P?tab=workbench", "#project-discussion") === "/projects/P?tab=workbench#project-discussion", "合法锚点接到 next 后面");
ok(appendSafeHash("/x", "#a b") === "/x" && appendSafeHash("/x", "#<script>") === "/x", "不合法的锚点不接");
ok(appendSafeHash("/x", "") === "/x" && appendSafeHash("/x", "#") === "/x" && appendSafeHash("/x", null) === "/x", "没有锚点");
ok(appendSafeHash("/x#y", "#z") === "/x#y", "next 已带锚点 → 不再接");

console.log("接线（源码断言）");
const header = read("src/components/header.tsx");
const navStart = header.indexOf("const handleNotificationNavigate");
const headerNav = header.slice(navStart, header.indexOf("}, []);", navStart));
ok(/import \{[^}]*notificationHref[^}]*\} from "@\/lib\/notifications\/href"/.test(header), "铃铛导入共用跳转函数");
ok(/notificationHref\(item\)/.test(headerNav) && /notificationOrgToRemember\(item\)/.test(headerNav), "铃铛调用共用跳转函数");
ok(!/entityType ===/.test(headerNav), "铃铛不再自带跳转表");
const page = read("src/app/(main)/notifications/page.tsx");
const clickStart = page.indexOf("const handleItemClick");
const pageClick = page.slice(clickStart, page.indexOf("[router]", clickStart));
ok(/import \{[^}]*notificationHref[^}]*\} from "@\/lib\/notifications\/href"/.test(page), "通知页导入共用跳转函数");
ok(/notificationHref\(item\)/.test(pageClick) && /notificationOrgToRemember\(item\)/.test(pageClick), "通知页调用共用跳转函数");
ok(!/entityType ===/.test(pageClick), "通知页不再自带跳转表");
ok(/\/read`, \{ method: "PATCH" \}/.test(pageClick), "通知页照旧标为已读");

const project = read("src/app/(main)/projects/[id]/page.tsx");
ok(/PROJECT_DISCUSSION_HASH/.test(project), "项目页识别 #project-discussion");
ok(/addEventListener\("hashchange"/.test(project), "项目页监听锚点变化");
ok(/setActiveTab\("workbench"\)/.test(project), "项目页打开工作台");
ok(/getElementById\("project-discussion"\)/.test(project) && /scrollIntoView/.test(project), "讨论区渲染后滚动过去");

const mw = read("src/middleware.ts");
ok(/import \{[^}]*loginRedirectPath[^}]*\} from "@\/lib\/auth\/safe-next"/.test(mw), "中间件导入登录地址函数");
ok(/loginRedirectPath\(pathname, request\.nextUrl\.search\)/.test(mw), "中间件按原路径与查询串生成登录地址");
const apiCheck = mw.indexOf('pathname.startsWith("/api/")');
const loginCall = mw.indexOf("loginRedirectPath(pathname");
ok(apiCheck > 0 && apiCheck < loginCall && /status: 401/.test(mw.slice(apiCheck, loginCall)), "接口请求仍返回 401，不跳转");

for (const p of ["src/app/(auth)/login/page.tsx", "src/app/(auth)/select-org/page.tsx"]) {
  const s = read(p);
  ok(/import \{[^}]*safeNextPath[^}]*\} from "@\/lib\/auth\/safe-next"/.test(s), `${p}：导入共用 next 校验`);
  ok(!/function safeNext\(/.test(s), `${p}：不再自带 next 校验`);
  ok(/appendSafeHash\(next, window\.location\.hash\)/.test(s), `${p}：跳转时接回锚点`);
}

console.log(`\nnotification-href: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
