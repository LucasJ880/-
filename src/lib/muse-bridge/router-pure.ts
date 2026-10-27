/**
 * Muse Bridge — 纯路由逻辑（零 DB / 零 LLM / 零出站）
 *
 * 所有"把青砚内部状态翻译成 Muse 能转述的一句话"的逻辑都在这里，便于离线测试。
 * router.ts 只负责取数和调用现有服务，然后交给本文件格式化。
 *
 * P1-8：所有 ok 回复都是 Advisory（结论 → 理由 → 下一步），经 advisoryResponse 出站；
 *       suggestedActions[0] 恒等于 nextStep。错误回复仍走 errResponse。
 */

import {
  MUSE_BRIDGE_CONTRACT_VERSION,
  MUSE_INTENT_PHASE,
  type MuseCommandArgs,
  type MuseCommandResponse,
  type MuseErrorCode,
  type MuseIntent,
  type MuseSuggestedAction,
} from "./contract";
import { advisoryResponse, sanitizeOutbound, type Advisory, type AdvisoryNextStep } from "./advisory";
import type { MuseUserPrefs } from "./prefs-pure";
import { getProjectStage, resolveCloseDate } from "@/lib/tender/stage";
import { rowProblemsZh, type CompareMatrix, type MusePricingView } from "@/lib/tender-rfq/compare";
import type { TenderProject } from "@/lib/tender/types";
import { INQUIRY_REPLY_TYPE, isWeChatConfirmableAction } from "@/lib/ai-grader/actions/wechat-confirm-policy";

export { advisoryResponse, OUTBOUND_REDACTED, sanitizeOutbound } from "./advisory";

// ── 响应构造 ────────────────────────────────────────────────────

export function errResponse(
  requestId: string,
  errorCode: MuseErrorCode,
  message: string,
  extra?: { availableInPhase?: number; suggestedActions?: MuseSuggestedAction[] },
): MuseCommandResponse {
  return {
    contractVersion: MUSE_BRIDGE_CONTRACT_VERSION,
    requestId,
    ok: false,
    message: sanitizeOutbound(message),
    suggestedActions: (extra?.suggestedActions ?? []).slice(0, 4),
    errorCode,
    availableInPhase: extra?.availableInPhase,
  };
}

/** 未启用意图的统一回复（诚实告知阶段）。 */
export function notEnabledResponse(requestId: string, intent: MuseIntent): MuseCommandResponse {
  const phase = MUSE_INTENT_PHASE[intent];
  const label: Record<MuseIntent, string> = {
    status: "查看状态",
    ask: "基于证据问答",
    approve: "批准",
    reject: "驳回",
    follow_tender: "跟进新标（标讯雷达）",
    rfq: "生成并发送询价",
    chase: "催单",
    compare: "比价",
    price_scenario: "定价情景",
    next_step: "下一步建议",
    set_preference: "设置个人偏好",
    preferences: "查看个人偏好",
    sales_overview: "销售概览",
    opportunity_status: "查看商机状态",
  };
  return errResponse(
    requestId,
    "INTENT_NOT_ENABLED",
    `「${label[intent]}」这个动作当前还没在 Muse 通道开放（属于 Phase ${phase}），请先在青砚里操作。`,
    { availableInPhase: phase },
  );
}

const shortName = (s: string, n = 12) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const money = (n: number) => Math.round(n).toLocaleString("en-US");
const nextStepOf = (projectId: string, name: string): AdvisoryNextStep => ({
  label: `「${shortName(name, 14)}」下一步做什么`,
  command: { intent: "next_step", projectId },
});

// ── status ──────────────────────────────────────────────────────

export type StatusProjectRow = TenderProject & {
  id: string;
  name: string;
  /** 最新分析状态（TenderAnalysisRun.status），无则 null */
  analysisStatus: string | null;
  /** 待办审批数（该用户可见） */
  pendingApprovals: number;
  /** P1-7：最新一轮里超期没回、但没有邮件线程（不是经青砚发的）的家数——只能手工催（单项目 status 才算） */
  manualChase?: number;
};

const STAGE_LABEL: Record<string, string> = {
  initiation: "立项",
  distribution: "分发",
  interpretation: "解读",
  supplier_inquiry: "询价",
  supplier_quote: "报价",
  submission: "提交",
};

const ANALYSIS_LABEL: Record<string, string> = {
  PENDING: "排队中",
  EXTRACTING: "解析中",
  ANALYZING: "分析中",
  REVIEW_REQUIRED: "待人工审阅",
  APPROVED: "分析已确认",
  FAILED: "分析失败",
  SUPERSEDED: "已被新版本覆盖",
};

function daysUntil(d: Date | null, now: Date): number | null {
  if (!d) return null;
  return Math.ceil((d.getTime() - now.getTime()) / 86_400_000);
}

function deadlineZh(p: StatusProjectRow, now: Date): string {
  const left = daysUntil(resolveCloseDate(p), now);
  return left === null ? "无截标日" : left < 0 ? `已过截标 ${-left} 天` : `截标还有 ${left} 天`;
}

/** 单项目一行摘要。 */
export function formatProjectLine(p: StatusProjectRow, now: Date): string {
  const stage = STAGE_LABEL[getProjectStage(p)] ?? "未知阶段";
  const analysis = p.analysisStatus ? ANALYSIS_LABEL[p.analysisStatus] ?? p.analysisStatus : "未分析";
  const approvals = p.pendingApprovals > 0 ? `，${p.pendingApprovals} 条待你批` : "";
  return `${p.name}：${stage} · ${deadlineZh(p, now)} · ${analysis}${approvals}`;
}

/** 排序：有待批的优先，其次截标最近。 */
export function sortStatusRows(rows: StatusProjectRow[], now: Date): StatusProjectRow[] {
  return [...rows].sort((a, b) => {
    if ((b.pendingApprovals > 0 ? 1 : 0) !== (a.pendingApprovals > 0 ? 1 : 0)) {
      return b.pendingApprovals > 0 ? 1 : -1;
    }
    const da = daysUntil(resolveCloseDate(a), now) ?? Number.POSITIVE_INFINITY;
    const db_ = daysUntil(resolveCloseDate(b), now) ?? Number.POSITIVE_INFINITY;
    return da - db_;
  });
}

/**
 * status：多项目 → 结论给总数，理由是前 3 个项目各一行，下一步 = 最该先看的那个标的 next_step；
 *         单项目 → 结论给阶段与截标，理由给分析状态与待批。完整列表在 data.projects。
 */
export function statusAdvisory(rows: StatusProjectRow[], now: Date, opts: { singleProject?: boolean } = {}): Advisory {
  if (rows.length === 0) return { conclusion: "当前没有在跟的投标项目", reasons: [], nextStep: null };
  const sorted = sortStatusRows(rows, now);
  const top = sorted[0];

  if (opts.singleProject) {
    const stage = STAGE_LABEL[getProjectStage(top)] ?? "未知阶段";
    const analysis = top.analysisStatus ? ANALYSIS_LABEL[top.analysisStatus] ?? top.analysisStatus : "未分析";
    return {
      conclusion: `「${shortName(top.name, 20)}」：${stage}阶段，${deadlineZh(top, now)}`,
      reasons: [
        `分析：${analysis}`,
        ...(top.pendingApprovals > 0 ? [`${top.pendingApprovals} 条待你批`] : []),
        ...(top.manualChase ? [`${top.manualChase} 家没回且无法自动催（没有邮件线程），请手工催`] : []),
      ],
      nextStep: nextStepOf(top.id, top.name),
      alternatives: [{ label: "最大的废标风险是什么", command: { intent: "ask", projectId: top.id, question: "这个标最大的废标风险是什么？" } }],
    };
  }

  const pending = sorted.reduce((n, r) => n + r.pendingApprovals, 0);
  const more = sorted.length > 3 ? `（另 ${sorted.length - 3} 个见列表）` : "";
  return {
    conclusion: pending > 0 ? `在跟 ${sorted.length} 个标，${pending} 条待你批${more}` : `在跟 ${sorted.length} 个标，最近截标「${shortName(top.name, 14)}」${more}`,
    reasons: sorted.slice(0, 3).map((p, i) => `${i + 1}. ${formatProjectLine(p, now)}`),
    nextStep: nextStepOf(top.id, top.name),
    alternatives: sorted.slice(1, 3).map((p) => nextStepOf(p.id, p.name)),
  };
}

/** 兼容旧调用：渲染后的 message + suggestedActions */
export function formatStatusMessage(rows: StatusProjectRow[], now: Date, opts: { singleProject?: boolean } = {}): { message: string; suggestedActions: MuseSuggestedAction[]; advisory: Advisory } {
  const a = statusAdvisory(rows, now, opts);
  const r = advisoryResponse("n/a", a);
  return { message: r.message, suggestedActions: r.suggestedActions, advisory: a };
}

// ── approvals ───────────────────────────────────────────────────

export type ApprovalDecisionOutcome = {
  ok: boolean;
  status?: string;
  message?: string;
  error?: string;
  duplicate?: boolean;
};

/**
 * Muse 自己起草、审批前已把要点给用户看过的对外动作：rfq / chase 意图的回复（rfqDraftAdvisory /
 * chaseAdvisory）列出收件供应商与发件邮箱，再给「发 / 批准」按钮——在 Muse 里批是设计内的流程。
 */
export const MUSE_FLOW_APPROVAL_TYPES = ["tender.send_rfq", "tender.send_chase"] as const;

/**
 * 白名单：Muse 里回「批准」可以直接批的动作 = 微信数字确认白名单（内部、低风险，同一套
 * isWeChatConfirmableAction，含按 payload 的筛选）+ Muse 自己的询价 / 催单。
 * 其余（询盘回复、活动上线、报价让利、研究计划、营销上下文覆盖、写报价备注、未知 / 新增类型）
 * 的审批卡只有一句标题，看不到正文 / 风险提醒，只能在青砚网页上批准；驳回不受影响。
 */
export function museCanApproveAction(type: string | null | undefined, payload?: unknown): boolean {
  if (!type) return false;
  if ((MUSE_FLOW_APPROVAL_TYPES as readonly string[]).includes(type)) return true;
  return isWeChatConfirmableAction(type, payload);
}

/**
 * 查到了类型、且不在白名单内 → 需去网页审批。查不到（不存在 / 跨组织）不在这里拦，交给 ApprovalPort 报错。
 */
export function museApprovalNeedsWebPreview(type: string | null | undefined, payload?: unknown): boolean {
  return !!type && !museCanApproveAction(type, payload);
}

export function webPreviewRequiredResponse(requestId: string, type?: string | null): MuseCommandResponse {
  if (type === INQUIRY_REPLY_TYPE) {
    return errResponse(requestId, "APPROVAL_FAILED", "给买家的询盘回复需在青砚「今日询盘」页看完草稿后批准，这里不能直接批。");
  }
  return errResponse(requestId, "APPROVAL_FAILED", "这条审批会对外发送、改动买家可见的内容或属于高风险操作，需在青砚「审批中心」看完内容后批准，这里不能直接批。");
}

export function formatApprovalOutcome(
  requestId: string,
  decision: "approve" | "reject",
  outcome: ApprovalDecisionOutcome,
): MuseCommandResponse {
  if (!outcome.ok) {
    return errResponse(requestId, "APPROVAL_FAILED", outcome.error ?? "审批失败，请在青砚审批中心查看。");
  }
  const verb = decision === "approve" ? "已批准" : "已驳回";
  return advisoryResponse(
    requestId,
    {
      conclusion: outcome.duplicate ? `${verb}（之前已处理过，本次未重复执行）` : verb,
      reasons: outcome.message ? [outcome.message] : [],
      nextStep: { label: "看看还有什么要批", command: { intent: "status" } },
    },
    { data: { status: outcome.status ?? null } },
  );
}

// ── ask（LLM 只写结论/理由/提示词；下一步由代码查表） ─────────────

export const ASK_OUTPUT_INSTRUCTIONS = [
  "只输出一个 JSON 对象，不要 markdown、不要解释：",
  '{"conclusion": "一句话结论（≤60字）", "reasons": ["依据1（带要求编号或页码）", "最多3条"], "nextStepHint": "看状态 / 询价 / 比价 / 定价 / 催 / 批 之一，没有就写空字符串"}',
].join("\n");

export type AskAnswer = { conclusion: string; reasons: string[]; nextStepHint: string | null };

/** 解析 LLM 输出；不是合法 JSON 时退化为"第一行结论 + 后面几行理由"，nextStepHint=null（不猜） */
export function parseAskAnswer(raw: string): AskAnswer {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const m = text.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const o = JSON.parse(m[0]) as Record<string, unknown>;
      if (typeof o.conclusion === "string" && o.conclusion.trim()) {
        return {
          conclusion: o.conclusion.trim(),
          reasons: Array.isArray(o.reasons) ? o.reasons.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [],
          nextStepHint: typeof o.nextStepHint === "string" && o.nextStepHint.trim() ? o.nextStepHint.trim() : null,
        };
      }
    } catch {
      /* 退化处理 */
    }
  }
  const lines = text.split(/\n+/).map((l) => l.replace(/^[-·•\d.、\s]+/, "").trim()).filter(Boolean);
  return { conclusion: lines[0] ?? "（没有可用的回答）", reasons: lines.slice(1, 4), nextStepHint: null };
}

/**
 * §2.1 映射表：看状态→status、问价/询价→rfq、比价→compare、算价/定价→price_scenario、催→chase、批→approve(最早待批)；
 * 其它 → null（不编）。"批"没有待批可指时也是 null。
 */
export function mapNextStepHint(hint: string | null, ctx: { projectId: string; earliestApprovalId: string | null }): AdvisoryNextStep | null {
  if (!hint) return null;
  const h = hint.trim();
  const pid = ctx.projectId;
  if (h.includes("看状态")) return { label: "看这个标的状态", command: { intent: "status", projectId: pid } };
  if (h.includes("问价") || h.includes("询价")) return { label: "起草询价", command: { intent: "rfq", projectId: pid } };
  if (h.includes("比价")) return { label: "比价", command: { intent: "compare", projectId: pid } };
  if (h.includes("算价") || h.includes("定价")) return { label: "算定价情景", command: { intent: "price_scenario", projectId: pid } };
  if (h.includes("催")) return { label: "催没回的供应商", command: { intent: "chase", projectId: pid } };
  if (h.includes("批")) return ctx.earliestApprovalId ? { label: "批准最早一条", command: { intent: "approve", approvalId: ctx.earliestApprovalId } } : null;
  return null;
}

export function askAdvisory(raw: string, ctx: { projectId: string; earliestApprovalId: string | null }): Advisory {
  const a = parseAskAnswer(raw);
  return { conclusion: a.conclusion, reasons: a.reasons, nextStep: mapNextStepHint(a.nextStepHint, ctx) };
}

export function askNoContextAdvisory(projectId: string, projectName: string): Advisory {
  return {
    conclusion: `「${shortName(projectName, 20)}」还没有可用的分析结果`,
    reasons: ["请先在青砚上传招标文件，分析完成后再来问我"],
    nextStep: { label: "看这个标的状态", command: { intent: "status", projectId } },
  };
}

// ── rfq ─────────────────────────────────────────────────────────

export type RfqDraftView = {
  projectId: string;
  actionId: string;
  roundNumber: number;
  replyBy: string | null;
  fromEmail: string;
  suppliers: Array<{ name: string }>;
  blockedSuppliers: Array<{ name: string; reason: "no_email" | "inactive" }>;
  excludedRequirements: number;
  supplierSource: "explicit" | "hint" | "prefs";
  incoterm: string | null;
  incotermFromPrefs: boolean;
};

export function rfqDraftAdvisory(r: RfqDraftView): Advisory {
  const names = r.suppliers.map((s) => s.name).join("、");
  const reasons: string[] = [
    r.supplierSource === "prefs" ? `按你常用的 ${names}` : `发给：${names}`,
    `回复截止 ${r.replyBy ?? "未设"}；批准后从 ${r.fromEmail} 发出${r.incoterm ? `；贸易条款 ${r.incoterm}${r.incotermFromPrefs ? "（你的默认）" : ""}` : ""}`,
  ];
  const notes: string[] = [];
  if (r.excludedRequirements > 0) notes.push(`已排除 ${r.excludedRequirements} 条非供应商侧/未确认要求`);
  if (r.blockedSuppliers.length) notes.push(`没发：${r.blockedSuppliers.map((b) => `${b.name}（${b.reason === "no_email" ? "没邮箱" : "已停用"}）`).join("、")}`);
  if (notes.length) reasons.push(notes.join("；"));
  return {
    conclusion: `第 ${r.roundNumber} 轮询价草稿好了：${r.suppliers.length} 家，等你批`,
    reasons,
    nextStep: { label: "发", command: { intent: "approve", approvalId: r.actionId } },
    alternatives: [{ label: "先不发", command: { intent: "reject", approvalId: r.actionId, reason: "暂缓" } }],
  };
}

export function rfqCandidatesAdvisory(projectId: string, candidates: Array<{ id: string; name: string; contactEmail: string | null }>): Advisory {
  const withEmail = candidates.filter((c) => !!c.contactEmail);
  return {
    conclusion: "要问哪几家？",
    reasons: [
      `最近用过的：${candidates.map((c) => `${c.name}${c.contactEmail ? "" : "（无邮箱）"}`).join("、")}`,
      "直接说名字，或者选下面的按钮；选定供应商后我会记住你的常用",
    ],
    nextStep: withEmail.length
      ? { label: `全部有邮箱的 ${withEmail.length} 家`, command: { intent: "rfq", projectId, supplierIds: withEmail.slice(0, 10).map((c) => c.id) } }
      : null,
    alternatives: withEmail.slice(0, 2).map((c) => ({ label: `只问 ${c.name.slice(0, 12)}`, command: { intent: "rfq" as const, projectId, supplierIds: [c.id] } })),
  };
}

// ── compare / price_scenario（P1-6）────────────────────────────

/** compare：结论 / 理由由矩阵（代码）拼；下一步 = 按推荐（无推荐则最便宜可换算）那家算情景 */
export function compareAdvisory(input: { projectId: string; roundNumber: number; matrix: CompareMatrix; firstTierQty?: number | null }): Advisory {
  const { matrix } = input;
  const byId = new Map(matrix.rows.map((r) => [r.itemId, r]));
  const rec = matrix.recommendedItemId ? byId.get(matrix.recommendedItemId) ?? null : null;
  const cheapest = matrix.cheapestItemId ? byId.get(matrix.cheapestItemId) ?? null : null;
  const qty = input.firstTierQty ?? null;

  const reasons: string[] = [];
  if (rec && cheapest && cheapest.itemId !== rec.itemId) {
    const pct = ((rec.landedCad.total! - cheapest.landedCad.total!) / cheapest.landedCad.total!) * 100;
    reasons.push(`最低价 ${shortName(cheapest.supplierName)}（${money(cheapest.landedCad.total!)}）未推荐：${rowProblemsZh(cheapest, qty).join("，") || "检查未全部通过"}；推荐的贵 ${pct.toFixed(1)}%`);
  }
  if (!rec) {
    for (const r of matrix.rows.slice(0, 2)) reasons.push(`${shortName(r.supplierName)}：${rowProblemsZh(r, qty).join("，") || "检查未全部通过"}`);
  }
  const notNormalized = matrix.rows.filter((r) => r.landedCad.total == null);
  if (notNormalized.length) reasons.push(`${notNormalized.length} 家未能换算落地价（${notNormalized[0].blockers[0] ?? "参数不全"}）`);
  reasons.push(`第 ${input.roundNumber} 轮共 ${matrix.rows.length} 家报价；落地价 = CAD，到目的地含税`);

  const target = rec ?? cheapest;
  const scenario = (r: { itemId: string; supplierName: string }): MuseSuggestedAction => ({
    label: `按 ${shortName(r.supplierName)} 的落地价算情景`,
    command: { intent: "price_scenario", projectId: input.projectId, supplierItemId: r.itemId },
  });
  return {
    conclusion: rec ? `推荐 ${shortName(rec.supplierName)}：落地价 ${money(rec.landedCad.total!)}` : `${matrix.rows.length} 家报价，暂无检查全部通过的`,
    reasons,
    nextStep: target ? scenario(target) : null,
    alternatives: matrix.rows.filter((r) => r.landedCad.total != null && r.itemId !== target?.itemId).slice(0, 2).map(scenario),
  };
}

export function formatCompareResponse(
  requestId: string,
  input: { projectId: string; inquiryId: string; roundNumber: number; matrix: CompareMatrix; firstTierQty?: number | null },
): MuseCommandResponse {
  return advisoryResponse(requestId, compareAdvisory(input), {
    strict: true,
    data: { inquiryId: input.inquiryId, roundNumber: input.roundNumber, matrix: input.matrix },
  });
}

/** 轮次里 0 家 quoted：如实说"还没有报价入表"，不回空矩阵 */
export function formatNoQuotesResponse(requestId: string, message: string, projectId: string): MuseCommandResponse {
  return advisoryResponse(requestId, {
    conclusion: message,
    reasons: ["供应商回信后会自动入表，我会推送提醒"],
    nextStep: { label: "看这个标的状态", command: { intent: "status", projectId } },
  });
}

/**
 * price_scenario：出价格分、总分差、打平价、所选供应商落地价（view 已由 projectScenariosForMuse 投影，不含 marginPct）。
 * 决定 A：落地价可以出；毛利率、项目估值、我方最终报价不出。候选价低于落地价 → 理由里写明会亏。
 */
export function priceScenarioAdvisory(input: {
  projectId: string;
  supplierName: string;
  competitorPriceCad: number | null;
  competitorSourceZh: string | null;
  view: MusePricingView;
}): Advisory {
  const { view } = input;
  const delta = (d: number) => `${d > 0 ? "+" : ""}${d}`;
  const compare = { label: "看比价", command: { intent: "compare" as const, projectId: input.projectId } };
  if (input.competitorPriceCad == null) {
    return {
      conclusion: "缺对手价参考，算不出价格分",
      reasons: ["请在青砚报价表助手填一个对手/现任价格假设"],
      nextStep: compare,
    };
  }
  const line = (s: { labelZh: string; priceCad: number; ourPriceScore: number; deltaPts: number }) =>
    `${s.labelZh} ${money(s.priceCad)} → 价格分 ${s.ourPriceScore}，总分差 ${delta(s.deltaPts)}`;
  const reasons: string[] = [];
  if (view.candidate) reasons.push(`${line(view.candidate)}${view.candidate.belowCostZh ? `（${view.candidate.belowCostZh}）` : ""}`);
  for (const s of view.scenarios) {
    if (reasons.length >= 2) break;
    reasons.push(line(s));
  }
  reasons.push(
    `对手参考价 ${money(input.competitorPriceCad)}${input.competitorSourceZh ? `（${input.competitorSourceZh}）` : ""}；按「${shortName(input.supplierName, 16)}」的报价${view.landedCostCad != null ? `，落地价 ${money(view.landedCostCad)}` : ""}`,
  );
  return {
    conclusion: view.breakEvenPriceCad != null ? `打平价 ${money(view.breakEvenPriceCad)}：${view.breakEvenNoteZh}` : `打平价：${view.breakEvenNoteZh}`,
    reasons,
    nextStep: compare,
  };
}

export function formatPriceScenarioResponse(
  requestId: string,
  input: {
    projectId: string;
    supplierItemId: string;
    supplierName: string;
    competitorPriceCad: number | null;
    competitorSourceZh: string | null;
    view: MusePricingView;
  },
): MuseCommandResponse {
  const { view } = input;
  return advisoryResponse(requestId, priceScenarioAdvisory(input), {
    strict: true,
    data: {
      supplierItemId: input.supplierItemId,
      supplierName: input.supplierName,
      competitorPriceCad: input.competitorPriceCad,
      scenarios: view.scenarios,
      candidate: view.candidate,
      breakEvenPriceCad: view.breakEvenPriceCad,
      landedCostCad: view.landedCostCad,
    },
  });
}

// ── chase（P1-7：催单 / 缺字段追问 → 审批卡） ─────────────────────────

export type ChaseRunView = {
  drafted: Array<{ supplierName: string; actionId: string; kind: "no_reply" | "missing_fields"; chaseIndex: 1 | 2 }>;
  skipped: Array<{ supplierName: string; reason: string }>;
  failed: Array<{ supplierName: string; error: string }>;
};

const CHASE_SKIP_ZH: Record<string, string> = {
  not_due: "还没到催的时候",
  no_thread: "没有邮件线程，请手工联系",
  pending_card: "已有一张待批的催单",
  rejected_card: "催单被驳回过",
  max_reached: "已催过两次，到期后自动标未响应",
  already_asked: "已追问过缺字段",
  complete: "已回复",
  quoted: "已报价",
  not_open: "不在询价中",
};

export function chaseAdvisory(projectId: string, run: ChaseRunView): Advisory {
  const notes = [
    ...run.skipped.map((s) => `${shortName(s.supplierName, 12)}${CHASE_SKIP_ZH[s.reason] ?? s.reason}`),
    ...run.failed.map((f) => `${shortName(f.supplierName, 12)}没起草成：${f.error}`),
  ];
  if (run.drafted.length === 0) {
    return {
      conclusion: "没有需要催的供应商",
      reasons: notes.slice(0, 3),
      nextStep: { label: "这个标下一步做什么", command: { intent: "next_step", projectId } },
    };
  }
  const what = (d: ChaseRunView["drafted"][number]) =>
    d.kind === "missing_fields" ? `追问 ${shortName(d.supplierName, 12)}缺的字段` : `${d.chaseIndex === 2 ? "第二次催" : "催"} ${shortName(d.supplierName, 12)}`;
  const first = run.drafted[0];
  return {
    conclusion: `起草了 ${run.drafted.length} 封催单 / 追问，等你批`,
    reasons: [run.drafted.map(what).join("、"), ...notes].slice(0, 3),
    nextStep: { label: `批准：${what(first)}`, command: { intent: "approve", approvalId: first.actionId } },
    alternatives: [{ label: "先不发", command: { intent: "reject", approvalId: first.actionId, reason: "暂不催" } }],
  };
}

// ── preferences（P1-8） ─────────────────────────────────────────

export function preferencesAdvisory(prefs: MuseUserPrefs, supplierNames: Map<string, string>): Advisory {
  const names = prefs.defaultSupplierIds.map((id) => supplierNames.get(id) ?? "（已删除的供应商）");
  const empty = !names.length && !prefs.defaultIncoterm && prefs.chaseAfterDays == null;
  return {
    conclusion: empty ? "还没有记住你的偏好" : "这是我记住的你的偏好",
    reasons: [
      `常用供应商：${names.length ? names.join("、") : "未设（选定供应商后自动记住）"}`,
      `默认贸易条款：${prefs.defaultIncoterm ?? "未设"}`,
      `催单：${prefs.chaseAfterDays != null ? `${prefs.chaseAfterDays} 天没回` : "未设（默认 3 天）"}`,
    ],
    nextStep: null,
    // 只在还没设默认条款时给一个示例按钮（已设就不重复建议）
    alternatives: prefs.defaultIncoterm
      ? []
      : [{ label: "默认贸易条款设为 DDP", command: { intent: "set_preference", key: "defaultIncoterm", value: "DDP" } }],
  };
}

export function setPreferenceAdvisory(summaryZh: string): Advisory {
  return {
    conclusion: `记住了：${summaryZh}`,
    reasons: ["以后起草询价时会按这个来；随时可以改或清空"],
    nextStep: { label: "看我的偏好", command: { intent: "preferences" } },
  };
}

// ── 意图门 ──────────────────────────────────────────────────────

export function gateIntent(
  requestId: string,
  command: MuseCommandArgs,
  enabled: ReadonlySet<MuseIntent>,
): MuseCommandResponse | null {
  return enabled.has(command.intent) ? null : notEnabledResponse(requestId, command.intent);
}
