"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SalesPriorityItem } from "@/lib/sales/home";
import { SalesCard, SalesCardState } from "./sales-card";
import { SalesPriorityItemRow, isFollowupDraftItem } from "./sales-priority-item";
import { FollowupDraftDialog } from "./followup-draft-dialog";

export function SalesPriorityList({
  items,
  total,
  status,
  onRetry,
}: {
  items: SalesPriorityItem[];
  total: number;
  status: "loading" | "empty" | "error" | "ready";
  onRetry?: () => void;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [draftItem, setDraftItem] = useState<SalesPriorityItem | null>(null);
  const visible = expanded ? items : items.slice(0, 5);

  return (
    <SalesCard
      title="今日重点"
      action={
        total > 5 ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-[12px] text-[var(--accent)] hover:underline"
          >
            {expanded ? "收起" : `查看全部 ${total} 项`}
          </button>
        ) : null
      }
    >
      {status === "loading" && <SalesCardState kind="loading" message="" />}
      {status === "error" && (
        <SalesCardState
          kind="error"
          message="今日重点暂时无法加载"
          onRetry={onRetry}
        />
      )}
      {status === "empty" && (
        <SalesCardState
          kind="empty"
          message="今天没有需要紧急处理的客户。你可以查看全部商机，或新建客户。"
        />
      )}
      {status === "ready" &&
        visible.map((item) => (
          <SalesPriorityItemRow
            key={item.id}
            item={item}
            onPrimary={(it) => {
              // 「生成跟进消息」按钮：真的生成（此前只是跳转到客户详情）
              if (isFollowupDraftItem(it) && it.customerId) {
                setDraftItem(it);
                return;
              }
              if (it.primaryAction.href) {
                router.push(it.primaryAction.href);
              } else if (it.customerId) {
                router.push(`/sales/customers/${it.customerId}`);
              }
            }}
          />
        ))}

      <FollowupDraftDialog
        open={!!draftItem}
        onClose={() => setDraftItem(null)}
        customerId={draftItem?.customerId ?? null}
        customerName={draftItem?.customerName ?? ""}
        category={draftItem?.category ?? ""}
      />
    </SalesCard>
  );
}
