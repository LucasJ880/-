/**
 * Revenue Spine 内部自治开关（B-5，D-4：代码默认关闭，sunny-home-deco 用本脚本开启做 dogfood）
 *
 * 用法：
 *   npx tsx scripts/seed-revenue-autonomy.ts                                   # dry-run，组织缺省 sunny-home-deco
 *   npx tsx scripts/seed-revenue-autonomy.ts --org-code sunny-home-deco --write  # 发布新版 policy（旧 active → superseded）
 *
 * 只把 revenue_spine.policy 里的 autonomy.autoStale 设为 true，其余 policy 原样保留；已开启时不重复发布。
 * 回滚：经 PUT /api/revenue/policy 发布 { "autonomy": { "autoStale": false } }。
 * 只写业务配置，不碰生产数据；生产执行仍需遵守 production-operation-guard。
 */

import { db } from "@/lib/db";
import { planAutonomyEnable } from "@/lib/revenue-spine/autonomy";
import { RULE_KEY_POLICY, loadRevenueSpinePolicy, publishRevenueSpineRule } from "@/lib/revenue-spine/policy";

const DEFAULT_ORG_CODE = "sunny-home-deco";

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

async function main() {
  if (process.argv.includes("--help")) {
    console.log("用法：npx tsx scripts/seed-revenue-autonomy.ts [--org-code <code>] [--write]\n缺省组织 sunny-home-deco；不带 --write 只打印计划。");
    return;
  }
  const orgCode = arg("--org-code") ?? DEFAULT_ORG_CODE;
  const write = process.argv.includes("--write");
  const org = await db.organization.findUnique({ where: { code: orgCode }, select: { id: true, name: true, ownerId: true } });
  if (!org) throw new Error(`组织不存在：${orgCode}`);

  const active = await db.orgBusinessRule.findFirst({
    where: { orgId: org.id, ruleKey: RULE_KEY_POLICY, status: "active" },
    orderBy: { version: "desc" },
    select: { version: true, configJson: true },
  });
  const next = planAutonomyEnable(active?.configJson ?? null);
  console.log(`组织：${org.name}（${org.id}）；当前 policy 版本：${active ? `v${active.version}` : "无（默认值）"}`);
  if (!next) {
    console.log("autonomy.autoStale 已开启，不重复发布。");
    return;
  }
  console.log("将发布的 policy =", JSON.stringify(next, null, 2));
  if (!write) {
    console.log("\n[dry-run] 未写入；加 --write 执行。");
    return;
  }
  const r = await publishRevenueSpineRule({ orgId: org.id, ruleKey: RULE_KEY_POLICY, config: next, userId: org.ownerId });
  const effective = await loadRevenueSpinePolicy(org.id);
  console.log(`写入完成：policy v${r.version}；autonomy.autoStale = ${effective.autonomy.autoStale}，staleAfterDays = ${effective.followUp.staleAfterDays}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
