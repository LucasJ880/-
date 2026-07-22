/**
 * 一次性：轮换指定企业的行折扣解锁码哈希。
 *
 * 用法：
 *   npx tsx scripts/rotate-org-unlock-code.ts \
 *     --org mengxin-home-textile \
 *     --env MENGXIN_LINE_DISCOUNT_UNLOCK_CODE
 *
 *   npx tsx scripts/rotate-org-unlock-code.ts \
 *     --org sunny-home-deco \
 *     --env SUNNY_LINE_DISCOUNT_UNLOCK_CODE \
 *     --dry-run
 *
 * 约束：
 * - 必须显式传入 --org（企业 code），禁止默认更新全部企业
 * - 新密钥只从环境变量读取，禁止命令行明文
 * - 只写 bcrypt hash；日志不打印明文或 hash
 * - 不走 seed（seed 会 kept_existing）
 * - 审计仅记录「轮换成功」
 */

import { db } from "@/lib/db";
import { hashUnlockCode } from "@/lib/blinds/unlock-code";
import { logAudit } from "@/lib/audit/logger";

function usage(): never {
  console.error(`用法:
  npx tsx scripts/rotate-org-unlock-code.ts --org <org-code> --env <ENV_VAR_NAME> [--dry-run]

示例:
  npx tsx scripts/rotate-org-unlock-code.ts --org mengxin-home-textile --env MENGXIN_LINE_DISCOUNT_UNLOCK_CODE
`);
  process.exit(1);
}

function parseArgs(argv: string[]) {
  let orgCode: string | null = null;
  let envName: string | null = null;
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--org") {
      orgCode = argv[++i] ?? null;
    } else if (a === "--env") {
      envName = argv[++i] ?? null;
    } else if (a === "--dry-run") {
      dryRun = true;
    } else if (a === "--help" || a === "-h") {
      usage();
    } else {
      console.error(`未知参数: ${a}`);
      usage();
    }
  }

  if (!orgCode?.trim()) {
    console.error("错误: 必须显式传入 --org <org-code>，禁止默认更新全部企业");
    usage();
  }
  if (!envName?.trim()) {
    console.error("错误: 必须传入 --env <ENV_VAR_NAME>（从环境变量读取新密钥）");
    usage();
  }
  if (!/^[A-Z][A-Z0-9_]*$/.test(envName!)) {
    console.error("错误: --env 必须是合法环境变量名（大写字母/数字/下划线）");
    process.exit(1);
  }

  return { orgCode: orgCode!.trim(), envName: envName!.trim(), dryRun };
}

async function main() {
  const { orgCode, envName, dryRun } = parseArgs(process.argv.slice(2));

  const plain = process.env[envName]?.trim() ?? "";
  if (!plain) {
    console.error(`错误: 环境变量 ${envName} 未设置或为空；拒绝从命令行读取明文`);
    process.exit(1);
  }
  if (plain.length < 8 || plain.length > 64) {
    console.error(`错误: ${envName} 长度需为 8~64 个字符`);
    process.exit(1);
  }

  const org = await db.organization.findUnique({
    where: { code: orgCode },
    select: { id: true, code: true, name: true, ownerId: true },
  });
  if (!org) {
    console.error(`错误: 找不到企业 code=${orgCode}`);
    process.exit(1);
  }

  const existing = await db.quoteDiscountSettings.findUnique({
    where: { orgId: org.id },
    select: {
      id: true,
      lineDiscountUnlockCodeHash: true,
      updatedAt: true,
      updatedBy: true,
    },
  });

  console.log(
    JSON.stringify({
      orgCode: org.code,
      orgName: org.name,
      orgId: org.id,
      envVar: envName,
      dryRun,
      hasExistingHash: Boolean(existing?.lineDiscountUnlockCodeHash),
      previousUpdatedAt: existing?.updatedAt?.toISOString() ?? null,
    }),
  );

  if (dryRun) {
    console.log(JSON.stringify({ result: "dry_run_ok", message: "将轮换该企业解锁码哈希（未写入）" }));
    return;
  }

  const nextHash = await hashUnlockCode(plain);
  const actorId = org.ownerId;
  const now = new Date();

  if (existing) {
    await db.quoteDiscountSettings.update({
      where: { orgId: org.id },
      data: {
        lineDiscountUnlockCodeHash: nextHash,
        updatedBy: actorId,
        updatedAt: now,
        version: { increment: 1 },
      },
    });
  } else {
    await db.quoteDiscountSettings.create({
      data: {
        orgId: org.id,
        version: 1,
        effectiveAt: now,
        lineDiscountUnlockCodeHash: nextHash,
        updatedBy: actorId,
        updatedAt: now,
      },
    });
  }

  await logAudit({
    userId: actorId,
    orgId: org.id,
    action: "update",
    targetType: "quote_discount_settings",
    targetId: existing?.id ?? org.id,
    // 仅记录轮换成功，不含明文/哈希
    afterData: { event: "unlock_code_rotated", result: "轮换成功" },
  });

  const after = await db.quoteDiscountSettings.findUnique({
    where: { orgId: org.id },
    select: { updatedAt: true, version: true },
  });

  console.log(
    JSON.stringify({
      result: "rotated",
      orgCode: org.code,
      updatedAt: after?.updatedAt?.toISOString() ?? now.toISOString(),
      version: after?.version ?? null,
      message: "轮换成功",
    }),
  );
}

main()
  .catch((e) => {
    console.error("rotate-org-unlock-code failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
