/**
 * A-1 组织驾驶舱岗位注册表 — 穷举与静态核对（openspec change org-cockpit-posts，spec cockpit/post-registry）
 * 运行：npx tsx src/lib/cockpit/__tests__/posts.test.ts
 *
 * 不连库：自动化键与工作域取运行时常量；PendingActionType 没有运行时数组，从类型定义源码读联合成员。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AUTOMATION_REGISTRY } from "@/lib/automation/registry";
import { WORK_DOMAINS } from "@/lib/workforce-runtime/work-domain";
import {
  POST_KEYS,
  POST_REGISTRY,
  getPostDefinition,
  postForAgentRunType,
  postForAutomation,
  postForPendingActionType,
  postForWorkDomain,
} from "../posts";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`);
  }
}

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

interface PostLike {
  key: string;
  automationKeys: readonly string[];
  pendingActionTypes: readonly string[];
  workDomains: readonly string[];
  agentRunTypes: readonly string[];
}
type Field = "automationKeys" | "pendingActionTypes" | "workDomains" | "agentRunTypes";

/** 每个值命中的岗位；missing = 没有岗位，duplicated = 多于一个岗位，unknown = 岗位里列了但全集里没有 */
function coverage(all: readonly string[], field: Field, posts: readonly PostLike[]) {
  const hits = new Map<string, string[]>(all.map((v) => [v, []]));
  const unknown: string[] = [];
  for (const post of posts) {
    for (const value of post[field]) {
      const list = hits.get(value);
      if (list) list.push(post.key);
      else unknown.push(`${post.key}:${value}`);
    }
  }
  const missing = [...hits].filter(([, ps]) => ps.length === 0).map(([v]) => v);
  const duplicated = [...hits].filter(([, ps]) => ps.length > 1).map(([v, ps]) => `${v} → ${ps.join(" + ")}`);
  return { missing, duplicated, unknown };
}

function pendingActionTypesFromSource(): string[] {
  const src = read("src/lib/pending-actions/types.ts");
  const body = src.match(/export type PendingActionType =([\s\S]*?);/)?.[1] ?? "";
  const withoutComments = body.replace(/\/\/.*$/gm, "");
  return [...withoutComments.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

const posts: readonly PostLike[] = POST_REGISTRY;

// ── 岗位集合固定为七个 ─────────────────────────────────────────
console.log("岗位集合");
const EXPECTED_KEYS = ["inbound_sales", "tender", "marketing", "service", "projects", "ops_knowledge", "content"];
ok(JSON.stringify(POST_KEYS) === JSON.stringify(EXPECTED_KEYS), "岗位键与顺序固定为七个", POST_KEYS);
ok(new Set(POST_KEYS).size === POST_KEYS.length, "岗位键不重复");
ok(POST_REGISTRY.every((p) => p.name.trim().length > 0), "每个岗位有中文名");
ok(getPostDefinition("content")?.key === "content" && getPostDefinition("marketing")?.key === "marketing", "content 与 marketing 是两个独立岗位（D-5）");
ok(getPostDefinition("tender")?.name === "投标", "按键查找岗位");
for (const bogus of ["ceo", "", "__proto__", "INBOUND_SALES"]) {
  ok(getPostDefinition(bogus) === null, `查找不存在的岗位 "${bogus}" → null，不回退默认岗位`);
}

// ── 自动化 ────────────────────────────────────────────────────
console.log("自动化归属");
const automationKeys = AUTOMATION_REGISTRY.map((a) => a.key as string);
ok(automationKeys.length >= 28, `自动化注册表读到 ${automationKeys.length} 项（≥ 28）`);
{
  const c = coverage(automationKeys, "automationKeys", posts);
  ok(c.missing.length === 0, "每个自动化键都有岗位", c.missing);
  ok(c.duplicated.length === 0, "没有自动化键归属两个岗位", c.duplicated);
  ok(c.unknown.length === 0, "岗位里没有注册表之外的自动化键", c.unknown);
}
for (const key of automationKeys) {
  const post = postForAutomation(key);
  ok(post !== null && POST_REGISTRY.find((p) => p.key === post)?.automationKeys.some((k) => k === key) === true, `反查 ${key} → ${post}`);
}
ok(postForAutomation("approval-timeout") === "ops_knowledge", "approval-timeout → ops_knowledge（全组织审批过期，不是投标专属）");
ok(postForAutomation("tender-watch") === "tender", "tender-watch → tender（不按 registry category=projects 推导）");
ok(postForAutomation("inquiry-sla") === "inbound_sales", "inquiry-sla → inbound_sales（不按 registry category=service 推导）");
ok(postForAutomation("aivora-sync") === "content", "aivora-sync → content");
ok(postForAutomation("no-such-automation") === null, "未知自动化键 → null");

// ── 待审批动作类型 ────────────────────────────────────────────
console.log("待审批动作类型归属");
const actionTypes = pendingActionTypesFromSource();
ok(actionTypes.length >= 14, `从 pending-actions/types.ts 读到 ${actionTypes.length} 个联合成员（≥ 14，防源码截取失效）`, actionTypes);
{
  const c = coverage(actionTypes, "pendingActionTypes", posts);
  ok(c.missing.length === 0, "每个动作类型都有岗位", c.missing);
  ok(c.duplicated.length === 0, "没有动作类型归属两个岗位", c.duplicated);
  ok(c.unknown.length === 0, "岗位里没有联合之外的动作类型", c.unknown);
}
for (const t of ["grader.internal_note", "grader.project_task", "grader.email_draft", "calendar.create_event"]) {
  ok(postForPendingActionType(t) === "projects", `${t} → projects（ai-grader 产出）`);
}
ok(postForPendingActionType("sales.send_inquiry_reply") === "inbound_sales", "sales.send_inquiry_reply → inbound_sales");
ok(postForPendingActionType("tender.send_chase") === "tender", "tender.send_chase → tender");
ok(postForPendingActionType("marketing.activate_campaign") === "marketing", "marketing.activate_campaign → marketing");
ok(postForPendingActionType("revenue_spine.propose_commercial_fact") === null, "尚未加入联合的类型 → null");

// ── workforce 工作域 ──────────────────────────────────────────
console.log("工作域归属");
{
  const c = coverage(WORK_DOMAINS, "workDomains", posts);
  ok(c.missing.length === 0 && c.duplicated.length === 0 && c.unknown.length === 0, "四个工作域各恰好一个岗位", c);
}
const EXPECTED_DOMAINS: Record<string, string> = { sales: "inbound_sales", tender: "tender", delivery: "projects", general: "ops_knowledge" };
for (const [domain, post] of Object.entries(EXPECTED_DOMAINS)) {
  ok(postForWorkDomain(domain) === post, `工作域 ${domain} → ${post}`);
}
ok(postForWorkDomain("system") === null && postForWorkDomain("") === null, "未知工作域 → null");

// ── AgentRun runType ─────────────────────────────────────────
console.log("AgentRun 类型归属");
{
  const listed = POST_REGISTRY.flatMap((p) => p.agentRunTypes as readonly string[]);
  const c = coverage([...new Set(listed)], "agentRunTypes", posts);
  ok(c.duplicated.length === 0, "每个 runType 至多一个岗位", c.duplicated);
  ok(!listed.includes("workforce_job"), "没有岗位按 runType 认领 workforce_job（它按工作域归属）");
}
ok(postForAgentRunType("fde_inbound_sales") === "inbound_sales", "fde_inbound_sales → inbound_sales");
for (const rt of ["workforce_job", "conversation", "assistant_dispatch", "supervisor", "unknown_type"]) {
  ok(postForAgentRunType(rt) === null, `runType ${rt} → null（不猜、不回退）`);
}

// ── KPI 来源 ──────────────────────────────────────────────────
console.log("KPI 来源");
const SENSITIVE = /margin|profit|毛利|利润|估值|valuation|winningBidPrice|最终报价|awardedValue|indicativeTenderValue|estimatedValue/i;
for (const post of POST_REGISTRY) {
  const kpi = post.kpi;
  if (kpi.kind === "unavailable") {
    ok(kpi.reason.trim().length > 0, `${post.key}：KPI 未接入且写明原因`);
    continue;
  }
  const exists = existsSync(join(root, kpi.module));
  ok(exists, `${post.key}：KPI 模块 ${kpi.module} 存在`);
  if (!exists) continue;
  const src = read(kpi.module);
  ok(new RegExp(`export async function ${kpi.exportName}\\b`).test(src), `${post.key}：${kpi.module} 导出 async ${kpi.exportName}`);
  ok(kpi.metrics.length === 3, `${post.key}：恰好三个指标`);
  for (const metric of kpi.metrics) {
    const segments = metric.path.split(".");
    const absent = segments.filter((seg) => !new RegExp(`\\b${seg}\\b`).test(src));
    ok(absent.length === 0, `${post.key}：指标路径 ${metric.path} 的每一段都出现在模块源码中`, absent);
    ok(metric.label.trim().length > 0, `${post.key}：指标 ${metric.path} 有中文标签`);
    ok(!SENSITIVE.test(metric.path) && !SENSITIVE.test(metric.label), `${post.key}：指标 ${metric.path}（${metric.label}）不含敏感字段`);
  }
}
ok(getPostDefinition("service")?.kpi.kind === "unavailable", "service 的 KPI 为未接入（无既有只读读函数）");
ok(getPostDefinition("content")?.kpi.kind === "unavailable", "content 的 KPI 为未接入（无既有只读读函数）");
ok(SENSITIVE.test("wonProjects.finalizedMarginPercentage") && SENSITIVE.test("funnel.economics.attributedGrossProfit") && SENSITIVE.test("awardedValueCad"), "敏感词正则能拦住 tender / marketing 返回值里的已知敏感字段");

// ── 跳转页面 ──────────────────────────────────────────────────
console.log("跳转页面");
for (const post of POST_REGISTRY) {
  ok(post.nav.startsWith("/"), `${post.key}：跳转路径以 / 开头`);
  ok(existsSync(join(root, "src/app/(main)", post.nav, "page.tsx")), `${post.key}：${post.nav} 对应的 page.tsx 存在`);
}

// ── 注册表是代码事实 ──────────────────────────────────────────
console.log("零运行时依赖");
{
  const src = read("src/lib/cockpit/posts.ts");
  const imports = src.split("\n").filter((line) => /^import\s/.test(line));
  ok(imports.length > 0 && imports.every((line) => /^import type\s/.test(line)), "posts.ts 只有 import type", imports);
  for (const banned of ["process.env", "settingsJson", "@/lib/db"]) {
    ok(!src.includes(banned), `posts.ts 不出现 ${banned}`);
  }
}

// ── 校验器自检：注入未归属 / 重复归属必须被检出 ─────────────────
console.log("校验器自检");
{
  const fake: PostLike[] = [
    { key: "a", automationKeys: ["x", "y"], pendingActionTypes: [], workDomains: [], agentRunTypes: [] },
    { key: "b", automationKeys: ["y", "ghost"], pendingActionTypes: [], workDomains: [], agentRunTypes: [] },
  ];
  const c = coverage(["x", "y", "z"], "automationKeys", fake);
  ok(JSON.stringify(c.missing) === JSON.stringify(["z"]), "未归属的键被检出", c.missing);
  ok(JSON.stringify(c.duplicated) === JSON.stringify(["y → a + b"]), "重复归属的键被检出", c.duplicated);
  ok(JSON.stringify(c.unknown) === JSON.stringify(["b:ghost"]), "全集之外的键被检出", c.unknown);
}

console.log(`\n组织驾驶舱岗位注册表: ${pass}/${pass + fail} passed`);
if (fail > 0) process.exit(1);
