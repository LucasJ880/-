/**
 * RFQ-AUTO-4 招标要求审核的批量确认 — 纯逻辑（计数 / 全选 / 分批 / 文案）
 *
 * 选择始终由人做：这里没有「替人选」的函数——全选只是把当前待确认的列出来，默认选中的永远是空。
 * 零依赖：前端面板直接引用。
 */

/** 批量确认接口一次最多处理的条数（接口对多出的部分是静默丢弃的，所以调用方必须自己分批） */
export const BATCH_CONFIRM_LIMIT = 200;
export const BATCH_CONFIRM_AUDIT_ACTION = "tender_analysis_requirements_batch_confirm" as const;

export const REVIEW_PENDING = "AI_EXTRACTED" as const;
export const REVIEW_CONFIRMED = "CONFIRMED" as const;
export const REVIEW_REJECTED = "REJECTED" as const;

type Reviewable = { id: string; reviewStatus: string };

/** 批量确认的控件只在分析等待审核时出现（批准之后界面不再允许确认） */
export function canBatchConfirm(runStatus: string | null | undefined): boolean {
  return runStatus === "REVIEW_REQUIRED";
}

export type ReviewCounts = { confirmed: number; pending: number; rejected: number; total: number };

export function countRequirementReview(reqs: ReadonlyArray<{ reviewStatus: string }>): ReviewCounts {
  let confirmed = 0;
  let pending = 0;
  let rejected = 0;
  for (const r of reqs) {
    if (r.reviewStatus === REVIEW_CONFIRMED) confirmed += 1;
    else if (r.reviewStatus === REVIEW_PENDING) pending += 1;
    else if (r.reviewStatus === REVIEW_REJECTED) rejected += 1;
  }
  return { confirmed, pending, rejected, total: reqs.length };
}

export function reviewCountsLineZh(c: ReviewCounts): string {
  return `已确认 ${c.confirmed} 条 · 待确认 ${c.pending} 条 · 已驳回 ${c.rejected} 条`;
}

/** 当前列表里待确认的要求号（「全选待确认的」选的就是这些；已确认、已驳回的不在其中） */
export function pendingRequirementIds(reqs: ReadonlyArray<Reviewable>): string[] {
  return reqs.filter((r) => r.reviewStatus === REVIEW_PENDING).map((r) => r.id);
}

/** 列表刷新后：选中的里面只保留仍然待确认的（别人刚处理掉的自动从选中里去掉） */
export function pruneSelection(selected: ReadonlyArray<string>, reqs: ReadonlyArray<Reviewable>): string[] {
  const pending = new Set(pendingRequirementIds(reqs));
  return [...new Set(selected)].filter((id) => pending.has(id));
}

/** 勾选 / 取消勾选一条。只有待确认的能被选中。 */
export function toggleSelection(selected: ReadonlyArray<string>, id: string, reqs: ReadonlyArray<Reviewable>): string[] {
  if (selected.includes(id)) return selected.filter((x) => x !== id);
  return pendingRequirementIds(reqs).includes(id) ? [...selected, id] : [...selected];
}

/** 按接口上限分批：去重、去空，保持顺序；每批不超过 size 条 */
export function chunkRequirementIds(ids: ReadonlyArray<string>, size: number = BATCH_CONFIRM_LIMIT): string[][] {
  const clean = [...new Set(ids.filter((x) => typeof x === "string" && x.length > 0))];
  const n = Number.isInteger(size) && size > 0 ? size : BATCH_CONFIRM_LIMIT;
  const out: string[][] = [];
  for (let i = 0; i < clean.length; i += n) out.push(clean.slice(i, i + n));
  return out;
}

/**
 * 提交完成后的一句话。confirmed = 各批接口返回的实际确认数之和；
 * 少于选中数（有的已被别人处理）如实说；中途失败说明已经确认了几条。
 */
export function batchConfirmResultZh(input: { selected: number; confirmed: number; error?: string | null }): string {
  if (input.error) {
    return input.confirmed > 0
      ? `提交中途出错：${input.error}。此前已确认 ${input.confirmed} 条，其余没有确认，可以重新勾选再试。`
      : `没有确认成功：${input.error}。`;
  }
  if (input.confirmed < input.selected) {
    return `已确认 ${input.confirmed} 条（选了 ${input.selected} 条，其中 ${input.selected - input.confirmed} 条在提交时已经不是待确认，可能刚被别人处理）。`;
  }
  return `已确认 ${input.confirmed} 条。`;
}

/** 「批准分析」按钮旁的提示：还有待确认的才显示；不拦批准、不多一次点击 */
export function approveHintZh(pendingCount: number): string | null {
  if (!(pendingCount > 0)) return null;
  return `还有 ${pendingCount} 条要求没有确认：批准后不能再确认，没确认的不会进询价单。`;
}
