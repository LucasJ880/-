/**
 * Supplier Intelligence M1-S1 — DB 集成测试（隔离库执行，否则跳过）
 *
 * 运行：
 *   DATABASE_URL=... DIRECT_URL=... NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *     npx tsx src/lib/supplier-intel/__tests__/supplier-intel-db.isolated.test.ts
 *
 * 安全：guard-first——顶层禁止 import "@/lib/db" 与任何 service（它们会拉起 Prisma 连接）。
 * 覆盖矩阵：T3(db) / T4 / T8(db) / T9 / T11-A..F / T16 / T17 / T18 + 认证/能力信任边界。
 */
import assert from "node:assert/strict";
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function requireIsolatedTestDb(): void {
  if (!process.env.DATABASE_URL?.trim()) {
    console.log("⏭  跳过 Supplier Intel DB 测试（未提供 DATABASE_URL）");
    process.exit(0);
  }
  assertSafeTestDatabase({ scriptName: "supplier-intel s1 integration" });
  if (process.env.NODE_ENV !== "test") {
    console.log("⏭  跳过 Supplier Intel DB 测试（需 NODE_ENV=test）");
    process.exit(0);
  }
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

/** 序列化归一（Date→ISO、Decimal→string）后做深比较 */
function frozen(v: unknown): unknown {
  return JSON.parse(JSON.stringify(v));
}

async function main() {
  requireIsolatedTestDb();
  const { db } = await import("@/lib/db");
  const { isSupplierIntelError } = await import("../errors");
  const runSvc = await import("../run-service");
  const signalSvc = await import("../signal-service");
  const evalSvc = await import("../evaluation-service");
  const certSvc = await import("../certification-service");
  const supplierSvc = await import("@/lib/supplier/service");

  async function expectErr(code: string, name: string, fn: () => Promise<unknown>) {
    try {
      await fn();
      ok(false, `${name}（期望抛 ${code}，实际成功）`);
    } catch (e) {
      if (isSupplierIntelError(e, code as never)) ok(true, name);
      else ok(false, name, e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    }
  }

  const tag = `s1si_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // ---------------- Fixture ----------------
  const userA = await db.user.create({
    data: { email: `si_a_${tag}@test.qingyan.local`, name: "SIUserA", role: "user", status: "active" },
  });
  const userB = await db.user.create({
    data: { email: `si_b_${tag}@test.qingyan.local`, name: "SIUserB", role: "user", status: "active" },
  });
  const orgA = await db.organization.create({
    data: { name: `SI Org A ${tag}`, code: `sia_${tag}`, ownerId: userA.id, status: "active" },
  });
  const orgB = await db.organization.create({
    data: { name: `SI Org B ${tag}`, code: `sib_${tag}`, ownerId: userB.id, status: "active" },
  });
  await db.organizationMember.createMany({
    data: [
      { orgId: orgA.id, userId: userA.id, role: "org_admin", status: "active" },
      { orgId: orgB.id, userId: userB.id, role: "org_admin", status: "active" },
    ],
  });
  const projectA = await db.project.create({
    data: { orgId: orgA.id, name: `SI Proj A ${tag}`, ownerId: userA.id, workDomain: "tender", intakeStatus: "dispatched" },
  });
  const supplierA = await db.supplier.create({
    data: { orgId: orgA.id, name: `佛山测试工厂 ${tag}`, region: "佛山", category: "家具", website: "https://factory.example", createdById: userA.id },
  });
  const supplierLoner = await db.supplier.create({
    data: { orgId: orgA.id, name: `无情报供应商 ${tag}`, createdById: userA.id },
  });

  const actorA = { orgId: orgA.id, userId: userA.id };
  const actorB = { orgId: orgB.id, userId: userB.id };

  const requirements = [
    { id: `req1_${tag}`, code: "R-001", text: "必须提供 UL 认证", category: "MANDATORY", mandatory: true, mandatorySignal: "must" },
    { id: `req2_${tag}`, code: "R-002", text: "希望支持小批量", category: "COMMERCIAL", mandatory: false, mandatorySignal: null },
    { id: `req3_${tag}`, code: "R-003", text: "疑似强制的安装要求", category: "INSTALLATION", mandatory: "uncertain", mandatorySignal: "shall be rejected" },
  ];

  try {
    console.log("\n== T3 用户提交信号（层 A / 层 C）==");
    const sigDouyin = await signalSvc.createSubmittedSignal(actorA, {
      url: "https://v.douyin.com/abc123/",
      rawText: "看这家工厂 车间实拍 UL Certified",
      projectId: projectA.id,
    });
    ok(sigDouyin.platform === "DOUYIN" && sigDouyin.status === "NEW", "抖音分享链 → DOUYIN/NEW 信号");
    ok(sigDouyin.sourceOrigin === "USER_SUBMITTED", "sourceOrigin=USER_SUBMITTED");
    ok(sigDouyin.accountName === null && sigDouyin.title === null, "解析不到的字段留空不猜");

    const sigManual = await signalSvc.createSubmittedSignal(actorA, {
      rawText: "展会遇到一家做铝合金外壳的厂，联系人老周",
      manualEntry: true,
    });
    ok(sigManual.platform === "MANUAL" && sigManual.sourceOrigin === "MANUAL_ENTRY", "手工线索 → MANUAL/MANUAL_ENTRY");

    console.log("\n== T4/T18 跨租户隔离 + trusted principal ==");
    ok((await signalSvc.getSignal(actorB, sigDouyin.id)) === null, "Org B 读不到 Org A 的信号");
    ok((await signalSvc.listSignals(actorB)).length === 0, "Org B 列表为空");
    await expectErr("NOT_FOUND", "Org B 不能 review Org A 的信号", () =>
      signalSvc.reviewSignal(actorB, sigDouyin.id));
    await expectErr("NOT_FOUND", "Org B 不能把自家信号 link 到 Org A 的供应商", async () => {
      const sigB = await signalSvc.createSubmittedSignal(actorB, { rawText: "b org clue", manualEntry: true });
      return signalSvc.linkSignalToSupplier(actorB, sigB.id, { supplierId: supplierA.id });
    });
    await expectErr("INVALID_INPUT", "伪造跨租户 projectId 被拒", () =>
      signalSvc.createSubmittedSignal(actorB, { rawText: "spoof", manualEntry: true, projectId: projectA.id }));

    console.log("\n== 信号人审流转 ==");
    const reviewed = await signalSvc.reviewSignal(actorA, sigDouyin.id);
    ok(reviewed?.status === "REVIEWED", "NEW → REVIEWED");
    const linked = await signalSvc.linkSignalToSupplier(actorA, sigDouyin.id, { supplierId: supplierA.id, note: "同一家" });
    ok(linked?.status === "LINKED" && linked?.linkedSupplierId === supplierA.id, "REVIEWED → LINKED（人工点按）");
    ok(Array.isArray(linked?.resolutionJson) && (linked?.resolutionJson as unknown[]).length === 1, "resolution 快照 append");
    await expectErr("INVALID_SIGNAL_TRANSITION", "LINKED 终态不可再 reject", () =>
      signalSvc.rejectSignal(actorA, sigDouyin.id));

    console.log("\n== 能力信号信任边界（H5/R1/R2）==");
    const cap = await signalSvc.createCapabilitySignal(actorA, {
      discoverySignalId: sigDouyin.id, type: "CERTIFICATION", value: "UL",
      evidenceStatus: "CLAIMED", extractedBy: "HUMAN",
    });
    ok(cap.evidenceStatus === "CLAIMED", "抖音文案『UL Certified』→ CLAIMED（不是 VERIFIED）");
    await expectErr("SOCIAL_VERIFIED_WRITE_BLOCKED", "social 写路径写 VERIFIED 被拒", () =>
      signalSvc.createCapabilitySignal(actorA, {
        discoverySignalId: sigDouyin.id, type: "CNC_CAPABILITY",
        evidenceStatus: "VERIFIED", extractedBy: "HUMAN",
      }));
    await expectErr("AI_CONFIDENCE_EXCEEDS_CAP", "AI_ASSISTED confidence>0.8 被拒", () =>
      signalSvc.createCapabilitySignal(actorA, {
        discoverySignalId: sigDouyin.id, type: "FACTORY_FLOOR",
        evidenceStatus: "OBSERVED", extractedBy: "AI_ASSISTED", confidence: 0.9,
      }));
    await expectErr("UNKNOWN_CAPABILITY_TYPE", "未知 capability type 拒收（T8）", () =>
      signalSvc.createCapabilitySignal(actorA, {
        discoverySignalId: sigDouyin.id, type: "TELEPORTATION",
        evidenceStatus: "OBSERVED", extractedBy: "HUMAN",
      }));

    console.log("\n== 认证登记与验证（B5）==");
    const offering = await certSvc.createOffering(actorA, {
      supplierId: supplierA.id, name: "铝合金外壳 A1", sku: "AL-A1", category: "enclosure",
      unitPrice: 100, currency: "CNY", priceStatus: "KNOWN", moq: 50, leadTimeDays: 20,
      incoterm: "FOB", sourceKind: "DISCOVERY", sourceSignalId: sigDouyin.id,
      attributes: { material: "AL6061", ip: "IP65" },
    });
    const offeringNoPrice = await certSvc.createOffering(actorA, {
      supplierId: supplierA.id, name: "无价样品壳", sourceKind: "MANUAL",
    });
    ok(offeringNoPrice.priceStatus === "UNKNOWN" && offeringNoPrice.unitPrice === null, "T13：缺价 offering 合法创建（不拒）");

    const cert = await certSvc.createCertification(actorA, {
      supplierId: supplierA.id, offeringId: offering.id, scope: "PRODUCT",
      certificationType: "UL", certificateNumber: "E123456", issuer: "UL LLC",
      expiresAt: new Date("2027-06-30T00:00:00Z"),
      sourceKind: "SOCIAL", sourceSignalId: sigDouyin.id,
    });
    ok(cert.status === "CLAIMED", "SOCIAL 来源创建 → 恒 CLAIMED");
    await expectErr("CERT_VERIFY_REQUIRES_EVIDENCE", "无独立证据不得 VERIFIED（fail-closed）", () =>
      certSvc.verifyCertification(actorA, cert.id));
    await expectErr("INVALID_SCOPE", "PRODUCT 级认证必须挂 offering", () =>
      certSvc.createCertification(actorA, {
        supplierId: supplierA.id, scope: "PRODUCT", certificationType: "CSA", sourceKind: "USER_ENTRY",
      }));
    const certVerified = await certSvc.verifyCertification(actorA, cert.id, {
      archiveItemId: `arch_${tag}`, note: "对过 UL 在线库+证书扫描件",
    });
    ok(certVerified?.status === "VERIFIED" && certVerified?.verifiedByUserId === userA.id, "人工+独立证据 → VERIFIED");

    console.log("\n== Run 生命周期 + 快照（T9/§10）==");
    const run = await runSvc.createSearchRun(actorA, {
      projectId: projectA.id,
      brief: { productKeywords: ["铝合金外壳"], socialSearchTermsZh: ["工厂实拍"], capabilitySearchTermsZh: ["CNC铝壳加工"] },
      requirements,
      sourceConfig: { adapters: ["manual"] },
      promptName: "supplier-brief-discover", promptVersion: "1",
    });
    ok(run.status === "PLANNED" && run.scoreVersion === "supplier-score-v1" && run.evaluationVersion === "supplier-eval-v1", "Run 创建：PLANNED + 版本冻结");
    ok(run.createdByUserId === userA.id, "createdByUserId 来自服务端上下文");
    const snapEntries = run.requirementSnapshotJson as Array<Record<string, unknown>>;
    ok(snapEntries.length === 3 && snapEntries[2].mandatory === "uncertain", "需求快照保留三值 mandatory（uncertain 不塌缩）");
    ok(
      Boolean(await db.auditLog.findFirst({ where: { action: "supplier_intel.run.created", targetId: run.id } })),
      "audit: run.created 已落",
    );
    await expectErr("RUN_NOT_RUNNING", "PLANNED 阶段不能建候选", () =>
      evalSvc.createSupplierCandidate(actorA, {
        searchRunId: run.id, supplierId: supplierA.id, originSource: "SAVED",
      }));
    await expectErr("NOT_FOUND", "Org B 不能推进 Org A 的 Run（T18）", () =>
      runSvc.startSearchRun(actorB, run.id));

    const running = await runSvc.startSearchRun(actorA, run.id);
    ok(running?.status === "RUNNING" && running?.startedAt !== null, "PLANNED → RUNNING");

    console.log("\n== 候选 + 匹配（B2/B3 快照冻结）==");
    const candidate = await evalSvc.createSupplierCandidate(actorA, {
      searchRunId: run.id, supplierId: supplierA.id, offeringId: offering.id,
      originSource: "NEW_DISCOVERY",
    });
    const supSnap = candidate.supplierSnapshotJson as Record<string, unknown>;
    const offSnap = candidate.offeringSnapshotJson as Record<string, unknown>;
    ok(supSnap.name === supplierA.name && typeof supSnap.capturedAt === "string", "供应商身份按值快照（§3.1）");
    ok(offSnap.unitPrice === "100" && offSnap.leadTimeDays === 20 && offSnap.priceStatus === "KNOWN", "offering 按值快照（§3.2）");
    await expectErr("DUPLICATE_CANDIDATE", "同 Run 同供应商×offering 幂等拒重", () =>
      evalSvc.createSupplierCandidate(actorA, {
        searchRunId: run.id, supplierId: supplierA.id, offeringId: offering.id, originSource: "SAVED",
      }));
    await expectErr("INVALID_ORIGIN_SOURCE", "originSource 目录 fail-closed", () =>
      evalSvc.createSupplierCandidate(actorA, {
        searchRunId: run.id, supplierId: supplierLoner.id, originSource: "GUESSING",
      }));

    const match = await evalSvc.createRequirementMatch(actorA, {
      candidateId: candidate.id, requirementKey: "R-001", verdict: "PASS",
      confidence: 0.95, explanation: "UL 证书已验证且 scope 覆盖该产品",
      evidence: [{ kind: "certification", certificationId: cert.id }],
      evaluatedBy: "HUMAN",
    });
    const evi = (match.evidenceJson as Array<Record<string, unknown>>)[0];
    ok(evi.kind === "certification" && evi.statusAtEvaluation === "VERIFIED" && evi.certificateNumber === "E123456", "认证证据整组冻结（§3.3，非裸 id）");
    const matchUncertain = await evalSvc.createRequirementMatch(actorA, {
      candidateId: candidate.id, requirementKey: "R-003", verdict: "UNKNOWN",
      evidence: [], evaluatedBy: "HUMAN",
    });
    ok(matchUncertain.mandatory === true && matchUncertain.mandatoryUncertain === true, "uncertain → mandatory=true + uncertain 标记（fail-closed，不当 optional）");
    await expectErr("REQUIREMENT_KEY_NOT_IN_SNAPSHOT", "快照外的 requirementKey 拒收", () =>
      evalSvc.createRequirementMatch(actorA, {
        candidateId: candidate.id, requirementKey: "R-999", verdict: "PASS", evidence: [], evaluatedBy: "HUMAN",
      }));
    await expectErr("DUPLICATE_MATCH", "同候选同 requirementKey 拒重", () =>
      evalSvc.createRequirementMatch(actorA, {
        candidateId: candidate.id, requirementKey: "R-001", verdict: "FAIL", evidence: [], evaluatedBy: "HUMAN",
      }));

    const done = await runSvc.completeSearchRun(actorA, run.id, { status: "ran", perSource: { manual: 2 } });
    ok(done?.status === "COMPLETED" && done?.completedAt !== null, "RUNNING → COMPLETED");

    console.log("\n== T17 终态不可变 ==");
    await expectErr("RUN_IMMUTABLE", "终态 Run 的工作数据 PATCH 被拒", () =>
      runSvc.updateRunWorkingData(actorA, run.id, { queries: ["late query"] }));
    await expectErr("INVALID_RUN_TRANSITION", "终态不可重入 RUNNING", () =>
      runSvc.startSearchRun(actorA, run.id));
    await expectErr("RUN_NOT_RUNNING", "终态后不可再建候选（重评估=新 Run）", () =>
      evalSvc.createSupplierCandidate(actorA, {
        searchRunId: run.id, supplierId: supplierLoner.id, originSource: "SAVED",
      }));
    await expectErr("RUN_NOT_RUNNING", "终态后不可再写匹配", () =>
      evalSvc.createRequirementMatch(actorA, {
        candidateId: candidate.id, requirementKey: "R-002", verdict: "PASS", evidence: [], evaluatedBy: "HUMAN",
      }));
    await expectErr("RUN_IMMUTABLE", "终态 Run 不可再挂新信号", () =>
      signalSvc.createSubmittedSignal(actorA, { rawText: "late signal", manualEntry: true, searchRunId: run.id }));

    console.log("\n== T11 历史可重现（A–F）==");
    const candidateBefore = frozen(await db.supplierCandidate.findUnique({ where: { id: candidate.id } }));
    const matchBefore = frozen(await db.supplierRequirementMatch.findUnique({ where: { id: match.id } }));
    const runSnapshotBefore = frozen((await db.supplierSearchRun.findUnique({ where: { id: run.id } }))?.requirementSnapshotJson);

    // A. Tender requirement 变化（模拟：canonical 需求后续更新——Run 快照不受影响，直接对比快照）
    // B. Supplier 档案变化
    await db.supplier.update({ where: { id: supplierA.id }, data: { name: `改名工厂 ${tag}`, region: "东莞", website: "https://renamed.example" } });
    // C/D/E. Offering 价格 / 属性 / 交期变化
    await certSvc.updateOffering(actorA, offering.id, {
      unitPrice: 999, priceStatus: "ESTIMATED", attributes: { material: "AL7075", ip: "IP68" }, leadTimeDays: 60,
    });
    // F. 认证到期
    await certSvc.updateCertificationStatus(actorA, cert.id, "EXPIRED", "2027 前到期演练");

    const candidateAfter = frozen(await db.supplierCandidate.findUnique({ where: { id: candidate.id } }));
    const matchAfter = frozen(await db.supplierRequirementMatch.findUnique({ where: { id: match.id } }));
    const runSnapshotAfter = frozen((await db.supplierSearchRun.findUnique({ where: { id: run.id } }))?.requirementSnapshotJson);
    try {
      assert.deepEqual(runSnapshotAfter, runSnapshotBefore);
      ok(true, "T11-A：需求快照逐字不变");
    } catch { ok(false, "T11-A：需求快照逐字不变"); }
    try {
      assert.deepEqual(candidateAfter, candidateBefore);
      ok(true, "T11-B/C/D/E：候选行（含供应商/offering 快照与分数字段）逐字不变");
    } catch (e) { ok(false, "T11-B/C/D/E：候选行逐字不变", e instanceof Error ? e.message.slice(0, 200) : ""); }
    try {
      assert.deepEqual(matchAfter, matchBefore);
      ok(true, "T11-F：匹配行与认证证据快照逐字不变（EXPIRED 不回写历史）");
    } catch { ok(false, "T11-F：匹配行与认证证据快照逐字不变"); }

    // 新 Run 才反映最新状态
    const run2 = await runSvc.createSearchRun(actorA, { brief: { productKeywords: ["铝壳"] }, requirements });
    await runSvc.startSearchRun(actorA, run2.id);
    const candidate2 = await evalSvc.createSupplierCandidate(actorA, {
      searchRunId: run2.id, supplierId: supplierA.id, offeringId: offering.id, originSource: "MEMORY",
    });
    const supSnap2 = candidate2.supplierSnapshotJson as Record<string, unknown>;
    const offSnap2 = candidate2.offeringSnapshotJson as Record<string, unknown>;
    ok(supSnap2.name === `改名工厂 ${tag}` && offSnap2.unitPrice === "999" && offSnap2.leadTimeDays === 60, "新 Run 反映最新供应商/offering 状态");
    const match2 = await evalSvc.createRequirementMatch(actorA, {
      candidateId: candidate2.id, requirementKey: "R-001", verdict: "UNKNOWN",
      explanation: "证书已过期，待重新验证",
      evidence: [{ kind: "certification", certificationId: cert.id }], evaluatedBy: "HUMAN",
    });
    const evi2 = (match2.evidenceJson as Array<Record<string, unknown>>)[0];
    ok(evi2.statusAtEvaluation === "EXPIRED", "新 Run 的认证证据读取最新状态（EXPIRED）");

    console.log("\n== T16 供应商删除守卫 ==");
    await expectErr("SUPPLIER_HAS_INTELLIGENCE_HISTORY", "有情报历史的供应商删除被受控拒绝", () =>
      supplierSvc.deleteSupplier(supplierA.id));
    ok(
      Boolean(await db.supplierCandidate.findUnique({ where: { id: candidate.id } })) &&
        Boolean(await db.supplierSearchRun.findUnique({ where: { id: run.id } })),
      "拒删后历史 Run/候选完好存活（无级联）",
    );
    await supplierSvc.deleteSupplier(supplierLoner.id);
    ok((await db.supplier.findUnique({ where: { id: supplierLoner.id } })) === null, "无情报历史的供应商仍可正常删除（对照）");
  } finally {
    // ---------------- Teardown（FK Restrict → 子先删）----------------
    const orgIds = [orgA.id, orgB.id];
    await db.supplierRequirementMatch.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.supplierCandidate.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.supplierCapabilitySignal.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.supplierDiscoverySignal.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.supplierCertification.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.supplierOffering.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.supplierSearchRun.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.supplier.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.auditLog.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.project.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.organizationMember.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.organization.deleteMany({ where: { id: { in: orgIds } } });
    await db.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
    await db.$disconnect();
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Supplier Intel S1 集成测试异常:", e);
  process.exit(1);
});
