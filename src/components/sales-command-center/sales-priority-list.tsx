"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SalesPriorityItem } from "@/lib/sales/home";
import { SalesCard, SalesCardState } from "./sales-card";
import { SalesPriorityItemRow } from "./sales-priority-item";

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
              if (it.primaryAction.href) {
                router.push(it.primaryAction.href);
              } else if (it.customerId) {
                router.push(`/sales/customers/${it.customerId}`);
              }
            }}
          />
        ))}
    </SalesCard>
  );
}
