#!/usr/bin/env tsx
/**
 * PERM-4c3：平台角色压扁脚本（岗位模式企业：boss / manager / operations / sales → user）
 *
 * 用法：
 *   ALLOW_ROLE_COLLAPSE=true npx tsx scripts/collapse-platform-roles.ts \
 *     --org <企业 code> --actor <平台管理员邮箱> [--dry-run] [--restore]
 *
 * 退出码：0 成功 / 1 拒绝（未显式允许、执行者不是平台管理员、写库闸门关闭）/ 2 输入或前置校验错误
 * 写库闸门 PLATFORM_ROLE_COLLAPSE_READY 关闭时只允许 --dry-run 与 --restore
 *（残留平台角色读点见 docs/QINGYAN_PERM-4c3_RESIDUAL_ROLE_READS.md）。
 * --restore 按审计记录把本企业被压扁、当前仍是 user 的人还原；可与 --dry-run 合用只看计划。
 * 不打印连接串 / 密码哈希 / token。
 */

import { PLATFORM_ROLE_COLLAPSE_READY } from "@/lib/authorization/platform-role-collapse";

const USAGE = [
  "用法：ALLOW_ROLE_COLLAPSE=true npx tsx scripts/collapse-platform-roles.ts --org <企业 code> --actor <平台管理员邮箱> [--dry-run] [--restore]",
  "  --org      企业 code（Organization.code），必须是岗位模式企业",
  "  --actor    执行者邮箱，必须是平台 super_admin",
  "  --dry-run  只打印计划与前置校验，不写库",
  "  --restore  按审计记录还原本企业被压扁的人（不受写库闸门限制）",
].join("\n");

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return null;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : null;
}

async function main(): Promise<number> {
  const orgCode = arg("org");
  const actorEmail = arg("actor");
  if (!orgCode || !actorEmail) {
    console.error("[collapse-platform-roles] 缺少必选参数");
    console.error(USAGE);
    return 2;
  }
  if (process.env.ALLOW_ROLE_COLLAPSE !== "true") {
    console.error("[collapse-platform-roles] 拒绝：需要显式 ALLOW_ROLE_COLLAPSE=true");
    return 1;
  }

  // 到这里才连库（前面的拒绝路径不需要 DATABASE_URL）
  const { runPlatformRoleCollapse } = await import("@/lib/authorization/platform-role-collapse-run");
  const result = await runPlatformRoleCollapse({
    orgCode,
    actorEmail,
    dryRun: process.argv.includes("--dry-run"),
    restore: process.argv.includes("--restore"),
    ready: PLATFORM_ROLE_COLLAPSE_READY,
  });
  const out = result.exitCode === 0 ? console.log : console.error;
  for (const line of result.lines) out(`[collapse-platform-roles] ${line}`);
  return result.exitCode;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error("[collapse-platform-roles] 失败：", e instanceof Error ? e.message : String(e));
    process.exit(2);
  });
