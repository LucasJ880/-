/**
 * PROC-1 候选优先级（纯函数，design D6）：五个可解释维度，只排序与解释，不输出中标概率。
 * 到期前 4–6 个月提高研究优先级是内部备料策略，不是重招预测或政府答复承诺。
 */

export interface PriorityInput {
  productHits: string[];
  serviceHits: string[];
  categoryHits: string[];
  /** 已知 call-up / PO 数（来自公开披露或已导入记录） */
  callUpCount: number;
  /** 有前序 / 相关历史采购工具 */
  hasPredecessor: boolean;
  /** 已发现的既有 ATI 披露摘要数 */
  atiSummaryCount: number;
  /** 已取得的订单 / 支出明细数（披露文件抽取并确认） */
  confirmedLineItemCount: number;
  currentExpiryAt: string | null;
  closingAt: string | null;
  recordsHolderKnown: boolean;
}

export interface PriorityDimension {
  key: "BUSINESS_MATCH" | "RECURRENCE" | "PREP_TIME" | "RECORDS_GAP" | "HOLDER_CLARITY";
  label: string;
  points: number;
  max: number;
  reasonZh: string;
}

export interface PriorityResult {
  score: number;
  dimensions: PriorityDimension[];
  unknownsZh: string[];
}

function monthsBetween(from: Date, toIso: string): number | null {
  const t = new Date(toIso);
  if (Number.isNaN(t.getTime())) return null;
  return (t.getTime() - from.getTime()) / (30.4375 * 86400_000);
}

export function computePriority(input: PriorityInput, now: Date): PriorityResult {
  const dims: PriorityDimension[] = [];

  // 1. 业务匹配
  const productPts = Math.min(20, input.productHits.length * 8) + (input.categoryHits.length > 0 ? 6 : 0);
  const servicePts = input.serviceHits.length > 0 && (input.productHits.length > 0 || input.categoryHits.length > 0) ? 4 : 0;
  const bm = Math.min(30, productPts + servicePts);
  dims.push({
    key: "BUSINESS_MATCH",
    label: "业务匹配",
    points: bm,
    max: 30,
    reasonZh:
      bm > 0
        ? `命中产品词：${input.productHits.slice(0, 4).join("、") || "—"}${input.categoryHits.length ? `；分类：${input.categoryHits.join("、")}` : ""}${servicePts ? `；含服务（${input.serviceHits.slice(0, 2).join("、")}）` : ""}`
        : "未命中产品词或分类",
  });

  // 2. 重复采购迹象
  let rec = 0;
  const recReasons: string[] = [];
  if (input.callUpCount > 0) {
    rec += Math.min(12, 4 + input.callUpCount * 2);
    recReasons.push(`公开披露 call-up / PO ${input.callUpCount} 笔`);
  }
  if (input.hasPredecessor) {
    rec += 6;
    recReasons.push("有前序 / 相关历史采购");
  }
  if (input.atiSummaryCount > 0) {
    rec += 2;
    recReasons.push(`既有 ATI 披露摘要 ${input.atiSummaryCount} 条`);
  }
  rec = Math.min(20, rec);
  dims.push({ key: "RECURRENCE", label: "重复采购迹象", points: rec, max: 20, reasonZh: recReasons.join("；") || "暂无重复采购证据" });

  // 3. 准备时间
  let prep = 0;
  let prepReason = "到期日 / 截止日未知";
  if (input.currentExpiryAt) {
    const m = monthsBetween(now, input.currentExpiryAt);
    if (m !== null) {
      if (m < 0) {
        prep = 5;
        prepReason = `公开到期日 ${input.currentExpiryAt.slice(0, 10)} 已过（可能已续期或重招，需核实）`;
      } else if (m <= 6 && m >= 4) {
        prep = 25;
        prepReason = `距公开到期日约 ${m.toFixed(1)} 个月（4–6 个月窗口，内部备料优先）`;
      } else if (m < 4) {
        prep = 18;
        prepReason = `距公开到期日约 ${m.toFixed(1)} 个月（准备时间偏紧）`;
      } else if (m <= 12) {
        prep = 10;
        prepReason = `距公开到期日约 ${m.toFixed(1)} 个月`;
      } else {
        prep = 3;
        prepReason = `距公开到期日约 ${m.toFixed(1)} 个月（较远）`;
      }
    }
  } else if (input.closingAt) {
    const m = monthsBetween(now, input.closingAt);
    if (m !== null && m >= 0) {
      prep = m <= 1 ? 15 : 8;
      prepReason = `招标截止 ${input.closingAt.slice(0, 10)}`;
    } else if (m !== null) {
      prep = 0;
      prepReason = `招标已于 ${input.closingAt.slice(0, 10)} 截止`;
    }
  }
  dims.push({ key: "PREP_TIME", label: "准备时间", points: prep, max: 25, reasonZh: prepReason });

  // 4. 资料缺口
  const gap = input.confirmedLineItemCount > 0 ? 3 : input.atiSummaryCount > 0 ? 9 : 15;
  dims.push({
    key: "RECORDS_GAP",
    label: "资料缺口",
    points: gap,
    max: 15,
    reasonZh:
      input.confirmedLineItemCount > 0
        ? `已取得 ${input.confirmedLineItemCount} 条订单 / 支出明细`
        : input.atiSummaryCount > 0
          ? "无订单明细，但有可索取的既有披露"
          : "无订单 / 支出明细，也未发现既有披露",
  });

  // 5. 资料持有机关清楚
  dims.push({
    key: "HOLDER_CLARITY",
    label: "资料持有机关",
    points: input.recordsHolderKnown ? 10 : 0,
    max: 10,
    reasonZh: input.recordsHolderKnown ? "已记录资料持有机关及依据" : "资料持有机关未核实（PSPC / 购买部门须按所需记录分别核实）",
  });

  return {
    score: dims.reduce((s, d) => s + d.points, 0),
    dimensions: dims,
    unknownsZh: ["采购资格、原产地、本地内容、认证与交付区域以当前正式文件为准（未核实即未知）"],
  };
}
