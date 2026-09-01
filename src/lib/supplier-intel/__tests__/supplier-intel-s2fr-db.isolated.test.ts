/**
 * Supplier Intelligence S2 Final Review Remediation — DB 集成（隔离库执行，否则跳过）
 *
 * 运行：
 *   DATABASE_URL=... DIRECT_URL=... NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *     npx tsx src/lib/supplier-intel/__tests__/supplier-intel-s2fr-db.isolated.test.ts
 *
 * 覆盖 S2-FR-T1..T9：
 *   B1  canonical 需求服务端读取（客户端无法降级/删减 mandatory；uncertain 幸存；
 *       封顶即 BLOCKED；无分析即 UNAVAILABLE）
 *   B2  平台 host ≠ 供应商身份（同 host 不匹配；精确账号可预填；内容页永不强键）
 *   B3  项目授权先于一切（org 成员 ≠ 项目权限；未授权 provider 调用数=0；列表零泄漏）
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function requireIsolatedTestDb(): void {
  if (!process.env.DATABASE_URL?.trim()) {
    console.log("⏭  跳过 S2-FR DB 测试（未提供 DATABASE_URL）");
    process.exit(0);
  }
  if (process.env.NODE_ENV !== "test") {
    console.log("⏭  跳过 S2-FR DB 测试（需 NODE_ENV=test）");
    process.exit(0);
  }
  if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") {
    console.log("⏭  跳过 S2-FR DB 测试（需 DATABASE_ENVIRONMENT=isolated）");
    process.exit(0);
  }
  assertSafeTestDatabase({ scriptName: "supplier-intel s2 final-review regression" });
}

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: string) {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  requireIsolatedTestDb();
  const { db } = await import("@/lib/db");
  const { isSupplierIntelError } = await import("../errors");
  const projectRunSvc = await import("../project-run-service");
  const canonicalMod = await import("../canonical-requirements");
  const discovery = await import("../discovery-service");
  const runSvc = await import("../run-service");
  const signalSvc = await import("../signal-service");
  const er = await import("../entity-resolution");
  const accessMod = await import("../access");
  type Provider = import("../providers").DiscoveryProvider;

  async function expectErr(code: string, name: string, fn: () => Promise<unknown>) {
    try {
      await fn();
      ok(false, `${name}（期望抛 ${code}，实际成功）`);
    } catch (e) {
      if (isSupplierIntelError(e, code as never)) ok(true, name);
      else ok(false, name, e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    }
  }

  const tag = `s2fr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // ---------------- Fixture ----------------
  const userOwner = await db.user.create({
    data: { email: `fr_owner_${tag}@test.qingyan.local`, name: "FROwner", role: "user", status: "active" },
  });
  const userPlain = await db.user.create({
    data: { email: `fr_plain_${tag}@test.qingyan.local`, name: "FRPlain", role: "user", status: "active" },
  });
  const userMember = await db.user.create({
    data: { email: `fr_member_${tag}@test.qingyan.local`, name: "FRMember", role: "user", status: "active" },
  });
  const orgA = await db.organization.create({
    data: { name: `FR Org ${tag}`, code: `fr_${tag}`, ownerId: userOwner.id, status: "active" },
  });
  await db.organizationMember.createMany({
    data: [
      { orgId: orgA.id, userId: userOwner.id, role: "org_admin", status: "active" },
      { orgId: orgA.id, userId: userPlain.id, role: "org_member", status: "active" },
      { orgId: orgA.id, userId: userMember.id, role: "org_member", status: "active" },
    ],
  });
  const projectA = await db.project.create({
    data: { orgId: orgA.id, name: `FR ProjA ${tag}`, ownerId: userOwner.id, workDomain: "tender", intakeStatus: "dispatched" },
  });
  const projectB = await db.project.create({
    data: { orgId: orgA.id, name: `FR ProjB ${tag}`, ownerId: userOwner.id, workDomain: "tender", intakeStatus: "dispatched" },
  });
  // userMember 只在 projectA 有成员身份（viewer）——projectB 不可见（T9）
  await db.projectMember.create({
    data: { projectId: projectA.id, userId: userMember.id, role: "viewer", status: "active" },
  });

  // canonical 分析 fixture（projectA）：5 条需求，R-001/R-002 强制、R-005 疑似强制（RISKS 聚合）
  const analysisA = await db.tenderAnalysisRun.create({
    data: {
      orgId: orgA.id,
      projectId: projectA.id,
      status: "APPROVED",
      idempotencyKey: `fr_a_${tag}`,
      sourceHashFingerprint: "fr-fixture",
    },
  });
  const reqSeed = [
    { code: "R-001", text: "ANSI/BIFMA X5.1 certification required", mandatory: true },
    { code: "R-002", text: "300 lb minimum weight capacity", mandatory: true },
    { code: "R-003", text: "mesh back preferred", mandatory: false },
    { code: "R-004", text: "lumbar support", mandatory: false },
    { code: "R-005", text: "on-site assembly may be required", mandatory: false }, // 塌缩后的 false
  ];
  for (const r of reqSeed) {
    await db.tenderExtractedRequirement.create({
      data: {
        projectId: projectA.id,
        analysisRunId: analysisA.id,
        requirementCode: r.code,
        category: "technical",
        originalRequirement: r.text,
        chineseTranslation: r.text,
        mandatory: r.mandatory,
      },
    });
  }
  await db.tenderAnalysisSection.create({
    data: {
      runId: analysisA.id,
      sectionKey: "RISKS",
      contentZh: "1 条要求强制性无法确定",
      structuredJson: {
        risks: [
          { id: "RISK-001", reasonCode: "MANDATORY_UNCERTAIN", relatedRequirementIds: ["R-005"] },
        ],
      },
    },
  });
  // projectB：uncertain 聚合表打满 12 条 → 封顶 fail-closed
  const analysisB = await db.tenderAnalysisRun.create({
    data: {
      orgId: orgA.id,
      projectId: projectB.id,
      status: "APPROVED",
      idempotencyKey: `fr_b_${tag}`,
      sourceHashFingerprint: "fr-fixture",
    },
  });
  await db.tenderExtractedRequirement.create({
    data: {
      projectId: projectB.id,
      analysisRunId: analysisB.id,
      requirementCode: "R-001",
      category: "technical",
      originalRequirement: "some requirement",
      chineseTranslation: "some requirement",
      mandatory: true,
    },
  });
  await db.tenderAnalysisSection.create({
    data: {
      runId: analysisB.id,
      sectionKey: "RISKS",
      contentZh: "12 条要求强制性无法确定",
      structuredJson: {
        risks: [
          {
            id: "RISK-001",
            reasonCode: "MANDATORY_UNCERTAIN",
            relatedRequirementIds: Array.from({ length: 12 }, (_, i) => `R-${String(i + 1).padStart(3, "0")}`),
          },
        ],
      },
    },
  });

  const ownerActor = { orgId: orgA.id, userId: userOwner.id };
  const plainActor = { orgId: orgA.id, userId: userPlain.id };
  const memberActor = { orgId: orgA.id, userId: userMember.id };

  try {
    console.log("\n== B1：canonical 需求服务端读取（S2-FR-T1/T2/T3）==");
    const snapshot = await canonicalMod.loadCanonicalSupplierRequirementSnapshot({
      orgId: orgA.id,
      projectId: projectA.id,
    });
    ok(snapshot.entries.length === 5, "S2-FR-T2：canonical 5 条全量（客户端无从删减）");
    const byCode = new Map(snapshot.entries.map((e) => [e.code, e]));
    ok(byCode.get("R-001")?.mandatory === true && byCode.get("R-002")?.mandatory === true, "S2-FR-T1：mandatory=true 忠实读出（客户端无从降级）");
    ok(byCode.get("R-005")?.mandatory === "uncertain", "S2-FR-T3：uncertain 从 RISKS 聚合幸存（不塌缩成 false）");
    ok(byCode.get("R-003")?.mandatory === false, "false 仍是 false");

    const run = await projectRunSvc.createProjectSearchRun(ownerActor, {
      projectId: projectA.id,
      allowLlm: false,
      hints: { productKeywordsZh: ["人体工学办公椅"], productKeywordsEn: ["ergonomic office chair"] },
    });
    const persisted = run.requirementSnapshotJson as Array<Record<string, unknown>>;
    ok(persisted.length === 5, "Run 快照 = canonical 全量（T2 持久面）");
    ok(persisted.find((e) => e.code === "R-005")?.mandatory === "uncertain", "Run 快照保留 uncertain（T3 持久面）");
    ok(persisted.find((e) => e.code === "R-001")?.mandatory === true, "Run 快照 mandatory=true 不可被客户端触及（T1 持久面）");
    const brief = run.briefSnapshotJson as { uncertainRequirements?: Array<{ code: string }>; preferredRequirements?: Array<{ code: string }> };
    ok(Boolean(brief.uncertainRequirements?.some((r) => r.code === "R-005")), "brief.uncertainRequirements 含 R-005");
    ok(!brief.preferredRequirements?.some((r) => r.code === "R-005"), "uncertain 未被静默降入 preferred");
    const srcCfg = run.sourceConfigJson as Record<string, unknown>;
    ok(srcCfg.canonicalAnalysisRunId === analysisA.id, "sourceConfig 留 canonical 分析 run 审计指针");

    console.log("\n== B1 fail-closed 边界 ==");
    await expectErr("BLOCKED_BY_CANONICAL_REQUIREMENT_SOURCE", "uncertain 聚合表打满 12 → 拒绝开搜（绝不静默塌缩）", () =>
      canonicalMod.loadCanonicalSupplierRequirementSnapshot({ orgId: orgA.id, projectId: projectB.id }));
    const projectC = await db.project.create({
      data: { orgId: orgA.id, name: `FR ProjC ${tag}`, ownerId: userOwner.id, workDomain: "tender", intakeStatus: "dispatched" },
    });
    await expectErr("CANONICAL_REQUIREMENTS_UNAVAILABLE", "无可用分析 → 拒绝开搜（需求是真相源）", () =>
      projectRunSvc.createProjectSearchRun(ownerActor, { projectId: projectC.id, allowLlm: false }));

    console.log("\n== B3：项目授权（S2-FR-T7/T8/T9）==");
    await expectErr("PROJECT_ACCESS_DENIED", "S2-FR-T7a：org 成员无项目身份 → create run 拒", () =>
      projectRunSvc.createProjectSearchRun(plainActor, { projectId: projectA.id, allowLlm: false }));
    await expectErr("PROJECT_ACCESS_DENIED", "S2-FR-T7b：读 run（含需求快照）拒", () =>
      projectRunSvc.getProjectSearchRun(plainActor, run.id));
    await expectErr("PROJECT_ACCESS_DENIED", "S2-FR-T7c：列表拒", () =>
      projectRunSvc.listProjectSearchRuns(plainActor, projectA.id));

    await runSvc.startSearchRun(ownerActor, run.id);
    let providerCalls = 0;
    const countingProvider: Provider = {
      providerId: "fake-counting",
      policy: { respectsRobots: true, requiresPlatformLogin: false, dataLicense: "test" },
      isAvailable: () => true,
      search: async (q) => {
        providerCalls += 1;
        return { status: "SUCCESS", results: [{ title: "x", url: "https://v.douyin.com/x/", snippet: "", sourceQuery: q }] };
      },
    };
    await expectErr("PROJECT_ACCESS_DENIED", "S2-FR-T7d：discover 拒（授权先于外呼）", () =>
      discovery.executeSupplierSearchRun(plainActor, run.id, { provider: countingProvider }));
    ok(providerCalls === 0, "S2-FR-T8：未授权路径 provider 调用数 = 0");

    ok((await projectRunSvc.listProjectSearchRuns(memberActor, projectA.id)).length >= 1, "projectA viewer 可列 projectA（read=任意 projectRole）");
    await expectErr("PROJECT_ACCESS_DENIED", "S2-FR-T9：projectA viewer 列 projectB 拒（零跨项目泄漏）", () =>
      projectRunSvc.listProjectSearchRuns(memberActor, projectB.id));
    const listA = await projectRunSvc.listProjectSearchRuns(memberActor, projectA.id);
    ok(listA.every((r) => r.projectId === projectA.id), "列表只含本项目 Run");
    await expectErr("PROJECT_ACCESS_DENIED", "viewer 写级动作（create run）拒（write 需 project_admin/owner/org_admin）", () =>
      projectRunSvc.createProjectSearchRun(memberActor, { projectId: projectA.id, allowLlm: false }));

    console.log("\n== B2：平台身份边界（S2-FR-T4/T5/T6）==");
    const supX = await db.supplier.create({
      data: { orgId: orgA.id, name: `工厂X ${tag}`, createdById: userOwner.id },
    });
    const sigAccountA = await signalSvc.createSubmittedSignal(ownerActor, {
      url: "https://www.douyin.com/user/factory_a_account",
      rawText: "主页分享 A",
    });
    await signalSvc.reviewSignal(ownerActor, sigAccountA.id);
    await signalSvc.linkSignalToSupplier(ownerActor, sigAccountA.id, { supplierId: supX.id });

    const sigAccountB = await signalSvc.createSubmittedSignal(ownerActor, {
      url: "https://www.douyin.com/user/factory_b_account",
      rawText: "第二家企业的主页分享",
    });
    const resB = await er.resolveSignalEntity(ownerActor, sigAccountB.id);
    ok(resB.decision !== "MATCHED_EXISTING" && resB.supplierId !== supX.id, "S2-FR-T4：同 douyin.com 不同账号 → 不匹配工厂X", JSON.stringify(resB.matchedSignals));

    const sigAccountA2 = await signalSvc.createSubmittedSignal(ownerActor, {
      url: "https://www.douyin.com/user/factory_a_account?from=share",
      rawText: "主页分享 A 再次提交",
    });
    const resA2 = await er.resolveSignalEntity(ownerActor, sigAccountA2.id);
    ok(resA2.decision === "MATCHED_EXISTING" && resA2.supplierId === supX.id, "S2-FR-T5：同一精确账号再现 → MATCHED_EXISTING 预填");
    const rowA2 = await db.supplierDiscoverySignal.findUnique({ where: { id: sigAccountA2.id } });
    ok(rowA2?.status === "NEW" && rowA2?.linkedSupplierId === null, "预填不自动 LINK/合并（AUTO_MERGE_PATHS=0）");

    const sigVideo = await signalSvc.createSubmittedSignal(ownerActor, {
      url: "https://www.douyin.com/video/7300000001",
      rawText: "某条视频分享",
    });
    await signalSvc.reviewSignal(ownerActor, sigVideo.id);
    await signalSvc.linkSignalToSupplier(ownerActor, sigVideo.id, { supplierId: supX.id });
    const sigVideo2 = await signalSvc.createSubmittedSignal(ownerActor, {
      url: "https://www.douyin.com/video/7300000002",
      rawText: "另一条视频分享",
    });
    const resVideo2 = await er.resolveSignalEntity(ownerActor, sigVideo2.id);
    ok(resVideo2.decision !== "MATCHED_EXISTING", "S2-FR-T6：内容页 URL 不沉淀身份——另一条视频不因同平台匹配");

    console.log("\n== F1：强身份冲突 fail-closed（S2-FR-T10/T14 DB 实证）==");
    const supY = await db.supplier.create({
      data: { orgId: orgA.id, name: `工厂Y ${tag}`, createdById: userOwner.id },
    });
    // 历史脏数据：同一精确账号被先后 LINK 给 supX 与 supY（无 schema 唯一约束，允许存在）
    const sigCollide1 = await signalSvc.createSubmittedSignal(ownerActor, {
      url: "https://www.douyin.com/user/collide_account",
      rawText: "主页分享 C1",
    });
    await signalSvc.linkSignalToSupplier(ownerActor, sigCollide1.id, { supplierId: supX.id });
    const sigCollide2 = await signalSvc.createSubmittedSignal(ownerActor, {
      url: "https://www.douyin.com/user/collide_account?ref=2",
      rawText: "主页分享 C2",
    });
    await signalSvc.linkSignalToSupplier(ownerActor, sigCollide2.id, { supplierId: supY.id });

    const sigCollideNew = await signalSvc.createSubmittedSignal(ownerActor, {
      url: "https://www.douyin.com/user/collide_account?ref=3",
      rawText: "主页分享 C3",
    });
    const resCollide = await er.resolveSignalEntity(ownerActor, sigCollideNew.id);
    ok(resCollide.decision === "NEEDS_HUMAN_REVIEW", "S2-FR-T10：冲突身份 → NEEDS_HUMAN_REVIEW（不 first-wins）", resCollide.decision);
    ok(resCollide.supplierId === undefined, "S2-FR-T10：不选任何一家");
    ok(
      resCollide.conflicts.some((c) => c.includes("强身份冲突") && c.includes([supX.id, supY.id].sort().join(","))),
      "S2-FR-T10：冲突元数据含排序后的双方 id",
      JSON.stringify(resCollide.conflicts),
    );

    // T14：另一 org 存在同一精确账号的 LINKED 历史——不得参与本 org 的匹配/冲突
    const userB2 = await db.user.create({
      data: { email: `fr_b2_${tag}@test.qingyan.local`, name: "FRB2", role: "user", status: "active" },
    });
    const orgB2 = await db.organization.create({
      data: { name: `FR OrgB2 ${tag}`, code: `frb2_${tag}`, ownerId: userB2.id, status: "active" },
    });
    await db.organizationMember.create({
      data: { orgId: orgB2.id, userId: userB2.id, role: "org_admin", status: "active" },
    });
    const actorB2 = { orgId: orgB2.id, userId: userB2.id };
    const supForeign = await db.supplier.create({
      data: { orgId: orgB2.id, name: `外org供应商 ${tag}`, createdById: userB2.id },
    });
    const sigForeign = await signalSvc.createSubmittedSignal(actorB2, {
      url: "https://www.douyin.com/user/xorg_account",
      rawText: "外 org 主页分享",
    });
    await signalSvc.linkSignalToSupplier(actorB2, sigForeign.id, { supplierId: supForeign.id });
    const sigLocal = await signalSvc.createSubmittedSignal(ownerActor, {
      url: "https://www.douyin.com/user/xorg_account",
      rawText: "本 org 看到同一账号",
    });
    const resLocal = await er.resolveSignalEntity(ownerActor, sigLocal.id);
    ok(
      resLocal.decision === "NEW_SUPPLIER_CANDIDATE" &&
        resLocal.supplierId === undefined &&
        !resLocal.conflicts.some((c) => c.includes("强身份冲突")),
      "S2-FR-T14：他 org 的同身份 LINK 不参与本 org 匹配/冲突",
      JSON.stringify({ d: resLocal.decision, c: resLocal.conflicts }),
    );
    await db.supplierDiscoverySignal.deleteMany({ where: { orgId: orgB2.id } });
    await db.supplier.deleteMany({ where: { orgId: orgB2.id } });
    await db.auditLog.deleteMany({ where: { orgId: orgB2.id } });
    await db.organizationMember.deleteMany({ where: { orgId: orgB2.id } });
    await db.organization.delete({ where: { id: orgB2.id } });
    await db.user.delete({ where: { id: userB2.id } });

    console.log("\n== 服务层 assert 与 canonical 门语义对齐（抽查）==");
    await accessMod.assertProjectAccessForActor(memberActor, projectA.id, "read");
    ok(true, "viewer read 放行（与 requireProjectReadAccess 一致）");
    await expectErr("NOT_FOUND", "跨 org 项目 → NOT_FOUND（不泄露存在性）", () =>
      accessMod.assertProjectAccessForActor(ownerActor, "proj_nonexistent", "read"));
  } finally {
    const orgIds = [orgA.id];
    await db.supplierRequirementMatch.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.supplierCandidate.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.supplierCapabilitySignal.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.supplierDiscoverySignal.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.supplierCertification.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.supplierOffering.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.supplierSearchRun.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.supplier.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.tenderExtractedRequirement.deleteMany({ where: { project: { orgId: { in: orgIds } } } });
    await db.tenderAnalysisSection.deleteMany({ where: { run: { orgId: { in: orgIds } } } });
    await db.tenderAnalysisRun.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.projectMember.deleteMany({ where: { project: { orgId: { in: orgIds } } } });
    await db.auditLog.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.project.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.organizationMember.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.organization.deleteMany({ where: { id: { in: orgIds } } });
    await db.user.deleteMany({ where: { id: { in: [userOwner.id, userPlain.id, userMember.id] } } });
    await db.$disconnect();
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("S2-FR 集成测试异常:", e);
  process.exit(1);
});
