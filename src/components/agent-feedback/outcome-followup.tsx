"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-fetch";

interface Props {
  feedbackEventId: string;
  entityType: string;
  entityId: string;
  defaultOutcomeType?: string;
  className?: string;
}

export function OutcomeFollowup({
  feedbackEventId,
  entityType,
  entityId,
  defaultOutcomeType = "customer_replied",
  className,
}: Props) {
  const [outcomeType, setOutcomeType] = useState(defaultOutcomeType);
  const [saving, setSaving] = useState(false);
  const [ok, setOk] = useState(false);

  if (ok) {
    return (
      <div className={className}>
        <span className="text-[12px] text-emerald-800">已关联业务结果</span>
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <span className="text-[#68706c]">后续结果</span>
        <select
          value={outcomeType}
          onChange={(e) => setOutcomeType(e.target.value)}
          className="rounded-md border border-black/[0.1] px-2 py-1"
        >
          <option value="customer_replied">客户已回复</option>
          <option value="meeting_booked">已约会议</option>
          <option value="quote_sent">已发报价</option>
          <option value="opportunity_advanced">机会推进</option>
          <option value="opportunity_won">赢单</option>
          <option value="no_response">无回复</option>
          <option value="published">已发布</option>
          <option value="leads">产生线索</option>
        </select>
        <button
          type="button"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            try {
              const res = await apiFetch("/api/business-outcomes", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  feedbackEventId,
                  entityType,
                  entityId,
                  actionType: "user_confirmed_followup",
                  outcomeType,
                  sourceType: "user_confirmed",
                  manuallyVerified: true,
                  confidence: 0.8,
                }),
              });
              if (res.ok) setOk(true);
            } finally {
              setSaving(false);
            }
          }}
          className="rounded-md bg-[#202422] px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50"
        >
          确认结果
        </button>
      </div>
    </div>
  );
}
