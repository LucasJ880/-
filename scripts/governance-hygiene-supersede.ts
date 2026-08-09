/**
 * Governance Hygiene Gate — 存量数据一次性清理
 *
 * 目标不变量：同一 (orgId, workspaceId, metric) 下最多只有一条 enabled 的
 * 配额策略（version 最高者为 current）。
 *
 * 历史上 createQuotaPolicy 不会 supersede 旧版本，导致同一 metric 可能
 * 存在多条 enabled 行（如生产上出现过的 23 条）。本脚本把每组中除最高
 * version 之外的 enabled 行置为 enabled=false, effectiveTo=now。
 *
 * 用法：
 *   npx tsx scripts/governance-hygiene-supersede.ts            # dry-run（默认，只读）
 *   npx tsx scripts/governance-hygiene-supersede.ts --apply    # 实际写入
 */

import { db } from "../src/lib/db";

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(`[hygiene] mode = ${apply ? "APPLY" : "DRY-RUN"}`);

  const enabledRows = await db.capabilityQuotaPolicy.findMany({
    where: { enabled: true },
    select: {
      id: true,
      orgId: true,
      workspaceId: true,
      metric: true,
      version: true,
      hardLimit: true,
    },
    orderBy: [{ orgId: "asc" }, { metric: "asc" }, { version: "desc" }],
  });

  const groups = new Map<string, typeof enabledRows>();
  for (const row of enabledRows) {
    const key = `${row.orgId}|${row.workspaceId ?? "_"}|${row.metric}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  let supersededTotal = 0;
  for (const [key, rows] of groups) {
    if (rows.length <= 1) continue;
    // rows 已按 version desc 排序；保留第一条，其余 supersede
    const keep = rows[0];
    const stale = rows.slice(1);
    console.log(
      `[hygiene] ${key}: ${rows.length} enabled → keep v${keep.version} (${keep.id}), supersede ${stale.length}`,
    );
    for (const s of stale) {
      console.log(`  - supersede v${s.version} (${s.id}) hard=${s.hardLimit}`);
    }
    if (apply) {
      const res = await db.capabilityQuotaPolicy.updateMany({
        where: { id: { in: stale.map((s) => s.id) } },
        data: { enabled: false, effectiveTo: new Date() },
      });
      supersededTotal += res.count;
    } else {
      supersededTotal += stale.length;
    }
  }

  console.log(
    `[hygiene] ${apply ? "superseded" : "would supersede"} ${supersededTotal} rows across ${[...groups.values()].filter((g) => g.length > 1).length} groups`,
  );
  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
