/**
 * FLOW-H1 项目页「下一步」的判断（纯函数，零 DB / 网络 / 模型）
 *
 * 只有一张表：待批、分析中、关键事实缺证据、强制要求不满足、还没询价、没回复、报价齐了、定了供应商没定价，
 * 这些状态直接调 Muse 通道的查表函数 `decideNextStep`（不复制、不修改它），结论文字也取自它。
 * 这里只做三件事：
 *   1. 查表之前：项目已结束、已提交、截标已过一天以上——这几种状态下查表的建议都没有意义；
 *   2. 查表之后：在它没有答案、或它的答案在网页上不成立的地方细化；
 *   3. 把每个结论换成页面上的一个位置。
 * 截标提醒单独算（再调一次同一张表），不参与排序——临近截标时不盖住真正的下一步。
 *
 * 写的每一句都要与页面上实际能做的事对得上：不承诺系统「会」做什么，只说现在是什么状态、去哪里处理。
 * 这里不执行任何动作：不批准、不发送、不起草。
 */
import { decideNextStep, type NextStepDecision, type NextStepSnapshot } from "@/lib/muse-bridge/next-step";
import { laterStage } from "@/lib/tender/stage";
import { analysisPhaseFromRunStatus } from "@/lib/tender/workbench-state";
import { deadlinePassed } from "@/lib/tender-rfq/chase-pure";
import {
  APPROVAL_CENTER_HREF,
  NEXT_STEP_ANCHORS,
  rfqRoundAnchorId,
  withoutMoney,
  type NextStepStage,
  type WebNextStepAction,
  type WebNextStepRule,
  type WebNextStepTarget,
  type WebNextStepView,
} from "./targets";

type TableItem = NonNullable<NextStepSnapshot["latestRound"]>["items"][number];
/** outOfScan：这一家虽然还是「已发出」，但定时催单已经不会再看它（轮次已结束，或发出超过扫描的时间窗） */
export type WebRoundItem = TableItem & { outOfScan?: boolean };

export type WebNextStepInput = {
  now: Date;
  projectId: string;
  projectName: string;
  /** 项目已放弃 / 已归档 / 招投标状态是终态时的说法（如「未中标」）；否则 null */
  closedLabelZh: string | null;
  /** 招投标状态是已中标 */
  won: boolean;
  /** 截标时间（只认项目上的截标时间，不拿内部的到期日顶替）；没有填为 null */
  closeDate: Date | null;
  submittedAt: Date | null;
  documentCount: number;
  /** 有文件还在解析 */
  parsingActive: boolean;
  /** 当前这份分析的状态（最近一次重跑失败或被取代、而之前有可用的一份时，是之前那份）；没有分析为 null */
  analysisStatus: string | null;
  /** 最近一次分析失败了，而上面用的是之前可用的那一份 */
  latestAnalysisFailed: boolean;
  unknownCriticalFacts: number;
  mandatoryNonCompliant: number;
  /** 当前这份分析里还没有人确认或驳回的要求条数 */
  pendingRequirementCount: number;
  /** 当前这份分析里已确认的要求条数（页面上的询价入口要求至少一条） */
  confirmedRequirementCount: number;
  /**
   * 这个人可见、属于本项目、待批且未过期的审批。
   * stale：催单卡针对的那一家已经不需要催了（已回复 / 已报价）——那一轮里不会列出它，批了也不会发出。
   */
  pendingApprovals: Array<{ id: string; title: string; createdAt: Date; type: string; inquiryId: string | null; stale?: boolean }>;
  /** 当前这一轮询价：最新一轮有已发出的供应商的（已取消的不算）；都没有发出过就是最新一轮；没有轮次为 null */
  latestRound: { inquiryId: string; replyBy: Date | null; items: WebRoundItem[] } | null;
  /** 有没有还作数的投标报价（已取消、已被取代的不算） */
  hasProjectQuote: boolean;
  /** FLOW-H1b：有没有等待审核或已批准的分析（不管最近一次是不是在重跑） */
  hasUsableAnalysis: boolean;
  /** FLOW-H1b：阶段记录说的是哪一段（与其余事实同一时刻读的） */
  recordedStage: NextStepStage;
  /** FLOW-H1b：项目已结束（已放弃、已归档、招投标状态是终态）→ 显示的阶段不再跟实际进度走 */
  stageFrozen: boolean;
  /** FLOW-H1b：任何一轮（已取消的不算）里有供应商已发出、已回复或已有结果 */
  anySent: boolean;
  /** FLOW-H1b：任何一轮（已取消的不算）里有供应商已报价 */
  anyQuoted: boolean;
  /** 等待天数：与定时催单扫描同一个取法（该轮授权里定格的 > 项目负责人的偏好 > 组织设置 > 3） */
  chaseAfterDays: number;
  /** 看页面的人有没有项目写权限 */
  canManage: boolean;
  /** 投标工作区的现算结果；该组织没有开启为 null */
  workspace: { hasPriceSchedule: boolean; blockers: Array<{ code: string; messageZh: string }> } | null;
  /** 页面上「问供应商要价」现在能不能用、不能用的原因。只在要指向询价入口时才取；没取为 null */
  rfqEntry?: { enabled: boolean; messageZh: string } | null;
  /** FLOW-H4a：这个组织开了「提交记录」——页面上有地方记提交时间与回执。不传 = 没开，与原来相同 */
  submissionRecordEnabled?: boolean;
};

/** 询价与催单这两种审批可以在它所在的那一轮里就地批准 */
const RFQ_CARD_TYPES: ReadonlySet<string> = new Set(["tender.send_rfq", "tender.send_chase"]);
/** 这几种阻断项不在这里列：成本输入只存在浏览器里，服务端看不到；截标时间的问题卡片另有提示 */
const UNLISTED_BLOCKERS: ReadonlySet<string> = new Set(["COST_MISSING", "COST_INCOMPLETE", "CLOSING_TIME_INVALID", "WINDOW_EXPIRED"]);
/** 需要项目写权限才能做的步骤 */
export const NEEDS_WRITE: ReadonlySet<WebNextStepRule> = new Set<WebNextStepRule>([
  "no_documents", "analysis_failed", "no_analysis", "unknown_facts", "mandatory_gap", "requirements_review", "no_confirmed_requirements",
  "no_rfq", "reply_deadline_passed", "replies_to_record", "single_quote", "no_quotes", "quotes_ready", "price_pending", "prepare_submission", "past_closing",
]);
/** 指向询价入口的规则：取数的一方据此再去读入口现在能不能用 */
export const RFQ_ENTRY_RULES: ReadonlySet<WebNextStepRule> = new Set<WebNextStepRule>(["no_rfq", "no_quotes"]);

const tab = (t: "workbench" | "requirements" | "bid" | "submission", anchor: string | null = null): WebNextStepTarget => ({ kind: "tab", tab: t, anchor });
const ANALYSIS = tab("requirements", NEXT_STEP_ANCHORS.analysis);
const RFQ_SECTION = tab("bid", NEXT_STEP_ANCHORS.rfqSection);
const KEY_DATES = tab("workbench", NEXT_STEP_ANCHORS.keyDates);
const SUBMISSION_RECORD = tab("submission", NEXT_STEP_ANCHORS.submissionRecord);
const APPROVALS: WebNextStepTarget = { kind: "href", href: APPROVAL_CENTER_HREF };
const roundTarget = (inquiryId: string) => tab("bid", rfqRoundAnchorId(inquiryId));
const go = (labelZh: string, target: WebNextStepTarget): WebNextStepAction => ({ labelZh, target });

type Also = WebNextStepView["also"];
type Core = { rule: WebNextStepRule; headlineZh: string; reasonsZh: string[]; action: WebNextStepAction | null; also?: Also };

/** 交给查表的那一份：定时催单已经不看的「已发出」按未响应算（查表才不会再说「该催了」「还在等」） */
const tableItems = (items: WebRoundItem[]): TableItem[] =>
  items.map(({ outOfScan, ...i }) => (outOfScan && i.status === "sent" ? { ...i, status: "no_response" } : i));

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
    latestRound: input.latestRound ? { inquiryId: input.latestRound.inquiryId, items: tableItems(input.latestRound.items) } : null,
    hasProjectQuote: input.hasProjectQuote,
    // 常用供应商只影响 Muse 的一句说明，网页不用；等待天数用扫描的口径
    prefs: { defaultSupplierIds: [], chaseAfterDays: input.chaseAfterDays },
  };
}

/** 指向询价入口时的原因：入口现在能不能用，以页面上那个入口自己的判断为准 */
function rfqEntryReasons(input: WebNextStepInput): string[] {
  const entry = input.rfqEntry;
  if (!entry) return ["到供应商询价：能直接发就点「问供应商要价」；不能发时那里会写明原因"];
  if (entry.enabled) return ["点「问供应商要价」：按已确认的要求起草，发出前要你批准"];
  return [`「问供应商要价」现在还不能用：${withoutMoney(entry.messageZh, "原因写在供应商询价那里")}`, "那里也可以手工建一轮"];
}

function prepareSubmission(input: WebNextStepInput): Core {
  const ws = input.workspace;
  const plain: Core = {
    rule: "prepare_submission", headlineZh: "投标价已有，准备提交",
    reasonsZh: input.submissionRecordEnabled ? ["到「提交」页核对提交材料与截标时间", "交完之后，在同一页记下实际提交的时间与回执"] : ["到「提交」页核对提交材料与截标时间"],
    action: go("去提交页", tab("submission")),
  };
  // 工作区没开、或开了但还没录价格表（那是另一件事，在顺带要办的事里提示）：不谈阻断项
  if (!ws || !ws.hasPriceSchedule) return plain;
  const blockers = ws.blockers.filter((b) => !UNLISTED_BLOCKERS.has(b.code));
  if (blockers.length === 0) {
    return { ...plain, reasonsZh: ["投标工作区没有成本以外的阻断项（成本核算只存在你的浏览器里，这里看不到）", ...plain.reasonsZh] };
  }
  return {
    rule: "prepare_submission",
    headlineZh: "投标价已有，提交前还有阻断项",
    reasonsZh: [
      `投标工作区还有 ${blockers.length} 个阻断项（成本核算只存在你的浏览器里，这里看不到）`,
      ...blockers.slice(0, 2).map((b) => withoutMoney(b.messageZh, "（内容请到投标工作区看）")),
    ],
    action: go("去看阻断项", tab("bid", NEXT_STEP_ANCHORS.bidWorkspace)),
  };
}

/** 查表说「没有待办」时，按询价轮次再分 */
function refineIdle(input: WebNextStepInput, fallback: NextStepDecision): Core {
  if (input.hasProjectQuote) return prepareSubmission(input);
  const round = input.latestRound;
  const items = round ? tableItems(round.items).filter((i) => i.status !== "pending") : [];
  if (round && items.length > 0) {
    const count = (status: string) => items.filter((i) => i.status === status).length;
    const waiting = items.filter((i) => i.status === "sent");
    const quoted = count("quoted");
    const replied = count("replied");
    const selected = items.some((i) => i.isSelected);
    const here = roundTarget(round.inquiryId);
    if (replied > 0) {
      return { rule: "replies_to_record", headlineZh: `${replied} 家已回复，报价还没录入`, reasonsZh: ["到这一轮看回复：把报价录入，或标成谢绝"], action: go("去看这一轮", here) };
    }
    if (waiting.length > 0) {
      const canStillChase = waiting.some((i) => (i.chasedAt?.length ?? 0) < 2);
      return {
        rule: "waiting_replies",
        headlineZh: `已问 ${items.length} 家，${quoted} 家已报价，还在等 ${waiting.length} 家`,
        reasonsZh: [canStillChase ? `满 ${input.chaseAfterDays} 天没回，这里会提示` : "都已经催过两次；再没有回复会被标成未响应"],
        action: go("看这一轮", here),
      };
    }
    if (!selected && quoted === 1) {
      return { rule: "single_quote", headlineZh: "只有 1 家报价", reasonsZh: ["可以直接选定这一家，或再问几家比一比"], action: go("去看这一轮", here) };
    }
    if (items.every((i) => i.status === "declined" || i.status === "no_response")) {
      return { rule: "no_quotes", headlineZh: "这一轮没有拿到报价", reasonsZh: ["问过的供应商都没有报价或已谢绝", ...rfqEntryReasons(input).slice(0, 1)], action: go("去供应商询价", RFQ_SECTION) };
    }
    if (!selected) {
      // 认不出的状态：不猜，带人去看
      return { rule: "idle", headlineZh: "询价这一轮需要你看一下", reasonsZh: [], action: go("看这一轮", here) };
    }
  }
  return { rule: "idle", headlineZh: fallback.advisory.conclusion, reasonsZh: [], action: null };
}

function requirementsReview(input: WebNextStepInput): Core {
  const pending = input.pendingRequirementCount;
  const confirmed = input.confirmedRequirementCount;
  return {
    rule: "requirements_review",
    headlineZh: pending > 0 ? "分析完了，等你确认要求并批准" : "要求都处理过了，还差「批准分析」",
    reasonsZh: [
      pending > 0 ? `还有 ${pending} 条要求待确认：批准后不能再确认，没确认的不会进询价单` : "批准之后这份分析才算定下来",
      confirmed > 0 ? `已确认的 ${confirmed} 条已经可以用来问供应商要价` : "至少确认一条，才能从页面上问供应商要价",
    ],
    action: go("去确认并批准", ANALYSIS),
    also: confirmed > 0 ? [{ textZh: "已确认的要求可以先拿去问供应商要价", target: RFQ_SECTION }] : [],
  };
}

/** 把查表的结论换成网页的说法与位置；它没有答案、或答案在网页上不成立的地方细化 */
function fromTable(input: WebNextStepInput, d: NextStepDecision, snapshot: NextStepSnapshot): Core {
  const phase = analysisPhaseFromRunStatus(input.analysisStatus);
  const headlineZh = d.advisory.conclusion;
  const tableReasons = d.advisory.reasons;
  const round = input.latestRound;
  const roundItems = round ? tableItems(round.items) : [];
  const roundActive = roundItems.some((i) => i.status !== "pending");

  switch (d.rule) {
    case "pending_approval": {
      const earliest = [...input.pendingApprovals].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
      const inPlace = !!earliest && RFQ_CARD_TYPES.has(earliest.type) && !!earliest.inquiryId && !earliest.stale;
      const title = withoutMoney(earliest?.title ?? "", "（标题里有金额，这里不显示）");
      return {
        rule: "pending_approval",
        headlineZh,
        reasonsZh: [
          `最早一条：${title}`,
          earliest?.stale ? "这张催单已经用不上了（对方已经回复或报价），可以在审批中心驳回" : "批准之前不会发出任何东西；先看正文再决定",
        ],
        action: inPlace ? go("去看这一条并决定", roundTarget(earliest.inquiryId as string)) : go("去审批中心", APPROVALS),
      };
    }
    case "no_analysis": {
      if (input.documentCount <= 0) {
        return { rule: "no_documents", headlineZh: "还没上传招标文件", reasonsZh: ["上传后青砚会解析文件并分析招标要求"], action: go("上传招标文件", { kind: "files" }) };
      }
      if (input.parsingActive) {
        return { rule: "parsing", headlineZh: "招标文件正在解析", reasonsZh: ["解析完成后会开始分析，这里会更新"], action: null };
      }
      // 没有可用的分析，但询价或定价已经在走（老项目、或有人直接手工做了）：跟着实际的进度走，分析的事放在顺带要办的事里
      if (roundActive || input.hasProjectQuote) {
        const assumed = { ...snapshot, analysisStatus: "APPROVED" };
        const next = fromTable({ ...input, analysisStatus: "APPROVED" }, decideNextStep(assumed), assumed);
        return { ...next, also: [{ textZh: phase === "failed" ? "招标文件上次分析失败了" : "招标文件还没分析", target: ANALYSIS }, ...(next.also ?? [])] };
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
      // 查表没有「分析完、等你确认并批准」这一步：这时它会落到「还没询价」
      if (phase === "review_required") return requirementsReview(input);
      // 有人不经询价直接定了价：不再催着去询价
      if (input.hasProjectQuote) return prepareSubmission(input);
      // 分析批准了却没有一条已确认的要求：页面上的询价入口用不了，批准后也不能再确认
      if (phase === "approved" && input.confirmedRequirementCount <= 0) {
        return {
          rule: "no_confirmed_requirements",
          headlineZh: "分析已批准，但没有已确认的要求",
          reasonsZh: ["页面上的「问供应商要价」需要至少一条已确认的要求", "批准后不能再确认：可以重新分析，或在供应商询价里手工建一轮"],
          action: go("去招标分析", ANALYSIS),
          also: [{ textZh: "也可以手工建一轮询价", target: RFQ_SECTION }],
        };
      }
      return { rule: "no_rfq", headlineZh, reasonsZh: rfqEntryReasons(input), action: go("去供应商询价", RFQ_SECTION) };
    }
    case "no_reply": {
      const stillSent = roundItems.filter((i) => i.status === "sent").length;
      const overdue = !!round && deadlinePassed(round.replyBy, input.now);
      const picked = roundItems.some((i) => i.isSelected);
      if (round && (overdue || picked)) {
        // 回复截止过了（定时催单不会再催，会把没回的标成未响应），或已经选定了一家（没回的不再挡路）：
        // 把没回的按未响应再查一次表，看后面该做什么
        const settled = { ...snapshot, latestRound: { inquiryId: round.inquiryId, items: roundItems.map((i) => (i.status === "sent" ? { ...i, status: "no_response" } : i)) } };
        const after = decideNextStep(settled);
        const note = overdue ? `回复截止已过，${stillSent} 家没回` : `另有 ${stillSent} 家没回`;
        if (after.rule === "quotes_ready" || after.rule === "price_pending" || (picked && after.rule === "idle")) {
          const settledInput = { ...input, latestRound: { ...round, items: settled.latestRound.items } };
          const next = fromTable(settledInput, after, settled);
          return { ...next, reasonsZh: [...next.reasonsZh.slice(0, 2), note] };
        }
        if (overdue) {
          return {
            rule: "reply_deadline_passed",
            headlineZh: `回复截止已过，${stillSent} 家没回`,
            reasonsZh: ["可以用已有的报价往下走，把没回的标成未响应，或再问一轮"],
            action: go("去看这一轮", roundTarget(round.inquiryId)),
          };
        }
      }
      return {
        rule: "no_reply",
        headlineZh,
        // 只说现在的状态与去哪里处理；催单什么时候起草、要不要你批，取决于邮箱与这一轮的授权，那一轮里看得到
        reasonsZh: [...tableReasons.slice(0, 2), "到这一轮看每一家的状态；有催单等批时也在那里"].slice(0, 3),
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
      if (phase === "review_required" && !roundActive) return requirementsReview(input);
      return refineIdle(input, d);
  }
}

/**
 * FLOW-H1b：按实际进度到了六段里的哪一段。看的是「有没有」——与阶段记录的含义一致（进入这一段）。
 * 最低是「立项」：项目有没有分发由阶段记录管，这里不重复判断。只读，不写任何东西。
 * 已有投标报价单（没作废的）也算到了「供应商报价」：这时已经在定价，「下一步」说的是「准备提交」。
 */
export function actualStageOf(input: Pick<WebNextStepInput, "submittedAt" | "anyQuoted" | "hasProjectQuote" | "anySent" | "hasUsableAnalysis">): NextStepStage {
  if (input.submittedAt) return "submission";
  if (input.anyQuoted || input.hasProjectQuote) return "supplier_quote";
  if (input.anySent) return "supplier_inquiry";
  if (input.hasUsableAnalysis) return "interpretation";
  return "initiation";
}

/**
 * FLOW-H1b：页面上显示哪一段。没结束的项目：记录的阶段与实际进度里靠后的那个（实际进度不会把显示往回拉）。
 * 已结束的项目（已中标、未中标、已放弃、已归档等）：就是记录的阶段——结束的项目进度条按「已完成」画，
 * 这时再按实际进度往后挪会把完成百分比抬高。
 */
export function shownStageOf(input: Pick<WebNextStepInput, "recordedStage" | "stageFrozen" | "submittedAt" | "anyQuoted" | "hasProjectQuote" | "anySent" | "hasUsableAnalysis">): NextStepStage {
  return input.stageFrozen ? input.recordedStage : laterStage(input.recordedStage, actualStageOf(input));
}

const HOUR = 3_600_000;
const DAY_MS = 24 * HOUR;
/**
 * 要不要提醒由查表决定（它的三天）；怎么说由这里定。
 * 手工填的截标时间只有日期（存成当天中午），所以不说「几小时」；查表按天向上取整，25 小时它会说「2 天后」，这里照实说「1 天多」。
 */
function urgencyText(left: number): string {
  if (left <= 0) return "截标时间到了或刚过，还没有提交记录";
  if (left < DAY_MS) return "不到 1 天后截标，还没提交";
  const whole = Math.floor(left / DAY_MS);
  return `${whole} 天${left - whole * DAY_MS >= HOUR ? "多" : ""}后截标，还没提交`;
}

export function decideWebNextStep(input: WebNextStepInput): WebNextStepView {
  const snapshot = toSnapshot(input);
  const closesAt = input.closeDate ? input.closeDate.toISOString() : null;
  const done = (core: Core, urgencyZh: string | null, extraAlso: Also): WebNextStepView => {
    const reasonsZh = core.reasonsZh.slice(0, 3);
    if (!input.canManage && NEEDS_WRITE.has(core.rule)) {
      reasonsZh.splice(2);
      reasonsZh.push("你在这个项目里没有修改权限，这一步要项目负责人来做");
    }
    return { rule: core.rule, headlineZh: core.headlineZh, reasonsZh, action: core.action, urgencyZh, closesAt, also: [...(core.also ?? []), ...extraAlso].slice(0, 3), actualStage: actualStageOf(input), recordedStage: input.recordedStage, shownStage: shownStageOf(input) };
  };
  const pendingCount = input.pendingApprovals.length;
  const pendingAlso: Also = pendingCount > 0 ? [{ textZh: `还有 ${pendingCount} 条审批等你处理`, target: APPROVALS }] : [];

  // —— 查表之前：这几种状态下，查表的建议都没有意义 ——
  if (input.won) {
    return done({ rule: "won", headlineZh: "这个标已中标", reasonsZh: ["后面是交接与履约，不在投标流程里"], action: null }, null, pendingAlso);
  }
  if (input.closedLabelZh) {
    return done({ rule: "closed", headlineZh: `这个标已结束（${input.closedLabelZh}）`, reasonsZh: [], action: null }, null, pendingAlso);
  }
  if (input.submittedAt) {
    return done({ rule: "submitted", headlineZh: "已提交，等开标结果", reasonsZh: ["提交记录在「提交」页签"], action: go("看提交记录", tab("submission")) }, null, pendingAlso);
  }
  const left = input.closeDate ? input.closeDate.getTime() - input.now.getTime() : null;
  // 过了截标时间整整一天才算「已过」：手工填的截标时间只有日期，当天之内不下这个结论
  if (left !== null && left <= -DAY_MS) {
    // 页面上有地方记提交了（FLOW-H4a 的开关开着）：先指到那里；截标时间改过的情形放在顺带要办的事里
    const core: Core = input.submissionRecordEnabled
      ? {
          rule: "past_closing",
          headlineZh: "截标日期已过，没有提交记录",
          reasonsZh: ["如果已经交了：到「提交」页签记下实际提交的时间与回执", "如果截标时间改过（比如补遗延期）：到工作台的关键日期里更新"],
          action: go("去记录提交", SUBMISSION_RECORD),
          also: [{ textZh: "截标时间改过？去更新关键日期", target: KEY_DATES }],
        }
      : {
          rule: "past_closing",
          headlineZh: "截标日期已过，没有提交记录",
          reasonsZh: ["如果截标时间改过（比如补遗延期）：到工作台的关键日期里更新", "如果已经在门户提交了：系统里还没有提交时间"],
          action: go("去看关键日期", KEY_DATES),
        };
    return done(core, null, pendingAlso);
  }

  // —— 截标提醒：同一张表、去掉待批，只看它是不是命中「三天内截标」 ——
  const deadline = decideNextStep({ ...snapshot, pendingApprovals: [] });
  const urgencyZh = deadline.rule === "deadline_soon" && left !== null ? urgencyText(left) : null;

  // —— 真正的下一步：同一张表、去掉截标时间 ——
  const tableSnapshot = { ...snapshot, closeDate: null };
  const core = fromTable(input, decideNextStep(tableSnapshot), tableSnapshot);

  // —— 顺带要办的事 ——
  const also: Also = [];
  const phase = analysisPhaseFromRunStatus(input.analysisStatus);
  const analysisRules: ReadonlySet<WebNextStepRule> = new Set<WebNextStepRule>(["requirements_review", "unknown_facts", "mandatory_gap", "no_confirmed_requirements"]);
  if (phase === "review_required" && !analysisRules.has(core.rule)) {
    const n = input.pendingRequirementCount;
    also.push({ textZh: `招标分析还没批准${n > 0 ? `（${n} 条要求待确认）` : ""}`, target: ANALYSIS });
  }
  if (input.latestAnalysisFailed) also.push({ textZh: "最近一次重新分析失败了，现在用的是之前那一份", target: ANALYSIS });
  if (input.workspace && !input.workspace.hasPriceSchedule && (phase === "review_required" || phase === "approved")) {
    also.push({ textZh: "价格表还没录，可以从招标分析带入", target: tab("bid", NEXT_STEP_ANCHORS.bidWorkspace) });
  }
  if (!input.closeDate) also.push({ textZh: "还没填截标时间", target: KEY_DATES });

  return done(core, urgencyZh, also);
}
