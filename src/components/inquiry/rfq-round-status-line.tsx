"use client";

/**
 * W-1 引擎发出的询价轮次 — 卡片上一眼可见的状态：发了几家、谁报了价、在等谁、截止哪天、会不会自动进表 / 自动催。
 */

import Link from "next/link";
import { Clock } from "lucide-react";
import { roundStatusLine, type UserMessage } from "@/lib/tender-rfq/web-entry-pure";

type Props = {
  items: Array<{ status: string }>;
  dueDate: string | null;
  timeZone: string;
  elapsed: string | null;
  autoIngest: UserMessage;
};

export function RfqRoundStatusLine({ items, dueDate, timeZone, elapsed, autoIngest }: Props) {
  const line = roundStatusLine(items, dueDate, timeZone);
  const waiting = items.some((i) => i.status === "sent");
  return (
    <div className="space-y-1 px-4 pb-3 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium text-foreground">{line}</span>
        {elapsed ? (
          <span className="inline-flex items-center gap-1 text-muted">
            <Clock size={11} />
            {elapsed}
          </span>
        ) : null}
      </div>
      {waiting ? (
        <p className="text-muted">
          {autoIngest.message}
          {autoIngest.action ? (
            <>
              {" "}
              <Link href={autoIngest.action.href} className="text-accent underline-offset-4 hover:underline">
                {autoIngest.action.label}
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
