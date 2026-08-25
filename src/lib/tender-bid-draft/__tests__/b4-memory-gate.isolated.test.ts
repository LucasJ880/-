/**
 * B4 — Bid Draft 记忆访问门：真实 DB 集成矩阵（隔离库）。
 * 运行（隔离库）：DATABASE_URL=... NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx <本文件>
 * 无隔离库自动跳过。B0 守卫先行验证目标（调用方负责用 db:target:check / 本地库）。
 *
 * 证明矩阵：
 *  - org_member 只见 PUBLIC_SOURCE/INTERNAL_COMPANY（CLIENT_CONFIDENTIAL/RESTRICTED 同 org 也不可见）
 *  - org_admin 见全部分级（但仍受 verification/claimType 业务收窄）
 *  - 跨 org / 伪造 orgId / 未知 user / 非活跃成员 → fail-closed 空集（绝不裸查回退）
 *  - SUPERSEDED、AI_EXTRACTED/NEEDS_REVIEW、COMPLIANCE_POSITION 均不进 prompt 输入
 *  - PRE/POST 对照：修复前的裸 findMany 形态在同一数据集上会把 CONFIDENTIAL 泄给任意调用者
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 B4 记忆访问门矩阵（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "B4 bid-draft memory gate matrix" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail) : ""); }
}

async function main() {
  const { db } = await import("@/lib/db");
  const { gatherVerifiedOrgMemoryClaims } = await import("../gather");
  const { searchMemoryClaims } = await import("@/lib/corporate-memory/retrieval");

  const stamp = "b4" + Date.now().toString(36);
  const ORG_A = `orgA_${stamp}`, ORG_B = `orgB_${stamp}`;
  const ADMIN_A = `uadminA_${stamp}`, MEMBER_A = `umemberA_${stamp}`, INACTIVE_A = `uinactiveA_${stamp}`, ADMIN_B = `uadminB_${stamp}`;

  for (const [id, name] of [[ADMIN_A, "AdminA"], [MEMBER_A, "MemberA"], [INACTIVE_A, "InactiveA"], [ADMIN_B, "AdminB"]] as const) {
    await db.user.create({ data: { id, email: `${id}@f.test`, name, role: "user" } });
  }
  await db.organization.create({ data: { id: ORG_A, name: "B4 Org A", code: `b4a-${stamp}`, ownerId: ADMIN_A } });
  await db.organization.create({ data: { id: ORG_B, name: "B4 Org B", code: `b4b-${stamp}`, ownerId: ADMIN_B } });
  await db.organizationMember.createMany({
    data: [
      { orgId: ORG_A, userId: ADMIN_A, role: "org_admin", status: "active" },
      { orgId: ORG_A, userId: MEMBER_A, role: "org_member", status: "active" },
      { orgId: ORG_A, userId: INACTIVE_A, role: "org_member", status: "inactive" },
      { orgId: ORG_B, userId: ADMIN_B, role: "org_admin", status: "active" },
    ],
  });

  const T0 = new Date("2026-08-01T00:00:00Z");
  const claim = (orgId: string, over: Record<string, unknown>) => ({
    orgId,
    subjectType: "BUYER",
    subjectKey: `buyer_${stamp}`,
    claimType: "BUYER_POLICY",
    claimNature: "FACT",
    confidence: "HIGH",
    verificationStatus: "HUMAN_CONFIRMED",
    sourceType: "TENDER_DOCUMENT",
    capturedAt: T0,
    createdByType: "user",
    createdById: ADMIN_A,
    ...over,
  });
  await db.memoryClaim.createMany({
    data: [
      claim(ORG_A, { statement: `A-INT-${stamp}`, accessClass: "INTERNAL_COMPANY" }),
      claim(ORG_A, { statement: `A-PUB-${stamp}`, accessClass: "PUBLIC_SOURCE", sourceType: "PUBLIC_WEB" }),
      claim(ORG_A, { statement: `A-CONF-${stamp}`, accessClass: "CLIENT_CONFIDENTIAL", claimType: "PRICE_FACT" }),
      claim(ORG_A, { statement: `A-RESTRICTED-${stamp}`, accessClass: "RESTRICTED", verificationStatus: "SYSTEM_VERIFIED", sourceType: "PROJECT_RECORD" }),
      claim(ORG_A, { statement: `A-AI-${stamp}`, verificationStatus: "AI_EXTRACTED", claimNature: "INFERENCE", sourceType: "AI_DERIVED", createdByType: "system", createdById: null }),
      claim(ORG_A, { statement: `A-NEEDSREVIEW-${stamp}`, verificationStatus: "NEEDS_REVIEW" }),
      claim(ORG_A, { statement: `A-COMPLIANCE-${stamp}`, claimType: "COMPLIANCE_POSITION" }),
      claim(ORG_A, { statement: `A-SUPERSEDED-${stamp}`, status: "SUPERSEDED", supersededAt: T0 }),
      claim(ORG_A, { statement: `A-LONG-${stamp}-` + "长".repeat(400), accessClass: "INTERNAL_COMPANY" }),
      claim(ORG_B, { statement: `B-PUB-${stamp}`, accessClass: "PUBLIC_SOURCE", createdById: ADMIN_B }),
      claim(ORG_B, { statement: `B-CONF-${stamp}`, accessClass: "CLIENT_CONFIDENTIAL", createdById: ADMIN_B }),
    ],
  });
  const stmts = (rows: Array<{ statement: string }>) => rows.map((r) => r.statement.slice(0, 60));
  const has = (rows: Array<{ statement: string }>, tag: string) => rows.some((r) => r.statement.startsWith(`${tag}-${stamp}`));

  // ── 1) org_admin：全分级可见，但 verification/claimType 业务收窄仍生效 ──
  {
    const rows = await gatherVerifiedOrgMemoryClaims(ORG_A, ADMIN_A);
    ok(has(rows, "A-INT") && has(rows, "A-PUB"), "admin 可见 INTERNAL/PUBLIC 已验证事实", stmts(rows));
    ok(has(rows, "A-CONF") && has(rows, "A-RESTRICTED"), "admin 可见 CONFIDENTIAL/RESTRICTED（canonical 角色裁定，非 Tender 复制策略）");
    ok(!has(rows, "A-AI") && !has(rows, "A-NEEDSREVIEW"), "AI_EXTRACTED/NEEDS_REVIEW 不进 VERIFIED ORG FACTS（真相边界）");
    ok(!has(rows, "A-COMPLIANCE"), "COMPLIANCE_POSITION 不进草稿输入（业务排除保留）");
    ok(!has(rows, "A-SUPERSEDED"), "SUPERSEDED 不可见（canonical 默认仅 ACTIVE）");
    ok(!has(rows, "B-PUB") && !has(rows, "B-CONF"), "他 org claim 绝不混入（org 作用域）");
    const long = rows.find((r) => r.statement.startsWith(`A-LONG-${stamp}`));
    ok(!!long && long.statement.length <= 300, "statement 截断 ≤300 保留", long?.statement.length);
    ok(rows.every((r) => Object.keys(r).sort().join(",") === "claimType,statement,verificationStatus"), "输出投影仅 statement/claimType/verificationStatus（不泄 accessClass/id）");
  }

  // ── 2) org_member：同 org 也只见 PUBLIC_SOURCE/INTERNAL_COMPANY ──
  {
    const rows = await gatherVerifiedOrgMemoryClaims(ORG_A, MEMBER_A);
    ok(has(rows, "A-INT") && has(rows, "A-PUB"), "member 可见 INTERNAL/PUBLIC 已验证事实");
    ok(!has(rows, "A-CONF") && !has(rows, "A-RESTRICTED"), "member 不可见 CONFIDENTIAL/RESTRICTED（同 org 受限证明——修复核心）", stmts(rows));
  }

  // ── 3) fail-closed：跨 org / 伪造 org / 未知 user / 非活跃成员 → 空集 ──
  {
    ok((await gatherVerifiedOrgMemoryClaims(ORG_B, ADMIN_A)).length === 0, "跨 org（A 管理员 × B org）→ 空集（即使 B 有 HUMAN_CONFIRMED PUBLIC claim）");
    ok((await gatherVerifiedOrgMemoryClaims(`forged_${stamp}`, ADMIN_A)).length === 0, "伪造 orgId → 空集");
    ok((await gatherVerifiedOrgMemoryClaims(ORG_A, `ghost_${stamp}`)).length === 0, "未知 userId → 空集");
    ok((await gatherVerifiedOrgMemoryClaims(ORG_A, INACTIVE_A)).length === 0, "非活跃成员 → 空集");
    ok((await gatherVerifiedOrgMemoryClaims(null, ADMIN_A)).length === 0, "orgId=null → 空集（个人工作区无企业记忆）");
    ok((await gatherVerifiedOrgMemoryClaims(ORG_A, "")).length === 0, "userId 空串 → 空集");
  }

  // ── 4) 门本身的裁定语义（与业务收窄分层）：member 经 canonical 门可见 AI_EXTRACTED，
  //       说明 verification 过滤是 gather 的业务收窄、访问分级是门的职责——不混层 ──
  {
    const viaGate = await searchMemoryClaims({ orgId: ORG_A, actor: { userId: MEMBER_A }, limit: 100 });
    ok(viaGate.every((r) => r.accessClass === "PUBLIC_SOURCE" || r.accessClass === "INTERNAL_COMPANY"),
      "门层：member 结果 accessClass ⊆ {PUBLIC_SOURCE, INTERNAL_COMPANY}", viaGate.map((r) => r.accessClass));
    ok(viaGate.some((r) => r.verificationStatus === "AI_EXTRACTED"),
      "门层不做 verification 收窄（业务过滤在 gather 投影后，职责分离）");
    let crossErr: { name?: string; code?: string } | null = null;
    try { await searchMemoryClaims({ orgId: ORG_B, actor: { userId: ADMIN_A } }); } catch (e) { crossErr = e as { name?: string; code?: string }; }
    // 按 name+code 判定而非 instanceof：tsx 双注册模块图会破坏 instanceof
    ok(crossErr?.name === "CorporateMemoryError" && crossErr?.code === "MEMORY_READ_FORBIDDEN",
      "门层：跨 org 抛 MEMORY_READ_FORBIDDEN（gather 将其吞为 fail-closed 空集）", crossErr && { name: crossErr.name, code: crossErr.code });
  }

  // ── 5) PRE/POST 对照：修复前 gather 的裸查询形态在同一数据集上的行为 ──
  //       （形态复刻自 60125e38^ 的 gather.ts:108-114；仅存在于本测试作为回归对照）
  {
    const legacy = await db.memoryClaim.findMany({
      where: {
        orgId: ORG_A,
        status: "ACTIVE",
        verificationStatus: { in: ["HUMAN_CONFIRMED", "SYSTEM_VERIFIED"] },
        claimType: { not: "COMPLIANCE_POSITION" },
      },
      orderBy: { capturedAt: "desc" },
      take: 40,
      select: { statement: true, claimType: true, verificationStatus: true },
    });
    ok(has(legacy, "A-CONF") && has(legacy, "A-RESTRICTED"),
      "PRE（裸查询形态）：CONFIDENTIAL/RESTRICTED 无条件返回——principal 根本未参与（漏洞证明）");
    const postAsMember = await gatherVerifiedOrgMemoryClaims(ORG_A, MEMBER_A);
    ok(!has(postAsMember, "A-CONF") && !has(postAsMember, "A-RESTRICTED"),
      "POST（canonical 门）：同数据集下 member 不再获得 CONFIDENTIAL/RESTRICTED");
  }

  // 清理
  await db.memoryClaim.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
  await db.organizationMember.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
  await db.organization.deleteMany({ where: { id: { in: [ORG_A, ORG_B] } } });
  await db.user.deleteMany({ where: { id: { in: [ADMIN_A, MEMBER_A, INACTIVE_A, ADMIN_B] } } });

  console.log(`\nB4 记忆访问门 DB 矩阵 结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("B4 隔离矩阵异常退出:", e);
  process.exit(1);
});
