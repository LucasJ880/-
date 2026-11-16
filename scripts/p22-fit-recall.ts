/**
 * P2-2 新标匹配度召回核对（只读，design D6）
 *
 * 对每个历史投标项目，用它自己的名称 / 描述 / 客户 / 日期拼成一条「假公告」，按与新标视图相同的规则算匹配度：
 * - 业务匹配：按该组织当前的采购监控关键词匹配项目名称与描述；
 * - 往来与业绩：本组织招投标项目，**排除它自己，且只算在它之前的**（提交 / 截标 / 建立时间早于它的发布日），
 *   不用事后才有的中标与重招（审查 M2）；运行人视角 = 全部项目，与超级管理员相同；
 * - 准备时间：有发布日才按发布日算到截标日；没有发布日记「截标时间未知」的中性 5 分（审查 M2）。
 * @internal 运维只读脚本：直接读本组织全部招投标项目，不经可见范围过滤（visibility.ts 的约定）。
 * 输出每项得分与总分，以及达到阈值的个数。不写库、不发外部请求。
 *
 * 用法：
 *   npx tsx scripts/p22-fit-recall.ts <orgId> <projectId> [projectId...] [--threshold=50]
 */

import { db } from "../src/lib/db";
import { computeFitScore, prepareFitProjects } from "../src/lib/procurement-records/fit-score-pure";
import { matchKeywords, readWatchConfig, defaultWatchConfig } from "../src/lib/procurement-records/watch-config";
import { getWatchRow } from "../src/lib/procurement-records/watch-service";

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
    select: { id: true, name: true, description: true, clientOrganization: true, tenderStatus: true, submittedAt: true, publicDate: true, closeDate: true, createdAt: true },
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
    // 「当时」= 发布日；没有则截标日；再没有则建立时间
    const when = p.publicDate ?? p.closeDate ?? p.createdAt;
    const before = (o: (typeof all)[number]) => (o.submittedAt ?? o.closeDate ?? o.createdAt).getTime() < when.getTime();
    const others = prepareFitProjects(all.filter((o) => o.id !== id && before(o)));
    const match = matchKeywords({ texts: [p.name, p.description] }, filters);
    const fit = computeFitScore({ title: p.name, buyingInstitution: p.clientOrganization, contractingInstitution: null, closingAt: p.publicDate ? p.closeDate : null, match }, others, when);
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
