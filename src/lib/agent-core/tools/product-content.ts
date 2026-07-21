/**
 * AI 外贸产品内容总监 — Agent 工具
 */

import { registry } from "../tool-registry";
import type { ToolExecutionContext } from "../types";
import {
  addJobInput,
  approveExecutionPlan,
  confirmProductFact,
  createProductContentJob,
  decideApproval,
  generateExecutionPlan,
  getProductContentJobDetail,
  rejectProductFact,
} from "@/lib/product-content/jobs/service";
import {
  approveProductContentJob,
  deliverProductContentPackage,
} from "@/lib/product-content/jobs/approve-deliver";
import { analyzeJobInputs } from "@/lib/product-content/intake/analyze";
import { generateProductCopy } from "@/lib/product-content/copy/generate";
import { generateProductDocuments } from "@/lib/product-content/documents/generate";
import { runProductContentPipeline } from "@/lib/product-content/jobs/runtime";

function ok(data: unknown) {
  return { success: true as const, data };
}

function fail(error: string) {
  return { success: false as const, data: { error } };
}

function requireOrg(ctx: ToolExecutionContext): string | null {
  if (!ctx.orgId) return "缺少组织上下文 orgId";
  return null;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

registry.register({
  name: "product_content_create_job",
  description: "创建产品内容任务（AI 外贸产品内容总监）",
  domain: "trade",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "任务标题" },
      executionMode: {
        type: "string",
        enum: ["AUTOPILOT", "ALWAYS_ASK"],
        description: "执行模式，默认 AUTOPILOT",
      },
      industryPack: { type: "string", description: "行业包，默认 home_textile" },
      selectedSku: { type: "string", description: "可选 SKU" },
    },
    required: ["title"],
  },
  execute: async (ctx) => {
    const denied = requireOrg(ctx);
    if (denied) return fail(denied);
    const title = str(ctx.args.title);
    if (!title) return fail("title 不能为空");

    const job = await createProductContentJob({
      orgId: ctx.orgId,
      userId: ctx.userId,
      title,
      executionMode: str(ctx.args.executionMode) as "AUTOPILOT" | "ALWAYS_ASK" | undefined,
      industryPack: str(ctx.args.industryPack),
      selectedSku: str(ctx.args.selectedSku),
    });
    return ok({ jobId: job.id, status: job.status, title: job.title });
  },
});

registry.register({
  name: "product_content_add_input",
  description: "为产品内容任务添加输入（文本/URL/已上传 blob 等）",
  domain: "trade",
  parameters: {
    type: "object",
    properties: {
      jobId: { type: "string" },
      inputType: { type: "string", description: "image|excel|pdf|url|text|voice" },
      blobPathname: { type: "string" },
      mimeType: { type: "string" },
      fileName: { type: "string" },
      textContent: { type: "string" },
      url: { type: "string" },
      purpose: { type: "string" },
      transcriptText: { type: "string" },
    },
    required: ["jobId", "inputType"],
  },
  execute: async (ctx) => {
    const denied = requireOrg(ctx);
    if (denied) return fail(denied);
    const jobId = str(ctx.args.jobId);
    const inputType = str(ctx.args.inputType);
    if (!jobId || !inputType) return fail("jobId 与 inputType 必填");

    const input = await addJobInput({
      orgId: ctx.orgId,
      userId: ctx.userId,
      jobId,
      inputType,
      blobPathname: str(ctx.args.blobPathname),
      mimeType: str(ctx.args.mimeType),
      fileName: str(ctx.args.fileName),
      textContent: str(ctx.args.textContent),
      url: str(ctx.args.url),
      purpose: str(ctx.args.purpose),
      transcriptText: str(ctx.args.transcriptText),
    });
    return ok({ inputId: input.id, inputType: input.inputType });
  },
});

registry.register({
  name: "product_content_analyze_inputs",
  description: "分析任务输入，提取产品事实与资产",
  domain: "trade",
  parameters: {
    type: "object",
    properties: { jobId: { type: "string" } },
    required: ["jobId"],
  },
  execute: async (ctx) => {
    const denied = requireOrg(ctx);
    if (denied) return fail(denied);
    const jobId = str(ctx.args.jobId);
    if (!jobId) return fail("jobId 必填");
    const result = await analyzeJobInputs(ctx.orgId, jobId, ctx.userId);
    return ok(result);
  },
});

registry.register({
  name: "product_content_extract_facts",
  description: "提取/查看产品事实（别名：分析输入后返回事实摘要）",
  domain: "trade",
  parameters: {
    type: "object",
    properties: { jobId: { type: "string" } },
    required: ["jobId"],
  },
  execute: async (ctx) => {
    const denied = requireOrg(ctx);
    if (denied) return fail(denied);
    const jobId = str(ctx.args.jobId);
    if (!jobId) return fail("jobId 必填");
    const detail = await getProductContentJobDetail(ctx.orgId, jobId, ctx.userId);
    return ok({
      jobId,
      status: detail.status,
      facts: detail.facts.map((f) => ({
        id: f.id,
        fieldKey: f.fieldKey,
        value: f.value,
        status: f.status,
        sourceType: f.sourceType,
        locked: f.locked,
      })),
      missingFields: detail.missingFieldsJson,
    });
  },
});

registry.register({
  name: "product_content_confirm_fact",
  description: "确认或拒绝产品事实",
  domain: "trade",
  parameters: {
    type: "object",
    properties: {
      factId: { type: "string" },
      action: { type: "string", enum: ["confirm", "reject"] },
    },
    required: ["factId", "action"],
  },
  execute: async (ctx) => {
    const denied = requireOrg(ctx);
    if (denied) return fail(denied);
    const factId = str(ctx.args.factId);
    if (!factId) return fail("factId 必填");
    const action = ctx.args.action === "reject" ? "reject" : "confirm";
    const fact =
      action === "reject"
        ? await rejectProductFact({ orgId: ctx.orgId, userId: ctx.userId, factId })
        : await confirmProductFact({ orgId: ctx.orgId, userId: ctx.userId, factId });
    return ok({ factId: fact.id, fieldKey: fact.fieldKey, status: fact.status });
  },
});

registry.register({
  name: "product_content_generate_plan",
  description: "生成产品内容执行计划",
  domain: "trade",
  parameters: {
    type: "object",
    properties: { jobId: { type: "string" } },
    required: ["jobId"],
  },
  execute: async (ctx) => {
    const denied = requireOrg(ctx);
    if (denied) return fail(denied);
    const jobId = str(ctx.args.jobId);
    if (!jobId) return fail("jobId 必填");
    const result = await generateExecutionPlan({
      orgId: ctx.orgId,
      jobId,
      userId: ctx.userId,
    });
    return ok(result);
  },
});

registry.register({
  name: "product_content_approve_plan",
  description: "批准执行计划；可选先处理 pending approval",
  domain: "trade",
  parameters: {
    type: "object",
    properties: {
      jobId: { type: "string" },
      approvalId: { type: "string" },
      decision: { type: "string", enum: ["approved", "rejected"] },
      reason: { type: "string" },
    },
    required: ["jobId"],
  },
  execute: async (ctx) => {
    const denied = requireOrg(ctx);
    if (denied) return fail(denied);
    const jobId = str(ctx.args.jobId);
    if (!jobId) return fail("jobId 必填");

    const approvalId = str(ctx.args.approvalId);
    if (approvalId && ctx.args.decision) {
      await decideApproval({
        orgId: ctx.orgId,
        jobId,
        userId: ctx.userId,
        approvalId,
        decision: ctx.args.decision === "rejected" ? "rejected" : "approved",
        reason: str(ctx.args.reason),
      });
      if (ctx.args.decision === "rejected") {
        return ok({ status: "rejected" });
      }
    }

    const job = await approveExecutionPlan({ orgId: ctx.orgId, jobId, userId: ctx.userId });
    return ok({ jobId: job.id, status: job.status, plan: job.planJson });
  },
});

registry.register({
  name: "product_content_run_pipeline",
  description: "运行产品内容流水线（分析→计划→视觉→文案→文档）",
  domain: "trade",
  parameters: {
    type: "object",
    properties: {
      jobId: { type: "string" },
      dryRunVisuals: { type: "boolean", description: "视觉 dry-run" },
      formalDocuments: { type: "boolean", description: "仅正式文档" },
    },
    required: ["jobId"],
  },
  execute: async (ctx) => {
    const denied = requireOrg(ctx);
    if (denied) return fail(denied);
    const jobId = str(ctx.args.jobId);
    if (!jobId) return fail("jobId 必填");
    const result = await runProductContentPipeline(ctx.orgId, jobId, ctx.userId, {
      dryRunVisuals: ctx.args.dryRunVisuals === true,
      formalDocuments: ctx.args.formalDocuments === true,
    });
    return ok(result);
  },
});

registry.register({
  name: "product_content_generate_copy",
  description: "生成出口产品英文文案",
  domain: "trade",
  parameters: {
    type: "object",
    properties: { jobId: { type: "string" } },
    required: ["jobId"],
  },
  execute: async (ctx) => {
    const denied = requireOrg(ctx);
    if (denied) return fail(denied);
    const jobId = str(ctx.args.jobId);
    if (!jobId) return fail("jobId 必填");
    const copy = await generateProductCopy(ctx.orgId, jobId, ctx.userId);
    return ok({ copyId: copy.id, titleEn: copy.titleEn, status: copy.status });
  },
});

registry.register({
  name: "product_content_generate_documents",
  description: "生成 Word/PDF/Excel/ZIP 交付文档包",
  domain: "trade",
  parameters: {
    type: "object",
    properties: {
      jobId: { type: "string" },
      formalDocuments: { type: "boolean" },
    },
    required: ["jobId"],
  },
  execute: async (ctx) => {
    const denied = requireOrg(ctx);
    if (denied) return fail(denied);
    const jobId = str(ctx.args.jobId);
    if (!jobId) return fail("jobId 必填");
    const documents = await generateProductDocuments(ctx.orgId, jobId, ctx.userId, {
      formalOnly: ctx.args.formalDocuments === true,
    });
    return ok({
      word: documents.wordDoc?.id,
      pdf: documents.pdfDoc?.id,
      excel: documents.excelDoc?.id,
      zip: documents.zipDoc?.id,
    });
  },
});

registry.register({
  name: "product_content_approve_job",
  description: "最终批准产品内容任务（门禁校验）",
  domain: "trade",
  parameters: {
    type: "object",
    properties: { jobId: { type: "string" } },
    required: ["jobId"],
  },
  execute: async (ctx) => {
    const denied = requireOrg(ctx);
    if (denied) return fail(denied);
    const jobId = str(ctx.args.jobId);
    if (!jobId) return fail("jobId 必填");
    const result = await approveProductContentJob({
      orgId: ctx.orgId,
      jobId,
      userId: ctx.userId,
    });
    return ok({
      jobId: result.job.id,
      status: result.job.status,
      snapshotId: result.snapshot.id,
    });
  },
});

registry.register({
  name: "product_content_deliver",
  description: "交付已批准的产品内容包",
  domain: "trade",
  parameters: {
    type: "object",
    properties: { jobId: { type: "string" } },
    required: ["jobId"],
  },
  execute: async (ctx) => {
    const denied = requireOrg(ctx);
    if (denied) return fail(denied);
    const jobId = str(ctx.args.jobId);
    if (!jobId) return fail("jobId 必填");
    const result = await deliverProductContentPackage({
      orgId: ctx.orgId,
      jobId,
      userId: ctx.userId,
    });
    return ok({
      jobId: result.job.id,
      status: result.job.status,
      zipPath: result.zipDocument.blobPathname,
    });
  },
});

registry.register({
  name: "product_content_get_status",
  description: "获取产品内容任务完整状态（只读）",
  domain: "trade",
  parameters: {
    type: "object",
    properties: { jobId: { type: "string" } },
    required: ["jobId"],
  },
  execute: async (ctx) => {
    const denied = requireOrg(ctx);
    if (denied) return fail(denied);
    const jobId = str(ctx.args.jobId);
    if (!jobId) return fail("jobId 必填");
    const job = await getProductContentJobDetail(ctx.orgId, jobId, ctx.userId);
    return ok({
      id: job.id,
      title: job.title,
      status: job.status,
      executionMode: job.executionMode,
      plan: job.planJson,
      missingFields: job.missingFieldsJson,
      errorMessage: job.errorMessage,
      factCount: job.facts.length,
      visualJobCount: job.visualJobs.length,
      hasCopy: Boolean(job.copy),
      documentCount: job.documents.length,
      pendingApprovals: job.approvals.filter((a) => a.status === "pending").length,
    });
  },
});
