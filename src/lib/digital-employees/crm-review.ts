const DAY_MS = 86_400_000;

const CLOSED_STAGES = new Set(["signed", "producing", "installing", "completed", "lost"]);

export type CrmReviewUrgency = "critical" | "warning" | "ready";
export type CrmReviewAction =
  | "complete_profile"
  | "contact"
  | "record_followup"
  | "create_quote"
  | "book_measurement"
  | "none";

export type CrmReviewInput = {
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  stage?: string | null;
  nextFollowupAt?: string | Date | null;
  lastContactAt?: string | Date | null;
  quoteStatus?: string | null;
  quoteViewed?: boolean;
  quoteViewedAt?: string | Date | null;
};

export type CrmReview = {
  urgency: CrmReviewUrgency;
  label: string;
  summary: string;
  reasons: string[];
  action: CrmReviewAction;
  actionLabel: string;
};

function time(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function ageInDays(value: string | Date | null | undefined, nowMs: number): number | null {
  const timestamp = time(value);
  return timestamp == null ? null : Math.max(0, Math.floor((nowMs - timestamp) / DAY_MS));
}

/**
 * 客户与商机数字员工的可解释规则层。只读业务信号，不自动外发或修改 CRM。
 */
export function reviewCrmRecord(input: CrmReviewInput, nowMs = Date.now()): CrmReview {
  const stage = input.stage ?? null;
  const isClosed = Boolean(stage && CLOSED_STAGES.has(stage));
  const nextFollowup = time(input.nextFollowupAt);
  const lastContactDays = ageInDays(input.lastContactAt, nowMs);
  const recordAgeDays = ageInDays(input.createdAt ?? input.updatedAt, nowMs) ?? 0;
  const updatedDays = ageInDays(input.updatedAt ?? input.createdAt, nowMs) ?? 0;
  const quoteViewed = Boolean(input.quoteViewed || input.quoteViewedAt);
  const contactable = Boolean(input.phone || input.email);
  const reasons: string[] = [];

  if (!contactable) reasons.push("缺少电话和邮箱，暂时无法联系客户");
  if (!input.address) reasons.push("地址未完善，后续量房与安装可能受阻");

  if (isClosed) {
    return {
      urgency: "ready",
      label: stage === "lost" ? "已结束" : "进展正常",
      summary: stage === "lost" ? "商机已流失，保留记录供复盘" : "当前阶段无需销售紧急介入",
      reasons,
      action: "none",
      actionLabel: "查看记录",
    };
  }

  if (!contactable) {
    return {
      urgency: "critical",
      label: "资料阻塞",
      summary: "先补齐联系方式，数字员工才能协助生成和发送跟进内容",
      reasons,
      action: "complete_profile",
      actionLabel: "完善客户资料",
    };
  }

  if (nextFollowup != null && nextFollowup <= nowMs) {
    reasons.unshift("计划跟进时间已到");
    return {
      urgency: "critical",
      label: "跟进逾期",
      summary: "建议今天联系客户，并在沟通后重新设定下一步",
      reasons,
      action: "record_followup",
      actionLabel: "记录本次跟进",
    };
  }

  if (quoteViewed && input.quoteStatus !== "signed" && input.quoteStatus !== "accepted") {
    reasons.unshift("客户已经查看报价，但尚未签约");
    return {
      urgency: "critical",
      label: "成交窗口",
      summary: "客户刚释放购买信号，优先确认价格、交期和安装疑问",
      reasons,
      action: "contact",
      actionLabel: "立即联系客户",
    };
  }

  if (stage === "new_lead" && lastContactDays == null && recordAgeDays >= 2) {
    reasons.unshift("新线索已超过 48 小时没有首次联系记录");
    return {
      urgency: "critical",
      label: "首次联系超时",
      summary: "尽快完成首次联系，避免线索继续降温",
      reasons,
      action: "contact",
      actionLabel: "首次联系客户",
    };
  }

  if (input.quoteStatus === "sent" && updatedDays >= 3) {
    reasons.unshift("报价已发送超过 3 天，尚未记录回复");
    return {
      urgency: "warning",
      label: "报价待跟进",
      summary: "确认客户是否收到报价，并处理主要异议",
      reasons,
      action: "record_followup",
      actionLabel: "跟进报价",
    };
  }

  const staleLimit = stage === "negotiation" || stage === "quoted" ? 5 : 7;
  if (updatedDays >= staleLimit || (lastContactDays != null && lastContactDays >= staleLimit)) {
    reasons.unshift(`商机已至少 ${staleLimit} 天没有有效推进`);
    return {
      urgency: "warning",
      label: "商机停滞",
      summary: "重新确认客户意向，并约定一个明确的时间节点",
      reasons,
      action: "record_followup",
      actionLabel: "安排下一步",
    };
  }

  if (stage === "needs_confirmed" && !input.address) {
    return {
      urgency: "warning",
      label: "待预约量房",
      summary: "补齐地址后安排量房，把需求转成可报价信息",
      reasons,
      action: "book_measurement",
      actionLabel: "新建量房预约",
    };
  }

  if (!input.nextFollowupAt) {
    reasons.unshift("当前没有设定下次跟进时间");
    return {
      urgency: "warning",
      label: "缺少下一步",
      summary: stage === "measure_booked" ? "确认量房时间和到场信息" : "每个活跃商机都应有明确的下一步",
      reasons,
      action: stage === "measure_booked" ? "book_measurement" : "record_followup",
      actionLabel: stage === "measure_booked" ? "确认预约" : "设定下一步",
    };
  }

  return {
    urgency: "ready",
    label: "推进正常",
    summary: "客户资料和跟进节奏正常，按计划执行即可",
    reasons,
    action: "none",
    actionLabel: "查看记录",
  };
}

type DuplicateCandidate = { id: string; phone?: string | null; email?: string | null };

function normalizePhone(value: string | null | undefined): string | null {
  let digits = value?.replace(/\D/g, "") ?? "";
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return digits.length >= 7 ? digits : null;
}

function normalizeEmail(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized.includes("@") ? normalized : null;
}

/** 标记当前已加载结果中电话或邮箱相同的疑似重复客户。 */
export function findPotentialDuplicateCustomerIds(customers: DuplicateCandidate[]): Set<string> {
  const owners = new Map<string, string>();
  const duplicates = new Set<string>();
  for (const customer of customers) {
    const keys = [
      normalizePhone(customer.phone) ? `phone:${normalizePhone(customer.phone)}` : null,
      normalizeEmail(customer.email) ? `email:${normalizeEmail(customer.email)}` : null,
    ].filter((key): key is string => Boolean(key));
    for (const key of keys) {
      const previous = owners.get(key);
      if (previous && previous !== customer.id) {
        duplicates.add(previous);
        duplicates.add(customer.id);
      } else {
        owners.set(key, customer.id);
      }
    }
  }
  return duplicates;
}
