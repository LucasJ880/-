/**
 * Cotton Towelling V1 fixture — 仅用于隔离数据库验收。
 * 禁止指向生产 / 共享 Staging（由调用方注入 ISOLATED_* URL）。
 */
import { db } from "@/lib/db";
import { startBidIntelligence } from "@/lib/bid-workflow/start-intelligence";
import { setGoHoldNoGo } from "@/lib/bid-workflow/go-decision";

import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

// Fail-closed：禁止对生产/未识别数据库执行 destructive 测试
assertSafeTestDatabase({ scriptName: "scripts/bid-workflow-cotton-iso-fixture.ts" });

function requireIsolated(): void {
  const env = (process.env.DATABASE_ENVIRONMENT || "").toLowerCase();
  if (env !== "isolated") {
    throw new Error("DATABASE_ENVIRONMENT must be isolated");
  }
  const url = process.env.DATABASE_URL || "";
  for (const marker of ["ep-super-field", "ep-raspy-credit"]) {
    if (url.includes(marker)) {
      throw new Error(`refusing protected host marker: ${marker}`);
    }
  }
}

async function main() {
  requireIsolated();
  const suffix = Date.now().toString(36);

  const user = await db.user.create({
    data: {
      email: `cotton-iso-${suffix}@example.test`,
      name: "Cotton Tester",
      passwordHash: "x",
    },
  });
  const org = await db.organization.create({
    data: {
      name: `Cotton Org ${suffix}`,
      code: `CTN_${suffix}`.slice(0, 24),
      status: "active",
      ownerId: user.id,
    },
  });
  await db.organizationMember.create({
    data: { orgId: org.id, userId: user.id, role: "org_admin", status: "active" },
  });

  const project = await db.project.create({
    data: {
      name: "Cotton Towelling Fabric",
      description: "Isolated V1 fixture",
      ownerId: user.id,
      orgId: org.id,
      workDomain: "tender",
      bidPhaseStatus: "READY_FOR_QUALIFICATION",
      currency: "CAD",
      color: "#3B82F6",
    },
  });
  await db.projectMember.create({
    data: {
      projectId: project.id,
      userId: user.id,
      role: "project_admin",
      status: "active",
    },
  });

  const member2 = await db.user.create({
    data: {
      email: `member-${suffix}@example.test`,
      name: "Internal Member",
      passwordHash: "x",
    },
  });
  await db.organizationMember.create({
    data: { orgId: org.id, userId: member2.id, role: "org_member", status: "active" },
  });
  await db.projectMember.create({
    data: {
      projectId: project.id,
      userId: member2.id,
      role: "operator",
      status: "active",
    },
  });

  const r1 = await startBidIntelligence({
    projectId: project.id,
    actorUserId: user.id,
    orgId: org.id,
  });
  const r2 = await startBidIntelligence({
    projectId: project.id,
    actorUserId: user.id,
    orgId: org.id,
  });

  const rooms = await db.bidIntelligenceRoom.count({
    where: { projectId: project.id },
  });
  const modules = await db.bidIntelligenceModule.count({
    where: { roomId: r1.roomId },
  });
  console.log(
    "[cotton] rooms=",
    rooms,
    "modules=",
    modules,
    "created1=",
    r1.created,
    "ensuredOnly2=",
    r2.ensuredOnly,
  );

  await db.bidIntelligenceFact.create({
    data: {
      roomId: r1.roomId,
      orgId: org.id,
      projectId: project.id,
      moduleKey: "historical_awards",
      content: "Cox’s Bazar Trading Inc. historically awarded",
      sourceType: "historical",
      sourceUrl: "https://example.test/award",
      confidence: "CONFIRMED",
      humanConfirmed: true,
      confirmedById: user.id,
      confirmedAt: new Date(),
    },
  });
  await db.bidIntelligenceFact.create({
    data: {
      roomId: r1.roomId,
      orgId: org.id,
      projectId: project.id,
      moduleKey: "contract_value",
      content:
        "CAD 886,410 is final contract ceiling; NOT equal to guaranteed annual purchase volume",
      sourceType: "tender_document",
      confidence: "CONFIRMED",
      humanConfirmed: true,
      confirmedById: user.id,
      confirmedAt: new Date(),
    },
  });
  await db.bidIntelligenceFact.create({
    data: {
      roomId: r1.roomId,
      orgId: org.id,
      projectId: project.id,
      moduleKey: "supply_chain",
      content: "Likely China mill -> Bangladesh finishing",
      sourceType: "ai_inference",
      confidence: "INFERRED",
      humanConfirmed: false,
    },
  });

  const s1 = await db.supplier.create({
    data: {
      orgId: org.id,
      name: `Supplier A ${suffix}`,
      createdById: user.id,
    },
  });
  const s2 = await db.supplier.create({
    data: {
      orgId: org.id,
      name: `Supplier B ${suffix}`,
      createdById: user.id,
    },
  });
  const link1 = await db.projectSupplierLink.create({
    data: {
      orgId: org.id,
      projectId: project.id,
      supplierId: s1.id,
      role: "candidate",
    },
  });
  const link2 = await db.projectSupplierLink.create({
    data: {
      orgId: org.id,
      projectId: project.id,
      supplierId: s2.id,
      role: "candidate",
    },
  });
  await db.projectSupplierLink.update({
    where: { id: link1.id },
    data: { role: "shortlisted" },
  });
  await db.projectSupplierLink.delete({ where: { id: link2.id } });
  const linksLeft = await db.projectSupplierLink.count({
    where: { projectId: project.id },
  });
  const suppliersLeft = await db.supplier.count({ where: { orgId: org.id } });
  console.log("[cotton] linksLeft=", linksLeft, "suppliersLeft=", suppliersLeft);

  const brief = await db.projectJoinBrief.create({
    data: {
      orgId: org.id,
      projectId: project.id,
      userId: member2.id,
      roleHint: "operator",
      briefMarkdown: [
        "## 项目是什么",
        "Cotton Towelling Fabric tender",
        "## 当前阶段",
        "INTELLIGENCE_IN_PROGRESS",
        "## 成员角色",
        "operator",
        "## 关键事实",
        "- CAD 886,410 ceiling (≠ annual guaranteed volume)",
        "## 分配任务",
        "- Review buyer history",
        "## 截止时间",
        "- 暂无",
        "## 必须阅读的文件",
        "- 暂无",
        "## 当前阻塞",
        "- 待确认国内厂家能力",
      ].join("\n"),
    },
  });
  console.log("[cotton] brief=", brief.id);

  const decision = await setGoHoldNoGo({
    projectId: project.id,
    actorUserId: user.id,
    orgId: org.id,
    decision: "HOLD",
    note: "Need more China mill evidence before GO",
  });
  if (!decision.ok) throw new Error(decision.error);

  const afterHold = await db.project.findUniqueOrThrow({
    where: { id: project.id },
    select: { bidPhaseStatus: true },
  });
  await startBidIntelligence({
    projectId: project.id,
    actorUserId: user.id,
    orgId: org.id,
  });
  const afterRestart = await db.project.findUniqueOrThrow({
    where: { id: project.id },
    select: { bidPhaseStatus: true },
  });
  const roomsStill = await db.bidIntelligenceRoom.count({
    where: { projectId: project.id },
  });
  console.log(
    "[cotton] holdStatus=",
    afterHold.bidPhaseStatus,
    "afterRestart=",
    afterRestart.bidPhaseStatus,
    "roomsStill=",
    roomsStill,
  );

  const doc = await db.projectGeneratedDocument.create({
    data: {
      orgId: org.id,
      projectId: project.id,
      docType: "china_supplier_brief",
      title: "China Supplier Sourcing Brief",
      fileUrl: `https://example.test/files/china-brief-${suffix}.pdf`,
      createdById: user.id,
    },
  });
  console.log("[cotton] pdfDoc=", doc.id, "hasUrl=", Boolean(doc.fileUrl));

  // soft-degrade: project still readable after "AI failure" simulation
  await db.bidIntelligenceRoom.update({
    where: { id: r1.roomId },
    data: { summaryStatus: "risk", summaryText: "AI investigation failed (simulated)" },
  });
  const projectStill = await db.project.findUnique({ where: { id: project.id } });
  if (!projectStill) throw new Error("project unreadable after AI failure sim");

  if (rooms !== 1) throw new Error(`expected 1 room, got ${rooms}`);
  if (modules !== 8) throw new Error(`expected 8 modules, got ${modules}`);
  if (r1.created !== true) throw new Error("first start should create");
  if (r2.ensuredOnly !== true) throw new Error("second start should ensure only");
  if (afterRestart.bidPhaseStatus !== "HOLD") throw new Error("HOLD reverted");
  if (linksLeft !== 1 || suppliersLeft !== 2) {
    throw new Error("unlink deleted supplier incorrectly");
  }
  console.log("[cotton] PASS");
}

main()
  .catch((e) => {
    console.error("[cotton] FAIL", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
