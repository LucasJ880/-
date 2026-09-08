/**
 * Supplier Intelligence S2 Final Remediation — DB 集成（隔离库执行，否则跳过）
 *
 * 运行：
 *   DATABASE_URL=... DIRECT_URL=... NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *     npx tsx src/lib/supplier-intel/__tests__/supplier-intel-s2rem-db.isolated.test.ts
 *
 * 覆盖：
 *   BL-2  扫描完整性真实服务路径：生产分页 / 供应商扫描触顶 / LINKED 史触顶（另一类完整但整体不完整）/
 *         页边界正常穷尽 / 跨 org 隔离；resolutionJson 追加（旧快照不改写）+ 扫描状态与原因真实持久化。
 *   BL-3  canonical requirement 边界行为：客户端伪造 requirements / mandatory=false 不影响快照；
 *         额外字段按现有契约忽略；无项目权限 → canonical 数据不可读、LLM/provider 调用数 = 0。
 *   BL-4  Run 收口真实持久化：全部已执行源 FAILED → FAILED（状态档 + 审计）；EMPTY+FAILED → COMPLETED；
 *         已终态（CANCELLED）不被收口覆盖。
 */
import { isDeepStrictEqual } from "node:util";
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function requireIsolatedTestDb(): void {
  if (!process.env.DATABASE_URL?.trim()) {
    console.log("⏭  跳过 S2-REM DB 测试（未提供 DATABASE_URL）");
    process.exit(0);
  }
  if (process.env.NODE_ENV !== "test") {
    console.log("⏭  跳过 S2-REM DB 测试（需 NODE_ENV=test）");
    process.exit(0);
  }
  if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") {
    console.log("⏭  跳过 S2-REM DB 测试（需 DATABASE_ENVIRONMENT=isolated）");
    process.exit(0);
  }
  assertSafeTestDatabase({ scriptName: "supplier-intel s2 final-remediation regression" });
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

function frozen(v: unknown): unknown {
  return JSON.parse(JSON.stringify(v));
}

/** jsonb 会规范化键序：持久快照与返回值的一致性用键序无关的深比较 */
function sameJson(a: unknown, b: unknown): boolean {
  return isDeepStrictEqual(frozen(a), frozen(b));
}

async function main() {
  requireIsolatedTestDb();
  const { db } = await import("@/lib/db");
  const { isSupplierIntelError } = await import("../errors");
  const er = await import("../entity-resolution");
  const signalSvc = await import("../signal-service");
  const projectRunSvc = await import("../project-run-service");
  const runSvc = await import("../run-service");
  const discovery = await import("../discovery-service");
  type Provider = import("../providers").DiscoveryProvider;
  type LlmInvoker = import("@/lib/tender-understanding/llm").LlmInvoker;

  async function expectErr(code: string, name: string, fn: () => Promise<unknown>) {
    try {
      await fn();
      ok(false, `${name}（期望抛 ${code}，实际成功）`);
    } catch (e) {
      if (isSupplierIntelError(e, code as never)) ok(true, name);
      else ok(false, name, e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    }
  }

  const tag = `s2rem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // ---------------- Fixture ----------------
  const userOwner = await db.user.create({
    data: { email: `rem_owner_${tag}@test.qingyan.local`, name: "REMOwner", role: "user", status: "active" },
  });
  const userPlain = await db.user.create({
    data: { email: `rem_plain_${tag}@test.qingyan.local`, name: "REMPlain", role: "user", status: "active" },
  });
  const orgA = await db.organization.create({
    data: { name: `REM Org ${tag}`, code: `rem_${tag}`, ownerId: userOwner.id, status: "active" },
  });
  await db.organizationMember.createMany({
    data: [
      { orgId: orgA.id, userId: userOwner.id, role: "org_admin", status: "active" },
      { orgId: orgA.id, userId: userPlain.id, role: "org_member", status: "active" },
    ],
  });
  const projectA = await db.project.create({
    data: { orgId: orgA.id, name: `REM Proj ${tag}`, ownerId: userOwner.id, workDomain: "tender", intakeStatus: "dispatched" },
  });
  const analysisA = await db.tenderAnalysisRun.create({
    data: { orgId: orgA.id, projectId: projectA.id, status: "APPROVED", idempotencyKey: `rem_a_${tag}`, sourceHashFingerprint: "rem-fixture" },
  });
  const reqSeed = [
    { code: "R-001", text: "ANSI/BIFMA X5.1 certification required", mandatory: true },
    { code: "R-002", text: "300 lb minimum weight capacity", mandatory: true },
    { code: "R-003", text: "mesh back preferred", mandatory: false },
    { code: "R-004", text: "on-site assembly may be required", mandatory: false },
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
      structuredJson: { risks: [{ id: "RISK-001", reasonCode: "MANDATORY_UNCERTAIN", relatedRequirementIds: ["R-004"] }] },
    },
  });

  const ownerActor = { orgId: orgA.id, userId: userOwner.id };
  const plainActor = { orgId: orgA.id, userId: userPlain.id };

  // 另一 org：用于 LINKED 史触顶 / 跨 org 隔离（供应商数少，便于隔离两类扫描）
  const userL = await db.user.create({
    data: { email: `rem_l_${tag}@test.qingyan.local`, name: "REML", role: "user", status: "active" },
  });
  const orgL = await db.organization.create({
    data: { name: `REM OrgL ${tag}`, code: `reml_${tag}`, ownerId: userL.id, status: "active" },
  });
  await db.organizationMember.create({ data: { orgId: orgL.id, userId: userL.id, role: "org_admin", status: "active" } });
  const actorL = { orgId: orgL.id, userId: userL.id };

  const cleanupOrgs = [orgA.id, orgL.id];
  const cleanupUsers = [userOwner.id, userPlain.id, userL.id];

  try {
    console.log("\n== BL-2：扫描完整性真实服务路径 ==");
    const supTarget = await db.supplier.create({
      data: { orgId: orgA.id, name: `REM 目标供应商 ${tag}`, website: "https://rem-target-site.example", createdById: userOwner.id },
    });
    for (let i = 0; i < 4; i++) {
      await db.supplier.create({ data: { orgId: orgA.id, name: `REM 填充供应商${i} ${tag}`, createdById: userOwner.id } });
    }
    const sigSite = await signalSvc.createSubmittedSignal(ownerActor, {
      url: "https://rem-target-site.example/contact",
      rawText: "官网线索",
    });

    // D1：生产分页（500×40）→ 扫描完整 → MATCHED_EXISTING；scan 与快照一致
    const r1 = await er.resolveSignalEntity(ownerActor, sigSite.id);
    ok(r1.decision === "MATCHED_EXISTING" && r1.supplierId === supTarget.id, "BL-2-D1：生产分页扫描完整 → 官网强键 MATCHED_EXISTING 预填");
    ok(
      r1.scan.complete && r1.scan.reasonCode === null && r1.scan.pageSize === 500 && r1.scan.maxPages === 40 &&
        r1.scan.suppliers.complete && r1.scan.linkedHistory.complete && r1.scan.suppliers.rows === 5,
      "BL-2-D1：生产入口固定 500/页×40 页；两类扫描完整；rows 如实（5 家 active 供应商）",
      JSON.stringify(r1.scan),
    );
    const row1 = await db.supplierDiscoverySignal.findUnique({ where: { id: sigSite.id } });
    const entries1 = row1?.resolutionJson as Array<Record<string, unknown>>;
    ok(Array.isArray(entries1) && entries1.length === 1, "BL-2-D1：resolutionJson 追加 1 条 AUTO_PREFILL");
    const snap1 = frozen(entries1[0]);
    ok(
      sameJson(entries1[0].scan, r1.scan) && sameJson((entries1[0].result as { scan: unknown }).scan, r1.scan) &&
        sameJson(entries1[0].result, r1),
      "BL-2-D1：持久快照的 scan（顶层 + result.scan）与返回值一致（键序无关）",
    );
    const recorded1 = er.readIdentityScanFromResolutionEntry(entries1[0]);
    ok(recorded1.recorded === true && recorded1.recorded && recorded1.scan.complete === true, "BL-2-D1：持久条目可被读回为已记录的完整扫描");

    // D2：供应商扫描触顶（pageSize 2 × maxPages 1，5 家供应商）→ 本可 MATCHED 的强命中一律人审
    const r2 = await er.resolveSignalEntityWithPagination(ownerActor, sigSite.id, { pageSize: 2, maxPages: 1 });
    ok(
      r2.decision === "NEEDS_HUMAN_REVIEW" && r2.supplierId === undefined,
      "BL-2-D2：供应商扫描触顶 → NEEDS_HUMAN_REVIEW 且 supplierId 为空（不完整不 MATCHED）",
      JSON.stringify({ d: r2.decision, s: r2.supplierId }),
    );
    ok(
      !r2.scan.complete && r2.scan.reasonCode === "IDENTITY_SCAN_INCOMPLETE" &&
        r2.scan.suppliers.complete === false && r2.scan.suppliers.capped === true && r2.scan.suppliers.pages === 1 && r2.scan.suppliers.rows === 2 &&
        r2.scan.linkedHistory.complete === true && r2.scan.pageSize === 2 && r2.scan.maxPages === 1,
      "BL-2-D2：scan 分别记录：suppliers 触顶（1 页 2 行 capped）、linkedHistory 完整；reasonCode=IDENTITY_SCAN_INCOMPLETE",
      JSON.stringify(r2.scan),
    );
    ok(
      r2.conflicts.some((c) => c.startsWith("IDENTITY_SCAN_INCOMPLETE：") && c.includes("suppliers=incomplete") && c.includes("linkedHistory=complete")),
      "BL-2-D2：conflicts 显式记录 IDENTITY_SCAN_INCOMPLETE（含两类扫描状态）",
      JSON.stringify(r2.conflicts),
    );
    const row2 = await db.supplierDiscoverySignal.findUnique({ where: { id: sigSite.id } });
    const entries2 = row2?.resolutionJson as Array<Record<string, unknown>>;
    ok(entries2.length === 2, "BL-2-D2：resolutionJson 追加为 2 条（append，不覆盖）");
    ok(sameJson(entries2[0], snap1), "BL-2-D2：旧快照内容不变（不改写历史；键序无关深比较）");
    ok(
      sameJson(entries2[1].scan, r2.scan) && sameJson(entries2[1].result, r2) &&
        (entries2[1].scan as { reasonCode: string }).reasonCode === "IDENTITY_SCAN_INCOMPLETE" &&
        (entries2[1].result as { decision: string }).decision === "NEEDS_HUMAN_REVIEW",
      "BL-2-D2：扫描状态与原因真实持久化，且与返回值一致（键序无关）",
    );

    // 页边界：pageSize 2 × maxPages 10 → 5 家供应商分 3 页穷尽 → 完整 → 仍 MATCHED
    const r2b = await er.resolveSignalEntityWithPagination(ownerActor, sigSite.id, { pageSize: 2, maxPages: 10 });
    ok(
      r2b.decision === "MATCHED_EXISTING" && r2b.supplierId === supTarget.id && r2b.scan.complete &&
        r2b.scan.suppliers.pages === 3 && r2b.scan.suppliers.rows === 5 && r2b.scan.suppliers.capped === false,
      "BL-2-D2b：页边界正常穷尽（2/页 → 3 页 5 行）→ 完整 → MATCHED_EXISTING",
      JSON.stringify(r2b.scan.suppliers),
    );

    // D3：LINKED 史触顶（orgL：2 家供应商 + 5 条 LINKED 精确账号史）→ suppliers 完整、linkedHistory 触顶 → 整体不完整
    const supLX = await db.supplier.create({ data: { orgId: orgL.id, name: `L 工厂X ${tag}`, createdById: userL.id } });
    await db.supplier.create({ data: { orgId: orgL.id, name: `L 工厂Y ${tag}`, createdById: userL.id } });
    await db.supplierDiscoverySignal.createMany({
      data: Array.from({ length: 5 }, (_, i) => ({
        orgId: orgL.id,
        platform: "DOUYIN",
        contentType: "POST",
        sourceOrigin: "USER_SUBMITTED",
        contentUrl: `https://www.douyin.com/user/rem_account_l?i=${i}`,
        status: "LINKED",
        linkedSupplierId: supLX.id,
      })),
    });
    const sigL = await signalSvc.createSubmittedSignal(actorL, { url: "https://www.douyin.com/user/rem_account_l", rawText: "L 账号新信号" });
    const r3 = await er.resolveSignalEntityWithPagination(actorL, sigL.id, { pageSize: 4, maxPages: 1 });
    ok(
      r3.scan.suppliers.complete === true && r3.scan.suppliers.rows === 2 &&
        r3.scan.linkedHistory.complete === false && r3.scan.linkedHistory.capped === true && r3.scan.linkedHistory.rows === 4 &&
        r3.scan.complete === false,
      "BL-2-D3：LINKED 史触顶（4 行满页、页数用尽）而供应商扫描完整 → 整体不完整",
      JSON.stringify(r3.scan),
    );
    ok(
      r3.decision === "NEEDS_HUMAN_REVIEW" && r3.supplierId === undefined &&
        r3.matchedSources.some((m) => m.kind === "platform_account" && m.supplierId === supLX.id),
      "BL-2-D3：本可 MATCHED 的账号强命中 → 人审，但命中证据保留",
      JSON.stringify({ d: r3.decision, m: r3.matchedSources }),
    );
    const rowL = await db.supplierDiscoverySignal.findUnique({ where: { id: sigL.id } });
    const entriesL = rowL?.resolutionJson as Array<Record<string, unknown>>;
    ok(
      (entriesL[0].scan as { linkedHistory: { complete: boolean } }).linkedHistory.complete === false,
      "BL-2-D3：linkedHistory 不完整真实持久化",
    );

    // D4：页边界正常穷尽（2/页 × 10 页）：LINKED 5 行 → 3 页；供应商 2 行 → 2 页 → 完整 → MATCHED
    const r4 = await er.resolveSignalEntityWithPagination(actorL, sigL.id, { pageSize: 2, maxPages: 10 });
    ok(
      r4.decision === "MATCHED_EXISTING" && r4.supplierId === supLX.id && r4.scan.complete &&
        r4.scan.linkedHistory.pages === 3 && r4.scan.linkedHistory.rows === 5 && r4.scan.suppliers.pages === 2 && r4.scan.suppliers.rows === 2,
      "BL-2-D4：跨页正常穷尽 → 完整 → 同一精确账号 MATCHED_EXISTING 预填",
      JSON.stringify(r4.scan),
    );
    const rowL2 = await db.supplierDiscoverySignal.findUnique({ where: { id: sigL.id } });
    ok(
      ((rowL2?.resolutionJson as unknown[]) ?? []).length === 2 &&
        sameJson((rowL2?.resolutionJson as unknown[])[0], entriesL[0]),
      "BL-2-D4：第二次解析 append，第一条（不完整）快照原样保留",
    );

    // D5：跨 org 隔离——orgA 的供应商/LINKED 不进 orgL 的扫描计数与身份集合
    ok(r4.scan.suppliers.rows === 2 && r4.scan.linkedHistory.rows === 5, "BL-2-D5：orgL 扫描行数只含本 org（orgA 的 5 家供应商 / LINKED 不计入）");
    const sigCross = await signalSvc.createSubmittedSignal(actorL, { url: "https://rem-target-site.example/about", rawText: "他 org 官网域名" });
    const r5 = await er.resolveSignalEntity(actorL, sigCross.id);
    ok(r5.decision === "NEW_SUPPLIER_CANDIDATE" && r5.supplierId === undefined, "BL-2-D5：他 org 供应商的官网域名在本 org 不匹配（跨 org 零泄漏）");
    ok(r5.scan.complete === true, "BL-2-D5：小 org 生产分页一页穷尽 → 完整");

    // D6：注入点只能收窄，不能放宽生产上限
    const r6 = await er.resolveSignalEntityWithPagination(ownerActor, sigSite.id, { pageSize: 9999, maxPages: 9999 });
    ok(r6.scan.pageSize === 500 && r6.scan.maxPages === 40 && r6.scan.complete, "BL-2-D6：分页注入被钳制在生产上限 500×40（不能放宽）");

    console.log("\n== BL-3：canonical requirement 边界行为 ==");
    let llmCalls = 0;
    const countingInvoker: LlmInvoker = async () => {
      llmCalls += 1;
      return { content: '{"commercialZh":[],"capabilityZh":[],"socialZh":[],"en":[]}', model: "fake", usage: null } as never;
    };
    // E1/E2：客户端伪造 requirements（含 mandatory=false 降级）——结构上不进快照
    const forged = await projectRunSvc.createProjectSearchRun(ownerActor, {
      projectId: projectA.id,
      allowLlm: false,
      hints: { productKeywordsZh: ["人体工学办公椅"], requirements: [{ code: "R-001", mandatory: false }] } as never,
      requirements: [{ id: "x", code: "R-001", text: "forged", mandatory: false, mandatorySignal: null }],
    } as never);
    const snapshot = forged.requirementSnapshotJson as Array<{ code: string; mandatory: unknown }>;
    const byCode = new Map(snapshot.map((e) => [e.code, e.mandatory]));
    ok(snapshot.length === 4 && byCode.get("R-001") === true && byCode.get("R-002") === true, "BL-3-E1：伪造 requirements 不能覆盖 canonical 快照（R-001 仍 mandatory=true，4 条全量）");
    ok(byCode.get("R-004") === "uncertain" && byCode.get("R-003") === false, "BL-3-E2：客户端把 mandatory 改成 false 不改变 canonical uncertain/false 语义");
    ok(!snapshot.some((e) => (e as { text?: string }).text === "forged"), "BL-3-E1：伪造条目零落地");
    // E3：额外字段按现有契约忽略（不改 HTTP 契约；服务层白名单拷贝）
    const extra = await projectRunSvc.createProjectSearchRun(ownerActor, {
      projectId: projectA.id,
      allowLlm: false,
      hints: { productKeywordsZh: ["办公椅"], extraField: "ignored" },
      unknownTopLevel: { budget: 1 },
    } as never);
    const serialized = JSON.stringify({ b: extra.briefSnapshotJson, s: extra.sourceConfigJson, q: extra.queriesJson });
    ok(!serialized.includes("extraField") && !serialized.includes("unknownTopLevel") && !serialized.includes("ignored"), "BL-3-E3：额外字段被忽略，不进任何快照");
    // E4：无项目权限 → canonical 数据不可读；LLM 调用 = 0；provider 调用 = 0
    llmCalls = 0;
    await expectErr("PROJECT_ACCESS_DENIED", "BL-3-E4a：org 成员无项目身份 → create run（allowLlm=true）拒绝", () =>
      projectRunSvc.createProjectSearchRun(plainActor, { projectId: projectA.id, allowLlm: true }, { invoker: countingInvoker }));
    ok(llmCalls === 0, "BL-3-E4b：无权限路径 LLM 调用数 = 0（授权先于需求读取与 brief/LLM）");
    await expectErr("PROJECT_ACCESS_DENIED", "BL-3-E4c：无权限读取 run（含 canonical 快照）拒绝", () =>
      projectRunSvc.getProjectSearchRun(plainActor, forged.id));
    await runSvc.startSearchRun(ownerActor, forged.id);
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
    await expectErr("PROJECT_ACCESS_DENIED", "BL-3-E4d：无权限 discover 拒绝", () =>
      discovery.executeSupplierSearchRun(plainActor, forged.id, { provider: countingProvider }));
    ok(providerCalls === 0, "BL-3-E4e：无权限路径 provider 调用数 = 0");

    console.log("\n== BL-4：Run 收口真实持久化 ==");
    // F1：全部已执行源 FAILED → Run FAILED（内部池关闭，避免内部源 SUCCESS 稀释）
    const failing: Provider = {
      providerId: "fake-failing",
      policy: { respectsRobots: true, requiresPlatformLogin: false, dataLicense: "test" },
      isAvailable: () => true,
      search: async () => ({ status: "PROVIDER_ERROR", results: [] }),
    };
    const resF1 = await discovery.executeSupplierSearchRun(ownerActor, forged.id, { provider: failing, includeInternalPool: false });
    const runF1 = await db.supplierSearchRun.findUnique({ where: { id: forged.id } });
    const sourcesF1 = (runF1?.statusDetailJson as { sources: Record<string, { status: string; reason?: string | null }> })?.sources ?? {};
    ok(resF1.runStatus === "FAILED" && runF1?.status === "FAILED" && runF1.completedAt !== null, "BL-4-F1：全部已执行源 FAILED → Run 持久化 FAILED（completedAt 落档）", JSON.stringify({ r: resF1.runStatus, s: runF1?.status }));
    ok(
      ["DOUYIN", "XIAOHONGSHU", "OPEN_WEB"].every((k) => sourcesF1[k]?.status === "FAILED" && sourcesF1[k]?.reason === "PROVIDER_ERROR"),
      "BL-4-F1：三个外部源状态档 FAILED + 原因 PROVIDER_ERROR",
      JSON.stringify(sourcesF1),
    );
    ok(sourcesF1.WECHAT_CHANNELS?.status === "DISABLED", "BL-4-F1：DISABLED 源保持 DISABLED（不伪装成执行源）");
    ok(
      ["memory", "historical", "saved"].every((k) => sourcesF1[k]?.status === "PLANNED"),
      "BL-4-F1：内部池关闭时内部源保持 PLANNED（未执行，不计入全失败判定）",
    );
    const auditFailed = await db.auditLog.count({ where: { orgId: orgA.id, targetId: forged.id, action: "supplier_intel.search.source_failed" } });
    const auditRunFailed = await db.auditLog.count({ where: { orgId: orgA.id, targetId: forged.id, action: "supplier_intel.run.failed" } });
    ok(auditFailed === 3 && auditRunFailed === 1, "BL-4-F1：审计：3 条 source_failed + 1 条 run.failed", JSON.stringify({ auditFailed, auditRunFailed }));
    await expectErr("RUN_NOT_RUNNING", "BL-4-F1：FAILED 终态不可再执行（重评估=新 Run）", () =>
      discovery.executeSupplierSearchRun(ownerActor, forged.id, { provider: failing }));

    // F2：EMPTY + FAILED → COMPLETED（EMPTY 不改判为错误），源级失败详情保留
    const runF2 = await projectRunSvc.createProjectSearchRun(ownerActor, { projectId: projectA.id, allowLlm: false, hints: { productKeywordsZh: ["办公椅"] } });
    await runSvc.startSearchRun(ownerActor, runF2.id);
    const mixed: Provider = {
      ...failing,
      providerId: "fake-mixed",
      search: async (q) => (q.startsWith("site:xiaohongshu.com") ? { status: "EMPTY", results: [] } : { status: "PROVIDER_ERROR", results: [] }),
    };
    const resF2 = await discovery.executeSupplierSearchRun(ownerActor, runF2.id, { provider: mixed, includeInternalPool: false });
    const rowF2 = await db.supplierSearchRun.findUnique({ where: { id: runF2.id } });
    const sourcesF2 = (rowF2?.statusDetailJson as { sources: Record<string, { status: string; reason?: string | null }> })?.sources ?? {};
    ok(resF2.runStatus === "COMPLETED" && rowF2?.status === "COMPLETED", "BL-4-F2：至少一个 EMPTY 其余 FAILED → COMPLETED 持久化");
    ok(sourcesF2.XIAOHONGSHU?.status === "EMPTY" && sourcesF2.DOUYIN?.status === "FAILED" && sourcesF2.OPEN_WEB?.status === "FAILED", "BL-4-F2：EMPTY 保持 EMPTY，失败源详情保留", JSON.stringify(sourcesF2));

    // F3：已终态（CANCELLED）不被收口覆盖；晚到执行被拒
    const runF3 = await projectRunSvc.createProjectSearchRun(ownerActor, { projectId: projectA.id, allowLlm: false, hints: { productKeywordsZh: ["办公椅"] } });
    await runSvc.startSearchRun(ownerActor, runF3.id);
    await runSvc.cancelSearchRun(ownerActor, runF3.id);
    await expectErr("INVALID_RUN_TRANSITION", "BL-4-F3：CANCELLED 后 completeSearchRun 被拒（终态不可覆盖）", () =>
      runSvc.completeSearchRun(ownerActor, runF3.id, { status: "late" }));
    await expectErr("INVALID_RUN_TRANSITION", "BL-4-F3：CANCELLED 后 failSearchRun 被拒", () =>
      runSvc.failSearchRun(ownerActor, runF3.id, "late"));
    await expectErr("RUN_NOT_RUNNING", "BL-4-F3：CANCELLED 后 execute 被拒（晚到执行不写入）", () =>
      discovery.executeSupplierSearchRun(ownerActor, runF3.id, { provider: failing }));
    const rowF3 = await db.supplierSearchRun.findUnique({ where: { id: runF3.id } });
    ok(rowF3?.status === "CANCELLED" && rowF3.statusDetailJson === null, "BL-4-F3：Run 保持 CANCELLED，状态档未被收口覆盖");
  } finally {
    await db.supplierRequirementMatch.deleteMany({ where: { orgId: { in: cleanupOrgs } } });
    await db.supplierCandidate.deleteMany({ where: { orgId: { in: cleanupOrgs } } });
    await db.supplierCapabilitySignal.deleteMany({ where: { orgId: { in: cleanupOrgs } } });
    await db.supplierDiscoverySignal.deleteMany({ where: { orgId: { in: cleanupOrgs } } });
    await db.supplierCertification.deleteMany({ where: { orgId: { in: cleanupOrgs } } });
    await db.supplierOffering.deleteMany({ where: { orgId: { in: cleanupOrgs } } });
    await db.supplierSearchRun.deleteMany({ where: { orgId: { in: cleanupOrgs } } });
    await db.supplier.deleteMany({ where: { orgId: { in: cleanupOrgs } } });
    await db.tenderExtractedRequirement.deleteMany({ where: { project: { orgId: { in: cleanupOrgs } } } });
    await db.tenderAnalysisSection.deleteMany({ where: { run: { orgId: { in: cleanupOrgs } } } });
    await db.tenderAnalysisRun.deleteMany({ where: { orgId: { in: cleanupOrgs } } });
    await db.projectMember.deleteMany({ where: { project: { orgId: { in: cleanupOrgs } } } });
    await db.auditLog.deleteMany({ where: { orgId: { in: cleanupOrgs } } });
    await db.project.deleteMany({ where: { orgId: { in: cleanupOrgs } } });
    await db.organizationMember.deleteMany({ where: { orgId: { in: cleanupOrgs } } });
    await db.organization.deleteMany({ where: { id: { in: cleanupOrgs } } });
    await db.user.deleteMany({ where: { id: { in: cleanupUsers } } });
    await db.$disconnect();
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("S2-REM 集成测试异常:", e);
  process.exit(1);
});
