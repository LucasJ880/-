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
  await db.supplierCandidate.deleteMany({ where: { orgId: org.id } });
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

  console.log(
    JSON.stringify(
      {
        orgId: org.id,
        orgCode: org.code,
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
