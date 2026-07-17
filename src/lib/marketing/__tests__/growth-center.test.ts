import { validateAuditContext, validateBrandTruth } from "../brand-validation";
import { calculateGrowthExecution, calculateMarketPresence } from "../dashboard";
import { build30DayPlan } from "../plan";
import { canEditMarketingBrandProfile } from "../access-policy";

let total = 0;
let failed = 0;
function expect(condition: boolean, message: string) {
  total += 1;
  if (condition) console.log(`  ✅ ${message}`);
  else { failed += 1; console.error(`  ❌ ${message}`); }
}

const valid = validateBrandTruth({
  legalName: "Sunny Shutter Inc.", brandName: "Sunny", website: "https://sunnyshutter.com",
  phone: "416-555-0100", addressLine: "690 Progress Avenue", city: "Toronto", region: "Ontario",
  country: "Canada", industry: "Custom window coverings",
  products: ["Plantation shutters", "Zebra blinds", "Motorized blinds"],
  serviceAreas: ["Toronto", "Scarborough", "GTA"],
  targetAudiences: ["Toronto homeowner"], competitors: ["Budget Blinds"],
  forbiddenContexts: ["Photography equipment", "New York", "Boston"],
});
expect(valid.status === "valid", "完整企业事实可通过校验");
expect(valid.score === 100, "完整企业事实得分 100");

const wrongGeo = validateAuditContext(valid.value, { geography: "Boston", industry: "Custom window coverings", product: "Zebra blinds", query: "best blinds in Boston" });
expect(wrongGeo.some((issue) => issue.code === "geography_mismatch"), "错误地域会被拒绝");
expect(wrongGeo.some((issue) => issue.code === "forbidden_context"), "禁止场景会使检测无效");
const wrongCompetitor = validateAuditContext(valid.value, { competitors: ["Unknown Photo Store"] });
expect(wrongCompetitor.some((issue) => issue.code === "competitor_unconfirmed"), "未确认竞争对手会被拒绝");
expect(validateAuditContext(valid.value, { geography: "Toronto", industry: "window coverings", product: "Plantation shutters", competitors: ["Budget Blinds"] }).length === 0, "正确检测上下文可通过");

expect(calculateMarketPresence([{ dimension: "SEO", score: 70 }, { dimension: "SOCIAL", score: 30 }]) === 50, "市场存在度只聚合已有维度");
expect(calculateMarketPresence([]) === null, "无体检时不伪造市场存在度");
expect(calculateGrowthExecution({ published: 4, experiments: 1, qualifiedLeads: 2, wins: 1, pendingReview: 0 }) === 30, "增长执行力按执行结果计算");

const plan = build30DayPlan([
  { id: "f1", dimension: "WEBSITE", severity: "critical", title: "压缩首页视频" },
  { id: "f2", dimension: "SOCIAL", severity: "high", title: "提高内容频率" },
], new Date("2026-07-17T00:00:00Z"));
expect(plan[0]?.findingId === "f1" && plan[0]?.priority === "urgent", "30 天计划优先处理严重问题");
expect(plan.every((item) => item.dayOffset >= 0 && item.dayOffset <= 29), "计划项目均落在 30 天内");
expect(plan.some((item) => item.category === "experiment"), "计划包含赛马复盘实验");

expect(canEditMarketingBrandProfile("user", { role: "org_member", status: "active" }), "活跃营销成员可维护企业事实");
expect(canEditMarketingBrandProfile("user", { role: "org_admin", status: "active" }), "组织管理员可维护企业事实");
expect(!canEditMarketingBrandProfile("user", { role: "org_viewer", status: "active" }), "观察者保持只读");
expect(!canEditMarketingBrandProfile("user", { role: "org_member", status: "inactive" }), "停用成员不可维护企业事实");
expect(canEditMarketingBrandProfile("admin", null), "平台管理员仍可维护企业事实");

console.log(`\n${failed === 0 ? "✅" : "❌"} Growth Center: ${total - failed}/${total} 通过`);
if (failed > 0) process.exit(1);
