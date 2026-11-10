#!/usr/bin/env tsx
/**
 * VIS-1c：发信文案回填脚本（spec settings/sender-copy「发信文案回填脚本」）
 *
 * 用法：
 *   ALLOW_SENDER_COPY_UPDATE=true npx tsx scripts/set-org-sender-copy.ts \
 *     --org <企业 code> --mode <platform_relay|clear> --actor <平台管理员邮箱> [--dry-run]
 *
 * 只改 Organization.settingsJson.ui.senderCopy，保留其他键；写库时记一条审计（organization.settings.sender_copy）。
 * 退出码：0 成功 / 1 拒绝（未显式允许、执行者不是平台管理员）/ 2 输入错误（参数、找不到企业）
 * 不打印连接串 / 密码哈希 / token。
 */

import type { Prisma } from "@prisma/client";
import { SENDER_COPY_PLATFORM_RELAY, readSenderCopy, withSenderCopy } from "@/lib/settings/sender-copy";

const USAGE =
  "用法：ALLOW_SENDER_COPY_UPDATE=true npx tsx scripts/set-org-sender-copy.ts --org <企业 code> --mode <platform_relay|clear> --actor <平台管理员邮箱> [--dry-run]";

const AUDIT_ACTION = "organization.settings.sender_copy";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return null;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : null;
}

async function main(): Promise<number> {
  const orgCode = arg("org");
  const mode = arg("mode");
  const actorEmail = arg("actor");
  const dryRun = process.argv.includes("--dry-run");

  if (!orgCode || !mode || !actorEmail) {
    console.error("[set-org-sender-copy] 缺少必选参数");
    console.error(USAGE);
    return 2;
  }
  if (mode !== SENDER_COPY_PLATFORM_RELAY && mode !== "clear") {
    console.error(`[set-org-sender-copy] 未知模式：${mode}`);
    console.error(USAGE);
    return 2;
  }
  // 含 --dry-run：没有显式开关就不连库、不读企业设置
  if (process.env.ALLOW_SENDER_COPY_UPDATE !== "true") {
    console.error("[set-org-sender-copy] 拒绝：需要显式 ALLOW_SENDER_COPY_UPDATE=true");
    return 1;
  }

  // 到这里才连库（前面的拒绝路径不需要 DATABASE_URL）
  const { db } = await import("@/lib/db");
  const { writeAuditLog } = await import("@/lib/audit/logger");

  const actor = await db.user.findUnique({
    where: { email: actorEmail.toLowerCase() },
    select: { id: true, role: true, email: true },
  });
  if (!actor || actor.role !== "super_admin") {
    console.error("[set-org-sender-copy] 拒绝：执行者必须是平台管理员（super_admin）");
    return 1;
  }

  const org = await db.organization.findUnique({
    where: { code: orgCode },
    select: { id: true, code: true, name: true, settingsJson: true },
  });
  if (!org) {
    console.error(`[set-org-sender-copy] 找不到企业 code=${orgCode}`);
    return 2;
  }

  const before = readSenderCopy(org.settingsJson);
  const nextSettings = withSenderCopy(org.settingsJson, mode);
  const after = readSenderCopy(nextSettings);
  console.log(
    `[set-org-sender-copy] 企业 ${org.code}（${org.name}）执行者 ${actor.email}：ui.senderCopy ${before ?? "（未设置）"} → ${after ?? "（未设置）"}${dryRun ? "（dry-run，不写库）" : ""}`,
  );
  if (dryRun) return 0;
  if (before === after) {
    console.log("[set-org-sender-copy] 无变化，不写库");
    return 0;
  }

  await db.$transaction(async (tx) => {
    await tx.organization.update({
      where: { id: org.id },
      data: { settingsJson: nextSettings as Prisma.InputJsonValue },
    });
    await writeAuditLog(tx, {
      userId: actor.id,
      orgId: org.id,
      action: AUDIT_ACTION,
      targetType: "organization",
      targetId: org.id,
      beforeData: { senderCopy: before },
      afterData: { senderCopy: after, via: "scripts/set-org-sender-copy.ts" },
    });
  });
  console.log("[set-org-sender-copy] 完成");
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error("[set-org-sender-copy] 失败：", e instanceof Error ? e.message : String(e));
    process.exit(2);
  });
