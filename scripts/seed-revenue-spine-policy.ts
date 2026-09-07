/**
 * Revenue Spine 企业策略写入（OrgBusinessRule ruleKey revenue_spine.*）
 *
 * 用法：
 *   npx tsx scripts/seed-revenue-spine-policy.ts --org-code mengxin-home-textile            # dry-run（打印将写入的配置）
 *   npx tsx scripts/seed-revenue-spine-policy.ts --org-code mengxin-home-textile --write    # 真正写入（新版本，旧 active → superseded）
 *
 * 只写业务配置，不碰生产数据；生产执行仍需遵守 production-operation-guard。
 */

import { db } from "@/lib/db";
import {
  MENGXIN_BUSINESS_PROFILE,
  RULE_KEY_BUSINESS_PROFILE,
  RULE_KEY_POLICY,
  loadRevenueSpinePolicy,
  publishRevenueSpineRule,
} from "@/lib/revenue-spine/policy";

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

async function main() {
  const orgCode = arg("--org-code");
  const write = process.argv.includes("--write");
  if (!orgCode) throw new Error("--org-code 必填");
  const org = await db.organization.findUnique({ where: { code: orgCode }, select: { id: true, name: true, ownerId: true } });
  if (!org) throw new Error(`组织不存在：${orgCode}`);

  const profile = MENGXIN_BUSINESS_PROFILE;
  const policyOverride = {
    salesSla: { newInquiryResponseHours: 4, customerReplyResponseHours: 8 },
    followUp: { afterReplyNoResponseBusinessDays: 3, quoteFollowUpDays: [3, 7, 14], sampleDeliveredFollowUpBusinessDays: 1, staleAfterDays: 21, nurtureCheckInDays: 30, maxQuestionsPerReply: 4 },
    scoring: { strategicMarkets: profile.primaryMarkets },
  };
  console.log(`组织：${org.name}（${org.id}）`);
  console.log("business_profile =", JSON.stringify(profile, null, 2));
  console.log("policy =", JSON.stringify(policyOverride, null, 2));
  if (!write) {
    console.log("\n[dry-run] 未写入；加 --write 执行。");
    return;
  }
  const a = await publishRevenueSpineRule({ orgId: org.id, ruleKey: RULE_KEY_BUSINESS_PROFILE, config: profile as unknown as Record<string, unknown>, userId: org.ownerId });
  const b = await publishRevenueSpineRule({ orgId: org.id, ruleKey: RULE_KEY_POLICY, config: policyOverride, userId: org.ownerId });
  console.log(`写入完成：business_profile v${a.version}，policy v${b.version}`);
  const effective = await loadRevenueSpinePolicy(org.id);
  console.log("生效类目：", effective.businessProfile.productCategories.join(", "));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
