"use client";

import { Suspense, useState } from "react";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { WorkQueue } from "@/components/tasks/work-queue";
import { TasksClassicPage } from "./tasks-classic";

/**
 * 我的工作 — Phase 3 默认工作队列
 * ?layout=classic 保留旧时间/项目/看板视图
 */
export default function TasksPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-accent" />
        </div>
      }
    >
      <TasksPageSwitch />
    </Suspense>
  );
}

function TasksPageSwitch() {
  const searchParams = useSearchParams();
  const classic = searchParams.get("layout") === "classic";
  const [showHint] = useState(true);

  if (classic) {
    return (
      <div className="space-y-2">
        <div className="px-4 pt-3 text-[12px] text-[var(--muted)] md:px-6">
          <Link href="/tasks" className="text-[var(--accent)] hover:underline">
            ← 返回工作队列
          </Link>
        </div>
        <TasksClassicPage />
      </div>
    );
  }

  return (
    <div>
      {showHint ? (
        <div className="border-b border-[var(--border)] px-4 py-2 text-[12px] text-[var(--muted)] md:px-6">
          当前为统一工作队列。需要看板/时间线时：
          <Link
            href="/tasks?layout=classic"
            className="ml-1 text-[var(--accent)] hover:underline"
          >
            打开经典视图
          </Link>
        </div>
      ) : null}
      <WorkQueue />
    </div>
  );
}
