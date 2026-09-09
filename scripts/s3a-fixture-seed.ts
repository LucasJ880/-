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
