export type QuoteReviewStatus = "ready" | "info" | "attention" | "blocked";

export interface QuoteReviewItem {
  key: string;
  status: QuoteReviewStatus;
  title: string;
  detail: string;
  action?: "customer" | "products" | "part_b" | "email_settings" | "signature";
}

export interface QuoteWorkflowReviewInput {
  customerId: string;
  customerName: string;
  customerEmail: string;
  customerAddress: string;
  productsSubtotal: number;
  enteredLineCount: number;
  motorizedLineCount: number;
  sunnyMotorPrice: number;
  taxRate: number;
  specialPromotion: number;
  promoRatio: number;
  promoMaxPct: number;
  promoBlocked: boolean;
  promotionApprovalRequested: boolean;
  promotionApprovalApproved?: boolean;
  paymentMethod: "direct" | "finance";
  depositAmount: number;
  grandTotal: number;
  depositMinPct: number;
  depositUnlocked: boolean;
  isAdmin: boolean;
  emailChannel: "loading" | "connected" | "disconnected";
  hasSignature: boolean;
}

export interface QuoteWorkflowReview {
  status: "ready" | "needs_attention" | "blocked";
  readyCount: number;
  attentionCount: number;
  blockedCount: number;
  items: QuoteReviewItem[];
  nextAction: string;
}

const DEFAULT_TAX_RATE = 0.13;

function money(value: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

export function reviewQuoteWorkflow(
  input: QuoteWorkflowReviewInput,
): QuoteWorkflowReview {
  const items: QuoteReviewItem[] = [];

  if (!input.customerId || !input.customerName.trim()) {
    items.push({
      key: "customer",
      status: "blocked",
      title: "尚未绑定客户",
      detail: "保存报价前必须选择客户并确认客户姓名。",
      action: "customer",
    });
  } else {
    items.push({
      key: "customer",
      status: input.customerAddress.trim() ? "ready" : "attention",
      title: "客户资料已绑定",
      detail: input.customerAddress.trim()
        ? `${input.customerName} · 地址已填写`
        : `${input.customerName} · 建议补充安装地址`,
      action: input.customerAddress.trim() ? undefined : "customer",
    });
  }

  if (input.productsSubtotal <= 0 || input.enteredLineCount <= 0) {
    items.push({
      key: "products",
      status: "blocked",
      title: "还没有可计价产品",
      detail: "至少填写一行有效的 Shades、Shutters 或 Drapes 产品。",
      action: "products",
    });
  } else {
    items.push({
      key: "products",
      status: "ready",
      title: `${input.enteredLineCount} 行产品已计价`,
      detail: `产品小计 ${money(input.productsSubtotal)}`,
    });
  }

  if (input.motorizedLineCount > 0) {
    items.push({
      key: "motor",
      status: "info",
      title: `${input.motorizedLineCount} 行选择 Sunny Motor`,
      detail: `${money(input.sunnyMotorPrice)} × ${input.motorizedLineCount}，共加收 ${money(
        input.sunnyMotorPrice * input.motorizedLineCount,
      )}`,
    });
  }

  if (!Number.isFinite(input.taxRate) || input.taxRate < 0 || input.taxRate > 0.3) {
    items.push({
      key: "tax",
      status: "blocked",
      title: "税率需要确认",
      detail: "税率必须在 0%–30% 范围内。",
      action: "part_b",
    });
  } else {
    const changed = Math.abs(input.taxRate - DEFAULT_TAX_RATE) > 0.0001;
    items.push({
      key: "tax",
      status: changed ? "info" : "ready",
      title: changed ? "税率已按地区调整" : "默认税率已确认",
      detail: `当前税率 ${(input.taxRate * 100).toFixed(2).replace(/\.00$/, "")}%${
        changed ? "，请确认与客户所在地区一致" : ""
      }`,
      action: changed ? "part_b" : undefined,
    });
  }

  if (input.promoBlocked) {
    items.push({
      key: "promotion",
      status: input.promotionApprovalApproved ? "ready" : input.promotionApprovalRequested ? "attention" : "blocked",
      title: input.promotionApprovalApproved
        ? "超额让利已获管理员批准"
        : input.promotionApprovalRequested
          ? "超额让利已提交管理员"
          : "Special Promotion 超过公司上限",
      detail: `${(input.promoRatio * 100).toFixed(1)}% > ${(input.promoMaxPct * 100).toFixed(
        0,
      )}%；${input.promotionApprovalApproved ? "本次金额快照已批准" : input.promotionApprovalRequested ? "等待管理员处理" : "需先申请管理员确认"}`,
      action: "part_b",
    });
  } else if (input.specialPromotion > 0) {
    items.push({
      key: "promotion",
      status: "ready",
      title: "Special Promotion 在授权范围内",
      detail: `${money(input.specialPromotion)} · 占产品税前小计 ${(input.promoRatio * 100).toFixed(1)}%`,
      action: "part_b",
    });
  }

  if (input.paymentMethod === "direct" && input.grandTotal > 0) {
    const depositRatio = input.depositAmount / input.grandTotal;
    const depositBlocked =
      !input.isAdmin &&
      !input.depositUnlocked &&
      depositRatio < input.depositMinPct;
    items.push({
      key: "deposit",
      status: depositBlocked ? "blocked" : "ready",
      title: depositBlocked ? "定金低于公司最低比例" : "定金条件已确认",
      detail: `${money(input.depositAmount)} · 占总价 ${(Math.max(0, depositRatio) * 100).toFixed(
        1,
      )}%${depositBlocked ? `，最低要求 ${(input.depositMinPct * 100).toFixed(0)}%` : ""}`,
      action: depositBlocked ? "part_b" : undefined,
    });
  }

  if (!input.customerEmail.trim()) {
    items.push({
      key: "email",
      status: "attention",
      title: "客户邮箱未填写",
      detail: "可以先保存报价，但无法从系统发送给客户。",
      action: "customer",
    });
  } else if (input.emailChannel === "disconnected") {
    items.push({
      key: "email",
      status: "attention",
      title: "销售邮箱尚未绑定",
      detail: "报价可下载到本地；绑定邮箱后才能从青砚发送。",
      action: "email_settings",
    });
  } else {
    items.push({
      key: "email",
      status: input.emailChannel === "loading" ? "info" : "ready",
      title: input.emailChannel === "loading" ? "正在检查发送通道" : "邮件发送通道已就绪",
      detail: input.customerEmail,
    });
  }

  items.push({
    key: "signature",
    status: input.hasSignature ? "ready" : "info",
    title: input.hasSignature ? "客户签名已完成" : "客户尚未签名",
    detail: input.hasSignature
      ? "保存后可以生成正式订单。"
      : "不影响保存报价；生成订单前需要在 Part B 签名。",
    action: input.hasSignature ? undefined : "signature",
  });

  const blockedCount = items.filter((item) => item.status === "blocked").length;
  const attentionCount = items.filter((item) => item.status === "attention").length;
  const readyCount = items.filter((item) => item.status === "ready").length;
  const status = blockedCount > 0 ? "blocked" : attentionCount > 0 ? "needs_attention" : "ready";

  let nextAction = "报价检查通过，可以保存并准备发送。";
  if (items.some((item) => item.key === "customer" && item.status === "blocked")) {
    nextAction = "先选择客户并确认基础资料。";
  } else if (items.some((item) => item.key === "products" && item.status === "blocked")) {
    nextAction = "先填写至少一行可计价产品。";
  } else if (items.some((item) => item.key === "promotion" && item.status === "blocked")) {
    nextAction = "前往 Part B 申请管理员确认超额让利。";
  } else if (items.some((item) => item.key === "deposit" && item.status === "blocked")) {
    nextAction = "提高定金金额，或在 Part B 使用管理员解锁码。";
  } else if (attentionCount > 0) {
    nextAction = "报价可以继续保存；发送前请处理黄色提醒。";
  } else if (input.hasSignature) {
    nextAction = "检查通过，可以保存并生成订单。";
  }

  return { status, readyCount, attentionCount, blockedCount, items, nextAction };
}
