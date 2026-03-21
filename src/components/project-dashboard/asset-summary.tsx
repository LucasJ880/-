"use client";

import Link from "next/link";
import { FileText, Database, BookOpen, Bot, Wrench, Layers, Rocket } from "lucide-react";
import type { DashboardAssets } from "@/lib/project-dashboard/types";

interface AssetSummaryProps {
  assets: DashboardAssets;
  projectId: string;
}

const ASSET_ITEMS = [
  { key: "prompts" as const, label: "Prompt", icon: FileText, path: "prompts" },
  { key: "knowledgeBases" as const, label: "知识库", icon: Database, path: "knowledge-bases" },
  { key: "documents" as const, label: "文档", icon: BookOpen, path: "knowledge-bases" },
  { key: "agents" as const, label: "Agent", icon: Bot, path: "agents" },
  { key: "tools" as const, label: "工具", icon: Wrench, path: "tools" },
  { key: "environments" as const, label: "环境", icon: Layers, path: "" },
] as const;

export function AssetSummary({ assets, projectId }: AssetSummaryProps) {
  return (
    <div className="rounded-xl border border-border bg-card-bg p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Layers size={16} className="text-accent/60" />
          AI 资产概览
        </div>
        {assets.recentPublishes > 0 && (
          <span className="flex items-center gap-1 rounded-full bg-[rgba(46,122,86,0.08)] px-2 py-0.5 text-[11px] font-medium text-[#2e7a56]">
            <Rocket size={10} />
            近期 {assets.recentPublishes} 次发布
          </span>
        )}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {ASSET_ITEMS.map((item) => {
          const count = assets[item.key];
          const content = (
            <div
              key={item.key}
              className="flex flex-col items-center gap-1.5 rounded-lg border border-border px-2 py-3 transition-colors hover:bg-[rgba(43,96,85,0.04)] hover:border-accent/20"
            >
              <item.icon size={16} className="text-accent/50" />
              <span className="text-lg font-bold text-foreground">{count}</span>
              <span className="text-[11px] text-muted">{item.label}</span>
            </div>
          );
          if (item.path) {
            return (
              <Link key={item.key} href={`/projects/${projectId}/${item.path}`}>
                {content}
              </Link>
            );
          }
          return <div key={item.key}>{content}</div>;
        })}
      </div>
    </div>
  );
}
