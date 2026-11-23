"use client";

/**
 * BIDPAGE-6「定报价只点一次」的界面小件（openspec change quote-one-step-confirm）
 *
 * - QuoteActionBar：逐行 / 总价编辑器标题旁的主按钮（定为我方报价 / 批准并定为我方报价 / 退回 / 提交给负责人），
 *   代替「提交、批准在专业模式里做」；按钮矩阵与不可点的原因来自 `quote-confirm/contract.ts`。
 * - 定之前确认一次（写报价合计 / 税前报价与要不要改选）；退回可写一句原因；提交后写明通知结果。
 * - OurBidLineView：② 最上面的「我方报价」一行 + 另起新版（代替改版前的我方报价卡）。
 * - 这里不算数：确认框里的数就是编辑器上显示的引擎结果，随请求带给服务端在锁内核对。
 * - 不放中标 / 建项目预算（留在专业模式）。
 */
import { useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import {
  actionBarOf,
  blockReasonZh,
  confirmedNoteZh,
  confirmPromptZh,
  notifyNeedsFollowUp,
  ourBidLineZh,
  QUOTE_ACTION_LABELS_ZH,
  QUOTE_ACTION_TEXT,
  RETURN_NOTE_MAX,
  REVISE_REASON_MAX,
  REVISE_TEXT,
  type ConfirmResult,
  type OurBidLine,
  type QuoteActionButton,
  type ReviseResult,
  type SubmitResult,
} from "@/lib/bid-page-v2/quote-confirm/contract";

/** 操作成功后要留给人看的一句（编辑器随新视图重挂，提示由 QuoteStep 留着再传回来） */
export type QuoteActionNotice = { text: string; tone: "muted" | "warn" };

export type QuoteActionDone =
  | { kind: "confirmed"; quoteId: string; result: ConfirmResult; notice: QuoteActionNotice | null }
  | { kind: "submitted"; quoteId: string; result: SubmitResult; notice: QuoteActionNotice }
  | { kind: "returned"; quoteId: string; notice: QuoteActionNotice }
  | { kind: "revised"; quoteId: string; result: ReviseResult; notice: null };

export type QuoteActionBarProps = {
  projectId: string;
  quote: { id: string; status: string; version: number; updatedAt: string; currency: string };
  capabilities: { canEdit: boolean; canApprove: boolean };
  ourBid: OurBidLine | null;
  /** 逐行表叫「报价合计」，总价表叫「税前报价」 */
  label: "报价合计" | "税前报价";
  /** 编辑器上显示的引擎税前报价；算不出为 null */
  sellingPrice: number | null;
  dirty: boolean;
  /** 视图里有「未定价」警告（按种类去过重，只知道有没有、不知道几行） */
  hasUnpriced: boolean;
  onDone: (done: QuoteActionDone) => void;
  /** 上一次操作成功后的提示（QuoteStep 留着；编辑器重挂后照样显示） */
  notice?: QuoteActionNotice | null;
};

/** 现在的我方报价是不是另一份（改选时写进确认框；已中标的不改选） */
export function otherOurBidOf(ourBid: OurBidLine | null, quoteId: string): { name: string; version: number; amount: number | null; currency: string; awarded: boolean } | null {
  if (!ourBid || ourBid.status !== "AUTHORITATIVE" || ourBid.quoteId === quoteId) return null;
  return { name: ourBid.name, version: ourBid.version, amount: ourBid.sellingPrice, currency: ourBid.currency, awarded: ourBid.quoteStatus === "awarded" };
}

const btnPrimary = "rounded bg-accent px-3 py-1 text-xs font-medium text-white disabled:opacity-50";
const btnPlain = "rounded border border-border px-3 py-1 text-xs disabled:opacity-50";
const toneCls = { muted: "text-xs text-muted", warn: "text-xs font-medium text-amber-700", error: "text-xs text-red-700" } as const;

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await apiFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, data };
}

export function QuoteActionBar(props: QuoteActionBarProps) {
  const { projectId, quote, capabilities, ourBid } = props;
  const isOurBid = ourBid?.status === "AUTHORITATIVE" && ourBid.quoteId === quote.id;
  const other = otherOurBidOf(ourBid, quote.id);
  const bar = actionBarOf({ status: quote.status, isOurBid, canEdit: capabilities.canEdit, canApprove: capabilities.canApprove, otherOurBidAwarded: !!other?.awarded, otherOurBidVersion: other?.version ?? null });
  const valueButton = bar.buttons.find((b) => b === "confirm" || b === "approve" || b === "submit");
  const block = blockReasonZh({ dirty: props.dirty, computedOk: props.sellingPrice != null, hasUnpriced: props.hasUnpriced, actionZh: valueButton ? QUOTE_ACTION_LABELS_ZH[valueButton] : "提交、批准" });
  const [mode, setMode] = useState<"idle" | "confirm" | "return" | "revise">("idle");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<{ text: string; tone: keyof typeof toneCls } | null>(null);
  const base = `/api/projects/${encodeURIComponent(projectId)}/bid-page/quotes/${encodeURIComponent(quote.id)}`;

  const run = async (path: string, body: unknown, done: (data: Record<string, unknown>) => void) => {
    setBusy(true);
    setMessage(null);
    try {
      const { ok, data } = await postJson(`${base}/${path}`, body);
      if (!ok) {
        setMessage({ text: typeof data.error === "string" ? data.error : "没有成功，请稍后再试", tone: "error" });
        return;
      }
      setMode("idle");
      setNote("");
      done(data);
    } catch {
      setMessage({ text: QUOTE_ACTION_TEXT.networkError, tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const confirm = () => {
    // 改选时写原来那份还在（名称取点「确定」那一刻的我方报价）；没改选不再多一句
    const previousName = other?.name ?? null;
    return run("confirm", { baseUpdatedAt: quote.updatedAt, expectedSellingPrice: props.sellingPrice }, (data) => {
      const r = data as unknown as ConfirmResult;
      const note2 = confirmedNoteZh(r.reselectedFrom && previousName ? { name: previousName, version: r.reselectedFrom.version } : null);
      props.onDone({ kind: "confirmed", quoteId: quote.id, result: r, notice: note2 ? { text: note2, tone: "muted" } : null });
    });
  };
  const submit = () =>
    run("submit", { baseUpdatedAt: quote.updatedAt }, (data) => {
      const r = data as unknown as SubmitResult;
      // 负责人没收到：要提交的人自己去说，醒目显示
      props.onDone({ kind: "submitted", quoteId: quote.id, result: r, notice: { text: r.messageZh, tone: notifyNeedsFollowUp(r.notify) ? "warn" : "muted" } });
    });
  const sendReturn = () =>
    run("return", { baseUpdatedAt: quote.updatedAt, note: note.trim() || null }, () => {
      props.onDone({ kind: "returned", quoteId: quote.id, notice: { text: QUOTE_ACTION_TEXT.returned, tone: "muted" } });
    });

  const needsValue = (b: QuoteActionButton) => b === "confirm" || b === "approve" || b === "submit";
  const onClick = (b: QuoteActionButton) => {
    setMessage(null);
    if (b === "confirm" || b === "approve") return setMode("confirm");
    if (b === "return") return setMode("return");
    void submit();
  };
  const canRevise = quote.status === "approved" && capabilities.canEdit;
  const prompt =
    props.sellingPrice != null
      ? confirmPromptZh({ label: props.label, amount: props.sellingPrice, currency: quote.currency, alreadyApproved: quote.status === "approved", current: other && !other.awarded ? { name: other.name, version: other.version, amount: other.amount, currency: other.currency } : null })
      : [];

  return (
    <div className="flex flex-col gap-2" data-testid="quote-action-bar">
      <div className="flex flex-wrap items-center gap-2">
        {bar.buttons.map((b) => (
          <button key={b} type="button" className={b === "return" ? btnPlain : btnPrimary} disabled={busy || mode !== "idle" || (needsValue(b) && !!block)} onClick={() => onClick(b)} data-testid={`quote-action-${b}`}>
            {busy && (b === "confirm" || b === "approve") ? QUOTE_ACTION_TEXT.confirming : busy && b === "submit" ? QUOTE_ACTION_TEXT.submitting : QUOTE_ACTION_LABELS_ZH[b]}
          </button>
        ))}
        {canRevise ? (
          <button type="button" className={btnPlain} disabled={busy || mode !== "idle"} onClick={() => setMode("revise")} data-testid="quote-action-revise">
            {REVISE_TEXT.button}
          </button>
        ) : null}
        {bar.statusZh ? <span className="text-xs text-muted" data-testid="quote-action-status">{bar.statusZh}</span> : null}
        {block && bar.buttons.some(needsValue) ? <span className="text-xs text-amber-700" data-testid="quote-action-block">{block}</span> : null}
      </div>
      {quote.status === "review" && capabilities.canEdit ? <div className="text-xs text-muted">{capabilities.canApprove ? QUOTE_ACTION_TEXT.reviewEditableApprover : QUOTE_ACTION_TEXT.reviewEditableEditor}</div> : null}
      {mode === "confirm" ? (
        <div className="space-y-2 rounded-lg border border-accent/40 bg-accent-soft/40 px-3 py-2 text-sm" role="alertdialog" data-testid="quote-action-confirm-panel">
          {prompt.map((l) => (
            <p key={l}>{l}</p>
          ))}
          {/* 确认框打开以后又改了数（没保存）或算不出：「确定」也不可点，写明原因 */}
          {block ? <p className="text-xs text-amber-700" data-testid="quote-action-confirm-block">{block}</p> : null}
          <div className="flex gap-2">
            <button type="button" className={btnPrimary} disabled={busy || !!block} onClick={() => void confirm()} data-testid="quote-action-confirm-ok">
              {busy ? QUOTE_ACTION_TEXT.confirming : QUOTE_ACTION_TEXT.ok}
            </button>
            <button type="button" className={btnPlain} disabled={busy} onClick={() => setMode("idle")} data-testid="quote-action-confirm-cancel">
              {QUOTE_ACTION_TEXT.cancel}
            </button>
          </div>
        </div>
      ) : null}
      {mode === "return" ? (
        <div className="space-y-2 rounded-lg border border-border/60 px-3 py-2 text-sm" data-testid="quote-action-return-form">
          <textarea className="w-full rounded border border-border px-2 py-1 text-sm" rows={2} maxLength={RETURN_NOTE_MAX} placeholder={QUOTE_ACTION_TEXT.returnNotePlaceholder} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex gap-2">
            <button type="button" className={btnPrimary} disabled={busy} onClick={() => void sendReturn()} data-testid="quote-action-return-ok">
              {busy ? QUOTE_ACTION_TEXT.returning : QUOTE_ACTION_LABELS_ZH.return}
            </button>
            <button type="button" className={btnPlain} disabled={busy} onClick={() => setMode("idle")}>
              {QUOTE_ACTION_TEXT.cancel}
            </button>
          </div>
        </div>
      ) : null}
      {mode === "revise" ? (
        <ReviseForm
          projectId={projectId}
          quoteId={quote.id}
          isOurBid={isOurBid}
          onCancel={() => setMode("idle")}
          onDone={(r) => {
            setMode("idle");
            props.onDone({ kind: "revised", quoteId: quote.id, result: r, notice: null });
          }}
        />
      ) : null}
      {/* 本次的错误优先；成功的提示由 QuoteStep 留着传回来（编辑器随新视图重挂，本地状态会丢） */}
      {message ?? props.notice ? (
        <div className={toneCls[(message ?? props.notice)!.tone]} data-testid="quote-action-message">
          {(message ?? props.notice)!.text}
        </div>
      ) : null}
    </div>
  );
}

/** 另起新版：写一句原因，确认后复制成新一版草稿（已批准的报价才有） */
export function ReviseForm({ projectId, quoteId, isOurBid, onDone, onCancel }: { projectId: string; quoteId: string; isOurBid: boolean; onDone: (r: ReviseResult) => void; onCancel: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const { ok, data } = await postJson(`/api/projects/${encodeURIComponent(projectId)}/bid-page/quotes/${encodeURIComponent(quoteId)}/revise`, { reason: reason.trim() });
      if (!ok) return setError(typeof data.error === "string" ? data.error : "没有成功，请稍后再试");
      onDone(data as unknown as ReviseResult);
    } catch {
      setError(QUOTE_ACTION_TEXT.networkError);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2 rounded-lg border border-border/60 px-3 py-2 text-sm" data-testid="quote-revise-form">
      <p>{isOurBid ? REVISE_TEXT.promptOurBid : REVISE_TEXT.promptOther}</p>
      <textarea className="w-full rounded border border-border px-2 py-1 text-sm" rows={2} maxLength={REVISE_REASON_MAX} placeholder={REVISE_TEXT.placeholder} value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="flex gap-2">
        <button type="button" className={btnPrimary} disabled={busy || !reason.trim()} onClick={() => void go()} data-testid="quote-revise-ok">
          {busy ? REVISE_TEXT.submitting : REVISE_TEXT.button}
        </button>
        <button type="button" className={btnPlain} disabled={busy} onClick={onCancel}>
          {QUOTE_ACTION_TEXT.cancel}
        </button>
      </div>
      {error ? <div className="text-xs text-red-700">{error}</div> : null}
    </div>
  );
}

/** ② 最上面的「我方报价」一行（代替改版前的我方报价卡；只给看得到金额的人，② 本身已在金额门后） */
export function OurBidLineView({ projectId, line, canEdit, onRevised }: { projectId: string; line: OurBidLine; canEdit: boolean; onRevised: (r: ReviseResult) => void }) {
  const [revising, setRevising] = useState(false);
  // 专业模式做的我方报价在专业模式里另起新版（新页面的接口只收逐行 / 总价报价）
  const canRevise = line.status === "AUTHORITATIVE" && line.quoteStatus === "approved" && line.entryMode !== null && canEdit;
  return (
    <div className="space-y-2 rounded-xl border border-border/60 bg-card-bg/60 px-4 py-2 text-sm" data-testid="our-bid-line">
      <div className="flex flex-wrap items-center gap-3">
        <span className={line.status === "AUTHORITATIVE" ? "font-medium" : "text-muted"} data-testid="our-bid-line-text">
          {ourBidLineZh(line)}
        </span>
        {canRevise && !revising ? (
          <button type="button" className={btnPlain} onClick={() => setRevising(true)} data-testid="our-bid-line-revise">
            {REVISE_TEXT.button}
          </button>
        ) : null}
      </div>
      {revising && line.status === "AUTHORITATIVE" ? (
        <ReviseForm
          projectId={projectId}
          quoteId={line.quoteId}
          isOurBid
          onCancel={() => setRevising(false)}
          onDone={(r) => {
            setRevising(false);
            onRevised(r);
          }}
        />
      ) : null}
    </div>
  );
}
