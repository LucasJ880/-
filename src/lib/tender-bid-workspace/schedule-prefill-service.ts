/**
 * FIX-2 价格表从招标分析带入 — 读取（只读，不写任何东西）
 *
 * 取项目当前有效的那份招标分析（最新一份等待审核或已批准的——与询价单取要求用的是同一条规则），
 * 读它「价格与评标」一节里保留的数量线索，去掉已被人驳回的要求对应的线索，再按确定性的规则生成粘贴文本。
 * 组织只取自调用方已经核对过的项目记录；查询同时按项目与组织限定。
 */
import { db } from "@/lib/db";
import {
  buildSchedulePrefill,
  readScheduleCandidates,
  schedulePrefillMessageZh,
  type SchedulePrefillResponse,
} from "./schedule-prefill";

const EMPTY = { text: "", rows: [], skipped: [] };

export async function loadSchedulePrefill(input: { projectId: string; orgId: string }): Promise<SchedulePrefillResponse> {
  const run = await db.tenderAnalysisRun.findFirst({
    where: { projectId: input.projectId, orgId: input.orgId, status: { in: ["REVIEW_REQUIRED", "APPROVED"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!run) return { state: "no_analysis", messageZh: schedulePrefillMessageZh("no_analysis", EMPTY), ...EMPTY };

  const section = await db.tenderAnalysisSection.findFirst({
    where: { runId: run.id, sectionKey: "PRICING_EVALUATION" },
    orderBy: { createdAt: "desc" },
    select: { structuredJson: true },
  });
  const stored = readScheduleCandidates(section?.structuredJson ?? null);
  if (stored.state === "absent") return { state: "legacy_analysis", messageZh: schedulePrefillMessageZh("legacy_analysis", EMPTY), ...EMPTY };

  // 来自要求的线索：这条要求现在已经被人驳回的，不带入
  const codes = [...new Set(stored.items.flatMap((i) => (i.source === "requirement" && i.code ? [i.code] : [])))];
  const rejected = new Set(
    codes.length
      ? (
          await db.tenderExtractedRequirement.findMany({
            where: { analysisRunId: run.id, projectId: input.projectId, requirementCode: { in: codes }, reviewStatus: "REJECTED" },
            select: { requirementCode: true },
          })
        ).map((r) => r.requirementCode)
      : [],
  );
  const prefill = buildSchedulePrefill(stored.items.filter((i) => !(i.source === "requirement" && i.code && rejected.has(i.code))));
  return { state: "ready", messageZh: schedulePrefillMessageZh("ready", prefill), ...prefill };
}
