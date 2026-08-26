/**
 * 一键生成项目 PDF（供应商询价 / 内部分析 / 同事任务单）
 */

import { db } from "@/lib/db";
import { putPrivateBlob } from "@/lib/files/blob-access";
import { sanitizeSupplierFacing } from "./pdf-common";
import { buildProjectAiContextBlock } from "@/lib/projects/project-ai-context";
import { computePriceGap } from "@/lib/projects/price-gap";
import { buildChinaSupplierBriefText } from "@/lib/bid-workflow/china-supplier-brief";

export type GenerateDocType =
  | "supplier_rfq"
  | "china_supplier_brief"
  | "analyst_memo"
  | "internal_analysis"
  | "teammate_tasks"
  | "tech_confirm"
  | "owner_clarification"
  | "bid_draft";

const DOC_TITLES: Record<GenerateDocType, string> = {
  supplier_rfq: "国内供应商询价",
  china_supplier_brief: "China Supplier Sourcing Brief",
  analyst_memo: "投标分析师备忘录",
  internal_analysis: "内部项目分析",
  teammate_tasks: "同事执行任务单",
  tech_confirm: "供应商技术确认表",
  owner_clarification: "RFI 问题清单（中英）",
  bid_draft: "投标文件起草（英文提交稿 + 中文审阅注）",
};

export async function generateProjectDocument(input: {
  projectId: string;
  orgId: string | null;
  userId: string;
  docType: GenerateDocType;
  /** china_supplier_brief：是否纳入公开历史金额（默认 false） */
  includePublicHistoricalAmounts?: boolean;
  /** china_supplier_brief：生成前备注 */
  confirmNotes?: string | null;
  /** analyst_memo（v2 全文多轮推理）：本次调用的时间预算截止点（Date.now() 语义）；未给则单步 4 分钟 */
  deadlineMs?: number;
  /** 仅预览正文，不写 Blob / ProjectGeneratedDocument */
  previewOnly?: boolean;
}) {
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

  // china_supplier_brief：禁止把 AI context / estimatedValue 拼进厂家文件
  const ctx =
    input.docType === "china_supplier_brief"
      ? ""
      : await buildProjectAiContextBlock(project.id);
  const addendumFingerprint = project.documents
    .map((d: { id: string; title: string }) => `${d.id}:${d.title}`)
    .sort()
    .join("|")
    .slice(0, 500);

  if (input.docType === "china_supplier_brief" && input.previewOnly) {
    const facts = await loadChinaBriefFacts(project.id);
    const previewText = buildChinaSupplierBriefText({
      projectName: project.name,
      clientOrganization: project.clientOrganization,
      closeDate: project.closeDate
        ? project.closeDate.toISOString().slice(0, 10)
        : null,
      documentTitles: project.documents.map((d) => d.title),
      includePublicHistoricalAmounts: !!input.includePublicHistoricalAmounts,
      facts,
      confirmNotes: input.confirmNotes,
    });
    return {
      id: null,
      previewText,
      previewOnly: true as const,
      fileUrl: null,
      blobUrl: null,
    };
  }

  // FB-4/5：internal_analysis / supplier_rfq 在有 Analyst 分析时走 HTML 模板
  // （基准=McMaster 管理层决策备忘录；中文安全，根治 jsPDF 无 CJK 字体乱码；
  //   内部=决策备忘录 ≠ 供应商=符合性确认+报价表，语义彻底分离）。
  // FB-16：China Supplier Brief 同样切 HTML（jsPDF 无 CJK 字体 → 乱码；与平台无关）
  if (input.docType === "china_supplier_brief") {
    const facts = await loadChinaBriefFacts(project.id);
    const briefText = buildChinaSupplierBriefText({
      projectName: project.name,
      clientOrganization: project.clientOrganization,
      closeDate: project.closeDate
        ? project.closeDate.toISOString().slice(0, 10)
        : null,
      documentTitles: project.documents.map((d) => d.title),
      includePublicHistoricalAmounts: !!input.includePublicHistoricalAmounts,
      facts,
      confirmNotes: input.confirmNotes,
    });
    const escd = briefText
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    const html = `<!doctype html><meta charset="utf-8"><title>China Supplier Sourcing Brief</title>
<style>body{font-family:"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif;color:#1c1c1c;max-width:800px;margin:0 auto;padding:32px 28px;line-height:1.7;font-size:14px;white-space:pre-wrap}@media print{body{padding:0}}</style>
${escd}`;
    return persistGeneratedHtml({
      project: { id: project.id, name: project.name },
      orgId: input.orgId,
      userId: input.userId,
      docType: input.docType,
      titleZh: "China Supplier Sourcing Brief",
      html,
      addendumFingerprint,
      conclusionVersion: "china_brief_text_v1",
    });
  }

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

  if (
    input.docType === "internal_analysis" ||
    input.docType === "supplier_rfq"
  ) {
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
      const { buildInternalDecisionMemoHtml, buildSupplierRfqHtml } =
        await import("./tender-doc-html");
      const projMeta = await db.project.findUnique({
        where: { id: project.id },
        select: { solicitationNumber: true },
      });
      const header = {
        projectName: project.name,
        clientOrganization: project.clientOrganization,
        solicitationNumber: projMeta?.solicitationNumber ?? null,
        closeDate: project.closeDate
          ? project.closeDate.toISOString().slice(0, 10)
          : null,
        orgName: null,
        generatedAt: new Date().toISOString().slice(0, 10),
      };
      const html = `<!doctype html><meta charset="utf-8">${
        input.docType === "internal_analysis"
          ? buildInternalDecisionMemoHtml(header, syn)
          : buildSupplierRfqHtml(header, syn)
      }`;
      return persistGeneratedHtml({
        project: { id: project.id, name: project.name },
        orgId: input.orgId,
        userId: input.userId,
        docType: input.docType,
        titleZh:
          input.docType === "internal_analysis"
            ? "内部投标决策备忘录"
            : "供应商询价与符合性确认表",
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
    textBody = body;
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
    textBody = body;
  } else if (input.docType === "bid_draft") {
    // Lane 5：投标文件起草——装配（只读）→ LLM 合成（AI_DRAFT，能力/价格不编造）→ HTML；
    // 结果元信息落 room.summaryJson.bidDraft 供工作台卡片展示（失败温和，不写半成品）
    const { gatherBidDraftInputs, synthesizeBidDraft, renderBidDraftHtml } = await import(
      "@/lib/tender-bid-draft"
    );
    const inputs = await gatherBidDraftInputs({ projectId: project.id, orgId: input.orgId, userId: input.userId });
    if (!inputs) throw new Error("尚无已完成的分析，无法起草");
    const { result, errorCode } = await synthesizeBidDraft(inputs);
    if (!result) throw new Error(`起草失败（${errorCode ?? "unknown"}）`);
    htmlOverride = renderBidDraftHtml(inputs, result);
    textBody = "";
    try {
      const room = await db.bidIntelligenceRoom.findUnique({ where: { projectId: project.id }, select: { id: true, summaryJson: true } });
      if (room) {
        const rsj = ((room.summaryJson as Record<string, unknown>) ?? {}) as Record<string, unknown>;
        await db.bidIntelligenceRoom.update({
          where: { id: room.id },
          data: {
            summaryJson: JSON.parse(
              JSON.stringify({
                ...rsj,
                bidDraft: {
                  version: result.version,
                  generatedAt: result.generatedAt,
                  placeholders: result.placeholders,
                  toConfirm: result.compliance.filter((c) => c.status === "TO_CONFIRM").length,
                  excludedNameHits: result.excludedNameHits,
                  forbiddenHits: result.forbiddenHits,
                  requirementCount: result.compliance.length,
                  internalNotesZh: result.sections.internalNotesZh.slice(0, 12),
                },
              }),
            ),
          },
        });
      }
    } catch {
      // 元信息落库失败不影响文档产出
    }
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
    const memo = ((roomForRfi?.summaryJson as Record<string, unknown>) ?? {}).bidStrategyMemo as {
      strategicRfis?: Array<{ questionZh?: unknown; whyZh?: unknown }>;
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
    });
    textBody = "";
  }

  const fullText = `${DOC_TITLES[input.docType]}\n\nProject: ${project.name}\n\n${textBody}`;
  const escd = fullText
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const html = htmlOverride ?? `<!doctype html><meta charset="utf-8"><title>${DOC_TITLES[input.docType]}</title>
<style>body{font-family:"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif;color:#1c1c1c;max-width:800px;margin:0 auto;padding:32px 28px;line-height:1.7;font-size:13px;white-space:pre-wrap}@media print{body{padding:0}}</style>
${escd}`;
  return persistGeneratedHtml({
    project: { id: project.id, name: project.name },
    orgId: input.orgId,
    userId: input.userId,
    docType: input.docType,
    titleZh: DOC_TITLES[input.docType],
    html,
    addendumFingerprint,
    conclusionVersion: project.intelligence?.structuredSummaryJson
      ? "structured_v1"
      : "none",
  });
}

/** HTML 生成文档统一落库：私有 Blob + ProjectGeneratedDocument(版本/stale) + 项目文件列表 */
async function persistGeneratedHtml(input: {
  project: { id: string; name: string };
  orgId: string | null;
  userId: string;
  docType: GenerateDocType;
  titleZh: string;
  html: string;
  addendumFingerprint: string;
  conclusionVersion: string;
}) {
  const version =
    (await db.projectGeneratedDocument.count({
      where: { projectId: input.project.id, docType: input.docType },
    })) + 1;
  // CJK-PDF 包：优先产出真 PDF（Chromium 渲染同一份 HTML，中文完好、任何
  // 设备可开）；转换失败回落存 HTML（现状行为，浏览器可开可打印），
  // 显式标注降级原因——绝不静默、绝不把坏字节当 PDF 存库。
  let blob: Awaited<ReturnType<typeof putPrivateBlob>>;
  let storedFileType: "pdf" | "html";
  let storedSize: number;
  let renderMode: string;
  try {
    const { renderHtmlToPdf } = await import("@/lib/pdf/html-to-pdf");
    const pdfBuffer = await renderHtmlToPdf(input.html);
    blob = await putPrivateBlob({
      pathname: `projects/${input.project.id}/generated/${input.docType}-v${version}-${Date.now()}.pdf`,
      body: pdfBuffer,
      contentType: "application/pdf",
    });
    storedFileType = "pdf";
    storedSize = pdfBuffer.length;
    renderMode = "chromium_pdf";
  } catch (e) {
    const htmlBuffer = Buffer.from(input.html, "utf-8");
    blob = await putPrivateBlob({
      pathname: `projects/${input.project.id}/generated/${input.docType}-v${version}-${Date.now()}.html`,
      body: htmlBuffer,
      contentType: "text/html; charset=utf-8",
    });
    storedFileType = "html";
    storedSize = htmlBuffer.length;
    renderMode = `html_fallback:${e instanceof Error ? e.message.slice(0, 120) : "unknown"}`;
    console.warn(`[generate-docs] PDF 转换失败，回落 HTML：${renderMode}`);
  }
  await db.projectGeneratedDocument.updateMany({
    where: { projectId: input.project.id, docType: input.docType, stale: false },
    data: { stale: true },
  });
  const row = await db.projectGeneratedDocument.create({
    data: {
      orgId: input.orgId,
      projectId: input.project.id,
      docType: input.docType,
      version,
      title: `${input.titleZh} v${version}`,
      blobUrl: blob.proxyUrl,
      fileUrl: blob.proxyUrl,
      metaJson: JSON.stringify({
        projectName: input.project.name,
        docType: input.docType,
        version,
        generatedAt: new Date().toISOString(),
        addendumFingerprint: input.addendumFingerprint,
        conclusionVersion: input.conclusionVersion,
        renderMode,
        createdById: input.userId,
      }),
      stale: false,
      createdById: input.userId,
    },
  });
  await db.projectDocument.create({
    data: {
      projectId: input.project.id,
      title: row.title,
      url: blob.proxyUrl,
      blobUrl: blob.proxyUrl,
      fileType: storedFileType,
      fileSize: storedSize,
      parseStatus: "done",
      source: "generated",
      uploadedById: input.userId,
    },
  });
  return row;
}

async function loadChinaBriefFacts(projectId: string) {
  try {
    const room = await db.bidIntelligenceRoom.findUnique({
      where: { projectId },
      select: {
        facts: {
          take: 40,
          orderBy: { extractedAt: "desc" },
          select: {
            content: true,
            confidence: true,
            sourceType: true,
            sourceUrl: true,
            sourcePage: true,
            humanConfirmed: true,
          },
        },
      },
    });
    return room?.facts ?? [];
  } catch {
    return [];
  }
}

/** 文件变更后标记生成文档可能过期 */
export async function markGeneratedDocsStale(projectId: string) {
  await db.projectGeneratedDocument.updateMany({
    where: { projectId, stale: false },
    data: { stale: true },
  });
}
