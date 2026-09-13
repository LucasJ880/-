/**
 * 标书分析 Skill — 对项目关联的招标文档进行深度结构化分析
 *
 * 输入路径：完整文档清单 → 角色分类 → 招标包 Manifest → 全文分块
 * → V2 抽取 / Evidence Verifier / Addendum 优先 → 完整性门 → GPT-6 综合。
 *
 * QUALITY_FIRST：tender 角色（GPT-6 Astra）。禁止用前 8 份文件、窄关键词
 * 或静默 100k 截断决定证据可用性。
 */

import { createTenderCompletion } from "@/lib/ai/model-policy";
import { getExpertSystemPrompt } from "@/lib/ai/expert-roles";
import { registerSkill } from "./registry";
import type { SkillContext, SkillResult } from "../types";
import { analyzeTender } from "@/lib/tender-understanding/analyzer";
import { loadTenderPackageInventory } from "@/lib/tender-understanding/load-package";
import {
  applyCompletenessToResult,
  buildTenderPackage,
  formatCountsForPrompt,
  formatManifestForPrompt,
  INCOMPLETE_COMPLIANCE_NOTICE,
  TENDER_PACKAGE_INCOMPLETE,
  toAnalyzerInput,
} from "@/lib/tender-understanding/package-input";
import type { AnalysisResultV2 } from "@/lib/tender-understanding/contract";
import type { TenderStage } from "@/lib/ai/model-policy";

const TENDER_SKILL_DISCIPLINE = `## HARD RULES（GPT-6 不得降低证据标准）
- 只陈述已验证 CLAIM，并给出 EVIDENCE / SOURCE / CONFIDENCE。
- 无法证明时写 UNKNOWN，禁止用推断填补缺失的强制条件、认证或截止日期。
- 必须跨文档核对：RFP / SOW / Terms / Pricing / Technical / Addendum / Drawing / Spec / Appendix / Forms / Q&A。
- Addendum 必须标 ORIGINAL / SUPERSEDED / MODIFIED / NEW / UNCHANGED；后发布有效补遗优先。
- 识别 conflict / duplicate / override / dependency / missing form / cross-reference。
- 不要逐份独立分析后简单拼接。先完整文档清单，再综合。
- 若状态为 TENDER_PACKAGE_INCOMPLETE，不得把报告写成完整合规审查。`;

function synthesisStage(pkg: {
  includedDocuments: { sourceRole: string }[];
}): TenderStage {
  const hasAddendum = pkg.includedDocuments.some((d) => d.sourceRole === "ADDENDUM");
  if (pkg.includedDocuments.length > 1) {
    return hasAddendum ? "addendum" : "cross_document";
  }
  return "understanding";
}

function groundedDigest(result: AnalysisResultV2): string {
  const mandatory = result.requirements
    .filter((r) => r.mandatory === true && r.status === "ACTIVE")
    .slice(0, 80)
    .map(
      (r) =>
        `- [${r.category}] ${r.statement} (disposition=${r.addendumDisposition}; evidence=${r.evidence
          .map((e) => `${e.documentId}#${e.pageNumber}`)
          .join(", ")})`,
    );
  const addenda = result.addendumChanges.slice(0, 80).map(
    (c) =>
      `- ${c.action} addendum=${c.addendumDocumentId} superseded=${c.supersededRequirementId ?? "n/a"} active=${c.activeRequirementId ?? "n/a"} note=${c.note} evidence=${c.evidence
        .map((e) => `${e.documentId}#${e.pageNumber}`)
        .join(",")}`,
  );
  const unknowns = result.unknowns
    .slice(0, 40)
    .map((u) => `- ${u.field}: ${u.note}`);
  const conflicts = result.conflicts.slice(0, 40).map(
    (c) => `- ${c.topic}: ${c.resolution} (${c.note})`,
  );
  return [
    `PROJECT_SUMMARY:\n${result.projectSummary}`,
    `MANDATORY_REQUIREMENTS:\n${mandatory.join("\n") || "(none verified)"}`,
    `ADDENDUM_CHANGES:\n${addenda.join("\n") || "(none)"}`,
    `UNKNOWNS:\n${unknowns.join("\n") || "(none)"}`,
    `CONFLICTS:\n${conflicts.join("\n") || "(none)"}`,
    `LIMITATIONS:\n${result.limitations.join("\n") || "(none)"}`,
  ].join("\n\n");
}

async function execute(ctx: SkillContext): Promise<SkillResult> {
  try {
    const inventory = await loadTenderPackageInventory(ctx.projectId);
    const pkg = buildTenderPackage({ projectId: ctx.projectId, inventory });

    if (pkg.includedDocuments.length === 0) {
      const incomplete = pkg.completeness.status === TENDER_PACKAGE_INCOMPLETE;
      const summary = incomplete
        ? `${TENDER_PACKAGE_INCOMPLETE}\n${INCOMPLETE_COMPLIANCE_NOTICE}\n未找到可分析的招标正文（见清单排除原因）。`
        : "未找到可分析的标书/招标文档，无需分析";
      return {
        success: true,
        data: {
          analyzed: 0,
          documents: [],
          completeness: pkg.completeness,
          manifest: pkg.manifest,
          counts: pkg.completeness.counts,
        },
        summary,
      };
    }

    const analyzerInput = toAnalyzerInput(ctx.projectId, pkg);
    const { result: rawResult, run } = await analyzeTender(analyzerInput);
    const failedWindowDocumentIds = run.failedWindows.map(
      (w) => w.windowId.split(":")[0]!,
    );
    const gatedPkg = buildTenderPackage({
      projectId: ctx.projectId,
      inventory,
      failedWindowDocumentIds,
    });
    const result = applyCompletenessToResult(rawResult, gatedPkg.completeness);

    const expertPrompt = getExpertSystemPrompt("bid_analyst") || "";
    const incomplete = gatedPkg.completeness.status === TENDER_PACKAGE_INCOMPLETE;
    const userPrompt = `对以下已验证招标包做跨文档综合（禁止把未纳入分析的文档当成已审）。

PACKAGE_STATUS: ${gatedPkg.completeness.status}
${incomplete ? INCOMPLETE_COMPLIANCE_NOTICE : "包完整性已建立。"}

COUNTS:
${formatCountsForPrompt(gatedPkg.completeness.counts)}

COVERAGE:
packageCoverage=${gatedPkg.completeness.packageCoverage}
mandatoryEvidenceCoverage=${gatedPkg.completeness.mandatoryEvidenceCoverage}
addendumCoverage=${gatedPkg.completeness.addendumCoverage}

MANIFEST:
${formatManifestForPrompt(gatedPkg.manifest)}

GROUNDED_EVIDENCE (Evidence Verifier 已核验；不得发明清单外文档):
${groundedDigest(result)}

必须输出：
1. 文档清单与纳入/排除原因
2. 强制要求 / 资格 / 技术 / 商务 / 执行可行性
3. Addendum 对照（ORIGINAL / SUPERSEDED / MODIFIED / NEW / UNCHANGED）
4. 跨文档冲突、重复、覆盖、依赖、缺表、交叉引用
5. 证据不足处明确 UNKNOWN
6. Bid / No-Bid 输入材料（不代替人工决策）
${incomplete ? `7. 开篇必须写 ${TENDER_PACKAGE_INCOMPLETE}，并写明尚不能保证完整合规审查` : ""}

请按照你的输出格式规范，输出结构化报告。`;

    const synthesis = await createTenderCompletion({
      systemPrompt: `${expertPrompt}\n\n${TENDER_SKILL_DISCIPLINE}`,
      userPrompt,
      mode: "deep",
      maxTokens: 4096,
      tenderStage: synthesisStage(gatedPkg),
      promptVersion: "tender-analysis-skill@3",
      userId: ctx.userId,
    });

    const prefix = incomplete
      ? `${TENDER_PACKAGE_INCOMPLETE}\n${INCOMPLETE_COMPLIANCE_NOTICE}\n\n`
      : "";
    const fallback = synthesis.fallbackUsed ? "ANALYZED_WITH_FALLBACK_MODEL\n\n" : "";
    const summary = `${prefix}${fallback}${synthesis.content}`;

    return {
      success: true,
      data: {
        analyzed: gatedPkg.completeness.counts.DOCUMENTS_ANALYZED,
        documents: gatedPkg.includedDocuments.map((d) => d.name),
        analyzedWithFallbackModel: synthesis.fallbackUsed || result.metadata.analyzedWithFallbackModel,
        model: synthesis.model,
        requestedModel: synthesis.requestedModel,
        completeness: gatedPkg.completeness,
        manifest: gatedPkg.manifest,
        chunkCount: gatedPkg.chunks.length,
        counts: gatedPkg.completeness.counts,
      },
      summary,
    };
  } catch (err) {
    return {
      success: false,
      data: {},
      summary: "标书分析失败",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

registerSkill({
  id: "tender_analysis",
  name: "标书分析",
  domain: "analysis",
  tier: "analysis",
  version: "1.2.0",
  description:
    "完整清单后深度分析招标文件/RFP：角色分类、全文分块、证据核验与补遗优先，输出面向老板决策的结构化报告",
  actions: ["analyze_tender", "extract_specs", "evaluate_feasibility"],
  riskLevel: "low",
  requiresApproval: false,
  inputSchema: { projectId: "string" },
  outputSchema: {
    analyzed: "number",
    documents: "string[]",
  },
  dependsOn: ["document_summary"],
  expertRoleId: "bid_analyst",
  execute,
});
