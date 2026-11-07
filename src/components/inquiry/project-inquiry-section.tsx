"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import {
  AlertTriangle,
  Loader2,
  ChevronDown,
  ChevronUp,
  Send,
  ShoppingCart,
} from "lucide-react";
import { InquiryDetail } from "./inquiry-detail";
import { RfqApprovalPanel } from "./rfq-approval-panel";
import { RfqRoundStatusLine } from "./rfq-round-status-line";
import { RfqWebEntryDrawer } from "./rfq-web-entry-drawer";
import type { RfqEntryView, RfqPendingSendView } from "./rfq-web-entry-types";

interface InquiryRound {
  id: string;
  roundNumber: number;
  title: string | null;
  status: string;
  dueDate: string | null;
  items: InquiryItemRow[];
}

export interface InquiryItemRow {
  id: string;
  supplierId: string;
  status: string;
  sentVia: string | null;
  sentAt: string | null;
  repliedAt: string | null;
  declinedAt: string | null;
  unitPrice: string | null;
  totalPrice: string | null;
  currency: string;
  deliveryDays: number | null;
  validUntil: string | null;
  quoteNotes: string | null;
  isSelected: boolean;
  contactNotes: string | null;
  supplier: { id: string; name: string };
}

interface Props {
  projectId: string;
  orgId: string | null;
  canManage: boolean;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  in_progress: "进行中",
  completed: "已完成",
  canceled: "已取消",
};

const ROUND_ANCHOR_PREFIX = "#rfq-round-";

export function ProjectInquirySection({ projectId, orgId, canManage }: Props) {
  const [rounds, setRounds] = useState<InquiryRound[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [entry, setEntry] = useState<RfqEntryView | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const loadEntry = useCallback(() => {
    apiFetch(`/api/projects/${projectId}/tender-rfq/entry`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: RfqEntryView | null) => setEntry(data))
      .catch(() => setEntry(null));
  }, [projectId]);

  const loadRounds = useCallback(() => {
    apiFetch(`/api/projects/${projectId}/inquiries`)
      .then((r) => r.json())
      .then((data) => {
        const list = Array.isArray(data) ? data : [];
        setRounds(list);
        setExpandedId((prev) => prev ?? (list.length > 0 ? list[list.length - 1].id : null));
      })
      .finally(() => setLoading(false));
  }, [projectId]);

  const reloadAll = useCallback(() => {
    loadRounds();
    loadEntry();
  }, [loadRounds, loadEntry]);

  useEffect(() => {
    reloadAll();
  }, [reloadAll]);

  const ready = entry && entry.available ? entry : null;
  const entryAction = ready?.state.action ?? null;
  const pendingByInquiry = new Map<string, RfqPendingSendView>((ready?.pendingSends ?? []).map((p) => [p.inquiryId, p]));

  // 有待批发送卡时默认展开那一轮（审批面板在里面）；只在「第一张待批卡」变化时跳，不打断用户手动收起
  const firstPendingInquiryId = ready?.pendingSends[0]?.inquiryId ?? null;
  useEffect(() => {
    if (firstPendingInquiryId) setExpandedId(firstPendingInquiryId);
  }, [firstPendingInquiryId]);

  /** 入口说明里的页内锚点：#rfq-round-<id> 展开并滚到该轮；#rfq-rounds 滚到列表 */
  const followAnchor = useCallback((href: string) => {
    if (href.startsWith(ROUND_ANCHOR_PREFIX)) setExpandedId(href.slice(ROUND_ANCHOR_PREFIX.length));
    const target = document.getElementById(href.startsWith(ROUND_ANCHOR_PREFIX) ? href.slice(1) : "rfq-rounds");
    window.setTimeout(() => target?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }, []);

  async function createRound() {
    setCreating(true);
    setCreateError(null);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/inquiries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "创建失败");
      }
      const inquiry = await res.json();
      setExpandedId(inquiry.id);
      reloadAll();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card-bg p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ShoppingCart size={16} className="text-accent/60" />
          供应商询价
          {rounds.length > 0 && (
            <span className="text-xs font-normal text-muted">
              {rounds.length} 轮
            </span>
          )}
        </h3>
        {canManage && (
          <div className="flex items-center gap-3">
            {ready ? (
              <>
                <button
                  type="button"
                  onClick={createRound}
                  disabled={creating}
                  className="text-xs text-muted underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50"
                  title="建一个空轮次，手工添加供应商并登记（电话 / 微信等线下联系）"
                >
                  {creating ? "正在建…" : "手工建一轮"}
                </button>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(true)}
                  disabled={!ready.state.enabled}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-[color:var(--on-accent)] hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                  data-testid="rfq-web-entry-open"
                >
                  <Send size={12} />
                  问供应商要价
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={createRound}
                disabled={creating}
                className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-[color:var(--on-accent)] hover:bg-accent-hover disabled:opacity-50"
              >
                {creating ? <Loader2 size={12} className="animate-spin" /> : null}
                新建询价轮次
              </button>
            )}
          </div>
        )}
      </div>

      {/* 按钮旁的实时说明：能发就说会怎么发，不能发就说为什么、去哪解决 */}
      {canManage && ready && (
        <div className="mt-2 space-y-1 text-xs" data-testid="rfq-web-entry-hint">
          <p className={ready.state.enabled ? "text-muted" : "text-foreground"}>
            {ready.state.message}
            {entryAction ? (
              <>
                {" "}
                {entryAction.href.startsWith("#") ? (
                  <a
                    href={entryAction.href}
                    onClick={(e) => {
                      e.preventDefault();
                      followAnchor(entryAction.href);
                    }}
                    className="font-medium text-accent underline-offset-4 hover:underline"
                  >
                    {entryAction.label} →
                  </a>
                ) : (
                  <Link href={entryAction.href} className="font-medium text-accent underline-offset-4 hover:underline">
                    {entryAction.label} →
                  </Link>
                )}
              </>
            ) : null}
          </p>
          {ready.state.warnings.map((w) => (
            <p key={w} className="flex items-start gap-1.5 text-[#9a6a2f]">
              <AlertTriangle size={12} className="mt-px shrink-0" />
              {w}
            </p>
          ))}
        </div>
      )}
      {createError && <p className="mt-2 text-xs text-danger">{createError}</p>}

      {loading ? (
        <div className="flex h-20 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-accent" />
        </div>
      ) : rounds.length === 0 ? (
        <p className="mt-4 text-center text-sm text-muted">
          {ready ? "还没有询价轮次。点「问供应商要价」，选几家供应商，系统按已确认的要求生成询价单。" : "暂无询价轮次"}
        </p>
      ) : (
        <div className="mt-4 space-y-3" id="rfq-rounds">
          {rounds.map((r) => {
            const isOpen = expandedId === r.id;
            const pending = pendingByInquiry.get(r.id) ?? null;
            const engine = ready?.engineRounds[r.id] ?? null;
            return (
              <div
                key={r.id}
                id={`rfq-round-${r.id}`}
                className="scroll-mt-4 rounded-lg border border-border bg-background"
              >
                <button
                  type="button"
                  onClick={() => setExpandedId(isOpen ? null : r.id)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left text-sm"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium">
                      {r.title || `第 ${r.roundNumber} 轮`}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        pending
                          ? "bg-accent/10 text-accent"
                          : r.status === "in_progress"
                            ? "bg-[rgba(46,122,86,0.08)] text-[#2e7a56]"
                            : r.status === "completed"
                              ? "bg-accent/10 text-accent"
                              : r.status === "canceled"
                                ? "bg-[rgba(166,61,61,0.08)] text-[#a63d3d]"
                                : "bg-[rgba(110,125,118,0.08)] text-[#6e7d76]"
                      }`}
                    >
                      {pending ? "待批准" : STATUS_LABEL[r.status] ?? r.status}
                    </span>
                    <span className="text-xs text-muted">
                      {r.items.length} 家供应商
                    </span>
                  </div>
                  {isOpen ? (
                    <ChevronUp size={14} className="text-muted" />
                  ) : (
                    <ChevronDown size={14} className="text-muted" />
                  )}
                </button>
                {engine && ready && !pending && (
                  <RfqRoundStatusLine
                    items={r.items}
                    dueDate={r.dueDate}
                    timeZone={ready.timeZone}
                    elapsed={engine.elapsed}
                    autoIngest={ready.autoIngest}
                  />
                )}
                {isOpen && (
                  <div className="space-y-3 border-t border-border px-4 py-3">
                    {pending && (
                      <RfqApprovalPanel
                        projectId={projectId}
                        inquiryId={r.id}
                        roundNumber={pending.roundNumber ?? r.roundNumber}
                        approval={pending.approval}
                        emails={pending.emails}
                        onDone={reloadAll}
                      />
                    )}
                    <InquiryDetail
                      projectId={projectId}
                      orgId={orgId}
                      inquiry={r}
                      canManage={canManage}
                      awaitingApproval={!!pending}
                      onUpdate={reloadAll}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {ready && (
        <RfqWebEntryDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          projectId={projectId}
          entry={ready}
          onChanged={reloadAll}
        />
      )}
    </div>
  );
}
