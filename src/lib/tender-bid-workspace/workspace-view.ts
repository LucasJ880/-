/**
 * TI-4a 投标工作区读取结果（纯函数）
 *
 * 由已存内容现算：价格表校验、尺寸对照、认证闸、领取方汇总、可投标判定、阶段决定与三张清单。
 * 读取结果里没有任何成本、报价金额或毛利。成本核算（buildCostSheet）另走一条路：
 * 输入来自请求、不落库、只给有财务查看权的人。
 */
import { computeCostScenario } from "@/lib/tender-bid-cost/pricing";
import { renderCostSheetMarkdown } from "@/lib/tender-bid-cost/render-markdown";
import { buildCostSheetView, type CostSheetView } from "@/lib/tender-bid-cost/sheet-view";
import type { CostScenarioInput } from "@/lib/tender-bid-cost/contract";
import { evaluateCertificationGate, type CertificationGateResult } from "@/lib/tender-bid-readiness/certification-gate";
import { assessBidReadiness, type CostReadinessInput, type ReadinessAssessment } from "@/lib/tender-bid-readiness/readiness";
import { decideStages, type MaterialKey, type StagePolicyResult } from "@/lib/tender-bid-readiness/stage-policy";
import type { DependentConclusion } from "@/lib/tender-bid-readiness/staleness";
import { summarizeDocumentHolders, type DocumentHolderSummary } from "@/lib/tender-competition/document-holders";
import { validatePriceSchedule, type PriceScheduleLine, type ScheduleValidation } from "@/lib/tender-price-schedule/contract";
import { matchDimensions, type DimensionMatch } from "@/lib/tender-price-schedule/dimension-match";
import type { CostSheetRequest, StoredWorkspace } from "./contract";

export type WorkspaceContext = {
  now: Date;
  /** Project.closeDate 的 ISO 字符串；没有则为 null */
  closingAtIso: string | null;
  /** 我方名称（项目所属组织的名称） */
  ownNames: readonly string[];
  /** 项目已上传的文件数 */
  documentCount: number;
  /** 该项目询价里「已报价」的供应商行数 */
  quotedSupplierCount: number;
};

export type LineCheck = {
  lineNo: number;
  /** 有尺寸要求且已填产品尺寸时才有；否则为 null（可投标判定里会报「尚未核对」） */
  dimension: (DimensionMatch & { required: string; offered: string }) | null;
  certification: CertificationGateResult;
};

export type WorkspaceView = {
  hasPriceSchedule: boolean;
  schedule: { lines: PriceScheduleLine[]; validation: ScheduleValidation };
  lineChecks: LineCheck[];
  documentHolders: DocumentHolderSummary | null;
  addenda: StoredWorkspace["addenda"];
  materials: MaterialKey[];
  readiness: ReadinessAssessment;
  stages: StagePolicyResult;
};

function linesOf(stored: StoredWorkspace | null): PriceScheduleLine[] {
  return (stored?.priceSchedule.lines ?? []) as PriceScheduleLine[];
}

function checkLines(stored: StoredWorkspace | null, now: Date): LineCheck[] {
  return linesOf(stored).map((line) => {
    const detail = stored?.lineDetails[String(line.lineNo)];
    const required = line.dimensions ?? line.minimumDimensions ?? null;
    const offered = detail?.offeredDimensions?.trim() || null;
    const dimension = required && offered
      ? { ...matchDimensions({ required, offered, mode: line.minimumDimensions && !line.dimensions ? "minimum" : "exact" }), required, offered }
      : null;
    const certification = evaluateCertificationGate({
      lineNo: line.lineNo, certificationGate: line.certificationGate, product: detail?.product ?? null, certificates: detail?.certificates ?? [], now,
    });
    return { lineNo: line.lineNo, dimension, certification };
  });
}

/** 「手头材料」由实际数据推导，不让用户勾选。 */
export function deriveMaterials(stored: StoredWorkspace | null, ctx: Pick<WorkspaceContext, "documentCount" | "quotedSupplierCount">): MaterialKey[] {
  const out: MaterialKey[] = [];
  if (ctx.documentCount > 0 || linesOf(stored).length > 0) out.push("TENDER_DOCUMENTS");
  if (stored?.documentHolders) out.push("DOCUMENT_HOLDER_LIST");
  if (ctx.quotedSupplierCount > 0) out.push("SUPPLIER_QUOTES");
  return out;
}

/**
 * TI-4c 由行明细现算「依赖补遗版本的结论」：填了产品尺寸的行有一条尺寸对照，
 * 带认证要求且填了品牌型号或证书的行有一条认证判定；基准是该行明细保存时的补遗号。
 */
function conclusionsOf(stored: StoredWorkspace | null): DependentConclusion[] {
  const out: DependentConclusion[] = [];
  for (const line of linesOf(stored)) {
    const detail = stored?.lineDetails[String(line.lineNo)];
    if (!detail) continue;
    const basedOnAddendum = detail.basedOnAddendum ?? 0;
    if ((line.dimensions || line.minimumDimensions) && detail.offeredDimensions?.trim()) {
      out.push({ key: `dimension:${line.lineNo}`, kind: "DIMENSION_MATCH", lineNo: line.lineNo, basedOnAddendum });
    }
    if (line.certificationGate?.trim() && (detail.product?.make?.trim() || detail.product?.model?.trim() || (detail.certificates ?? []).length > 0)) {
      out.push({ key: `certification:${line.lineNo}`, kind: "CERTIFICATION", lineNo: line.lineNo, basedOnAddendum });
    }
  }
  return out;
}

function readinessOf(stored: StoredWorkspace | null, ctx: WorkspaceContext, checks: LineCheck[], cost: CostReadinessInput | null): ReadinessAssessment {
  const details = stored?.lineDetails ?? {};
  return assessBidReadiness({
    now: ctx.now,
    closingAt: ctx.closingAtIso,
    lines: linesOf(stored),
    cost,
    dimensionChecks: checks.filter((c) => c.dimension).map((c) => ({ lineNo: c.lineNo, verdict: c.dimension!.verdict, reasonZh: c.dimension!.reasonZh })),
    products: Object.fromEntries(Object.entries(details).map(([k, v]) => [Number(k), v.product ?? undefined])),
    certificates: Object.fromEntries(Object.entries(details).map(([k, v]) => [Number(k), v.certificates ?? []])),
    addenda: stored?.addenda ?? [],
    conclusions: conclusionsOf(stored),
  });
}

export function buildWorkspaceView(stored: StoredWorkspace | null, ctx: WorkspaceContext): WorkspaceView {
  const lines = linesOf(stored);
  const checks = checkLines(stored, ctx.now);
  const materials = deriveMaterials(stored, ctx);
  return {
    hasPriceSchedule: lines.length > 0,
    schedule: { lines, validation: lines.length > 0 ? validatePriceSchedule(lines) : { valid: false, issues: [] } },
    lineChecks: checks,
    documentHolders: stored?.documentHolders ? summarizeDocumentHolders({ snapshot: stored.documentHolders, ownNames: ctx.ownNames }) : null,
    addenda: stored?.addenda ?? [],
    materials,
    readiness: readinessOf(stored, ctx, checks, null),
    stages: decideStages({ materials }),
  };
}

export type CostSheetResult =
  | { ok: true; view: CostSheetView; markdown: string; readiness: ReadinessAssessment }
  | { ok: false; status: 400 | 409; code: "NO_PRICE_SCHEDULE" | "UNKNOWN_LINE" | "COST_INPUT_REJECTED"; messageZh: string };

/** 用请求里的成本输入 + 已存的价格表行项算核算表。不保存任何东西。 */
export function buildCostSheet(stored: StoredWorkspace | null, req: CostSheetRequest, ctx: WorkspaceContext): CostSheetResult {
  const lines = linesOf(stored);
  if (lines.length === 0) return { ok: false, status: 409, code: "NO_PRICE_SCHEDULE", messageZh: "还没有保存价格表，先保存价格表行项再做成本核算" };
  const known = new Set(lines.map((l) => l.lineNo));
  const stray = req.lines.find((l) => !known.has(l.lineNo));
  if (stray) return { ok: false, status: 400, code: "UNKNOWN_LINE", messageZh: `成本输入引用了价格表里不存在的第 ${stray.lineNo} 行` };
  const byLine = new Map(req.lines.map((l) => [l.lineNo, l] as const));
  const scenarioInput: CostScenarioInput = {
    key: "workspace",
    label: req.label?.trim() || "当前成本输入",
    // 价格表里的每一行都进核算表；没有成本输入的行按进口、无报价处理 → 表上显示「缺供应商报价」
    lines: lines.map((line) => {
      const c = byLine.get(line.lineNo);
      return c ? { ...c, line } : { line, sourcing: "IMPORT" as const, quote: null };
    }),
    importGst: req.importGst,
    freight: req.freight ?? null,
    reserves: req.reserves ?? [],
    pricing: req.pricing,
  };
  const scenario = computeCostScenario(scenarioInput);
  if (!scenario.ok) return { ok: false, status: 400, code: "COST_INPUT_REJECTED", messageZh: scenario.messageZh };
  const view = buildCostSheetView(scenario);
  return { ok: true, view, markdown: renderCostSheetMarkdown(view), readiness: readinessOf(stored, ctx, checkLines(stored, ctx.now), scenario) };
}
