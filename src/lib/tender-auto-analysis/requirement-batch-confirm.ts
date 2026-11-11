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
  // 批大小不合规用接口上限；也不允许超过接口上限（超出的部分接口会静默丢弃）
  const n = Number.isInteger(size) && size > 0 ? Math.min(size, BATCH_CONFIRM_LIMIT) : BATCH_CONFIRM_LIMIT;
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
    return `已确认 ${input.confirmed} 条（选了 ${input.selected} 条，其中 ${input.selected - input.confirmed} 条在提交时已经不是待确认——可能已被处理过，以刷新后的列表为准）。`;
  }
  return `已确认 ${input.confirmed} 条。`;
}

/** 「批准分析」按钮旁的提示：还有待确认的才显示；不拦批准、不多一次点击 */
export function approveHintZh(pendingCount: number): string | null {
  if (!(pendingCount > 0)) return null;
  return `还有 ${pendingCount} 条要求没有确认：批准后不能再确认，没确认的不会进询价单。`;
}

/* ---------------------------------- 提交 ---------------------------------- */

/** 一批的提交结果：ok = HTTP 成功；json = 响应体（解析不了就是 null） */
export type BatchPostResult = { ok: boolean; json: unknown };

export type BatchSubmitOutcome<A> = {
  selected: number;
  /** 各批接口返回的实际确认数之和 */
  confirmed: number;
  /** 出错的那一批的说明；全部成功 = null */
  error: string | null;
  /** 各批响应里带回的「自动起草」结果：取最后一个需要提示的；都不需要提示 = null */
  autoDraft: A | null;
  /** 有没有哪一批带回过「自动起草」结果（据此决定要不要清掉旧的提示） */
  sawAutoDraft: boolean;
};

/**
 * 按批依次提交选中的要求。某一批失败（HTTP 失败、响应看不懂、抛错）就停，后面的批次不再提交。
 * 这里不碰界面状态：面板拿到结果后自己决定显示什么。
 */
export async function submitBatchConfirm<A extends { quiet: boolean }>(
  ids: ReadonlyArray<string>,
  post: (chunk: string[]) => Promise<BatchPostResult>,
): Promise<BatchSubmitOutcome<A>> {
  const chunks = chunkRequirementIds(ids);
  const out: BatchSubmitOutcome<A> = { selected: chunks.reduce((n, c) => n + c.length, 0), confirmed: 0, error: null, autoDraft: null, sawAutoDraft: false };
  for (const chunk of chunks) {
    let res: BatchPostResult;
    try {
      res = await post(chunk);
    } catch (e) {
      out.error = e instanceof Error ? e.message : String(e);
      break;
    }
    const json = (res.json && typeof res.json === "object" ? res.json : null) as { confirmedCount?: unknown; error?: unknown; rfqAutoDraft?: unknown } | null;
    if (!res.ok) {
      out.error = typeof json?.error === "string" && json.error ? json.error : "操作失败";
      break;
    }
    if (typeof json?.confirmedCount !== "number") {
      // 成功的状态码但内容看不懂：不能当作「确认了 0 条」，按失败处理
      out.error = "服务器返回的内容看不懂，这一批是否确认成功请以刷新后的列表为准";
      break;
    }
    out.confirmed += json.confirmedCount;
    const auto = json.rfqAutoDraft as A | undefined;
    if (auto && typeof auto === "object") {
      out.sawAutoDraft = true;
      // 后面的批次带回「不必提示」的结果，不能把前面那一批需要提示的结果冲掉
      if (!auto.quiet) out.autoDraft = auto;
    }
  }
  return out;
}
