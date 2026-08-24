/**
 * Mention Gateway M2-A — ExternalIdentity DB 集成测试（隔离库专用）
 * 运行：DATABASE_URL=<隔离库> DIRECT_URL=<同> NODE_ENV=test npx tsx src/lib/mention-gateway/__tests__/m2a-identity-db.isolated.test.ts
 *
 * 安全红线：guard-first —— 顶层不 import "@/lib/db"；先过统一 Production DB Test Guard
 * （assertSafeTestDatabase，fail-closed），未配置 DATABASE_URL 则按约定 skip（exit 0）。
 *
 * 覆盖：唯一键 / CHECK 约束 / 级联删除 / provision+audit 原子性 / 生命周期
 * （verify / relink / disable / enable / revoke）/ 跨租户 IDOR / ownership 真网关 /
 * legacy 回填脚本（dry-run → write → 幂等 → Attack C 不接管）。
 */

import { execFileSync } from "node:child_process";
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function requireIsolatedTestDb(): void {
  if (!process.env.DATABASE_URL?.trim()) {
    console.log("⏭  跳过 Mention M2-A DB 测试（未提供 DATABASE_URL）");
    process.exit(0);
  }
  assertSafeTestDatabase({ scriptName: "mention-gateway m2a identity db test" });
  if (process.env.NODE_ENV !== "test") {
    console.log("⏭  跳过 Mention M2-A DB 测试（需 NODE_ENV=test）");
    process.exit(0);
  }
}

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail !== undefined ? detail : "");
  }
}

const PLATFORM_ORG = "__qingyan_platform__";

async function main() {
  requireIsolatedTestDb();
  const { db } = await import("@/lib/db");
  const svc = await import("../identity-service");
  const { AUDIT_ACTIONS } = await import("@/lib/audit/logger");

  const tag = `m2a_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const mkUser = (label: string, role = "sales", status = "active") =>
    db.user.create({
      data: { email: `${label}_${tag}@test.qingyan.local`, name: label, role, status },
    });

  const [adminA, memberA, memberA2, plainA, adminB, outsider] = await Promise.all([
    mkUser("m2a_admin_a"),
    mkUser("m2a_member_a"),
    mkUser("m2a_member_a2"),
    mkUser("m2a_plain_a"),
    mkUser("m2a_admin_b"),
    mkUser("m2a_outsider"),
  ]);
  const orgA = await db.organization.create({
    data: { name: `M2A Org A ${tag}`, code: `m2a_a_${tag}`, ownerId: adminA.id, status: "active" },
  });
  const orgB = await db.organization.create({
    data: { name: `M2A Org B ${tag}`, code: `m2a_b_${tag}`, ownerId: adminB.id, status: "active" },
  });
  await db.organizationMember.createMany({
    data: [
      { orgId: orgA.id, userId: adminA.id, role: "org_admin", status: "active" },
      { orgId: orgA.id, userId: memberA.id, role: "org_member", status: "active" },
      { orgId: orgA.id, userId: memberA2.id, role: "org_member", status: "active" },
      { orgId: orgA.id, userId: plainA.id, role: "org_member", status: "active" },
      { orgId: orgB.id, userId: adminB.id, role: "org_admin", status: "active" },
    ],
  });
  const gwPersonalA = await db.weChatGateway.create({
    data: { orgId: orgA.id, channel: "personal_wechat", status: "active" },
  });
  await db.weChatGateway.create({
    data: { orgId: orgA.id, channel: "wecom", corpId: `corp_a_${tag}`, status: "active" },
  });
  await db.weChatGateway.create({
    data: { orgId: PLATFORM_ORG, channel: "wecom", corpId: `corp_shared_${tag}`, status: "active" },
  });
  const callerAdminA = { userId: adminA.id, role: adminA.role };
  const callerAdminB = { userId: adminB.id, role: adminB.role };

  const auditCount = (action: string, targetId: string) =>
    db.auditLog.count({ where: { action, targetId } });

  console.log("DB-1 唯一键 (provider, providerTenantId, providerUserId)");
  {
    const data = {
      provider: "personal_wechat",
      providerTenantId: gwPersonalA.id,
      providerUserId: `wx_dup_${tag}`,
      userId: memberA.id,
    };
    const row = await db.externalIdentity.create({ data });
    let p2002 = false;
    try {
      await db.externalIdentity.create({ data: { ...data, userId: memberA2.id } });
    } catch (e) {
      p2002 = (e as { code?: string })?.code === "P2002";
    }
    ok(p2002, "重复三元组 → P2002（不同 userId 也不放行）");
    const cnt = await db.externalIdentity.count({
      where: { providerUserId: data.providerUserId },
    });
    ok(cnt === 1, "仍只有 1 行，userId 未被改写");
    await db.externalIdentity.delete({ where: { id: row.id } });
  }

  console.log("DB-2 CHECK 约束：非法 status / verificationMethod 被 DB 拒绝");
  {
    const rawInsert = (id: string, status: string, method: string | null) =>
      db.$executeRawUnsafe(
        `INSERT INTO "ExternalIdentity" ("id","provider","providerTenantId","providerUserId","userId","status","verificationMethod","updatedAt") VALUES ($1,'mock','mock',$2,$3,$4,$5,NOW())`,
        id,
        `chk_${id}`,
        memberA.id,
        status,
        method,
      );
    let statusRejected = false;
    try {
      await rawInsert(`chk_status_${tag}`, "HACKED", null);
    } catch (e) {
      statusRejected = String(e).includes("ExternalIdentity_status_check");
    }
    ok(statusRejected, `status='HACKED' → ExternalIdentity_status_check 拒绝`);
    let methodRejected = false;
    try {
      await rawInsert(`chk_method_${tag}`, "ACTIVE", "SELF_LINK");
    } catch (e) {
      methodRejected = String(e).includes("ExternalIdentity_verification_method_check");
    }
    ok(methodRejected, `verificationMethod='SELF_LINK' → verification_method_check 拒绝`);
    const okInsert = await rawInsert(`chk_ok_${tag}`, "PENDING", "LEGACY_SELF_ASSERTED");
    ok(okInsert === 1, "合法值原样接受");
    await db.externalIdentity.deleteMany({ where: { id: `chk_ok_${tag}` } });
  }

  console.log("DB-3 User 级联删除：删用户 → 身份行随之删除");
  {
    const ephemeral = await mkUser("m2a_cascade");
    await db.externalIdentity.create({
      data: {
        provider: "mock",
        providerTenantId: "mock",
        providerUserId: `cascade_${tag}`,
        userId: ephemeral.id,
        status: "PENDING",
      },
    });
    await db.user.delete({ where: { id: ephemeral.id } });
    const left = await db.externalIdentity.count({ where: { userId: ephemeral.id } });
    ok(left === 0, "onDelete: Cascade 生效");
  }

  console.log("DB-4 adminProvisionIdentity：OWNED → ACTIVE/ADMIN_PROVISIONED + 审计（原子）");
  const pwKey = {
    provider: "personal_wechat",
    providerTenantId: gwPersonalA.id,
    providerUserId: `wx_member_a_${tag}`,
  };
  let provisionedId = "";
  {
    const r = await svc.adminProvisionIdentity({
      caller: callerAdminA,
      managementOrgId: orgA.id,
      ...pwKey,
      targetUserId: memberA.id,
    });
    ok(r.ok && r.outcome === "CREATE", "创建成功（outcome=CREATE）", r);
    if (r.ok) {
      provisionedId = r.identity.id;
      ok(r.identity.status === "ACTIVE" && r.identity.verificationMethod === "ADMIN_PROVISIONED", "ACTIVE + ADMIN_PROVISIONED");
      ok(r.identity.verifiedById === adminA.id && r.identity.linkedById === adminA.id, "verifiedById/linkedById = 操作管理员");
      const audits = await db.auditLog.findMany({
        where: { action: AUDIT_ACTIONS.EXTERNAL_IDENTITY_PROVISION, targetId: r.identity.id },
      });
      ok(audits.length === 1 && audits[0].orgId === orgA.id, "审计行 external_identity_provision ×1（同事务）");
      const after = audits[0].afterData ?? "";
      ok(!after.includes(pwKey.providerUserId), "审计不含 raw providerUserId");
      ok(after.includes(svc.hashProviderUserId(pwKey.providerUserId)), "审计含 sha256 截断 hash");
    }
  }

  console.log("DB-5 provision 幂等：同键同用户重放 → IDEMPOTENT，无第二行/审计");
  {
    const r = await svc.adminProvisionIdentity({
      caller: callerAdminA,
      managementOrgId: orgA.id,
      ...pwKey,
      targetUserId: memberA.id,
    });
    ok(r.ok && r.outcome === "IDEMPOTENT", "outcome=IDEMPOTENT（无写）", r);
    ok((await auditCount(AUDIT_ACTIONS.EXTERNAL_IDENTITY_PROVISION, provisionedId)) === 1, "审计仍 ×1");
  }

  console.log("DB-6 Attack B takeover：同键指向他人 → IDENTITY_ALREADY_CLAIMED，映射不动");
  {
    const r = await svc.adminProvisionIdentity({
      caller: callerAdminA,
      managementOrgId: orgA.id,
      ...pwKey,
      targetUserId: memberA2.id,
    });
    ok(!r.ok && r.code === "IDENTITY_ALREADY_CLAIMED", "CONFLICT，不改写", r);
    const row = await db.externalIdentity.findUnique({ where: { id: provisionedId } });
    ok(row?.userId === memberA.id && row?.status === "ACTIVE", "受害者映射原样保留");
    ok(!r.ok && !JSON.stringify(r).includes(memberA.id), "错误响应不泄露 existing userId");
  }

  console.log("DB-7 Ownership fail-closed：UNPROVEN / 平台共享 corp / slack → 不产生任何行");
  {
    const before = await db.externalIdentity.count();
    const unknownGw = await svc.adminProvisionIdentity({
      caller: callerAdminA,
      managementOrgId: orgA.id,
      provider: "personal_wechat",
      providerTenantId: "gw_does_not_exist",
      providerUserId: `wx_x_${tag}`,
      targetUserId: memberA.id,
    });
    ok(!unknownGw.ok && unknownGw.code === "PROVIDER_TENANT_UNVERIFIED", "未知网关 id → PROVIDER_TENANT_UNVERIFIED");
    const platformCorp = await svc.adminProvisionIdentity({
      caller: callerAdminA,
      managementOrgId: orgA.id,
      provider: "wecom",
      providerTenantId: `corp_shared_${tag}`,
      providerUserId: `wc_x_${tag}`,
      targetUserId: memberA.id,
    });
    ok(!platformCorp.ok && platformCorp.code === "PROVIDER_TENANT_UNVERIFIED", "仅平台共享网关命中的 CorpID → 拒（不得猜 org）");
    const slack = await svc.adminProvisionIdentity({
      caller: callerAdminA,
      managementOrgId: orgA.id,
      provider: "slack",
      providerTenantId: "T123",
      providerUserId: `sl_x_${tag}`,
      targetUserId: memberA.id,
    });
    ok(!slack.ok && slack.code === "PROVIDER_TENANT_UNVERIFIED", "slack（UNSUPPORTED）→ 拒");
    ok((await db.externalIdentity.count()) === before, "三次拒绝均未创建行（含 PENDING 占位）");
  }

  console.log("DB-8 跨租户：org B 管理员借 org A 网关 / 管 org A 身份 → 全拒");
  {
    const steal = await svc.adminProvisionIdentity({
      caller: callerAdminB,
      managementOrgId: orgB.id,
      provider: "personal_wechat",
      providerTenantId: gwPersonalA.id,
      providerUserId: `wx_steal_${tag}`,
      targetUserId: adminB.id,
    });
    ok(!steal.ok && steal.code === "PROVIDER_TENANT_UNVERIFIED", "org A 网关 → org B MISMATCH 拒");
    const manage = await svc.disableIdentity({
      caller: callerAdminB,
      managementOrgId: orgB.id,
      identityId: provisionedId,
    });
    ok(!manage.ok && manage.code === "IDENTITY_NOT_FOUND", "org B 管 org A 身份 → 视同不存在（IDOR 404）");
    const list = await svc.listIdentitiesForAdmin({
      caller: callerAdminB,
      managementOrgId: orgB.id,
      targetUserId: memberA.id,
    });
    ok(!list.ok, "org B 管理员列 org A 成员身份 → 拒");
  }

  console.log("DB-9 授权：org_member 调写操作 → CALLER_FORBIDDEN；目标非本 org 成员 → TARGET_NOT_MEMBER");
  {
    const byPlain = await svc.adminProvisionIdentity({
      caller: { userId: plainA.id, role: plainA.role },
      managementOrgId: orgA.id,
      provider: "personal_wechat",
      providerTenantId: gwPersonalA.id,
      providerUserId: `wx_plain_${tag}`,
      targetUserId: memberA.id,
    });
    ok(!byPlain.ok && byPlain.code === "CALLER_FORBIDDEN", "org_member → CALLER_FORBIDDEN");
    const toOutsider = await svc.adminProvisionIdentity({
      caller: callerAdminA,
      managementOrgId: orgA.id,
      provider: "personal_wechat",
      providerTenantId: gwPersonalA.id,
      providerUserId: `wx_out_${tag}`,
      targetUserId: outsider.id,
    });
    ok(!toOutsider.ok && toOutsider.code === "TARGET_NOT_MEMBER", "目标无本 org membership → TARGET_NOT_MEMBER");
  }

  console.log("DB-10 verify：PENDING → ACTIVE（升级 LEGACY）+ 审计；REVOKED 不可 verify");
  let legacyId = "";
  {
    const legacy = await db.externalIdentity.create({
      data: {
        provider: "personal_wechat",
        providerTenantId: gwPersonalA.id,
        providerUserId: `wx_legacy_${tag}`,
        userId: memberA2.id,
        status: "PENDING",
        verificationMethod: "LEGACY_SELF_ASSERTED",
      },
    });
    legacyId = legacy.id;
    const r = await svc.verifyIdentity({
      caller: callerAdminA,
      managementOrgId: orgA.id,
      identityId: legacy.id,
    });
    ok(r.ok && r.identity.status === "ACTIVE" && r.identity.verificationMethod === "ADMIN_PROVISIONED", "PENDING/LEGACY → ACTIVE/ADMIN_PROVISIONED", r);
    ok((await auditCount(AUDIT_ACTIONS.EXTERNAL_IDENTITY_VERIFY, legacy.id)) === 1, "审计 external_identity_verify ×1");
    const again = await svc.verifyIdentity({
      caller: callerAdminA,
      managementOrgId: orgA.id,
      identityId: legacy.id,
    });
    ok(!again.ok && again.code === "INVALID_STATE", "已 ACTIVE/ADMIN → 再 verify 报 INVALID_STATE");
  }

  console.log("DB-11 disable / enable：状态机 + enable 前重验 ownership");
  {
    const d = await svc.disableIdentity({ caller: callerAdminA, managementOrgId: orgA.id, identityId: legacyId });
    ok(d.ok && d.identity.status === "DISABLED", "ACTIVE → DISABLED");
    await db.weChatGateway.update({ where: { id: gwPersonalA.id }, data: { status: "inactive" } });
    const eBlocked = await svc.enableIdentity({ caller: callerAdminA, managementOrgId: orgA.id, identityId: legacyId });
    ok(!eBlocked.ok && eBlocked.code === "PROVIDER_TENANT_UNVERIFIED", "网关失活 → enable 拒（重验 ownership）");
    await db.weChatGateway.update({ where: { id: gwPersonalA.id }, data: { status: "active" } });
    const e = await svc.enableIdentity({ caller: callerAdminA, managementOrgId: orgA.id, identityId: legacyId });
    ok(e.ok && e.identity.status === "ACTIVE", "网关恢复 → DISABLED → ACTIVE");
    ok((await auditCount(AUDIT_ACTIONS.EXTERNAL_IDENTITY_STATUS_CHANGE, legacyId)) === 2, "status_change 审计 ×2（disable+enable）");
  }

  console.log("DB-12 revoke 终态 + relink 显式恢复（Attack A 防线）");
  {
    const rv = await svc.revokeIdentity({
      caller: callerAdminA,
      managementOrgId: orgA.id,
      identityId: legacyId,
      reason: "test revoke",
    });
    ok(rv.ok && rv.identity.status === "REVOKED" && rv.identity.revokeReason === "test revoke", "admin revoke → REVOKED");
    const rvAgain = await svc.revokeIdentity({ caller: callerAdminA, managementOrgId: orgA.id, identityId: legacyId });
    ok(!rvAgain.ok && rvAgain.code === "INVALID_STATE", "重复 revoke → INVALID_STATE");
    const enableRevoked = await svc.enableIdentity({ caller: callerAdminA, managementOrgId: orgA.id, identityId: legacyId });
    ok(!enableRevoked.ok, "REVOKED 不可 enable");
    const provisionRevoked = await svc.adminProvisionIdentity({
      caller: callerAdminA,
      managementOrgId: orgA.id,
      provider: "personal_wechat",
      providerTenantId: gwPersonalA.id,
      providerUserId: `wx_legacy_${tag}`,
      targetUserId: memberA2.id,
    });
    ok(!provisionRevoked.ok && provisionRevoked.code === "INVALID_STATE", "REVOKED 键重 provision → 必须显式 relink");
    const rl = await svc.relinkIdentity({
      caller: callerAdminA,
      managementOrgId: orgA.id,
      identityId: legacyId,
      newUserId: memberA.id,
    });
    ok(rl.ok && rl.identity.userId === memberA.id && rl.identity.status === "ACTIVE", "relink → 新用户 ACTIVE");
    ok(rl.ok && rl.identity.revokedAt === null && rl.identity.revokeReason === null, "revoke 字段清空");
    ok((await auditCount(AUDIT_ACTIONS.EXTERNAL_IDENTITY_RELINK, legacyId)) === 1, "审计 external_identity_relink ×1");
  }

  console.log("DB-13 self-revoke IDOR：只能撤销自己的身份");
  {
    const notOwner = await svc.revokeIdentity({
      caller: { userId: memberA2.id, role: memberA2.role },
      managementOrgId: null,
      identityId: provisionedId,
    });
    ok(!notOwner.ok && notOwner.code === "IDENTITY_NOT_FOUND", "非 owner self-revoke → 视同不存在");
    const owner = await svc.revokeIdentity({
      caller: { userId: memberA.id, role: memberA.role },
      managementOrgId: null,
      identityId: provisionedId,
      reason: "user opt-out",
    });
    ok(owner.ok && owner.identity.status === "REVOKED", "owner self-revoke → REVOKED");
  }

  console.log("DB-14 lookup 热路径：只读，不写 lastSeenAt");
  {
    const before = await db.externalIdentity.findUnique({ where: { id: legacyId } });
    const hit = await svc.lookupExternalIdentityRecord(
      "personal_wechat",
      gwPersonalA.id,
      `wx_legacy_${tag}`,
    );
    ok(hit?.userId === memberA.id && hit?.status === "ACTIVE", "命中最小投影 {userId,status,method}");
    const after = await db.externalIdentity.findUnique({ where: { id: legacyId } });
    ok(
      String(before?.lastSeenAt) === String(after?.lastSeenAt) &&
        String(before?.updatedAt) === String(after?.updatedAt),
      "lookup 未产生任何写（lastSeenAt/updatedAt 不变）",
    );
    ok((await svc.lookupExternalIdentityRecord("personal_wechat", "other_tenant", `wx_legacy_${tag}`)) === null, "不同 tenant 同 providerUserId → 未命中（租户隔离）");
  }

  console.log("DB-15 事务原子性：事务中途失败 → 身份行回滚（audit 与写同事务）");
  {
    const before = await db.externalIdentity.count();
    let threw = false;
    try {
      await db.$transaction(async (tx) => {
        await tx.externalIdentity.create({
          data: {
            provider: "mock",
            providerTenantId: "mock",
            providerUserId: `atomic_${tag}`,
            userId: memberA.id,
            status: "PENDING",
          },
        });
        throw new Error("simulated audit failure");
      });
    } catch {
      threw = true;
    }
    ok(threw && (await db.externalIdentity.count()) === before, "抛错 → 整体回滚，无残留行");
  }

  console.log("DB-16 legacy 回填脚本：dry-run → write → 幂等 → Attack C 不接管");
  {
    // 种子 WeChatBinding：正常 / disconnected / 无 org（UNRESOLVED）/ 与既有 verified 身份冲突
    const bindings = await db.$transaction([
      db.weChatBinding.create({
        data: { userId: memberA2.id, orgId: orgA.id, channel: "personal_wechat", externalId: `bf_ok_${tag}`, status: "active" },
      }),
      db.weChatBinding.create({
        data: { userId: memberA2.id, orgId: orgA.id, channel: "personal_wechat", externalId: `bf_gone_${tag}`, status: "disconnected" },
      }),
      db.weChatBinding.create({
        data: { userId: memberA2.id, orgId: null, channel: "personal_wechat", externalId: `bf_noorg_${tag}`, status: "active" },
      }),
      db.weChatBinding.create({
        data: { userId: memberA2.id, orgId: orgA.id, channel: "personal_wechat", externalId: `wx_legacy_${tag}`, status: "active" },
      }),
    ]);
    ok(bindings.length === 4, "4 条 legacy binding 就绪（含 1 条与 verified 身份键冲突）");
    const run = (write: boolean) =>
      execFileSync(
        "npx",
        ["tsx", "scripts/backfill-external-identity-from-wechat-binding.ts", ...(write ? ["--write"] : [])],
        { env: { ...process.env }, encoding: "utf8", timeout: 180_000 },
      );

    const dry = run(false);
    ok(/DRY RUN/.test(dry), "默认 dry-run");
    ok((await db.externalIdentity.count({ where: { providerUserId: `bf_ok_${tag}` } })) === 0, "dry-run 未写库");
    ok(!dry.includes(`bf_ok_${tag}`) && !dry.includes(`wx_legacy_${tag}`), "输出不含 raw externalId");

    const write1 = run(true);
    ok(/WRITE/.test(write1), "--write 实际执行");
    const created = await db.externalIdentity.findUnique({
      where: {
        provider_providerTenantId_providerUserId: {
          provider: "personal_wechat",
          providerTenantId: gwPersonalA.id,
          providerUserId: `bf_ok_${tag}`,
        },
      },
    });
    ok(created?.userId === memberA2.id && created?.status === "ACTIVE" && created?.verificationMethod === "LEGACY_SELF_ASSERTED", "active binding → ACTIVE + LEGACY_SELF_ASSERTED（非 verified）");
    const gone = await db.externalIdentity.findUnique({
      where: {
        provider_providerTenantId_providerUserId: {
          provider: "personal_wechat",
          providerTenantId: gwPersonalA.id,
          providerUserId: `bf_gone_${tag}`,
        },
      },
    });
    ok(gone?.status === "REVOKED", "disconnected binding → REVOKED");
    ok((await db.externalIdentity.count({ where: { providerUserId: `bf_noorg_${tag}` } })) === 0, "orgId 缺失 → UNRESOLVED 仅报告，不造行");
    const conflictRow = await db.externalIdentity.findUnique({
      where: {
        provider_providerTenantId_providerUserId: {
          provider: "personal_wechat",
          providerTenantId: gwPersonalA.id,
          providerUserId: `wx_legacy_${tag}`,
        },
      },
    });
    ok(conflictRow?.userId === memberA.id && conflictRow?.verificationMethod === "ADMIN_PROVISIONED", "Attack C：binding 指向他人，但既有 relink 后身份未被接管/降级");
    ok((await auditCount(AUDIT_ACTIONS.EXTERNAL_IDENTITY_BACKFILL, created?.id ?? "-")) === 1, "回填创建带审计 external_identity_backfill");

    const before2 = await db.externalIdentity.count();
    const write2 = run(true);
    ok(/EXISTING_SAME/.test(write2) && (await db.externalIdentity.count()) === before2, "重复 --write 幂等：无新增行");
  }

  console.log(`\nM2-A Identity DB 结果: ${pass} 通过, ${fail} 失败`);
  console.log(`DB_UNIQUE_KEY_ENFORCED = ${pass > 0 && fail === 0 ? "PASS" : "CHECK"}`);
  await db.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
