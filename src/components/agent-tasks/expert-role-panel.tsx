"use client";

import {
  Brain,
  Shield,
  TrendingUp,
  Ship,
  FileCheck,
  Briefcase,
  ChevronDown,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { apiJson } from "@/lib/api-fetch";

interface ExpertRoleInfo {
  id: string;
  name: string;
  domain: string;
  skills: string[];
}

const ROLE_ICON: Record<string, React.ElementType> = {
  bid_analyst: TrendingUp,
  project_manager: Briefcase,
  quote_reviewer: FileCheck,
  risk_assessor: Shield,
  supply_chain_analyst: Ship,
};

const ROLE_COLOR: Record<string, { bg: string; text: string; border: string }> = {
  bid_analyst:          { bg: "bg-indigo-50",  text: "text-indigo-700",  border: "border-indigo-200" },
  project_manager:      { bg: "bg-blue-50",    text: "text-blue-700",    border: "border-blue-200" },
  quote_reviewer:       { bg: "bg-amber-50",   text: "text-amber-700",   border: "border-amber-200" },
  risk_assessor:        { bg: "bg-red-50",     text: "text-red-700",     border: "border-red-200" },
  supply_chain_analyst: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
};

const DOMAIN_LABEL: Record<string, string> = {
  analysis: "分析",
  project: "项目",
  quote: "报价",
  risk: "风险",
  execution: "执行",
};

export function ExpertRolePanel() {
  const [roles, setRoles] = useState<ExpertRoleInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedRole, setExpandedRole] = useState<string | null>(null);

  useEffect(() => {
    apiJson<{ roles: ExpertRoleInfo[] }>("/api/agent/expert-roles")
      .then((data) => setRoles(data.roles ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="text-xs text-muted-foreground py-3 px-4">加载专家角色...</div>;
  }

  if (roles.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 px-1">
        <Brain className="h-3.5 w-3.5 text-violet-500" />
        <span className="text-xs font-medium text-foreground">AI 专家角色</span>
        <span className="text-[10px] text-muted-foreground">
          · {roles.length} 个已激活
        </span>
      </div>

      <div className="grid gap-1.5">
        {roles.map((role) => {
          const Icon = ROLE_ICON[role.id] ?? Sparkles;
          const color = ROLE_COLOR[role.id] ?? { bg: "bg-slate-50", text: "text-slate-700", border: "border-slate-200" };
          const isExpanded = expandedRole === role.id;

          return (
            <div
              key={role.id}
              className={cn(
                "rounded-lg border transition-colors",
                color.border,
                isExpanded ? color.bg : "bg-card hover:bg-muted/20"
              )}
            >
              <button
                onClick={() => setExpandedRole(isExpanded ? null : role.id)}
                className="w-full flex items-center gap-2.5 px-3 py-2"
              >
                <div className={cn("flex h-7 w-7 items-center justify-center rounded-md", color.bg)}>
                  <Icon className={cn("h-3.5 w-3.5", color.text)} />
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <div className="text-xs font-medium text-foreground">{role.name}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {DOMAIN_LABEL[role.domain] ?? role.domain}
                    {role.skills.length > 0 && ` · ${role.skills.length} 个技能`}
                  </div>
                </div>
                {isExpanded ? (
                  <ChevronDown className="h-3 w-3 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-3 w-3 text-muted-foreground" />
                )}
              </button>

              {isExpanded && role.skills.length > 0 && (
                <div className="px-3 pb-2.5 pt-0.5">
                  <div className="text-[10px] text-muted-foreground mb-1.5">关联技能</div>
                  <div className="flex flex-wrap gap-1">
                    {role.skills.map((skill) => (
                      <span
                        key={skill}
                        className={cn(
                          "text-[10px] px-2 py-0.5 rounded-full border font-medium",
                          color.bg, color.text, color.border
                        )}
                      >
                        {skill}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
