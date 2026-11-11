/**
 * FLOW-H1 项目页「下一步」的判断（纯函数，零 DB / 网络 / 模型）
 *
 * 只有一张表：待批、分析中、关键事实缺证据、强制要求不满足、还没询价、没回复、报价齐了、定了供应商没定价，
 * 这些状态直接调 Muse 通道的查表函数 `decideNextStep`（不复制、不修改它），结论文字也取自它。
 * 这里只做三件事：
 *   1. 查表之前：项目已结束、已提交、截标已过——这三种状态下查表的建议都没有意义；
 *   2. 查表之后：在它没有答案的地方细化（没传文件 / 解析中 / 等批准分析 / 等回复 / 只有一家报价 / 准备提交…）；
 *   3. 把每个结论换成页面上的一个位置。
 * 截标提醒单独算（再调一次同一张表），不参与排序——临近截标时不盖住真正的下一步。
 *
 * 这里不执行任何动作：不批准、不发送、不起草。
 */
import { decideNextStep, type NextStepDecision, type NextStepSnapshot } from "@/lib/muse-bridge/next-step";
import { analysisPhaseFromRunStatus } from "@/lib/tender/workbench-state";
import { deadlinePassed } from "@/lib/tender-rfq/chase-pure";
import {
  APPROVAL_CENTER_HREF,
  NEXT_STEP_ANCHORS,
  rfqRoundAnchorId,
  type WebNextStepAction,
  type WebNextStepRule,
  type WebNextStepTarget,
  type WebNextStepView,
} from "./targets";

type RoundItem = NonNullable<NextStepSnapshot["latestRound"]>["items"][number];

export type WebNextStepInput = {
  now: Date;
  projectId: string;
  projectName: string;
  /** 项目已放弃或招投标状态已是终态时的说法（如「已放弃」「未中标」）；否则 null */
  closedLabelZh: string | null;
  closeDate: Date | null;
  submittedAt: Date | null;
  documentCount: number;
  /** 有文件还在解析 */
  parsingActive: boolean;
  /** 最新一份分析的状态；没有分析为 null */
  analysisStatus: string | null;
  unknownCriticalFacts: number;
  mandatoryNonCompliant: number;
  /** 最新一份分析里还没有人确认或驳回的要求条数 */
  pendingRequirementCount: number;
  /** 这个人可见、属于本项目、待批且未过期的审批 */
  pendingApprovals: Array<{ id: string; title: string; createdAt: Date; type: string; inquiryId: string | null }>;
  /** 最新一轮询价（已取消的不算）；没有为 null */
  latestRound: { inquiryId: string; replyBy: Date | null; items: RoundItem[] } | null;
  hasProjectQuote: boolean;
  /** 等待天数：与定时催单扫描同一个取法（该轮授权里定格的 > 项目负责人的偏好 > 组织设置 > 3） */
  chaseAfterDays: number;
  /** 看页面的人有没有项目写权限 */
  canManage: boolean;
  /** 投标工作区的现算结果；该组织没有开启为 null */
  workspace: { hasPriceSchedule: boolean; blockers: Array<{ code: string; messageZh: string }> } | null;
};

/** 询价与催单这两种审批可以在它所在的那一轮里就地批准 */
const RFQ_CARD_TYPES: ReadonlySet<string> = new Set(["tender.send_rfq", "tender.send_chase"]);
/** 成本类的阻断项：成本输入只存在浏览器里，服务端看不到，列出来就永远在 */
const COST_BLOCKERS: ReadonlySet<string> = new Set(["COST_MISSING", "COST_INCOMPLETE"]);
/** 需要项目写权限才能做的步骤 */
const NEEDS_WRITE: ReadonlySet<WebNextStepRule> = new Set<WebNextStepRule>([
  "no_documents", "analysis_failed", "no_analysis", "unknown_facts", "mandatory_gap", "requirements_review",
  "no_rfq", "reply_deadline_passed", "single_quote", "no_quotes", "quotes_ready", "price_pending", "prepare_submission",
]);

const tab = (t: "workbench" | "requirements" | "bid" | "submission", anchor: string | null = null): WebNextStepTarget => ({ kind: "tab", tab: t, anchor });
const ANALYSIS = tab("requirements", NEXT_STEP_ANCHORS.analysis);
const RFQ_ROUNDS = tab("bid", NEXT_STEP_ANCHORS.rfqRounds);
const roundTarget = (inquiryId: string) => tab("bid", rfqRoundAnchorId(inquiryId));
const go = (labelZh: string, target: WebNextStepTarget): WebNextStepAction => ({ labelZh, target });

type Core = { rule: WebNextStepRule; headlineZh: string; reasonsZh: string[]; action: WebNextStepAction | null };

function toSnapshot(input: WebNextStepInput): NextStepSnapshot {
  return {
    projectId: input.projectId,
    projectName: input.projectName,
    now: input.now,
    closeDate: input.closeDate,
    submittedAt: input.submittedAt,
    analysisStatus: input.analysisStatus,
    unknownCriticalFacts: input.unknownCriticalFacts,
    mandatoryNonCompliant: input.mandatoryNonCompliant,
    pendingApprovals: input.pendingApprovals.map(({ id, title, createdAt }) => ({ id, title, createdAt })),
    latestRound: input.latestRound ? { inquiryId: input.latestRound.inquiryId, items: input.latestRound.items } : null,
    hasProjectQuote: input.hasProjectQuote,
    // 常用供应商只影响 Muse 的一句说明，网页不用；等待天数用扫描的口径
    prefs: { defaultSupplierIds: [], chaseAfterDays: input.chaseAfterDays },
  };
}

function prepareSubmission(input: WebNextStepInput): Core {
  const ws = input.workspace;
  if (!ws) {
    return { rule: "prepare_submission", headlineZh: "投标价已有，准备提交", reasonsZh: ["到「提交」页核对提交材料与截标时间"], action: go("去提交页", tab("submission")) };
  }
  const blockers = ws.blockers.filter((b) => !COST_BLOCKERS.has(b.code));
  if (blockers.length === 0) {
    return {
      rule: "prepare_submission",
      headlineZh: "投标价已有，准备提交",
      reasonsZh: ["投标工作区没有成本以外的阻断项（成本核算只存在你的浏览器里，这里看不到）", "到「提交」页核对提交材料与截标时间"],
      action: go("去提交页", tab("submission")),
    };
  }
  return {
    rule: "prepare_submission",
    headlineZh: "投标价已有，提交前还有阻断项",
    reasonsZh: [`投标工作区还有 ${blockers.length} 个阻断项（成本核算只存在你的浏览器里，这里看不到）`, ...blockers.slice(0, 2).map((b) => b.messageZh)],
    action: go("去看阻断项", tab("bid", NEXT_STEP_ANCHORS.bidWorkspace)),
  };
}

/** 查表说「没有待办」时，按询价轮次再分 */
function refineIdle(input: WebNextStepInput, fallback: NextStepDecision): Core {
  if (input.hasProjectQuote) return prepareSubmission(input);
  const round = input.latestRound;
  const items = (round?.items ?? []).filter((i) => i.status !== "pending");
  if (round && items.length > 0) {
    const waiting = items.filter((i) => i.status === "sent").length;
    const quoted = items.filter((i) => i.status === "quoted").length;
    const selected = items.some((i) => i.isSelected);
    const here = roundTarget(round.inquiryId);
    if (waiting > 0) {
      return {
        rule: "waiting_replies",
        headlineZh: `已问 ${items.length} 家，${quoted} 家已报价，还在等 ${waiting} 家`,
        reasonsZh: [`满 ${input.chaseAfterDays} 天没回，这里会提示`],
        action: go("看这一轮", here),
      };
    }
    if (!selected && quoted === 1) {
      return { rule: "single_quote", headlineZh: "只有 1 家报价", reasonsZh: ["可以直接选定这一家，或再问几家比一比"], action: go("去看这一轮", here) };
    }
    if (quoted === 0) {
      return { rule: "no_quotes", headlineZh: "这一轮没有拿到报价", reasonsZh: ["问过的供应商都没有报价或已谢绝，可以再问一轮"], action: go("再问一轮", RFQ_ROUNDS) };
    }
  }
  return { rule: "idle", headlineZh: fallback.advisory.conclusion, reasonsZh: [], action: null };
}

/** 把查表的结论换成网页的说法与位置；它没有答案的地方细化 */
function fromTable(input: WebNextStepInput, d: NextStepDecision, snapshot: NextStepSnapshot): Core {
  const phase = analysisPhaseFromRunStatus(input.analysisStatus);
  const headlineZh = d.advisory.conclusion;
  const tableReasons = d.advisory.reasons;
  const round = input.latestRound;

  switch (d.rule) {
    case "pending_approval": {
      const earliest = [...input.pendingApprovals].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
      const inPlace = !!earliest && RFQ_CARD_TYPES.has(earliest.type) && !!earliest.inquiryId;
      return {
        rule: "pending_approval",
        headlineZh,
        reasonsZh: [...tableReasons.slice(0, 1), "批准之前不会发出任何东西；先看正文再决定"],
        action: inPlace ? go("去看这一条并决定", roundTarget(earliest.inquiryId as string)) : go("去审批中心", { kind: "href", href: APPROVAL_CENTER_HREF }),
      };
    }
    case "no_analysis": {
      if (input.documentCount <= 0) {
        return { rule: "no_documents", headlineZh: "还没上传招标文件", reasonsZh: ["上传后青砚会解析文件并分析招标要求"], action: go("上传招标文件", { kind: "files" }) };
      }
      if (input.parsingActive) {
        return { rule: "parsing", headlineZh: "招标文件正在解析", reasonsZh: ["解析完成后会开始分析，这里会更新"], action: null };
      }
      if (phase === "failed") {
        return { rule: "analysis_failed", headlineZh: "上次分析失败", reasonsZh: ["到「招标要求」重新发起分析；文件有问题的话先换文件"], action: go("去重新分析", ANALYSIS) };
      }
      return { rule: "no_analysis", headlineZh, reasonsZh: [`已上传 ${input.documentCount} 个文件，还没有发起分析`], action: go("去分析", ANALYSIS) };
    }
    case "analysis_running":
      return { rule: "analysis_running", headlineZh, reasonsZh: ["分析完成后这里会更新"], action: go("看分析进度", ANALYSIS) };
    case "unknown_facts":
      return { rule: "unknown_facts", headlineZh, reasonsZh: [...tableReasons.slice(0, 1), "到「招标要求」核对；确认无误后再批准分析"], action: go("去核对", ANALYSIS) };
    case "mandatory_gap":
      return { rule: "mandatory_gap", headlineZh, reasonsZh: tableReasons.slice(0, 1), action: go("去看这几条要求", ANALYSIS) };
    case "no_rfq": {
      // 查表没有「分析完、等你确认并批准」这一步：这时它会落到「还没询价」，而页面上的询价入口正要求先批准
      if (phase === "review_required") return requirementsReview(input);
      // 有人不经询价直接定了价：不再催着去询价
      if (input.hasProjectQuote) return prepareSubmission(input);
      return {
        rule: "no_rfq",
        headlineZh,
        reasonsZh: ["在「标书与报价」点「问供应商要价」：按已确认的要求起草，发出前要你批准"],
        action: go("去问供应商要价", RFQ_ROUNDS),
      };
    }
    case "no_reply": {
      if (round && deadlinePassed(round.replyBy, input.now)) {
        // 回复截止过了，定时扫描不会再催，会把没回的标成未响应。照这个结果再查一次表，看后面该做什么
        const stillSent = round.items.filter((i) => i.status === "sent").length;
        const after = decideNextStep({
          ...snapshot,
          latestRound: { inquiryId: round.inquiryId, items: round.items.map((i) => (i.status === "sent" ? { ...i, status: "no_response" } : i)) },
        });
        const note = `回复截止已过，${stillSent} 家没回（系统不会再催）`;
        if (after.rule === "quotes_ready" || after.rule === "price_pending") {
          const next = fromTable(input, after, snapshot);
          return { ...next, reasonsZh: [...next.reasonsZh.slice(0, 2), note] };
        }
        return {
          rule: "reply_deadline_passed",
          headlineZh: `回复截止已过，${stillSent} 家没回`,
          reasonsZh: ["系统不会再催这一轮", "可以用已有的报价往下走，把没回的标成未响应，或再问一轮"],
          action: go("去看这一轮", roundTarget(round.inquiryId)),
        };
      }
      const command = d.advisory.nextStep?.command;
      const chaseable = command && command.intent === "chase" ? (command.itemIds?.length ?? 0) : 0;
      return {
        rule: "no_reply",
        headlineZh,
        reasonsZh: [
          ...tableReasons.slice(0, 2),
          ...(chaseable > 0 ? [`定时检查会给其中 ${chaseable} 家起草催单，起草好了会在这里等你批`] : []),
        ].slice(0, 3),
        action: round ? go("去看这一轮", roundTarget(round.inquiryId)) : null,
      };
    }
    case "quotes_ready":
      return { rule: "quotes_ready", headlineZh, reasonsZh: tableReasons.slice(0, 1), action: round ? go("去比价并选定", roundTarget(round.inquiryId)) : null };
    case "price_pending":
      return { rule: "price_pending", headlineZh, reasonsZh: tableReasons.slice(0, 1), action: go("去定投标价", tab("bid", NEXT_STEP_ANCHORS.bidQuote)) };
    case "deadline_soon":
      // 这里查表时已经去掉了截标时间，不会走到；走到就按没有待办处理
      return refineIdle(input, d);
    case "idle":
    default:
      if (phase === "review_required" && !(round && round.items.some((i) => i.status !== "pending"))) return requirementsReview(input);
      return refineIdle(input, d);
  }
}

function requirementsReview(input: WebNextStepInput): Core {
  const n = input.pendingRequirementCount;
  return {
    rule: "requirements_review",
    headlineZh: "分析完了，等你确认要求并批准",
    reasonsZh: [n > 0 ? `还有 ${n} 条要求待确认` : "要求都处理过了，还差「批准分析」", "批准之后才能从页面上问供应商要价"],
    action: go("去确认并批准", ANALYSIS),
  };
}

const HOUR = 3_600_000;
/**
 * 要不要提醒由查表决定（三天以内）；怎么说：满一天的用查表的原话，
 * 不足一天的按小时说——查表按天向上取整，离截标 5 小时它会说「1 天后截标」，在页面上会误导人。
 */
function urgencyText(input: WebNextStepInput, tableConclusion: string): string {
  const left = input.closeDate ? input.closeDate.getTime() - input.now.getTime() : null;
  if (left === null || left >= 24 * HOUR) return tableConclusion;
  if (left < HOUR) return "不到 1 小时后截标，还没提交";
  return `约 ${Math.round(left / HOUR)} 小时后截标，还没提交`;
}

export function decideWebNextStep(input: WebNextStepInput): WebNextStepView {
  const snapshot = toSnapshot(input);
  const closesAt = input.closeDate ? input.closeDate.toISOString() : null;
  const done = (core: Core, urgencyZh: string | null, also: WebNextStepView["also"]): WebNextStepView => {
    const reasonsZh = [...core.reasonsZh];
    if (!input.canManage && NEEDS_WRITE.has(core.rule)) {
      reasonsZh.splice(2);
      reasonsZh.push("你在这个项目里没有修改权限，这一步要项目负责人来做");
    }
    return { rule: core.rule, headlineZh: core.headlineZh, reasonsZh: reasonsZh.slice(0, 3), action: core.action, urgencyZh, closesAt, also: also.slice(0, 3) };
  };

  // —— 查表之前：这三种状态下，查表的建议都没有意义 ——
  if (input.closedLabelZh) {
    return done({ rule: "closed", headlineZh: `这个标已结束（${input.closedLabelZh}）`, reasonsZh: [], action: null }, null, []);
  }
  if (input.submittedAt) {
    return done({ rule: "submitted", headlineZh: "已提交，等开标结果", reasonsZh: ["提交记录在「提交」页签"], action: go("看提交记录", tab("submission")) }, null, []);
  }
  if (input.closeDate && input.closeDate.getTime() < input.now.getTime()) {
    return done(
      {
        rule: "past_closing",
        headlineZh: "截标时间已过，没有提交记录",
        reasonsZh: ["如果已经在门户提交了：系统里还没有提交时间（项目阶段没有推进到「项目提交」）", "如果没有提交：这个标已经错过截标"],
        action: go("去提交页核对", tab("submission")),
      },
      null,
      [],
    );
  }

  // —— 截标提醒：同一张表、去掉待批，只看它是不是命中「三天内截标」 ——
  const deadline = decideNextStep({ ...snapshot, pendingApprovals: [] });
  const urgencyZh = deadline.rule === "deadline_soon" ? urgencyText(input, deadline.advisory.conclusion) : null;

  // —— 真正的下一步：同一张表、去掉截标时间 ——
  const tableSnapshot = { ...snapshot, closeDate: null };
  const core = fromTable(input, decideNextStep(tableSnapshot), tableSnapshot);

  // —— 顺带要办的事 ——
  const also: WebNextStepView["also"] = [];
  const phase = analysisPhaseFromRunStatus(input.analysisStatus);
  const analysisRules: ReadonlySet<WebNextStepRule> = new Set<WebNextStepRule>(["requirements_review", "unknown_facts", "mandatory_gap"]);
  if (phase === "review_required" && !analysisRules.has(core.rule)) {
    const n = input.pendingRequirementCount;
    also.push({ textZh: `招标分析还没批准${n > 0 ? `（${n} 条要求待确认）` : ""}`, target: ANALYSIS });
  }
  if (input.workspace && !input.workspace.hasPriceSchedule && (phase === "review_required" || phase === "approved")) {
    also.push({ textZh: "价格表还没录，可以从招标分析带入", target: tab("bid", NEXT_STEP_ANCHORS.bidWorkspace) });
  }
  if (!input.closeDate) also.push({ textZh: "还没填截标时间", target: tab("workbench") });

  return done(core, urgencyZh, also);
}
