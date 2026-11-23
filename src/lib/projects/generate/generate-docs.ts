/**
 * 一键生成项目 PDF（供应商询价单 / 内部分析 / 同事任务单）
 */

import { db } from "@/lib/db";
import { putPrivateBlob } from "@/lib/files/blob-access";
import { buildProjectAiContextBlock } from "@/lib/projects/project-ai-context";
import { computePriceGap } from "@/lib/projects/price-gap";
import { buildProjectRfqSheet } from "@/lib/tender-rfq/sheet-download-service";
import { rfqSheetRecordTitle } from "@/lib/tender-rfq/sheet-download";
import { redactLegacyMemo } from "@/lib/tender-intel/memo-pricing";

/**
 * RFQ-PDF-1：发给供应商的文件只有 supplier_rfq（供应商询价单）一种，内容与检查全在 tender-rfq
 * （与发询价时的询价单同一个生成器、同一个模板、同一套检查）。其余都是内部文件：照旧印项目名称、
 * 项目编号、采购方与截标日期，不过禁出清单。
 */
export type GenerateDocType =
  | "supplier_rfq"
  | "analyst_memo"
  | "internal_analysis"
  | "teammate_tasks"
  | "owner_clarification"
  | "bid_draft";

/** 内部文件的标题（供应商询价单的标题带询价编号，见 rfqSheetRecordTitle） */
const DOC_TITLES: Record<Exclude<GenerateDocType, "supplier_rfq">, string> = {
  analyst_memo: "投标分析师备忘录",
  internal_analysis: "内部项目分析",
  teammate_tasks: "同事执行任务单",
  owner_clarification: "RFI 问题清单（中英）",
  bid_draft: "投标文件起草（英文提交稿 + 中文审阅注）",
};

export async function generateProjectDocument(input: {
  projectId: string;
  orgId: string | null;
  userId: string;
  docType: GenerateDocType;
  /** analyst_memo（v2 全文多轮推理）：本次调用的时间预算截止点（Date.now() 语义）；未给则单步 4 分钟 */
  deadlineMs?: number;
  /** supplier_rfq：起草时刻（缺省 = 现在；测试用） */
  now?: Date;
}) {
  // RFQ-PDF-1：供应商询价单不读项目名称、描述、情报摘要与项目 AI 上下文——在下面那条查询之前就处理完。
  // 内容有问题（没有已确认的要求 / 内部财务信息 / 招标身份）或 PDF 不合格时 buildProjectRfqSheet 直接抛出，
  // 此时还没有写任何东西：不存文件、不建记录、不动旧记录的过期标记，也不回落成 HTML。
  if (input.docType === "supplier_rfq") {
    const sheet = await buildProjectRfqSheet({ projectId: input.projectId, now: input.now });
    return persistGeneratedFile({
      projectId: input.projectId,
      orgId: input.orgId,
      userId: input.userId,
      docType: "supplier_rfq",
      title: (version) => rfqSheetRecordTitle(sheet.reference, version),
      file: { body: sheet.pdf, fileType: "pdf", contentType: "application/pdf", renderMode: "chromium_pdf" },
      meta: {
        conclusionVersion: `rfq_sheet_v${sheet.templateVersion}`,
        reference: sheet.reference,
        draftedAt: sheet.draftedAt,
        draftedOn: sheet.draftedOn,
        contentHash: sheet.contentHash,
        templateVersion: sheet.templateVersion,
        replyLeadDays: sheet.replyLeadDays,
        pages: sheet.pages,
      },
    });
  }
  const docType = input.docType;

  const project = await db.project.findUnique({
    where: { id: input.projectId },
    select: {
      id: true,
      name: true,
      description: true,
      location: true,
      clientOrganization: true,
      closeDate: true,
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

  // 分析师备忘录 v2：全文多轮推理（深读→研究→综合→数字回核；断点续跑，未完返回 inProgress）
  if (input.docType === "analyst_memo") {
    const latestRun = await db.tenderAnalysisRun.findFirst({
      where: { projectId: project.id, status: { in: ["REVIEW_REQUIRED", "APPROVED"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true, summaryJson: true },
    });
    if (!latestRun) throw new Error("先完成标书分析（REVIEW_REQUIRED/APPROVED）再生成分析师备忘录");
    const { runMemoV2Step } = await import("@/lib/tender-analyst-memo/v2/pipeline");
    const deadlineMs = input.deadlineMs ?? Date.now() + 240_000;
    const step = await runMemoV2Step({ projectId: project.id, runId: latestRun.id, deadlineMs });
    if (!step.done) {
      return { id: null, previewOnly: false as const, fileUrl: null, blobUrl: null, inProgress: true as const, statusZh: step.statusZh, progress: step.progress };
    }
    const sj = ((latestRun.summaryJson as Record<string, unknown>) ?? {}) as Record<string, unknown>;
    const cf = (sj.criticalFacts ?? {}) as Record<string, { status?: string; text?: string | null }>;
    const CF_ZH: Record<string, string> = { buyer: "采购方", tender_number: "招标编号", project_title: "项目名称", closing_datetime: "截标时间", question_deadline: "提问截止", site_visit: "现场踏勘", location: "地点/交付地", scope: "工作范围", quantity: "数量", contract_duration: "合同期", delivery: "交付要求", installation: "安装要求", warranty: "保修", bond: "保函", insurance: "保险", submission_method: "提交方式", pricing_method: "计价方式", addenda: "补遗", incumbent_supplier: "现任供应商", evaluation_criteria: "评标标准" };
    const criticalFacts = Object.entries(CF_ZH)
      .map(([k, labelZh]) => ({ labelZh, status: cf[k]?.status ?? "UNKNOWN", text: cf[k]?.text ?? null }))
      .filter((f) => f.status !== "UNKNOWN" || f.text);
    const { buildAnalystMemoV2Html } = await import("@/lib/tender-analyst-memo/v2/render");
    const { verifyNumbers, ANALYST_MEMO_V2_VERSION } = await import("@/lib/tender-analyst-memo/v2/contract");
    const projMeta2 = await db.project.findUnique({ where: { id: project.id }, select: { solicitationNumber: true } });
    const memoText = [...(step.state.sectionsPart1 ?? []), ...(step.state.sectionsPart2 ?? [])].map((x) => x.bodyMd).join("\n");
    const researchCorpus = JSON.stringify(step.state.research ?? {});
    const numberAudit = verifyNumbers(memoText, step.fullTextCorpus + researchCorpus);
    const html = `<!doctype html><meta charset="utf-8">${buildAnalystMemoV2Html({
      header: {
        projectName: project.name,
        clientOrganization: project.clientOrganization,
        solicitationNumber: projMeta2?.solicitationNumber ?? null,
        closeDate: project.closeDate ? project.closeDate.toISOString().slice(0, 10) : null,
        orgName: null,
        generatedAt: new Date().toISOString().slice(0, 10),
      },
      state: step.state,
      criticalFacts,
      numberAudit,
    })}`;
    return persistGeneratedHtml({
      project: { id: project.id, name: project.name },
      orgId: input.orgId,
      userId: input.userId,
      docType: input.docType,
      titleZh: "投标分析师备忘录",
      html,
      addendumFingerprint,
      conclusionVersion: ANALYST_MEMO_V2_VERSION,
    });
  }

  if (input.docType === "internal_analysis") {
    const latestRun = await db.tenderAnalysisRun.findFirst({
      where: {
        projectId: project.id,
        status: { in: ["REVIEW_REQUIRED", "APPROVED"] },
      },
      orderBy: { createdAt: "desc" },
      select: { summaryJson: true },
    });
    const { readAnalystSynthesis } = await import("@/lib/tender-analyst/contract");
    const syn = readAnalystSynthesis(latestRun?.summaryJson ?? null);
    if (syn) {
      const { buildInternalDecisionMemoHtml } = await import("./tender-doc-html");
      const generatedAt = new Date().toISOString().slice(0, 10);
      // 内部备忘录：抬头照旧印项目名称、项目编号、采购方、投标截止
      const projMeta = await db.project.findUnique({
        where: { id: project.id },
        select: { solicitationNumber: true },
      });
      const body = buildInternalDecisionMemoHtml(
        {
          projectName: project.name,
          clientOrganization: project.clientOrganization,
          solicitationNumber: projMeta?.solicitationNumber ?? null,
          closeDate: project.closeDate ? project.closeDate.toISOString().slice(0, 10) : null,
          orgName: null,
          generatedAt,
        },
        syn,
      );
      const html = `<!doctype html><meta charset="utf-8">${body}`;
      return persistGeneratedHtml({
        project: { id: project.id, name: project.name },
        orgId: input.orgId,
        userId: input.userId,
        docType: input.docType,
        titleZh: "内部投标决策备忘录",
        html,
        addendumFingerprint,
        conclusionVersion: "analyst_synthesis_v1",
      });
    }
  }

  // 中文安全（CJK-PDF 包）：legacy 文本文档并入 HTML → Chromium PDF 统一漏斗，
  // jsPDF 无 CJK 字体的方块/乱码路径整体退役；正文语义 1:1 保留。
  let textBody = "";
  let htmlOverride: string | null = null;

  if (input.docType === "internal_analysis") {
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
    textBody = body;
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
    textBody = body;
  } else if (input.docType === "bid_draft") {
    // Lane 5：投标文件起草——装配（只读）→ LLM 合成（AI_DRAFT，能力/价格不编造）→ HTML；
    // 结果元信息落 room.summaryJson.bidDraft 供工作台卡片展示（失败温和，不写半成品）。FLOW-H5 的标注也在里面。
    const { buildBidDraftDocument } = await import(
      "@/lib/tender-bid-draft"
    );
    htmlOverride = await buildBidDraftDocument({ projectId: project.id, orgId: input.orgId, userId: input.userId });
    textBody = "";
  } else {
    // owner_clarification — Lane 2：真·RFI 问题清单（备忘录策略 RFI + 分析器澄清，
    // 去重编号；AI 只做中→英翻译；渲染为中英对照表，可直接贴进门户提交）
    const { buildRfiItems, translateRfiToEn, renderRfiHtml } = await import("./rfi-export");
    const latestRunForRfi = await db.tenderAnalysisRun.findFirst({
      where: { projectId: project.id, status: { in: ["REVIEW_REQUIRED", "APPROVED"] } },
      orderBy: { createdAt: "desc" },
      select: { summaryJson: true },
    });
    const roomForRfi = await db.bidIntelligenceRoom.findUnique({
      where: { projectId: project.id },
      select: { summaryJson: true },
    });
    const rsj = (latestRunForRfi?.summaryJson ?? {}) as Record<string, unknown>;
    const syn = (rsj.analystSynthesis ?? null) as {
      clarifications?: Array<{ questionZh?: unknown; reasonZh?: unknown; priority?: unknown }>;
    } | null;
    // CHAIN-2d：旧版备忘（输入里有我方成本）先裁剪：碰到成本类字眼的 RFI 不进澄清问题文件
    const memo = redactLegacyMemo(((roomForRfi?.summaryJson as Record<string, unknown>) ?? {}).bidStrategyMemo ?? null) as {
      strategicRfis?: Array<{ questionZh?: unknown; whyZh?: unknown }>;
      legacyRfisRemoved?: number;
    } | null;
    const items = buildRfiItems({
      memoRfis: memo?.strategicRfis ?? null,
      synthesisClarifications: syn?.clarifications ?? null,
    });
    await translateRfiToEn(items, { timeoutMs: 60_000 });
    const cf = (rsj.criticalFacts ?? {}) as Record<string, { status?: string; text?: string | null }>;
    const known = (k: string) => (cf[k]?.status === "KNOWN" && cf[k]?.text ? String(cf[k]!.text) : null);
    htmlOverride = renderRfiHtml({
      projectName: project.name,
      tenderNumber: known("tender_number"),
      buyer: known("buyer") ?? project.clientOrganization ?? null,
      questionDeadline: known("question_deadline"),
      closing: known("closing_datetime") ?? (project.closeDate ? project.closeDate.toISOString().slice(0, 10) : null),
      submitChannel: known("submission_method"),
      items,
      generatedAt: new Date().toISOString().slice(0, 16).replace("T", " "),
      withheldMemoRfis: memo?.legacyRfisRemoved ?? 0,
    });
    textBody = "";
  }

  // 内部文件以项目名开头
  const fullText = `${DOC_TITLES[docType]}\n\nProject: ${project.name}\n\n${textBody}`;
  const escd = fullText
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const html = htmlOverride ?? `<!doctype html><meta charset="utf-8"><title>${DOC_TITLES[docType]}</title>
<style>body{font-family:"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif;color:#1c1c1c;max-width:800px;margin:0 auto;padding:32px 28px;line-height:1.7;font-size:13px;white-space:pre-wrap}@media print{body{padding:0}}</style>
${escd}`;
  return persistGeneratedHtml({
    project: { id: project.id, name: project.name },
    orgId: input.orgId,
    userId: input.userId,
    docType: input.docType,
    titleZh: DOC_TITLES[docType],
    html,
    addendumFingerprint,
    conclusionVersion: project.intelligence?.structuredSummaryJson
      ? "structured_v1"
      : "none",
  });
}

/**
 * 内部文件（HTML 模板）的落库：先转 PDF 并写入存储，任一步失败就改存 HTML 并写明降级原因。
 * 供应商询价单不走这里——它的 PDF 已在 tender-rfq 里生成并检查过，不合格就不保存，没有 HTML 回落。
 */
async function persistGeneratedHtml(input: {
  project: { id: string; name: string };
  orgId: string | null;
  userId: string;
  docType: Exclude<GenerateDocType, "supplier_rfq">;
  titleZh: string;
  html: string;
  addendumFingerprint: string;
  conclusionVersion: string;
}) {
  const target = { projectId: input.project.id, docType: input.docType };
  const version = await nextGeneratedVersion(target);
  // CJK-PDF 包：优先产出真 PDF（Chromium 渲染同一份 HTML，中文完好、任何
  // 设备可开）；转换失败回落存 HTML（现状行为，浏览器可开可打印），
  // 显式标注降级原因——绝不静默、绝不把坏字节当 PDF 存库。
  let file: GeneratedFile;
  let blob: Awaited<ReturnType<typeof putPrivateBlob>>;
  try {
    const { renderHtmlToPdf } = await import("@/lib/pdf/html-to-pdf");
    const pdfBuffer = await renderHtmlToPdf(input.html);
    file = { body: pdfBuffer, fileType: "pdf", contentType: "application/pdf", renderMode: "chromium_pdf" };
    blob = await putGeneratedBlob(target, version, file);
  } catch (e) {
    const renderMode = `html_fallback:${e instanceof Error ? e.message.slice(0, 120) : "unknown"}`;
    console.warn(`[generate-docs] PDF 转换失败，回落 HTML：${renderMode}`);
    file = { body: Buffer.from(input.html, "utf-8"), fileType: "html", contentType: "text/html; charset=utf-8", renderMode };
    blob = await putGeneratedBlob(target, version, file);
  }
  return recordGeneratedFile({
    ...target,
    orgId: input.orgId,
    userId: input.userId,
    version,
    title: `${input.titleZh} v${version}`,
    file,
    blob,
    meta: { projectName: input.project.name, addendumFingerprint: input.addendumFingerprint, conclusionVersion: input.conclusionVersion },
  });
}

/**
 * 一份已定的 PDF 字节落库（供应商询价单用）：算版本号 → 写存储 → 建记录。
 * 调用方保证字节已经是要存的那一份；这里不做转换、不做降级，任何一步失败都直接抛出。
 */
async function persistGeneratedFile(input: {
  projectId: string;
  orgId: string | null;
  userId: string;
  docType: GenerateDocType;
  title: (version: number) => string;
  file: GeneratedFile;
  meta: Record<string, unknown>;
}) {
  const target = { projectId: input.projectId, docType: input.docType };
  const version = await nextGeneratedVersion(target);
  const blob = await putGeneratedBlob(target, version, input.file);
  return recordGeneratedFile({ ...target, orgId: input.orgId, userId: input.userId, version, title: input.title(version), file: input.file, blob, meta: input.meta });
}

type GeneratedFile = { body: Buffer; fileType: "pdf" | "html"; contentType: string; renderMode: string };
type GeneratedTarget = { projectId: string; docType: GenerateDocType };

/** 版本号 = 该项目同类已有记录数 + 1（旧版记录计入） */
async function nextGeneratedVersion(target: GeneratedTarget): Promise<number> {
  return (await db.projectGeneratedDocument.count({ where: { projectId: target.projectId, docType: target.docType } })) + 1;
}

function putGeneratedBlob(target: GeneratedTarget, version: number, file: GeneratedFile) {
  return putPrivateBlob({
    pathname: `projects/${target.projectId}/generated/${target.docType}-v${version}-${Date.now()}.${file.fileType}`,
    body: file.body,
    contentType: file.contentType,
  });
}

/** 同类旧记录标为可能过期 + ProjectGeneratedDocument + 项目文件列表 */
async function recordGeneratedFile(input: GeneratedTarget & {
  orgId: string | null;
  userId: string;
  version: number;
  title: string;
  file: GeneratedFile;
  blob: Awaited<ReturnType<typeof putPrivateBlob>>;
  /** 写进 metaJson 的类型专有信息（docType / version / generatedAt / renderMode / createdById 由本函数统一写） */
  meta: Record<string, unknown>;
}) {
  await db.projectGeneratedDocument.updateMany({
    where: { projectId: input.projectId, docType: input.docType, stale: false },
    data: { stale: true },
  });
  const row = await db.projectGeneratedDocument.create({
    data: {
      orgId: input.orgId,
      projectId: input.projectId,
      docType: input.docType,
      version: input.version,
      title: input.title,
      blobUrl: input.blob.proxyUrl,
      fileUrl: input.blob.proxyUrl,
      metaJson: JSON.stringify({
        ...input.meta,
        docType: input.docType,
        version: input.version,
        generatedAt: new Date().toISOString(),
        renderMode: input.file.renderMode,
        createdById: input.userId,
      }),
      stale: false,
      createdById: input.userId,
    },
  });
  await db.projectDocument.create({
    data: {
      projectId: input.projectId,
      title: row.title,
      url: input.blob.proxyUrl,
      blobUrl: input.blob.proxyUrl,
      fileType: input.file.fileType,
      fileSize: input.file.body.length,
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
