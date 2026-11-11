"use client";

/**
 * W-1「问供应商要价」抽屉：一屏三块（问哪几家 / 条款 / 会发出什么）→ 生成并送审 → 结果页原地审批。
 *
 * 能前置判断的失败原因已经在入口按钮上挡掉（entry.state）；这里只处理提交时的竞态与输入错误。
 * 生成只建审批卡，批准前零出站。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronDown, ChevronRight, Plus, Search, Star, X } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-fetch";
import { notifyPendingActionsChanged } from "@/lib/hooks/use-pending-approvals-badge";
import { monthDay } from "@/lib/tender-rfq/web-entry-pure";
import { cn } from "@/lib/utils";
import { RfqApprovalPanel, type RfqDecisionOutcome } from "./rfq-approval-panel";
import type { RfqEntryView, RfqIncoterm, RfqRoundCreated, RfqRoundFailed, UserMessage } from "./rfq-web-entry-types";

type Entry = Extract<RfqEntryView, { available: true }>;

type Props = {
  open: boolean;
  onClose: () => void;
  projectId: string;
  entry: Entry;
  /** 轮次已建（送审）后调用，父组件刷新 */
  onChanged: () => void;
  /** 在结果页批准 / 驳回之后：父组件保留结果文字并刷新；批准成功或驳回后抽屉自动关闭 */
  onDecision: (inquiryId: string, outcome: RfqDecisionOutcome) => void;
};

const INCOTERMS: RfqIncoterm[] = ["EXW", "FOB", "CIF", "DDP", "DAP"];
const MAX_SUPPLIERS = 8;
const MAX_QUESTIONS = 5;
const inputCls =
  "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent/60";

export function RfqWebEntryDrawer({ open, onClose, projectId, entry, onChanged, onDecision }: Props) {
  const defaultSelected = useMemo(
    () => entry.suppliers.filter((s) => s.isDefault && s.ready).slice(0, MAX_SUPPLIERS).map((s) => s.id),
    [entry.suppliers],
  );
  const [selected, setSelected] = useState<string[]>(defaultSelected);
  const [query, setQuery] = useState("");
  const [incoterm, setIncoterm] = useState<RfqIncoterm | "">(entry.defaults.incoterm ?? "");
  const [destination, setDestination] = useState("");
  const [scopeNote, setScopeNote] = useState("");
  const [questions, setQuestions] = useState<string[]>([]);
  const [showQuestions, setShowQuestions] = useState(false);
  // RFQ-AUTO-1：开关打开时默认勾选；开关关闭时入口不给 offer，这个值不会被提交
  const followUpOffer = entry.followUp?.offer ?? null;
  const [autoFollowUp, setAutoFollowUp] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<UserMessage | null>(null);
  const [created, setCreated] = useState<RfqRoundCreated | null>(null);

  // 只在「关 → 开」时从入口数据重置（常用供应商 / 默认条款可能已变）；
  // 送审成功后父组件会刷新 entry，此时不能重置，否则结果页会被清掉。
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setSelected(defaultSelected);
      setQuery("");
      setIncoterm(entry.defaults.incoterm ?? "");
      setDestination("");
      setScopeNote("");
      setQuestions([]);
      setShowQuestions(false);
      setFailure(null);
      setCreated(null);
    }
    wasOpen.current = open;
  }, [open, defaultSelected, entry.defaults.incoterm]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entry.suppliers;
    return entry.suppliers.filter((s) => s.name.toLowerCase().includes(q) || (s.contactEmail ?? "").toLowerCase().includes(q));
  }, [entry.suppliers, query]);

  const full = selected.length >= MAX_SUPPLIERS;

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= MAX_SUPPLIERS ? prev : [...prev, id]));
  }

  async function submit() {
    setSubmitting(true);
    setFailure(null);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/tender-rfq/rounds`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierIds: selected,
          incoterm: incoterm || null,
          destination: destination.trim() || null,
          scopeNote: scopeNote.trim() || null,
          extraQuestions: questions.map((q) => q.trim()).filter(Boolean),
          ...(followUpOffer ? { autoFollowUp } : {}),
        }),
      });
      const data = (await res.json().catch(() => null)) as RfqRoundCreated | RfqRoundFailed | null;
      if (data && data.ok) {
        setCreated(data);
        notifyPendingActionsChanged();
        onChanged();
        return;
      }
      setFailure(
        (data && !data.ok && data.userMessage) || { message: "生成没有成功，请重试。", action: null },
      );
      // 提交时才撞上轮次锁（别人刚发了一轮）：刷新入口，按钮旁的说明会写清是第几轮、哪天
      if (data && !data.ok && data.errorCode === "ROUND_LOCKED") onChanged();
    } catch {
      setFailure({ message: "网络出错了，请重试。", action: null });
    } finally {
      setSubmitting(false);
    }
  }

  const replyText = entry.preview.replyBy ? `${monthDay(entry.preview.replyBy, entry.timeZone)}（截标日前留出余量）` : "请尽快（项目没有截标日）";
  const title = created ? `第 ${created.roundNumber} 轮询价已生成` : "问供应商要价";

  const footer = created ? (
    <div className="flex justify-end">
      <Button variant="outline" size="sm" onClick={onClose}>
        关闭
      </Button>
    </div>
  ) : (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-muted">生成后先送审，批准前不会发出任何邮件。</p>
      <Button variant="accent" onClick={submit} disabled={selected.length === 0} loading={submitting} loadingText="正在生成…">
        生成并送审{selected.length ? `（${selected.length} 家）` : ""}
      </Button>
    </div>
  );

  return (
    <Drawer open={open} onClose={onClose} title={title} width="w-[560px]" footer={footer}>
      {created ? (
        <div className="space-y-4 p-5">
          <p className="text-sm text-foreground">
            等待批准后从 <span className="font-medium">{created.fromEmail}</span> 发给 {created.suppliers.length} 家
            {created.replyBy ? `，请他们在 ${monthDay(created.replyBy, entry.timeZone)} 前回复` : ""}。
          </p>
          <p className="text-xs text-muted">
            贸易条款：{created.incoterm ?? "不指定（让供应商注明）"}
            {created.excludedRequirements ? ` · ${created.excludedRequirements} 条未确认或不面向供应商的要求没有写进询价单` : ""}
          </p>
          {created.blockedSuppliers.length > 0 && (
            <p className="text-xs text-[#9a6a2f]">
              没发给：{created.blockedSuppliers.map((b) => `${b.name}（${b.reason === "no_email" ? "没有邮箱" : "已停用"}）`).join("、")}
            </p>
          )}
          <RfqApprovalPanel
            projectId={projectId}
            inquiryId={created.inquiryId}
            roundNumber={created.roundNumber}
            approval={created.approval}
            emails={created.emails}
            followUp={created.followUp ?? null}
            onDone={(o) => {
              onDecision(created.inquiryId, o);
              if (o.kind !== "error") onClose();
            }}
          />
          <p className="text-xs text-muted">回信会自动进表；之后的进度在「供应商询价」的这一轮里看。</p>
        </div>
      ) : (
        <div className="space-y-6 p-5">
          {/* 1. 问哪几家 */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">问哪几家</h3>
              <span className={cn("text-xs", full ? "text-[#9a6a2f]" : "text-muted")}>
                已选 {selected.length} / 最多 {MAX_SUPPLIERS}
              </span>
            </div>
            {entry.suppliers.length === 0 ? (
              <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted">
                组织里还没有供应商。{" "}
                <Link href="/suppliers" className="text-accent underline-offset-4 hover:underline">
                  去添加供应商
                </Link>
              </p>
            ) : (
              <>
                {entry.suppliers.length > 6 && (
                  <label className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5">
                    <Search size={13} className="text-muted" />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="按名称或邮箱筛选"
                      className="w-full bg-transparent text-sm outline-none"
                    />
                  </label>
                )}
                <ul className="max-h-72 divide-y divide-border/60 overflow-y-auto rounded-md border border-border">
                  {visible.map((s) => {
                    const checked = selected.includes(s.id);
                    const disabled = !s.ready || (!checked && full);
                    return (
                      <li key={s.id} className={cn("flex items-center gap-2 px-3 py-2 text-sm", !s.ready && "opacity-60")}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => toggle(s.id)}
                          aria-label={`选择 ${s.name}`}
                          className="h-4 w-4 accent-[var(--accent)]"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate font-medium text-foreground">{s.name}</span>
                            {s.isDefault && (
                              <span className="inline-flex items-center gap-0.5 rounded-full bg-accent/10 px-1.5 py-px text-[10px] text-accent">
                                <Star size={9} />
                                常用
                              </span>
                            )}
                          </span>
                          <span className="block truncate text-xs text-muted">
                            {s.ready ? s.contactEmail : s.blockedReason === "no_email" ? "没有联系邮箱" : "已停用"}
                          </span>
                        </span>
                        {!s.ready && (
                          <Link href={`/suppliers/${s.id}`} className="shrink-0 text-xs text-accent underline-offset-4 hover:underline">
                            {s.blockedReason === "no_email" ? "补邮箱" : "查看"}
                          </Link>
                        )}
                      </li>
                    );
                  })}
                  {visible.length === 0 && <li className="px-3 py-3 text-xs text-muted">没有匹配的供应商</li>}
                </ul>
              </>
            )}
          </section>

          {/* 2. 条款 */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">条款</h3>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1 text-xs text-muted">
                <span>贸易条款</span>
                <select value={incoterm} onChange={(e) => setIncoterm(e.target.value as RfqIncoterm | "")} className={inputCls}>
                  <option value="">不指定（让供应商注明）</option>
                  {INCOTERMS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                      {entry.defaults.incoterm === t && entry.defaults.incotermFromPrefs ? "（你的默认）" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-xs text-muted">
                <span>目的地（可空）</span>
                <input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="如 Edmonton, AB" className={inputCls} maxLength={200} />
              </label>
            </div>
            <label className="block space-y-1 text-xs text-muted">
              <span>补充说明（可空，会写进询价单）</span>
              <textarea value={scopeNote} onChange={(e) => setScopeNote(e.target.value)} rows={3} className={inputCls} maxLength={2000} />
            </label>
            <div>
              <button type="button" onClick={() => setShowQuestions((v) => !v)} className="inline-flex items-center gap-1 text-xs text-accent">
                {showQuestions ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                附加问题（可选，最多 {MAX_QUESTIONS} 条）{questions.filter((q) => q.trim()).length ? ` · ${questions.filter((q) => q.trim()).length} 条` : ""}
              </button>
              {showQuestions && (
                <div className="mt-2 space-y-2">
                  {questions.map((q, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        value={q}
                        onChange={(e) => setQuestions((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
                        placeholder={`问题 ${i + 1}`}
                        className={inputCls}
                        maxLength={500}
                      />
                      <button type="button" aria-label="删除这条问题" onClick={() => setQuestions((prev) => prev.filter((_, j) => j !== i))} className="text-muted hover:text-foreground">
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                  {questions.length < MAX_QUESTIONS && (
                    <button type="button" onClick={() => setQuestions((prev) => [...prev, ""])} className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground">
                      <Plus size={12} />
                      加一条
                    </button>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* 3. 会发出什么 */}
          <section className="space-y-2 rounded-md bg-background p-3 text-xs">
            <h3 className="text-sm font-semibold text-foreground">会发出什么</h3>
            <dl className="grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-1 text-muted">
              <dt>发件人</dt>
              <dd className="text-foreground">
                {entry.preview.fromName} &lt;{entry.preview.fromEmail}&gt;
              </dd>
              <dt>回复截止</dt>
              <dd className="text-foreground">{replyText}</dd>
              <dt>要求</dt>
              <dd className="text-foreground">
                包含 {entry.preview.confirmedRequirementCount} 条已确认要求
                {entry.preview.excludedCount ? `；${entry.preview.excludedCount} 条（未确认或不面向供应商）不会发出` : ""}
              </dd>
            </dl>
            {entry.state.warnings.map((w) => (
              <p key={w} className="flex items-start gap-1.5 text-[#9a6a2f]">
                <AlertTriangle size={13} className="mt-px shrink-0" />
                {w}
              </p>
            ))}
          </section>

          {/* 4. 自动跟进（RFQ-AUTO-1；开关关闭时不出现） */}
          {followUpOffer && (
            <section className="space-y-2 rounded-md border border-border p-3 text-xs" data-testid="rfq-followup-offer">
              <label className="flex cursor-pointer items-start gap-2">
                <input type="checkbox" className="mt-0.5" checked={autoFollowUp} onChange={(e) => setAutoFollowUp(e.target.checked)} data-testid="rfq-followup-checkbox" />
                <span>
                  <span className="text-sm font-semibold text-foreground">这一轮的催单和追问自动发</span>
                  <span className="mt-0.5 block text-muted">批准这一轮的那张卡，就一并批准了后面的催单和追问，不用再一封一封点。不勾 = 和以前一样逐封批。</span>
                </span>
              </label>
              {autoFollowUp && (
                <div className="space-y-1 pl-6 text-muted">
                  <p className="text-foreground/85">{followUpOffer.summaryZh}</p>
                  <p>正文是固定模板，只发给这一轮的收件人；送审后在审批卡上可以逐段看到。轮次取消、过了回复截止、或你点「停止自动跟进」后不再发。</p>
                </div>
              )}
            </section>
          )}

          {failure && (
            <div className="rounded-md border border-danger/30 bg-danger/[0.04] p-3 text-xs text-danger" role="alert">
              {failure.message}
              {failure.action ? (
                <>
                  {" "}
                  <FailureAction action={failure.action} onAnchor={onClose} />
                </>
              ) : null}
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

/** 页内锚点（#rfq-…）先关抽屉再跳；站内路径用 Link。 */
function FailureAction({ action, onAnchor }: { action: { label: string; href: string }; onAnchor: () => void }) {
  if (action.href.startsWith("#")) {
    return (
      <a
        href={action.href}
        onClick={() => onAnchor()}
        className="font-medium underline underline-offset-4"
      >
        {action.label}
      </a>
    );
  }
  return (
    <Link href={action.href} className="font-medium underline underline-offset-4">
      {action.label}
    </Link>
  );
}
