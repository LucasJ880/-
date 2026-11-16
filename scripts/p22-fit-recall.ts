/**
 * P2-2 新标匹配度召回核对（只读，design D6）
 *
 * 对每个历史投标项目，用它自己的名称 / 描述 / 客户 / 日期拼成一条「假公告」，按与新标视图相同的规则算匹配度：
 * - 业务匹配：按该组织当前的采购监控关键词匹配项目名称与描述；
 * - 往来与业绩：本组织招投标项目，**排除它自己**（运行人视角 = 全部项目，与超级管理员相同）；
 * - 准备时间：以发布日（没有则截标前 14 天）为「当时」，算到截标日。
 * 输出每项得分与总分，以及达到阈值的个数。不写库、不发外部请求。
 *
 * 用法：
 *   npx tsx scripts/p22-fit-recall.ts <orgId> <projectId> [projectId...] [--threshold=50]
 */

import { db } from "../src/lib/db";
import { computeFitScore, prepareFitProjects } from "../src/lib/procurement-records/fit-score-pure";
import { matchKeywords, readWatchConfig, defaultWatchConfig } from "../src/lib/procurement-records/watch-config";
import { getWatchRow } from "../src/lib/procurement-records/watch-service";

const DAY = 86_400_000;

async function main() {
  const args = process.argv.slice(2);
  const threshold = Number(args.find((a) => a.startsWith("--threshold="))?.split("=")[1] ?? 50);
  const [orgId, ...projectIds] = args.filter((a) => !a.startsWith("--"));
  if (!orgId || projectIds.length === 0) {
    console.error("用法：npx tsx scripts/p22-fit-recall.ts <orgId> <projectId> [projectId...] [--threshold=50]");
    process.exit(2);
  }
  const watch = await getWatchRow(orgId);
  const filters = (watch ? readWatchConfig(watch) : defaultWatchConfig()).filters;
  const all = await db.project.findMany({
    where: { orgId, workDomain: "tender" },
    select: { id: true, name: true, description: true, clientOrganization: true, tenderStatus: true, submittedAt: true, publicDate: true, closeDate: true },
  });
  const byId = new Map(all.map((p) => [p.id, p]));
  console.log(`组织 ${orgId}：招投标项目 ${all.length} 个；监控关键词 ${filters.keywords.length} 个；阈值 ${threshold}\n`);
  let hit = 0;
  let found = 0;
  for (const id of projectIds) {
    const p = byId.get(id);
    if (!p) {
      console.log(`${id}\t（不在该组织的招投标项目里，跳过）`);
      continue;
    }
    found++;
    const others = prepareFitProjects(all.filter((o) => o.id !== id));
    const match = matchKeywords({ texts: [p.name, p.description] }, filters);
    const when = p.publicDate ?? (p.closeDate ? new Date(p.closeDate.getTime() - 14 * DAY) : new Date());
    const fit = computeFitScore({ title: p.name, buyingInstitution: p.clientOrganization, contractingInstitution: null, closingAt: p.closeDate, match }, others, when);
    if (fit.score >= threshold) hit++;
    console.log(`${id}\t${fit.score}\t${p.name}`);
    for (const d of fit.dimensions) console.log(`    ${d.label} ${d.points}/${d.max}：${d.reasonZh}`);
  }
  console.log(`\n达到 ${threshold} 分：${hit} / ${found}`);
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
