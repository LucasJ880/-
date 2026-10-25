/**
 * Revenue Spine — 买家没回信时的跟进草稿（展后跟进）
 *
 * 首封回复发出后买家一直没回信：从首封算起第 3 / 7 / 14 天（policy.followUp.noReplyFollowUpDays）
 * 各起草一封跟进邮件进审批中心，**不发送**。买家回信、商机进入报价或之后的阶段、或已有待审批草稿时不起草；
 * 同一封外发之后的同一次跟进只起草一次（被拒绝、过期也不重复起草）。
 *
 * 跟进只追问报价需要的信息，不写价格 / MOQ / 交期等任何承诺，与首封同一套守卫；英文草稿附中文对照给审核人。
 */

import { db } from "@/lib/db";
import { requestApproval } from "@/lib/approval/request";
import { createNotificationsForUsers } from "@/lib/notifications/create";
import { detectInquiryRisks } from "../inquiry-risks";
import { toCanonicalStage, type OpportunityStage } from "../opportunity-stage";
import { loadRevenueSpinePolicy, type RevenueSpinePolicy } from "../policy";
import { allowedStyles, checkDraftGuardrails, signatureLines, type ReplyDraft } from "../reply-draft";
import { buildClarifyingQuestions, computeMissingFields, type ClarifyingQuestion } from "../rfq/missing-info";
import { rfqRowToFields } from "../rfq/persist";
import { FDE_EMPLOYEE_KEY } from "./actions";
import { INQUIRY_REPLY_ACTION_TYPE, approvalPreview, boothContext } from "./inbound-sales";

/** 报价前、还在收集信息的阶段才发「补充信息」式跟进；进入报价（quoting）之后由报价跟进接手 */
const FOLLOW_UP_STAGES: readonly OpportunityStage[] = ["new_inquiry", "enriching", "needs_info", "qualified", "rfq_ready"];
const DAY_MS = 86_400_000;
const MAX_PER_RUN = 50;
/** 错过跟进时间超过这么多天就不再补起草（上线时不给几周前的老询盘一口气补草稿；长期无动作交给 stale 流程） */
const MAX_LATE_DAYS = 7;

export interface NoReplyFollowUpDue {
  /** 第几次跟进（1 起） */
  step: number;
  total: number;
  /** 从首封算起第几天 */
  day: number;
  dueAt: Date;
}

/**
 * 纯函数：到没到跟进时间。followUpCount = 已外发封数（首封算 1），所以第 n 次跟进对应 followUpCount = n；
 * 间隔按首封起算的天数折算（3 / 7 / 14 → 上一封之后 3 / 4 / 7 天），审批拖延时不会挤在一起。
 */
export function noReplyFollowUpDue(
  opp: { stage: string; lastOutboundAt: Date | null; lastCustomerReplyAt: Date | null; followUpCount: number },
  days: readonly number[],
  now: Date,
): NoReplyFollowUpDue | null {
  const stage = toCanonicalStage(opp.stage);
  if (!stage || !FOLLOW_UP_STAGES.includes(stage) || !opp.lastOutboundAt || !days.length) return null;
  if (opp.lastCustomerReplyAt && opp.lastCustomerReplyAt.getTime() > opp.lastOutboundAt.getTime()) return null;
  const step = Math.max(1, opp.followUpCount);
  if (step > days.length) return null;
  const gap = days[step - 1] - (step >= 2 ? days[step - 2] : 0);
  const dueAt = new Date(opp.lastOutboundAt.getTime() + gap * DAY_MS);
  if (now.getTime() < dueAt.getTime() || now.getTime() - dueAt.getTime() > MAX_LATE_DAYS * DAY_MS) return null;
  return { step, total: days.length, day: days[step - 1], dueAt };
}

export interface NoReplyFollowUpInput {
  step: number;
  total: number;
  language: "en" | "zh";
  contactName: string | null;
  orgName: string;
  senderName: string;
  /** 上一封外发的主题（跟进沿用，买家邮箱里归到同一串） */
  previousSubject: string | null;
  previousSentAt: Date;
  /** 产品 / 参考款的说法；null = 不提具体产品 */
  product: string | null;
  /** 展会名；有 = 展位来访的买家 */
  event: string | null;
  /** 还缺的报价信息 */
  questions: ClarifyingQuestion[];
  /** 落款附加行：afterName（职位）/ afterOrg（WhatsApp、网站）；企业未配置时为空 */
  signature?: { afterName: string[]; afterOrg: string[] };
}

function fmtDate(d: Date, lang: "en" | "zh"): string {
  return lang === "zh"
    ? `${d.getUTCMonth() + 1} 月 ${d.getUTCDate()} 日`
    : d.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
}

/** 纯函数：跟进草稿正文。第一次追问缺的信息；中间几次问项目是否还在进行；最后一次说明这是最后一封 */
export function buildNoReplyFollowUpDraft(input: NoReplyFollowUpInput): ReplyDraft {
  const zh = input.language === "zh";
  const last = input.step >= input.total;
  const qs = input.questions.slice(0, 3);
  const lines: string[] = [];
  const prev = input.previousSubject?.trim() || null;
  const subject = prev
    ? /^(re|回复)[:：]/i.test(prev)
      ? prev
      : zh
        ? `回复：${prev}`
        : `Re: ${prev}`
    : zh
      ? `跟进：${input.product ?? "您的询盘"} — ${input.orgName}`
      : `Following up${input.product ? ` on ${input.product}` : ""} — ${input.orgName}`;

  if (zh) {
    lines.push(`${input.contactName ?? "您好"}${input.contactName ? "，您好" : ""}：`);
    lines.push("");
    if (input.step === 1) {
      lines.push(input.event ? `希望您从${/^[A-Za-z0-9]/.test(input.event) ? ` ${input.event} ` : input.event}回去一路顺利。` : `再次感谢您的询盘${input.product ? `（${input.product}）` : ""}。`);
      lines.push("");
      lines.push(`跟进一下我在 ${fmtDate(input.previousSentAt, "zh")} 发给您的邮件${input.product ? `（${input.product}）` : ""}。为了给您准确报价，还需要以下几点信息：`);
      if (qs.length) qs.forEach((q, i) => lines.push(`${i + 1}. ${q.question}`));
      else lines.push("1. 请告知本次预计采购数量和期望的交货时间。");
      lines.push("");
      lines.push("如果方便，直接回复数量和期望交期即可，其余我们来跟进。");
    } else if (!last) {
      lines.push(`想确认一下您${input.product ? `关于${input.product}` : ""}的项目是否还在进行。`);
      if (input.event) lines.push("您在展位看过的参考款，我们可以再发更多图片和细节；每一款都可以按您的规格定做。");
      lines.push(
        qs.length
          ? `只要您告知${qs.map((q) => q.label).join("、")}，我们就为您准备报价。`
          : "您方便的时候告诉我们，我们随时为您准备报价。",
      );
    } else {
      lines.push("不想打扰您太多，这是我近期最后一次跟进。");
      lines.push(`如果现在时机不合适，告诉我们什么时候再联系您就好${input.product ? `；${input.product}` : ""}有任何需要，我们随时乐意协助。`);
    }
    lines.push("");
    lines.push("祝好！");
    lines.push(input.senderName);
    for (const l of input.signature?.afterName ?? []) lines.push(l);
    lines.push(input.orgName);
    for (const l of input.signature?.afterOrg ?? []) lines.push(l);
  } else {
    lines.push(`Dear ${input.contactName ?? "there"},`);
    lines.push("");
    if (input.step === 1) {
      lines.push(input.event ? `I hope you had a good trip back from ${input.event}.` : `Thank you again for your inquiry${input.product ? ` about ${input.product}` : ""}.`);
      lines.push("");
      lines.push(
        `I am following up on my email of ${fmtDate(input.previousSentAt, "en")}${input.product ? ` about ${input.product}` : ""}. To prepare an accurate quotation for you, we only need a few details:`,
      );
      if (qs.length) qs.forEach((q, i) => lines.push(`${i + 1}. ${q.question}`));
      else lines.push("1. What quantity are you planning to order, and when would you like the goods delivered?");
      lines.push("");
      lines.push("If it is easier, just reply with your quantity and the delivery date you have in mind, and we will take it from there.");
    } else if (!last) {
      lines.push(`I wanted to check whether your project${input.product ? ` for ${input.product}` : ""} is still active.`);
      if (input.event) lines.push("We can share more photos and details of the reference styles you saw at our booth, and each of them can be made to your own specification.");
      lines.push(
        qs.length
          ? `As soon as we know your ${qs.map((q) => q.label.toLowerCase()).join(", ")}, we will prepare a quotation for you.`
          : "Whenever you are ready, we will be glad to prepare a quotation for you.",
      );
    } else {
      lines.push("I do not want to fill up your inbox, so this will be my last follow-up for now.");
      lines.push(
        `If the timing is not right, simply let me know when it would be better to get back in touch — we will be happy to help whenever you are ready${input.product ? ` with ${input.product}` : ""}.`,
      );
    }
    lines.push("");
    lines.push("Best regards,");
    lines.push(input.senderName);
    for (const l of input.signature?.afterName ?? []) lines.push(l);
    lines.push(input.orgName);
    for (const l of input.signature?.afterOrg ?? []) lines.push(l);
  }

  const body = lines.join("\n");
  return {
    subject,
    body,
    language: input.language,
    factsUsed: [],
    pendingInternalConfirmation: [],
    guardrailViolations: checkDraftGuardrails(`${subject}\n${body}`),
    templateOnly: true,
  };
}

function productLabel(styles: Array<{ code: string; name: string | null }>, productName: string | null, zh: boolean): string | null {
  if (styles.length) {
    const first = styles[0].name ?? styles[0].code;
    return styles.length > 1 ? (zh ? `${first} 等 ${styles.length} 款` : `${first} and ${styles.length - 1} more`) : first;
  }
  return productName;
}

/**
 * 扫描组织里到期的无回复商机，逐个起草跟进邮件进审批（cron 调用）。
 * 返回起草的审批 id；任何一个商机失败不影响其它商机。
 */
export async function draftNoReplyFollowUps(
  orgId: string,
  opts?: { policy?: RevenueSpinePolicy; now?: Date },
): Promise<{ due: number; drafted: number; pendingActionIds: string[]; skipped: Array<{ opportunityId: string; reason: string }> }> {
  const now = opts?.now ?? new Date();
  const policy = opts?.policy ?? (await loadRevenueSpinePolicy(orgId));
  const days = policy.followUp.noReplyFollowUpDays;
  const out = { due: 0, drafted: 0, pendingActionIds: [] as string[], skipped: [] as Array<{ opportunityId: string; reason: string }> };
  if (!days.length) return out;

  const candidates = await db.salesOpportunity.findMany({
    where: {
      orgId,
      stage: { in: [...FOLLOW_UP_STAGES] },
      lastOutboundAt: { not: null },
      customer: { archivedAt: null, email: { not: null } },
    },
    select: {
      id: true,
      stage: true,
      customerId: true,
      assignedToId: true,
      lastOutboundAt: true,
      lastCustomerReplyAt: true,
      followUpCount: true,
      customer: { select: { name: true, email: true, contactName: true } },
    },
    orderBy: { lastOutboundAt: "asc" },
    take: 500,
  });
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { name: true, ownerId: true } });
  if (!org) return out;

  for (const opp of candidates) {
    if (out.drafted >= MAX_PER_RUN) break;
    const due = noReplyFollowUpDue(opp, days, now);
    if (!due || !opp.lastOutboundAt || !opp.customer.email) continue;
    out.due += 1;
    const skip = (reason: string) => out.skipped.push({ opportunityId: opp.id, reason });

    // 同一封外发之后的同一次跟进只起草一次（拒绝 / 过期都算处理过，不再重复）
    const idempotencyKey = `revenue-spine:no-reply-followup:${opp.id}:${opp.lastOutboundAt.getTime()}:f${due.step}`;
    const [existing, openDraft] = await Promise.all([
      db.pendingAction.findFirst({ where: { orgId, idempotencyKey }, select: { id: true } }),
      db.pendingAction.findFirst({
        where: { orgId, type: INQUIRY_REPLY_ACTION_TYPE, status: "pending", expiresAt: { gt: now }, payload: { path: ["opportunityId"], equals: opp.id } },
        select: { id: true },
      }),
    ]);
    if (existing) {
      skip("already_drafted");
      continue;
    }
    if (openDraft) {
      skip("draft_pending");
      continue;
    }

    try {
      const [inbound, lastOut, rfqRow] = await Promise.all([
        db.customerInteraction.findMany({
          where: { orgId, opportunityId: opp.id, direction: "inbound" },
          orderBy: { createdAt: "desc" },
          take: 5,
          select: { id: true, channel: true, content: true, summary: true, language: true, analysisResult: true },
        }),
        db.customerInteraction.findFirst({
          where: { orgId, opportunityId: opp.id, direction: "outbound" },
          orderBy: { createdAt: "desc" },
          select: { summary: true, language: true, createdAt: true },
        }),
        db.salesRfq.findUnique({ where: { opportunityId: opp.id } }),
      ]);
      const latest = inbound[0];
      if (!latest) {
        skip("no_inbound");
        continue;
      }
      const language: "en" | "zh" = (lastOut?.language ?? latest.language) === "zh" ? "zh" : "en";
      const booth = boothContext(inbound, latest);
      // 展会 C 级且企业规定"只发目录、不追问"：不进无回复跟进
      if (booth.grade === "C" && policy.businessProfile.commercialFacts?.gradeCCatalogOnly) {
        skip("grade_c_catalog_only");
        continue;
      }
      const fields = rfqRow ? rfqRowToFields(rfqRow as unknown as Record<string, unknown>) : null;
      const missing = fields ? computeMissingFields(fields) : [];
      const principalUserId = opp.assignedToId ?? org.ownerId;
      const principal = await db.user.findUnique({ where: { id: principalUserId }, select: { name: true } });
      const senderName = (booth.fromLatest && booth.sales) || principal?.name?.trim() || "Sales Team";
      const risks = detectInquiryRisks(inbound.map((i) => i.content ?? i.summary ?? "").join("\n\n"));

      const input = (lang: "en" | "zh"): NoReplyFollowUpInput => ({
        step: due.step,
        total: due.total,
        language: lang,
        contactName: opp.customer.contactName,
        orgName: org.name,
        senderName,
        previousSubject: lastOut?.summary ?? null,
        previousSentAt: opp.lastOutboundAt!,
        product: productLabel(allowedStyles(booth.styles, policy), fields?.productName ?? null, lang === "zh"),
        event: booth.fromLatest ? booth.event : null,
        questions: buildClarifyingQuestions(missing, lang, 3),
        signature: signatureLines(policy, lang),
      });
      const draft = buildNoReplyFollowUpDraft(input(language));
      if (draft.guardrailViolations.length) {
        skip(`guardrail:${draft.guardrailViolations.join(",")}`);
        continue;
      }
      const reviewZh = language === "en" ? buildNoReplyFollowUpDraft(input("zh")) : null;

      const approval = await requestApproval({
        orgId,
        principal: { userId: principalUserId, actorType: "agent" },
        actionType: INQUIRY_REPLY_ACTION_TYPE,
        title: `${risks.length ? "⚠ " : ""}跟进第 ${due.step}/${due.total} 次（${booth.fromLatest ? `展会${booth.grade ? ` · ${booth.grade} 级` : ""} · ` : ""}${due.day} 天未回复）：${opp.customer.name}`.slice(0, 160),
        preview: approvalPreview(draft, reviewZh, risks),
        payload: {
          opportunityId: opp.id,
          customerId: opp.customerId,
          to: opp.customer.email,
          subject: draft.subject,
          body: draft.body,
          language: draft.language,
          // 发送前 executor 核对：买家在此之后来信 → 草稿过时、拒发
          replyToInteractionId: latest.id,
          followUpStep: due.step,
          metadata: { orgId, customerId: opp.customerId, opportunityId: opp.id, employeeKey: FDE_EMPLOYEE_KEY },
        },
        risk: { vocabulary: "agent-core.tool-risk", value: "l3_strong", requiresApproval: true },
        source: { module: "revenue-spine.no-reply-followup", toolName: "sales_send_inquiry_reply", stepKey: `followup:${opp.id}:f${due.step}` },
        approver: { approverUserId: principalUserId },
        // 展会期间审核可能晚几天：给 5 天
        ttlHours: 120,
        idempotencyKey,
      });
      if (!approval.ok) {
        skip(`approval:${approval.errorCode}`);
        continue;
      }
      const pendingActionId = approval.actionIds[0];
      out.drafted += 1;
      out.pendingActionIds.push(pendingActionId);
      await createNotificationsForUsers([principalUserId], {
        type: "approval",
        title: `待审批：跟进第 ${due.step} 次 — ${opp.customer.name}`.slice(0, 120),
        summary: `首封发出后 ${due.day} 天没有回信，跟进草稿已备好`,
        orgId,
        entityType: "revenue_opportunity",
        entityId: opp.id,
        priority: "high",
        metadata: { pendingActionId, opportunityId: opp.id, followUpStep: due.step },
        sourceKeyPrefix: `revenue-followup-approval:${pendingActionId}`,
      }).catch(() => undefined);
    } catch (err) {
      skip(`error:${err instanceof Error ? err.message : String(err)}`.slice(0, 200));
    }
  }
  return out;
}
