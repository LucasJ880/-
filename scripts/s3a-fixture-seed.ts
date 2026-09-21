/**
 * S3-A 隔离库验收夹具（仅用于本地/隔离环境；绝不对生产运行）。
 *
 * 造一个完整的「加拿大 Tender → 国内采购」场景：
 *   org（allowlist 内）+ 三种权限用户 + 三个项目（成品 / 定制 / 供货+安装）
 *   + canonical 分析（REVIEW_REQUIRED/APPROVED）+ 需求行（三值 mandatory）
 *   + RISKS 节（真实 writer 形状）+ 若干既有供应商。
 *
 * 运行：node --env-file=<isolated env> --import tsx scripts/... （见 S3-A 交付报告）
 */
import bcrypt from "bcryptjs";
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function requireIsolated(): void {
  if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") {
    console.error("拒绝执行：需要 DATABASE_ENVIRONMENT=isolated");
    process.exit(1);
  }
  assertSafeTestDatabase({ scriptName: "supplier-intel s3a fixture seed" });
}

async function main() {
  requireIsolated();
  const { db } = await import("@/lib/db");
  const { buildCanonicalRisksStructuredJson } = await import(
    "@/lib/supplier-intel/__tests__/fixtures/canonical-risks-writer"
  );

  const TAG = process.env.S3A_FIXTURE_TAG || "s3a";
  const PASSWORD = process.env.S3A_FIXTURE_PASSWORD || "s3a-demo-pass";
  const hash = await bcrypt.hash(PASSWORD, 10);

  const mkUser = (slug: string, name: string) =>
    db.user.upsert({
      where: { email: `${slug}_${TAG}@test.qingyan.local` },
      update: { passwordHash: hash, status: "active" },
      create: {
        email: `${slug}_${TAG}@test.qingyan.local`,
        name,
        role: "user",
        status: "active",
        passwordHash: hash,
      },
    });

  const buyer = await mkUser("buyer", "采购-张工");        // 项目写权限
  const viewer = await mkUser("viewer", "只读-李");         // 项目只读
  const outsider = await mkUser("outsider", "他项目-王");   // 同 org 无本项目权限

  const org = await db.organization.upsert({
    where: { code: `s3a_${TAG}` },
    update: {},
    create: { name: `S3A 演示组织 ${TAG}`, code: `s3a_${TAG}`, ownerId: buyer.id, status: "active" },
  });
  for (const [u, role] of [
    [buyer, "org_member"],
    [viewer, "org_member"],
    [outsider, "org_member"],
  ] as const) {
    await db.organizationMember.upsert({
      where: { orgId_userId: { orgId: org.id, userId: u.id } },
      update: { role, status: "active" },
      create: { orgId: org.id, userId: u.id, role, status: "active" },
    });
    await db.user.update({ where: { id: u.id }, data: { activeOrgId: org.id } });
  }

  // S3-B：另一个组织里的用户——用来证明供应商证据页跨 org 一律 404 且零业务内容
  const stranger = await mkUser("stranger", "他组织-赵");
  const otherOrg = await db.organization.upsert({
    where: { code: `s3a_${TAG}_other` },
    update: {},
    create: { name: `S3A 他组织 ${TAG}`, code: `s3a_${TAG}_other`, ownerId: stranger.id, status: "active" },
  });
  await db.organizationMember.upsert({
    where: { orgId_userId: { orgId: otherOrg.id, userId: stranger.id } },
    update: { role: "org_admin", status: "active" },
    create: { orgId: otherOrg.id, userId: stranger.id, role: "org_admin", status: "active" },
  });
  await db.user.update({ where: { id: stranger.id }, data: { activeOrgId: otherOrg.id } });

  type Spec = {
    key: string;
    name: string;
    scenario: string;
    reqs: Array<{
      code: string;
      en: string;
      zh: string;
      category: string;
      mandatory: true | false | "uncertain";
      quantity?: string;
      unit?: string;
    }>;
  };

  const SPECS: Spec[] = [
    {
      key: "standard",
      name: `[演示] 标准成品采购 — 办公椅 ${TAG}`,
      scenario: "标准成品采购",
      reqs: [
        { code: "R-001", en: "Chairs shall be certified to ANSI/BIFMA X5.1.", zh: "座椅须通过 ANSI/BIFMA X5.1 认证。", category: "safety", mandatory: true },
        { code: "R-002", en: "Minimum weight capacity 300 lb.", zh: "最小承重 300 磅。", category: "technical", mandatory: true, quantity: "300", unit: "lb" },
        { code: "R-003", en: "Quantity: 750 units.", zh: "数量：750 张。", category: "product", mandatory: true, quantity: "750", unit: "units" },
        { code: "R-004", en: "Mesh back preferred.", zh: "优先选用网布靠背。", category: "product", mandatory: false },
        { code: "R-005", en: "Supplier may be required to provide a sample chair.", zh: "供应商可能需要提供样椅。", category: "samples", mandatory: "uncertain" },
      ],
    },
    {
      key: "custom",
      name: `[演示] 定制规格采购 — 实验台 ${TAG}`,
      scenario: "需要定制规格的产品",
      reqs: [
        { code: "R-001", en: "Bench tops shall be epoxy resin, 25mm thick.", zh: "台面须为环氧树脂，厚度 25 毫米。", category: "technical", mandatory: true, quantity: "25", unit: "mm" },
        { code: "R-002", en: "Custom widths from 1200mm to 2400mm per room schedule.", zh: "按房间清单定制宽度 1200–2400 毫米。", category: "technical", mandatory: true },
        { code: "R-003", en: "Shop drawings required prior to fabrication.", zh: "生产前须提交深化图纸。", category: "shop_drawings", mandatory: true },
        { code: "R-004", en: "Brand X or approved equivalent.", zh: "X 品牌或经批准的同等产品。", category: "product", mandatory: "uncertain" },
        { code: "R-005", en: "Packaging to be recyclable where practical.", zh: "在可行情况下采用可回收包装。", category: "packaging", mandatory: false },
      ],
    },
    {
      key: "install",
      name: `[演示] 国内供货 + 加拿大安装 — 储物柜 ${TAG}`,
      scenario: "国内供货 + 加拿大本地安装",
      reqs: [
        { code: "R-001", en: "Lockers shall be delivered DDP to Regina, SK.", zh: "储物柜须以 DDP 条件交付至萨省里贾纳。", category: "delivery", mandatory: true },
        { code: "R-002", en: "Installation shall be performed by a local certified installer.", zh: "安装须由本地持证安装商完成。", category: "installation", mandatory: true },
        { code: "R-003", en: "Warranty: 10 years on structure.", zh: "结构质保 10 年。", category: "warranty", mandatory: true, quantity: "10", unit: "years" },
        { code: "R-004", en: "Anchoring hardware to suit concrete walls.", zh: "锚固件须适配混凝土墙体。", category: "installation", mandatory: "uncertain" },
        { code: "R-005", en: "Colour selection from manufacturer standard range.", zh: "颜色从厂家标准色系中选择。", category: "product", mandatory: false },
      ],
    },
  ];

  // S4-A：一个**没有** uncertain 要求的项目——否则硬门永远 INCOMPLETE，验不了 PASS 流程
  SPECS.push({
    key: "evalclean",
    name: `[演示] 标准成品采购（无待确认项）— 会议椅 ${TAG}`,
    scenario: "标准成品采购",
    reqs: [
      { code: "R-001", en: "Chairs shall be certified to ANSI/BIFMA X5.1.", zh: "座椅须通过 ANSI/BIFMA X5.1 认证。", category: "safety", mandatory: true },
      { code: "R-002", en: "Minimum weight capacity 300 lb.", zh: "最小承重 300 磅。", category: "technical", mandatory: true, quantity: "300", unit: "lb" },
      { code: "R-003", en: "Mesh back preferred.", zh: "优先选用网布靠背。", category: "product", mandatory: false },
    ],
  });

  const created: Array<{ key: string; projectId: string; analysisRunId: string }> = [];

  for (const spec of SPECS) {
    const existing = await db.project.findFirst({ where: { orgId: org.id, name: spec.name } });
    const project =
      existing ??
      (await db.project.create({
        data: {
          orgId: org.id,
          name: spec.name,
          ownerId: buyer.id,
          workDomain: "tender",
          intakeStatus: "dispatched",
          status: "active",
          clientOrganization: "City of Example (演示数据)",
          location: "Regina, SK",
        },
      }));

    await db.projectMember.upsert({
      where: { projectId_userId: { projectId: project.id, userId: buyer.id } },
      update: { role: "project_admin", status: "active" },
      create: { projectId: project.id, userId: buyer.id, role: "project_admin", status: "active" },
    });
    await db.projectMember.upsert({
      where: { projectId_userId: { projectId: project.id, userId: viewer.id } },
      update: { role: "viewer", status: "active" },
      create: { projectId: project.id, userId: viewer.id, role: "viewer", status: "active" },
    });

    let run = await db.tenderAnalysisRun.findFirst({
      where: { orgId: org.id, projectId: project.id, status: { in: ["REVIEW_REQUIRED", "APPROVED"] } },
    });
    if (!run) {
      run = await db.tenderAnalysisRun.create({
        data: {
          orgId: org.id,
          projectId: project.id,
          status: "APPROVED",
          idempotencyKey: `s3a_${TAG}_${spec.key}`,
          sourceHashFingerprint: `s3a-fixture-${spec.key}`,
          summaryText: `演示分析：${spec.scenario}`,
        },
      });
      for (const r of spec.reqs) {
        await db.tenderExtractedRequirement.create({
          data: {
            projectId: project.id,
            analysisRunId: run.id,
            requirementCode: r.code,
            category: r.category,
            originalRequirement: r.en,
            chineseTranslation: r.zh,
            // 持久层三值塌缩：uncertain 落库为 false（由 RISKS 聚合还原）
            mandatory: r.mandatory === true,
          },
        });
      }
      await db.tenderAnalysisSection.create({
        data: {
          runId: run.id,
          sectionKey: "RISKS",
          contentZh: "演示：强制性不确定项",
          structuredJson: buildCanonicalRisksStructuredJson(
            spec.reqs.map((r) => ({ code: r.code, mandatory: r.mandatory, statement: r.en })),
          ) as never,
        },
      });
    }
    created.push({ key: spec.key, projectId: project.id, analysisRunId: run.id });
  }

  // 既有供应商（用于「核对是否已有供应商」与身份冲突演示）
  const suppliers = [
    { name: `佛山市演示家具有限公司 ${TAG}`, website: "https://demo-furniture.example" },
    { name: `广东演示金属制品有限公司 ${TAG}`, website: null },
  ];
  for (const s of suppliers) {
    const hit = await db.supplier.findFirst({ where: { orgId: org.id, name: s.name } });
    if (!hit) {
      await db.supplier.create({
        data: { orgId: org.id, name: s.name, website: s.website, createdById: buyer.id },
      });
    }
  }

  /* ═════════ FR4 场景夹具：来源五态 / 历史快照 / 恢复态 ═════════
   *
   * 全部经**真实 service 路径**产生（createProjectSearchRun → executeSupplierSearchRun），
   * 只把 provider 与 adapter 换成确定性的测试实现。刻意不把 provider 选择做成生产 HTTP
   * 参数——那等于给公开入口开一个「换搜索源」的后门。
   */
  const projectByKey = new Map(created.map((c) => [c.key, c.projectId]));
  const actorBuyer = { orgId: org.id, userId: buyer.id };
  const projectRunSvc = await import("@/lib/supplier-intel/project-run-service");
  const runSvc = await import("@/lib/supplier-intel/run-service");
  const { executeSupplierSearchRun } = await import("@/lib/supplier-intel/discovery-service");
  const signalSvc = await import("@/lib/supplier-intel/signal-service");

  const testPolicy = { respectsRobots: true, requiresPlatformLogin: false, dataLicense: "test-fixture" };
  /** 可用的确定性 provider：adapter 自己决定成功/空/失败，provider 本身不被真正调用 */
  const availableProvider = {
    providerId: "s3a-fixture-provider",
    policy: testPolicy,
    isAvailable: () => true,
    search: async () => ({ status: "OK", results: [], failureReason: null }),
  };
  const unavailableProvider = {
    providerId: "s3a-fixture-provider-off",
    policy: testPolicy,
    isAvailable: () => false,
    search: async () => ({ status: "DISABLED", results: [], failureReason: "fixture: disabled" }),
  };
  const mkPlan = (source: string) => [
    {
      source,
      query: `${source} 演示检索词 ${TAG}`,
      language: "zh" as const,
      queryType: "COMMERCIAL" as const,
      priority: 1,
      generatedFrom: ["fixture"],
    },
  ];
  const mkAdapter = (platform: string, mode: "SUCCESS" | "EMPTY" | "FAILED") => ({
    platform,
    buildQueryPlan: () => mkPlan(platform),
    discover: async () => {
      if (mode === "FAILED") {
        return { ok: false as const, code: "PROVIDER_ERROR", message: `演示：${platform} 来源本次失败` };
      }
      return {
        ok: true as const,
        sourceStatus: mode,
        plan: mkPlan(platform),
        drafts:
          mode === "SUCCESS"
            ? [
                {
                  platform: "OPEN_WEB",
                  contentUrl: `https://s3a-fixture-factory.example/${TAG}/a`,
                  title: `[演示夹具] 佛山某家具厂 ${TAG}`,
                  description: "合成夹具数据，不是真实搜到的厂家。",
                  sourceQuery: mkPlan(platform)[0].query,
                },
              ]
            : [],
        noiseFiltered: 0,
        providerStatuses: [mode === "SUCCESS" ? "OK" : "EMPTY"],
        failureReason: null,
        note: null,
      };
    },
  });

  /**
   * 场景重置：验收会**消耗**恢复态夹具（取消 / 继续执行都是破坏性的），
   * 所以每轮验收前重跑本脚本时，先把上一轮的场景数据清掉再重建。
   * 删除严格限定在本夹具 org 内；顺序按外键依赖（候选 → 线索 → Run）。
   */
  const fixtureProjectIds = created.map((c) => c.projectId);
  await db.supplierCertification.deleteMany({ where: { orgId: org.id } });
  // S4-A：需求匹配行引用候选（onDelete Restrict），必须先于候选删除；否则第二次评估验收后重跑夹具会撞 FK
  await db.supplierRequirementMatch.deleteMany({ where: { orgId: org.id } });
  await db.supplierCandidate.deleteMany({ where: { orgId: org.id } });
  await db.supplierOffering.deleteMany({ where: { orgId: org.id } });
  await db.tenderArchiveItem.deleteMany({ where: { orgId: org.id, captureKey: { startsWith: "upload:s3b-" } } });
  await db.supplierCapabilitySignal.deleteMany({ where: { orgId: org.id } });
  await db.supplierDiscoverySignal.deleteMany({ where: { orgId: org.id } });
  await db.supplierSearchRun.deleteMany({ where: { orgId: org.id } });
  // V2 分析也一并重来，保证「V1 快照 Run 早于 V2 分析」这个时序恒成立
  const staleV2 = await db.tenderAnalysisRun.findMany({
    where: { orgId: org.id, idempotencyKey: { startsWith: `s3a_${TAG}_custom_v2` } },
    select: { id: true },
  });
  if (staleV2.length > 0) {
    const v2Ids = staleV2.map((r) => r.id);
    await db.tenderAnalysisSection.deleteMany({ where: { runId: { in: v2Ids } } });
    await db.tenderExtractedRequirement.deleteMany({ where: { analysisRunId: { in: v2Ids } } });
    await db.tenderAnalysisRun.deleteMany({ where: { id: { in: v2Ids } } });
  }
  void fixtureProjectIds;

  const scenarioRuns: Array<{ key: string; runId: string; state: string }> = [];

  // ① custom：来源混合态（SUCCESS + EMPTY + FAILED）
  const customProjectId = projectByKey.get("custom");
  if (customProjectId) {
    const mixed = await projectRunSvc.createProjectSearchRun(actorBuyer, {
      projectId: customProjectId, allowLlm: false,
    });
    await runSvc.startSearchRun(actorBuyer, mixed.id);
    await executeSupplierSearchRun(actorBuyer, mixed.id, {
      finalize: true,
      includeInternalPool: true,
      provider: availableProvider as never,
      adapters: [
        mkAdapter("OPEN_WEB", "SUCCESS"),
        mkAdapter("ONE688", "EMPTY"),
        mkAdapter("XIAOHONGSHU", "FAILED"),
      ] as never,
    });
    scenarioRuns.push({ key: "custom", runId: mixed.id, state: "MIXED_SOURCES" });

    // ② custom：外部整体未启用（全 DISABLED，仅内部源）
    const disabled = await projectRunSvc.createProjectSearchRun(actorBuyer, {
      projectId: customProjectId, allowLlm: false,
    });
    await runSvc.startSearchRun(actorBuyer, disabled.id);
    await executeSupplierSearchRun(actorBuyer, disabled.id, {
      finalize: true,
      includeInternalPool: true,
      provider: unavailableProvider as never,
    });
    scenarioRuns.push({ key: "custom", runId: disabled.id, state: "EXTERNAL_DISABLED" });

    // ③ custom：历史快照——这次 Run 用 V1 需求，随后 canonical 升到 V2
    const v1Run = await projectRunSvc.createProjectSearchRun(actorBuyer, {
      projectId: customProjectId, allowLlm: false,
    });
    await runSvc.startSearchRun(actorBuyer, v1Run.id);
    await runSvc.completeSearchRun(actorBuyer, v1Run.id, { status: "fixture-v1" });
    // 场景重置已经把旧的 V2 删掉，这里总是新建——保证时序：V1 Run 先建，V2 分析后到
    const v2Key = `s3a_${TAG}_custom_v2`;
    {
      const v2 = await db.tenderAnalysisRun.create({
        data: {
          orgId: org.id, projectId: customProjectId, status: "APPROVED",
          idempotencyKey: v2Key, sourceHashFingerprint: `s3a-fixture-custom-v2`,
          summaryText: "演示分析 V2（需求已改版）",
        },
      });
      await db.tenderExtractedRequirement.create({
        data: {
          projectId: customProjectId, analysisRunId: v2.id, requirementCode: "R-V2-ONLY",
          category: "technical",
          originalRequirement: `V2 ONLY REQUIREMENT ${TAG}`,
          chineseTranslation: `仅 V2 才有的新要求 ${TAG}`,
          mandatory: true,
        },
      });
      await db.tenderAnalysisSection.create({
        data: {
          runId: v2.id, sectionKey: "RISKS", contentZh: "V2",
          structuredJson: buildCanonicalRisksStructuredJson([
            { code: "R-V2-ONLY", mandatory: true, statement: `V2 ONLY REQUIREMENT ${TAG}` },
          ]) as never,
        },
      });
    }
    scenarioRuns.push({ key: "custom", runId: v1Run.id, state: "V1_SNAPSHOT" });
  }

  // ④ install：恢复态——PLANNED（从未执行）+ RUNNING 且声明已过期（执行结果未知）
  const installProjectId = projectByKey.get("install");
  if (installProjectId) {
    const planned = await projectRunSvc.createProjectSearchRun(actorBuyer, {
      projectId: installProjectId, allowLlm: false,
    });
    scenarioRuns.push({ key: "install", runId: planned.id, state: "IDLE_PLANNED" });

    const stale = await projectRunSvc.createProjectSearchRun(actorBuyer, {
      projectId: installProjectId, allowLlm: false,
    });
    await runSvc.startSearchRun(actorBuyer, stale.id);
    // 负 TTL = 造出一个「已过期且从未释放」的声明（等价于 executor 中途被杀）
    await runSvc.claimRunExecution(actorBuyer, stale.id, { ttlMs: -1000 });
    scenarioRuns.push({ key: "install", runId: stale.id, state: "RECOVERY_REQUIRED" });

    // FR1 最终收口：**旧格式**声明（无 claimId，且 expiresAt 还在未来）。
    // 早期实现会把它解析成 null → 当成「没有声明」→ IDLE → 直接允许重跑。
    // 现在必须判为不可验证 → RECOVERY_REQUIRED。直接写库造出这种历史行。
    const legacy = await projectRunSvc.createProjectSearchRun(actorBuyer, {
      projectId: installProjectId, allowLlm: false,
    });
    await runSvc.startSearchRun(actorBuyer, legacy.id);
    await db.supplierSearchRun.update({
      where: { id: legacy.id },
      data: {
        statusDetailJson: {
          executionClaim: {
            claimedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
            byUserId: buyer.id,
          },
        } as never,
      },
    });
    scenarioRuns.push({ key: "install", runId: legacy.id, state: "LEGACY_CLAIM" });
  }

  // ⑤ standard：不可信文本线索（XSS 载荷必须以字面文本呈现）
  const standardProjectId = projectByKey.get("standard");
  let xssSignalId: string | null = null;
  if (standardProjectId) {
    const existing = await db.supplierDiscoverySignal.findFirst({
      where: { orgId: org.id, projectId: standardProjectId, rawText: { contains: "onerror" } },
      select: { id: true },
    });
    if (existing) {
      xssSignalId = existing.id;
    } else {
      const created = await signalSvc.createSubmittedSignal(actorBuyer, {
        url: `https://s3a-fixture-factory.example/${TAG}/xss`,
        rawText: `展会线索 <img src=x onerror=alert(1)> <script>alert(2)</script> ${TAG}`,
        manualEntry: true,
        projectId: standardProjectId,
      });
      xssSignalId = created.id;
    }
  }

  /* ═════════ S3-B 夹具：已关联线索 + 档案依据 ═════════
   * 供应商证据页的两个入口：① standard 项目里一条已人工关联到某家供应商的线索；
   * ② custom 项目 MIXED_SOURCES 那次搜索命中的内部候选（上面已由真实 service 路径产生）。
   * 另造一份项目档案条目，作为资质核验的合法「独立依据」。全部是合成数据。
   */
  const standardProjectIdForS3b = projectByKey.get("standard");
  let s3b: {
    supplierId: string; supplierName: string; projectId: string; linkedSignalId: string;
    archiveItemId: string; internalCandidateRunId: string | null; internalCandidateProjectId: string | null;
    otherOrgId: string; strangerEmail: string;
  } | null = null;
  if (standardProjectIdForS3b) {
    let evidenceSupplier = await db.supplier.findFirst({ where: { orgId: org.id, name: { contains: "演示" } } });
    if (!evidenceSupplier) {
      evidenceSupplier = await db.supplier.create({
        data: { orgId: org.id, name: `[演示夹具] 佛山演示家具厂 ${TAG}`, createdById: buyer.id },
      });
    }
    const linked = await signalSvc.createSubmittedSignal(actorBuyer, {
      url: `https://s3a-fixture-factory.example/${TAG}/s3b-linked`,
      rawText: `[演示夹具] 厂家自述：有 3 轴 CNC 六台、喷粉线一条，做过办公椅出口 ${TAG}`,
      manualEntry: true,
      projectId: standardProjectIdForS3b,
    });
    await signalSvc.reviewSignal(actorBuyer, linked.id);
    await signalSvc.linkSignalToSupplier(actorBuyer, linked.id, { supplierId: evidenceSupplier.id });

    const archive = await db.tenderArchiveItem.create({
      data: {
        orgId: org.id, projectId: standardProjectIdForS3b, kind: "other",
        captureKey: `upload:s3b-${TAG}-cert-scan`, capturedAt: new Date(), captureMethod: "upload",
        mimeType: "application/pdf", fileSize: 4096, contentHash: `s3b_${TAG}_${Date.now()}`,
        storageKey: `archive/${org.id}/s3/s3b_${TAG}`, createdById: buyer.id,
      },
    });
    const mixedRun = scenarioRuns.find((r) => r.state === "MIXED_SOURCES") ?? null;
    s3b = {
      supplierId: evidenceSupplier.id,
      supplierName: evidenceSupplier.name,
      projectId: standardProjectIdForS3b,
      linkedSignalId: linked.id,
      archiveItemId: archive.id,
      internalCandidateRunId: mixedRun?.runId ?? null,
      internalCandidateProjectId: mixedRun ? (projectByKey.get(mixedRun.key) ?? null) : null,
      otherOrgId: otherOrg.id,
      strangerEmail: stranger.email,
    };
  }

  /* ═════════ S4-A 夹具：评估用的产品 / 证书 / 线索 / 档案（evalclean 项目）═════════ */
  let s4a: Record<string, string | null> | null = null;
  const evalProjectId = projectByKey.get("evalclean");
  if (evalProjectId && s3b) {
    const sup = s3b.supplierId;
    await db.supplierOffering.deleteMany({ where: { orgId: org.id, supplierId: sup, sku: { in: ["S4A-A", "S4A-B"] } } });
    const offA = await db.supplierOffering.create({ data: { orgId: org.id, supplierId: sup, name: "[演示] 网布会议椅 A", sku: "S4A-A", attributesJson: { 承重: "600 lb", 材质: "钢架+网布" }, priceStatus: "UNKNOWN", sourceKind: "MANUAL", createdByUserId: buyer.id } });
    const offB = await db.supplierOffering.create({ data: { orgId: org.id, supplierId: sup, name: "[演示] 经济款会议椅 B", sku: "S4A-B", attributesJson: { 承重: "250 lb" }, unitPrice: 50, currency: "CNY", priceStatus: "KNOWN", sourceKind: "MANUAL", createdByUserId: buyer.id } });
    const FUTURE = new Date(`${new Date().getFullYear() + 3}-01-01T00:00:00.000Z`);
    const PAST = new Date("2020-01-01T00:00:00.000Z");
    const mkCert = (data: Record<string, unknown>) => db.supplierCertification.create({ data: { orgId: org.id, supplierId: sup, sourceKind: "USER_ENTRY", ...data } as never });
    const certBifmaA = await mkCert({ scope: "PRODUCT", offeringId: offA.id, certificationType: "BIFMA", certificateNumber: `BIFMA-A-${TAG}`, status: "VERIFIED", expiresAt: FUTURE, verifiedByUserId: buyer.id, verifiedAt: new Date() });
    const certBifmaClaimed = await mkCert({ scope: "SUPPLIER", certificationType: "BIFMA", certificateNumber: `BIFMA-CLAIM-${TAG}`, status: "CLAIMED", sourceKind: "SOCIAL" });
    const certUlExpired = await mkCert({ scope: "SUPPLIER", certificationType: "UL", certificateNumber: `UL-OLD-${TAG}`, status: "VERIFIED", expiresAt: PAST, verifiedByUserId: buyer.id, verifiedAt: new Date() });
    // FR2：VERIFIED、范围对、未过期，但 validFrom 在评估之后 → 评估时尚未生效，不可采信
    const NOT_YET = new Date(Date.now() + 60 * 24 * 3600_000);
    const certBifmaFutureA = await mkCert({ scope: "PRODUCT", offeringId: offA.id, certificationType: "BIFMA", certificateNumber: `BIFMA-FUTURE-A-${TAG}`, status: "VERIFIED", validFrom: NOT_YET, expiresAt: FUTURE, verifiedByUserId: buyer.id, verifiedAt: new Date() });
    const social = await signalSvc.createSubmittedSignal(actorBuyer, {
      url: `https://s3a-fixture-factory.example/${TAG}/s4a-social`,
      rawText: `[演示夹具] 厂家抖音自述：我们的椅子都是 BIFMA 认证、UL 认证 ${TAG}`,
      manualEntry: true,
      projectId: evalProjectId,
    });
    await signalSvc.reviewSignal(actorBuyer, social.id);
    await signalSvc.linkSignalToSupplier(actorBuyer, social.id, { supplierId: sup });
    const arch = await db.tenderArchiveItem.create({ data: { orgId: org.id, projectId: evalProjectId, kind: "other", captureKey: `upload:s3b-${TAG}-s4a-test-report`, capturedAt: new Date(), captureMethod: "upload", mimeType: "application/pdf", fileSize: 2048, contentHash: `s4a_${TAG}_${Date.now()}`, storageKey: `archive/${org.id}/s4/s4a_${TAG}`, createdById: buyer.id } });
    s4a = { projectId: evalProjectId, supplierId: sup, offeringAId: offA.id, offeringBId: offB.id, certBifmaAId: certBifmaA.id, certBifmaClaimedId: certBifmaClaimed.id, certUlExpiredId: certUlExpired.id, certBifmaFutureAId: certBifmaFutureA.id, socialSignalId: social.id, archiveItemId: arch.id };

    /* ═════════ S4-B 夹具：1688 线索 / 挂牌价报盘 / 询价轮 / 历史交互 / 已核验出口能力（evalclean 项目）═════════
     * 角色：B = s3b 供应商（历史供应商，正式 RFQ，VERIFIED 出口）；ONE688 = 1688 便宜挂牌价、无 RFQ；
     *       CHEAP = 最低正式价但 250 lb 门 FAIL；FULL = 第二家四维齐全（用于 PRIMARY / BACKUP）。全部是合成夹具。 */
    const s4bNames = [`[演示] 1688 网布椅源头工厂 ${TAG}`, `[演示] 便宜但不合规椅厂 ${TAG}`, `[演示] 第二家合规椅厂 ${TAG}`, `[演示] 两款产品椅厂 ${TAG}`];
    const olds = await db.supplier.findMany({ where: { orgId: org.id, name: { in: s4bNames } }, select: { id: true } });
    const oldIds = olds.map((x) => x.id);
    if (oldIds.length) {
      await db.supplierRequirementMatch.deleteMany({ where: { orgId: org.id, candidate: { is: { supplierId: { in: oldIds } } } } });
      await db.supplierCandidate.deleteMany({ where: { orgId: org.id, supplierId: { in: oldIds } } });
      await db.supplierCertification.deleteMany({ where: { orgId: org.id, supplierId: { in: oldIds } } });
      await db.supplierOffering.deleteMany({ where: { orgId: org.id, supplierId: { in: oldIds } } });
      await db.inquiryItem.deleteMany({ where: { supplierId: { in: oldIds } } });
      await db.supplierCapabilitySignal.deleteMany({ where: { orgId: org.id, discoverySignal: { is: { linkedSupplierId: { in: oldIds } } } } });
      await db.supplierDiscoverySignal.deleteMany({ where: { orgId: org.id, linkedSupplierId: { in: oldIds } } });
      await db.supplier.deleteMany({ where: { id: { in: oldIds } } });
    }
    // 本项目与历史项目的询价轮全部重置（夹具幂等）
    const histProjA = projectByKey.get("custom") ?? null; const histProjB = projectByKey.get("install") ?? null;
    await db.inquiryItem.deleteMany({ where: { inquiry: { projectId: { in: [evalProjectId, histProjA, histProjB].filter((x): x is string => Boolean(x)) } } } });
    await db.projectInquiry.deleteMany({ where: { projectId: { in: [evalProjectId, histProjA, histProjB].filter((x): x is string => Boolean(x)) } } });
    await db.supplierCapabilitySignal.deleteMany({ where: { orgId: org.id, discoverySignalId: social.id } });

    const mkSup = (name: string) => db.supplier.create({ data: { orgId: org.id, name, createdById: buyer.id } });
    const sup1688 = await mkSup(s4bNames[0]); const supCheap = await mkSup(s4bNames[1]); const supFull = await mkSup(s4bNames[2]); const supTwo = await mkSup(s4bNames[3]);
    const linkSignal = async (supplierId: string, url: string, rawText: string) => {
      const sig = await signalSvc.createSubmittedSignal(actorBuyer, { url, rawText, manualEntry: true, projectId: evalProjectId });
      await signalSvc.reviewSignal(actorBuyer, sig.id); await signalSvc.linkSignalToSupplier(actorBuyer, sig.id, { supplierId });
      return sig;
    };
    const sig1688 = await linkSignal(sup1688.id, `https://detail.1688.com/offer/${TAG}-chair.html`, `[演示夹具] 办公椅 网布椅 源头工厂 OEM ODM 出口 加拿大 北美 UL certified BIFMA 厂家直销 挂牌价 ¥80 ${TAG}`);
    await db.supplierDiscoverySignal.update({ where: { id: sig1688.id }, data: { platform: "ONE688", contentType: "PROFILE", title: "办公椅 网布椅 源头工厂 OEM 出口加拿大 UL认证", description: "[演示夹具] 厂家直销 ¥80 起 支持 OEM ODM 出口北美", accountName: `演示1688店铺 ${TAG}`, rawMetadataJson: { sourceQuery: "办公椅 厂家" } } });
    // 本项目先有一次发现 Run（Brief 快照是找厂优先级的词源；真实链路里线索来自它）。不执行外呼，直接收口为 skipped。
    const runSvcSeed = await import("@/lib/supplier-intel/run-service");
    const discRun = await projectRunSvc.createProjectSearchRun(actorBuyer, { projectId: evalProjectId, hints: { productKeywordsZh: ["办公椅", "网布椅"], productKeywordsEn: ["office chair"], capabilityHintsZh: ["OEM"] } });
    await runSvcSeed.startSearchRun(actorBuyer, discRun.id); await runSvcSeed.completeSearchRun(actorBuyer, discRun.id, { status: "skipped", sources: {} });
    const sigCheap = await linkSignal(supCheap.id, `https://cheap-chairs.example/${TAG}`, `[演示夹具] 便宜椅子 ${TAG}`);
    const sigFull = await linkSignal(supFull.id, `https://full-chairs.example/${TAG}`, `[演示夹具] 网布椅 办公椅 厂家 出口 ${TAG}`);
    const sigTwo = await linkSignal(supTwo.id, `https://two-chairs.example/${TAG}`, `[演示夹具] 两款产品 办公椅 网布椅 厂家 ${TAG}`);
    // FR2 夹具：一个采购员看不到的项目（owner = 无项目权限成员，无成员，未派发），里面把 1688 厂家的 CANADA_EXPORT 核验为 VERIFIED
    await db.supplierCapabilitySignal.deleteMany({ where: { orgId: org.id, discoverySignal: { is: { linkedSupplierId: sup1688.id } } } });
    const oldHidden = await db.project.findMany({ where: { orgId: org.id, name: `[演示] 隐藏项目（FR2） ${TAG}` }, select: { id: true } });
    for (const h of oldHidden) {
      await db.supplierCapabilitySignal.deleteMany({ where: { orgId: org.id, discoverySignal: { is: { projectId: h.id } } } });
      await db.supplierDiscoverySignal.deleteMany({ where: { orgId: org.id, projectId: h.id } });
      await db.tenderArchiveItem.deleteMany({ where: { orgId: org.id, projectId: h.id } });
      await db.projectMember.deleteMany({ where: { projectId: h.id } });
      await db.project.delete({ where: { id: h.id } });
    }
    // FR2-HIDDEN-V2：线索只能挂在 dispatched 项目上；采购员不是成员（org_member）→ 读不到；outsider 是该项目管理员
    const hiddenProject = await db.project.create({ data: { orgId: org.id, name: `[演示] 隐藏项目（FR2） ${TAG}`, ownerId: outsider.id, workDomain: "tender", intakeStatus: "dispatched", status: "active" } });
    await db.projectMember.create({ data: { projectId: hiddenProject.id, userId: outsider.id, role: "project_admin", status: "active" } });
    const actorOutsider = { orgId: org.id, userId: outsider.id };
    const sigHidden = await signalSvc.createSubmittedSignal(actorOutsider, { url: `https://hidden-1688.example/${TAG}`, rawText: `[演示夹具] 隐藏项目里的 1688 厂家线索 ${TAG}`, manualEntry: true, projectId: hiddenProject.id });
    await signalSvc.reviewSignal(actorOutsider, sigHidden.id); await signalSvc.linkSignalToSupplier(actorOutsider, sigHidden.id, { supplierId: sup1688.id });
    const capHidden = await db.supplierCapabilitySignal.create({ data: { orgId: org.id, discoverySignalId: sigHidden.id, type: "CANADA_EXPORT", value: "隐藏项目已核验出口加拿大", evidenceStatus: "VERIFIED", extractedBy: "HUMAN", explanation: "[演示夹具] VERIFIED in hidden project" } });
    const off1688 = await db.supplierOffering.create({ data: { orgId: org.id, supplierId: sup1688.id, name: "[演示] 1688 网布会议椅", sku: `S4B-1688-${TAG}`, attributesJson: { 承重: "600 lb", 材质: "钢架+网布" }, unitPrice: 80, currency: "CNY", priceStatus: "KNOWN", sourceKind: "DISCOVERY", sourceUrl: `https://detail.1688.com/offer/${TAG}-chair.html`, sourceSignalId: sig1688.id, leadTimeDays: 30, incoterm: "FOB", createdByUserId: buyer.id } });
    const offCheap = await db.supplierOffering.create({ data: { orgId: org.id, supplierId: supCheap.id, name: "[演示] 经济款会议椅", sku: `S4B-CHEAP-${TAG}`, attributesJson: { 承重: "250 lb" }, priceStatus: "UNKNOWN", sourceKind: "MANUAL", leadTimeDays: 20, incoterm: "FOB", createdByUserId: buyer.id } });
    const offFull = await db.supplierOffering.create({ data: { orgId: org.id, supplierId: supFull.id, name: "[演示] 网布会议椅 F", sku: `S4B-FULL-${TAG}`, attributesJson: { 承重: "600 lb" }, priceStatus: "UNKNOWN", sourceKind: "MANUAL", leadTimeDays: 40, incoterm: "FOB", createdByUserId: buyer.id } });
    const offTwoA1 = await db.supplierOffering.create({ data: { orgId: org.id, supplierId: supTwo.id, name: "[演示] 会议椅 A1（120V 升降）", sku: `S4B-TWO-A1-${TAG}`, attributesJson: { 承重: "600 lb" }, priceStatus: "UNKNOWN", sourceKind: "MANUAL", leadTimeDays: 40, incoterm: "FOB", createdByUserId: buyer.id } });
    const offTwoA2 = await db.supplierOffering.create({ data: { orgId: org.id, supplierId: supTwo.id, name: "[演示] 会议椅 A2（230V 升降）", sku: `S4B-TWO-A2-${TAG}`, attributesJson: { 承重: "600 lb" }, priceStatus: "UNKNOWN", sourceKind: "MANUAL", leadTimeDays: 40, incoterm: "FOB", createdByUserId: buyer.id } });
    // B 的产品 A 补贸易术语与交期（进口准备度四项齐全）；S4-A 流程不读这两个字段
    await db.supplierOffering.update({ where: { id: offA.id }, data: { leadTimeDays: 45, incoterm: "DDP" } });
    const mkCert2 = (supplierId: string, offeringId: string, number: string) => db.supplierCertification.create({ data: { orgId: org.id, supplierId, sourceKind: "USER_ENTRY", scope: "PRODUCT", offeringId, certificationType: "BIFMA", certificateNumber: number, status: "VERIFIED", expiresAt: FUTURE, verifiedByUserId: buyer.id, verifiedAt: new Date() } as never });
    const cert1688 = await mkCert2(sup1688.id, off1688.id, `BIFMA-1688-${TAG}`); const certCheap = await mkCert2(supCheap.id, offCheap.id, `BIFMA-CHEAP-${TAG}`); const certFull = await mkCert2(supFull.id, offFull.id, `BIFMA-FULL-${TAG}`);
    const certTwoA1 = await mkCert2(supTwo.id, offTwoA1.id, `BIFMA-TWO-A1-${TAG}`); const certTwoA2 = await mkCert2(supTwo.id, offTwoA2.id, `BIFMA-TWO-A2-${TAG}`);
    // 出口能力：B / FULL 已核验（VERIFIED 只能来自人工 + 档案，夹具直接落库并注明）；1688 只是 CLAIMED
    const mkCap = (discoverySignalId: string, type: string, evidenceStatus: string, value: string) => db.supplierCapabilitySignal.create({ data: { orgId: org.id, discoverySignalId, type, value, evidenceStatus, extractedBy: "HUMAN", explanation: evidenceStatus === "VERIFIED" ? `[演示夹具] VERIFIED by human; archive=${arch.id}` : "[演示夹具] 平台文案声称" } });
    await mkCap(social.id, "CANADA_EXPORT", "VERIFIED", "已出口加拿大（档案）"); await mkCap(social.id, "EXPORT_PACKAGING", "VERIFIED", "出口包装（档案）");
    await mkCap(sigFull.id, "CANADA_EXPORT", "VERIFIED", "已出口加拿大（档案）");
    const cap1688Claimed = await mkCap(sig1688.id, "CANADA_EXPORT", "CLAIMED", "1688 文案：出口加拿大");
    // 历史交互（别项目）：B 两次联系两次回复一次入选；FULL 两次联系一次回复；CHEAP 两次入选（历史很强但门 FAIL）
    const mkInq = async (projectId: string | null, round: number, items: Array<{ supplierId: string; total: number | null; replied: boolean; selected?: boolean; days?: number }>) => {
      if (!projectId) return null;
      const inq = await db.projectInquiry.create({ data: { projectId, roundNumber: round, title: `[演示夹具] 询价第 ${round} 轮`, scope: "会议椅", status: "in_progress", createdById: buyer.id } });
      for (const it of items) await db.inquiryItem.create({ data: { inquiryId: inq.id, supplierId: it.supplierId, status: it.replied ? "quoted" : "no_response", sentAt: new Date("2026-03-01"), repliedAt: it.replied ? new Date("2026-03-05") : null, totalPrice: it.total, currency: "CAD", deliveryDays: it.days ?? null, validUntil: new Date("2026-12-31"), isSelected: it.selected ?? false, createdById: buyer.id } });
      return inq;
    };
    await mkInq(histProjA, 1, [{ supplierId: sup, total: 1000, replied: true, selected: true }, { supplierId: supFull.id, total: 1200, replied: true }, { supplierId: supCheap.id, total: 900, replied: true, selected: false }]);
    await mkInq(histProjB, 1, [{ supplierId: sup, total: 1100, replied: true }, { supplierId: supFull.id, total: 1150, replied: true }, { supplierId: supCheap.id, total: 950, replied: true, selected: true }]);
    // 本项目 RFQ round 1：B / CHEAP / FULL 已正式报价；1688 未询价（FLOW C 再补）
    const round1 = await mkInq(evalProjectId, 1, [{ supplierId: sup, total: 110000, replied: true, days: 60 }, { supplierId: supCheap.id, total: 90000, replied: true, days: 40 }, { supplierId: supFull.id, total: 95000, replied: true, days: 50 }, { supplierId: supTwo.id, total: 100000, replied: true, days: 45 }]);
    const itemOf = async (supplierId: string) => round1 ? (await db.inquiryItem.findFirstOrThrow({ where: { inquiryId: round1.id, supplierId }, select: { id: true } })).id : null;
    s4a = { ...s4a, s4bSupplier1688Id: sup1688.id, s4bOffering1688Id: off1688.id, s4bSignal1688Id: sig1688.id, s4bCert1688Id: cert1688.id, s4bCap1688ClaimedId: cap1688Claimed.id,
      s4bSupplierCheapId: supCheap.id, s4bOfferingCheapId: offCheap.id, s4bCertCheapId: certCheap.id, s4bSignalCheapId: sigCheap.id,
      s4bSupplierFullId: supFull.id, s4bOfferingFullId: offFull.id, s4bCertFullId: certFull.id, s4bSignalFullId: sigFull.id,
      s4bRound1Id: round1?.id ?? null, s4bHistProjectAId: histProjA, s4bHistProjectBId: histProjB,
      s4bRound1ItemBId: await itemOf(sup), s4bRound1ItemCheapId: await itemOf(supCheap.id), s4bRound1ItemFullId: await itemOf(supFull.id),
      s4bSupplierTwoId: supTwo.id, s4bOfferingTwoA1Id: offTwoA1.id, s4bOfferingTwoA2Id: offTwoA2.id, s4bCertTwoA1Id: certTwoA1.id, s4bCertTwoA2Id: certTwoA2.id, s4bSignalTwoId: sigTwo.id, s4bRound1ItemTwoId: await itemOf(supTwo.id),
      s4bHiddenProjectId: hiddenProject.id, s4bHiddenSignalId: sigHidden.id, s4bHiddenCapId: capHidden.id };
  }

  console.log(
    JSON.stringify(
      {
        orgId: org.id,
        orgCode: org.code,
        s3b,
        s4a,
        password: PASSWORD,
        users: {
          buyer: buyer.email,
          viewer: viewer.email,
          outsider: outsider.email,
        },
        projects: created,
        scenarioRuns,
        xssSignalId,
      },
      null,
      2,
    ),
  );
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
