/**
 * 为窗饰行业包（Sunny）企业的 modulesJson 显式补上 "window_covering" 模块。
 *
 * 背景：报价/工艺单/驾驶舱/库存等窗饰专属导航改为按 window_covering 模块门控，
 * 运行时已有行业包回退（withIndustryPackModules）兜底，本脚本把配置落到 DB，
 * 让数据与语义一致、不依赖回退。
 *
 * 默认 dry-run 只打印将发生的变更：
 *   npx tsx scripts/enable-window-covering-module.ts
 * 确认后写库：
 *   npx tsx scripts/enable-window-covering-module.ts --write
 */

import { PrismaClient } from "@prisma/client";
import { parseOrgModulesJson } from "../src/lib/tenancy/modules";

const WRITE = process.argv.includes("--write");
const db = new PrismaClient();

async function main() {
  const orgs = await db.organization.findMany({
    select: { id: true, name: true, industryPackId: true, modulesJson: true },
    orderBy: { createdAt: "asc" },
  });

  let toPatch = 0;
  for (const org of orgs) {
    const modules = parseOrgModulesJson(org.modulesJson);
    const isWindowPack = org.industryPackId === "window_covering_services_v1";
    const tag = `${org.name} (${org.id}) pack=${org.industryPackId ?? "无"}`;

    if (!isWindowPack) {
      const leaked = modules?.enabled.includes("window_covering");
      console.log(
        leaked
          ? `⚠ 非窗饰企业却启用了 window_covering，请人工确认: ${tag}`
          : `— 跳过（非窗饰行业包）: ${tag}`,
      );
      continue;
    }

    if (!modules || modules.enabled.length === 0) {
      // 空配置 = 导航 fail-closed，本脚本不替它做模块决策
      console.log(`— 跳过（modulesJson 为空，维持 fail-closed）: ${tag}`);
      continue;
    }

    if (modules.enabled.includes("window_covering")) {
      console.log(`✓ 已含 window_covering: ${tag}`);
      continue;
    }

    toPatch += 1;
    const next = { enabled: [...modules.enabled, "window_covering"] };
    if (WRITE) {
      await db.organization.update({
        where: { id: org.id },
        data: { modulesJson: next },
      });
      console.log(`✏ 已写入 window_covering: ${tag}`);
    } else {
      console.log(`→ 将补上 window_covering: ${tag}`);
      console.log(`    enabled: ${JSON.stringify(next.enabled)}`);
    }
  }

  console.log(
    WRITE
      ? `\n完成：写入 ${toPatch} 个企业。`
      : `\ndry-run：${toPatch} 个企业待写入。确认无误后加 --write 执行。`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
