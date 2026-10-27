#!/usr/bin/env tsx
/**
 * PERM-1：岗位绑定脚本（人 → 岗位，唯一写入口）
 *
 * 用法：
 *   ALLOW_POSITION_BINDING=true npx tsx scripts/bind-positions.ts \
 *     --org <企业 code> --file <绑定文件.json> --actor <平台管理员邮箱> [--prune] [--dry-run]
 *
 * 退出码：0 成功 / 1 拒绝（未显式允许、执行者不是平台管理员）/ 2 输入错误（参数、文件、占位、未知岗位、非成员）
 * 绑定文件：{ "bindings": { "<email>": ["owner", "bids"], ... } }；邮箱写 "TODO:<姓名>" 表示未填，整文件拒绝。
 * 不打印连接串 / 密码哈希 / token。
 */

import { readFileSync } from "node:fs";
import {
  parseBindingFile,
  planBindingDiff,
  summarizePlan,
  validateBindings,
} from "@/lib/authorization/position-binding";
import { profilesForIndustryPack } from "@/lib/authorization/role-defaults";

const USAGE = [
  "用法：ALLOW_POSITION_BINDING=true npx tsx scripts/bind-positions.ts --org <企业 code> --file <绑定文件.json> --actor <平台管理员邮箱> [--prune] [--dry-run]",
  "  --org     企业 code（Organization.code）",
  "  --file    绑定文件：{ \"bindings\": { \"<email>\": [\"owner\", ...] } }",
  "  --actor   执行者邮箱，必须是平台 super_admin",
  "  --prune   停用该人身上行业包岗位集内未在文件列出的绑定（系统模板绑定不动）",
  "  --dry-run 只打印差异计划，不写库",
].join("\n");

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return null;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : null;
}

async function main(): Promise<number> {
  const orgCode = arg("org");
  const file = arg("file");
  const actorEmail = arg("actor");
  const prune = process.argv.includes("--prune");
  const dryRun = process.argv.includes("--dry-run");

  if (!orgCode || !file || !actorEmail) {
    console.error("[bind-positions] 缺少必选参数");
    console.error(USAGE);
    return 2;
  }
  if (process.env.ALLOW_POSITION_BINDING !== "true") {
    console.error("[bind-positions] 拒绝：需要显式 ALLOW_POSITION_BINDING=true");
    return 1;
  }

  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    console.error(`[bind-positions] 读不到绑定文件：${file}`);
    return 2;
  }
  const parsed = parseBindingFile(text);
  if (!parsed.ok) {
    console.error("[bind-positions] 绑定文件错误：");
    for (const e of parsed.errors) console.error(`  - ${e}`);
    return 2;
  }

  // 到这里才连库（前面的拒绝路径不需要 DATABASE_URL）
  const { db } = await import("@/lib/db");
  const { logAuthorizationChange } = await import("@/lib/authorization/audit");

  const actor = await db.user.findUnique({
    where: { email: actorEmail.toLowerCase() },
    select: { id: true, role: true, email: true },
  });
  if (!actor || actor.role !== "super_admin") {
    console.error("[bind-positions] 拒绝：执行者必须是平台管理员（super_admin）");
    return 1;
  }

  const org = await db.organization.findUnique({
    where: { code: orgCode },
    select: { id: true, code: true, name: true, industryPackId: true },
  });
  if (!org) {
    console.error(`[bind-positions] 找不到企业 code=${orgCode}`);
    return 2;
  }

  const [profiles, memberRows, existingRows] = await Promise.all([
    db.roleProfile.findMany({
      where: { orgId: org.id, status: "active" },
      select: { id: true, key: true },
    }),
    db.organizationMember.findMany({
      where: { orgId: org.id },
      select: { userId: true, status: true, user: { select: { email: true } } },
    }),
    db.principalRoleBinding.findMany({
      where: { orgId: org.id, principalType: "HUMAN" },
      select: { id: true, principalId: true, status: true, roleProfile: { select: { key: true } } },
    }),
  ]);

  const profileIdByKey = new Map(profiles.map((p) => [p.key, p.id]));
  const membersByEmail: Record<string, { userId: string; status: string }> = {};
  for (const m of memberRows) {
    if (m.user.email) membersByEmail[m.user.email.toLowerCase()] = { userId: m.userId, status: m.status };
  }

  const validated = validateBindings({
    file: parsed.value,
    knownProfileKeys: [...profileIdByKey.keys()],
    membersByEmail,
  });
  if (!validated.ok) {
    console.error("[bind-positions] 校验失败，未写入：");
    for (const e of validated.errors) console.error(`  - ${e}`);
    return 2;
  }

  const plan = planBindingDiff({
    desired: validated.resolved,
    existing: existingRows.map((r) => ({ userId: r.principalId, profileKey: r.roleProfile.key, status: r.status })),
    prune,
    prunableKeys: profilesForIndustryPack(org.industryPackId).map((p) => p.key),
  });
  const summary = summarizePlan(plan);

  console.log(`[bind-positions] 企业 ${org.code}（${org.name}）执行者 ${actor.email}${dryRun ? "（dry-run）" : ""}`);
  for (const line of summary.lines) console.log(`  ${line}`);
  console.log(`  新增 ${summary.created}，已存在 ${plan.keep.length}，停用 ${summary.deactivated}`);
  if (dryRun) return 0;

  for (const c of plan.create) {
    const roleProfileId = profileIdByKey.get(c.profileKey)!;
    const inactive = existingRows.find(
      (r) => r.principalId === c.userId && r.roleProfile.key === c.profileKey && r.status !== "active",
    );
    if (inactive) {
      await db.principalRoleBinding.update({ where: { id: inactive.id }, data: { status: "active" } });
    } else {
      await db.principalRoleBinding.create({
        data: { orgId: org.id, principalType: "HUMAN", principalId: c.userId, roleProfileId, status: "active" },
      });
    }
    await logAuthorizationChange({
      actorUserId: actor.id,
      orgId: org.id,
      action: "authorization.position.bind",
      targetType: "principal_role_binding",
      targetPrincipalId: c.userId,
      after: { email: c.email, profileKey: c.profileKey, via: "scripts/bind-positions.ts" },
    });
  }
  for (const d of plan.deactivate) {
    const row = existingRows.find(
      (r) => r.principalId === d.userId && r.roleProfile.key === d.profileKey && r.status === "active",
    );
    if (!row) continue;
    await db.principalRoleBinding.update({ where: { id: row.id }, data: { status: "inactive" } });
    await logAuthorizationChange({
      actorUserId: actor.id,
      orgId: org.id,
      action: "authorization.position.unbind",
      targetType: "principal_role_binding",
      targetPrincipalId: d.userId,
      before: { email: d.email, profileKey: d.profileKey },
      after: { status: "inactive", via: "scripts/bind-positions.ts" },
    });
  }
  console.log("[bind-positions] 完成");
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error("[bind-positions] 失败：", e instanceof Error ? e.message : String(e));
    process.exit(2);
  });
