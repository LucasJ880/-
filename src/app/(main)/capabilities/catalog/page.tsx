"use client";

import Link from "next/link";
import { PageHeader } from "@/components/page-header";

export default function CapabilitiesCatalogPage() {
  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="能力目录"
        description="查看企业已启用的 Agent、Skill 与 Tool（目录详情将随配置健康迭代完善）"
      />
      <p className="text-sm text-muted-foreground">
        第一版提供导航归位与入口。完整 Agent Builder / 目录编排不在本轮信息架构范围内。
      </p>
      <ul className="space-y-2 text-sm">
        <li>
          <Link href="/settings/agent-skills" className="text-[var(--accent)]">
            前往 Agent Skills 设置 →
          </Link>
        </li>
        <li>
          <Link href="/settings/digital-employees" className="text-[var(--accent)]">
            前往数字员工设置 →
          </Link>
        </li>
        <li>
          <Link href="/capabilities" className="text-muted-foreground">
            ← 返回中台总览
          </Link>
        </li>
      </ul>
    </div>
  );
}
