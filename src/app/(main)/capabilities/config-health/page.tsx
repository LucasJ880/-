"use client";

import Link from "next/link";
import { PageHeader } from "@/components/page-header";

export default function CapabilitiesHealthPage() {
  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="配置健康"
        description="Provider、模块与关键配置状态的轻量入口（完整 Config Health 不在本轮范围）"
      />
      <ul className="space-y-2 text-sm">
        <li className="rounded-md border border-border px-3 py-2">
          OpenAI：以服务端环境配置为准（密钥不在前端展示）
        </li>
        <li className="rounded-md border border-border px-3 py-2">
          Gemini / Qwen / Flux：未接入或未配置时不得显示为可用
        </li>
        <li className="rounded-md border border-border px-3 py-2">
          Industry Pack / modulesJson：由企业管理与经营中心共同驱动导航可见性
        </li>
      </ul>
      <Link href="/capabilities" className="text-sm text-muted-foreground">
        ← 返回中台总览
      </Link>
    </div>
  );
}
