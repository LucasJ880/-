/**
 * 一键生成项目 PDF（供应商询价 / 内部分析 / 同事任务单）
 */

import { db } from "@/lib/db";
import { putPrivateBlob } from "@/lib/files/blob-access";
import {
  createProjectPdfDoc,
  sanitizeSupplierFacing,
  writeWrappedText,
} from "./pdf-common";
import { buildProjectAiContextBlock } from "@/lib/projects/project-ai-context";
import { computePriceGap } from "@/lib/projects/price-gap";

export type GenerateDocType =
  | "supplier_rfq"
  | "internal_analysis"
  | "teammate_tasks"
  | "tech_confirm"
  | "owner_clarification";

const DOC_TITLES: Record<GenerateDocType, string> = {
  supplier_rfq: "国内供应商询价",
  internal_analysis: "内部项目分析",
  teammate_tasks: "同事执行任务单",
  tech_confirm: "供应商技术确认表",
  owner_clarification: "业主澄清问题",
};

export async function generateProjectDocument(input: {
  projectId: string;
  orgId: string | null;
  userId: string;
  docType: GenerateDocType;
}) {
  const project = await db.project.findUnique({
    where: { id: input.projectId },
    select: {
      id: true,
      name: true,
      description: true,
      location: true,
      currency: true,
      ourBidPrice: true,
      winningBidPrice: true,
      aiAdviceStatus: true,
      projectTypes: true,
      intelligence: {
        select: {
          summary: true,
          structuredSummaryJson: true,
          riskLevel: true,
          recommendation: true,
        },
      },
      documents: {
        take: 20,
        select: { id: true, title: true, createdAt: true },
      },
      tasks: {
        where: { status: { not: "done" } },
        take: 20,
        select: {
          title: true,
          description: true,
          priority: true,
          dueDate: true,
          assignee: { select: { name: true } },
        },
      },
      similaritiesAsSource: {
        take: 3,
        orderBy: { score: "desc" },
        select: {
          score: true,
          impactText: true,
          recommendationsJson: true,
          similarProject: { select: { name: true, tenderStatus: true } },
        },
      },
      insights: {
        where: { status: "confirmed" },
        take: 10,
        select: { title: true, content: true, kind: true },
      },
    },
  });
  if (!project) throw new Error("项目不存在");

  const ctx = await buildProjectAiContextBlock(project.id);
  const addendumFingerprint = project.documents
    .map((d: { id: string; title: string }) => `${d.id}:${d.title}`)
    .sort()
    .join("|")
    .slice(0, 500);

  const doc = await createProjectPdfDoc();
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 16;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(DOC_TITLES[input.docType], pageWidth / 2, y, { align: "center" });
  y += 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  y = writeWrappedText(doc, `Project: ${project.name}`, 14, y, pageWidth - 28);
  y += 2;

  if (input.docType === "supplier_rfq") {
    const body = sanitizeSupplierFacing(
      [
        "SUPPLIER RFQ (China / Factory)",
        `Project name (CN/EN): ${project.name}`,
        project.description?.slice(0, 600) || "",
        "Please quote: product, qty, size, material, certifications, packaging, sample lead time, production lead time, required docs.",
        "Hide: customer budget, our margin, competitor info.",
        "Questions for supplier:",
        "1) Can you meet specs exactly?",
        "2) Lead time for sample and bulk?",
        "3) Certifications available?",
        ctx.slice(0, 1800),
      ].join("\n\n"),
    );
    y = writeWrappedText(doc, body, 14, y, pageWidth - 28, 4.5);
  } else if (input.docType === "internal_analysis") {
    const gap = computePriceGap({
      ourBidPrice: project.ourBidPrice,
      winningBidPrice: project.winningBidPrice,
      currency: project.currency,
    });
    const simLines = project.similaritiesAsSource
      .map(
        (s) =>
          `- ${s.similarProject.name} (${s.similarProject.tenderStatus || "-"}) score=${s.score}: ${s.impactText || ""}`,
      )
      .join("\n");
    const body = [
      `AI advice: ${project.aiAdviceStatus || "-"}`,
      `Summary: ${project.intelligence?.summary || "-"}`,
      `Risk: ${project.intelligence?.riskLevel || "-"}`,
      gap ? gap.summaryLines.join("\n") : "Price gap: n/a",
      "Similar projects:",
      simLines || "(none)",
      "Confirmed insights:",
      ...project.insights.map((i) => `- [${i.kind}] ${i.title}: ${i.content.slice(0, 160)}`),
      "Context excerpt:",
      ctx.slice(0, 2200),
    ].join("\n\n");
    y = writeWrappedText(doc, body, 14, y, pageWidth - 28, 4.5);
  } else if (input.docType === "teammate_tasks") {
    const taskLines =
      project.tasks.length > 0
        ? project.tasks
            .map(
              (t, i) =>
                `${i + 1}. ${t.title} | owner=${t.assignee?.name || "TBD"} | priority=${t.priority} | due=${t.dueDate ? t.dueDate.toISOString().slice(0, 10) : "TBD"}\n   ${t.description?.slice(0, 120) || ""}`,
            )
            .join("\n")
        : "1. Review project files and confirm missing info\n2. Collect supplier quotes\n3. Draft clarification questions";
    const body = [
      `Background: ${project.name}`,
      project.description?.slice(0, 400) || "",
      "Goal: advance bid readiness and close information gaps.",
      "Tasks:",
      taskLines,
      "Done criteria: answers logged as insights/tasks; files updated.",
    ].join("\n\n");
    y = writeWrappedText(doc, body, 14, y, pageWidth - 28, 4.5);
  } else if (input.docType === "tech_confirm") {
    const body = sanitizeSupplierFacing(
      [
        "Supplier Technical Confirmation",
        `Project: ${project.name}`,
        "Table columns: Customer Requirement | Meet (Y/N) | Supplier Note | Evidence | Deviation",
        "",
        "Row templates (fill with project requirements):",
        "1) Product / material spec |  |  |  |  ",
        "2) Dimensions / tolerance |  |  |  |  ",
        "3) Certification / testing |  |  |  |  ",
        "4) Lead time / sample |  |  |  |  ",
        "5) Packaging / labeling |  |  |  |  ",
        "",
        "Known requirements from project context:",
        ctx.slice(0, 2000),
      ].join("\n"),
    );
    y = writeWrappedText(doc, body, 14, y, pageWidth - 28, 4.5);
  } else {
    // owner_clarification — English draft + internal checklist
    const body = [
      "Owner / Consultant Clarification Draft (EN)",
      `Subject: Clarification Questions – ${project.name}`,
      "",
      "Dear Sir/Madam,",
      "Please clarify the following items so we can prepare an accurate bid.",
      "Do NOT re-ask items already answered in the issued documents.",
      "",
      "Technical:",
      "1) ",
      "Quantity / Scope:",
      "2) ",
      "Schedule:",
      "3) ",
      "Certification:",
      "4) ",
      "Installation / Interface (if applicable):",
      "5) ",
      "Contract / Responsibility boundary:",
      "6) ",
      "",
      "Internal checklist (CN):",
      "- 仅列文件中未明确的问题",
      "- 分类：技术 / 数量 / 交期 / 认证 / 安装 / 合同 / 范围边界",
      "",
      "Context excerpt for authors:",
      ctx.slice(0, 1800),
    ].join("\n");
    y = writeWrappedText(doc, body, 14, y, pageWidth - 28, 4.5);
  }

  const pdfBuffer = Buffer.from(doc.output("arraybuffer"));
  const prev = await db.projectGeneratedDocument.findFirst({
    where: { projectId: project.id, docType: input.docType },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const version = (prev?.version ?? 0) + 1;
  const pathname = `projects/${project.id}/generated/${input.docType}-v${version}-${Date.now()}.pdf`;
  const blob = await putPrivateBlob({
    pathname,
    body: pdfBuffer,
    contentType: "application/pdf",
  });

  // 标记旧版可能过期
  await db.projectGeneratedDocument.updateMany({
    where: { projectId: project.id, docType: input.docType, stale: false },
    data: { stale: true },
  });

  const meta = {
    projectName: project.name,
    docType: input.docType,
    version,
    generatedAt: new Date().toISOString(),
    addendumFingerprint,
    conclusionVersion: project.intelligence?.structuredSummaryJson
      ? "structured_v1"
      : "none",
    createdById: input.userId,
  };

  // 浏览器必须走 /api/files 代理；私有 Blob 直链会 Forbidden
  const publicUrl = blob.proxyUrl;

  const row = await db.projectGeneratedDocument.create({
    data: {
      orgId: input.orgId,
      projectId: project.id,
      docType: input.docType,
      version,
      title: `${DOC_TITLES[input.docType]} v${version}`,
      blobUrl: publicUrl,
      fileUrl: publicUrl,
      metaJson: JSON.stringify(meta),
      stale: false,
      createdById: input.userId,
    },
  });

  // 同步一份到项目文件列表，便于下载
  await db.projectDocument.create({
    data: {
      projectId: project.id,
      title: row.title,
      url: publicUrl,
      blobUrl: publicUrl,
      fileType: "pdf",
      fileSize: pdfBuffer.length,
      parseStatus: "done",
      source: "generated",
      uploadedById: input.userId,
    },
  });

  return row;
}

/** 文件变更后标记生成文档可能过期 */
export async function markGeneratedDocsStale(projectId: string) {
  await db.projectGeneratedDocument.updateMany({
    where: { projectId, stale: false },
    data: { stale: true },
  });
}
