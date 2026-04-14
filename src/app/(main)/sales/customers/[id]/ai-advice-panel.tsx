"use client";

import { useState, useCallback } from "react";
import { Loader2, Brain, Sparkles, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";

interface AiProfile {
  customerType?: string | null;
  budgetRange?: string | null;
  communicationStyle?: string | null;
  decisionSpeed?: string | null;
  keyNeeds?: string[];
  objectionHistory?: string[];
  priceSensitivity?: number | null;
  winProbability?: number | null;
  confidence?: number;
  productPreferences?: string[];
}

const PROFILE_LABELS: Record<string, string> = {
  residential: "住宅客户", commercial: "商业客户", designer: "设计师",
  contractor: "承包商", developer: "开发商",
  economy: "经济型", mid_range: "中端", premium: "高端", luxury: "奢华",
  fast: "快速", moderate: "一般", slow: "慢",
};

function ProfileBadge({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-lg bg-white/60 border border-border/50 px-2.5 py-1.5 min-w-[70px]">
      <span className="text-[10px] text-muted">{label}</span>
      <span className="text-xs font-medium text-foreground">{PROFILE_LABELS[value] || value}</span>
    </div>
  );
}

function HealthBar({ score }: { score: number }) {
  const color = score >= 70 ? "bg-emerald-500" : score >= 40 ? "bg-amber-500" : "bg-red-500";
  const textColor = score >= 70 ? "text-emerald-600" : score >= 40 ? "text-amber-600" : "text-red-600";
  return (
    <div className="flex items-center gap-2">
      <span className={cn("text-lg font-bold", textColor)}>{score}</span>
      <div className="flex-1">
        <div className="h-2 rounded-full bg-muted/20 overflow-hidden">
          <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${score}%` }} />
        </div>
        <span className="text-[10px] text-muted">Deal 健康度</span>
      </div>
    </div>
  );
}

export function AiAdvicePanel({ customerId }: { customerId: string }) {
  const [advice, setAdvice] = useState<string | null>(null);
  const [profile, setProfile] = useState<AiProfile | null>(null);
  const [dealHealth, setDealHealth] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const fetchAdvice = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/sales/customers/${customerId}/ai-advice`, {
        method: "POST",
      });
      if (res.ok) {
        const data = await res.json();
        setAdvice(data.advice || null);
        setProfile(data.profile || null);
        setDealHealth(data.dealHealth || 0);
        setExpanded(true);
      }
    } catch (err) {
      console.error("AI advice failed:", err);
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  return (
    <div className="rounded-xl border border-accent/20 bg-accent/[0.02]">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-accent" />
          <h3 className="text-sm font-semibold text-foreground">AI 销售助手</h3>
          {profile && (
            <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
              画像置信度 {((profile.confidence ?? 0) * 100).toFixed(0)}%
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {advice && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-[11px] text-muted hover:text-foreground"
            >
              {expanded ? "收起" : "展开"}
            </button>
          )}
          <button
            onClick={fetchAdvice}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded-lg bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent hover:bg-accent/20 disabled:opacity-50 transition-colors"
          >
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : advice ? (
              <RefreshCw className="h-3 w-3" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            {advice ? "重新分析" : "AI 分析"}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-accent/10">
          {(profile || dealHealth > 0) && (
            <div className="px-4 py-3 space-y-3">
              {dealHealth > 0 && <HealthBar score={dealHealth} />}

              {profile && (
                <div className="flex flex-wrap gap-2">
                  <ProfileBadge label="类型" value={profile.customerType} />
                  <ProfileBadge label="预算" value={profile.budgetRange} />
                  <ProfileBadge label="决策" value={profile.decisionSpeed} />
                  <ProfileBadge label="沟通" value={profile.communicationStyle} />
                  {profile.winProbability != null && (
                    <div className="flex flex-col items-center gap-0.5 rounded-lg bg-white/60 border border-border/50 px-2.5 py-1.5 min-w-[70px]">
                      <span className="text-[10px] text-muted">赢率</span>
                      <span className={cn(
                        "text-xs font-bold",
                        profile.winProbability >= 0.6 ? "text-emerald-600" : profile.winProbability >= 0.3 ? "text-amber-600" : "text-red-600"
                      )}>
                        {(profile.winProbability * 100).toFixed(0)}%
                      </span>
                    </div>
                  )}
                  {profile.priceSensitivity != null && (
                    <div className="flex flex-col items-center gap-0.5 rounded-lg bg-white/60 border border-border/50 px-2.5 py-1.5 min-w-[70px]">
                      <span className="text-[10px] text-muted">价格敏感</span>
                      <span className="text-xs font-medium text-foreground">
                        {profile.priceSensitivity >= 0.7 ? "高" : profile.priceSensitivity >= 0.4 ? "中" : "低"}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {profile?.keyNeeds && (profile.keyNeeds as string[]).length > 0 && (
                <div className="flex flex-wrap gap-1">
                  <span className="text-[10px] text-muted mr-1">需求:</span>
                  {(profile.keyNeeds as string[]).map((n, i) => (
                    <span key={i} className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] text-blue-700">
                      {n}
                    </span>
                  ))}
                </div>
              )}

              {profile?.objectionHistory && (profile.objectionHistory as string[]).length > 0 && (
                <div className="flex flex-wrap gap-1">
                  <span className="text-[10px] text-muted mr-1">异议:</span>
                  {(profile.objectionHistory as string[]).map((o, i) => (
                    <span key={i} className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] text-red-700">
                      {o}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {advice && (
            <div className="border-t border-accent/10 px-4 py-3">
              <div className="prose-ai text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                {advice}
              </div>
            </div>
          )}
        </div>
      )}

      {!advice && !loading && (
        <div className="px-4 pb-3">
          <p className="text-xs text-muted/60">
            点击"AI 分析"，AI 将综合客户画像、知识库和历史数据给出策略建议
          </p>
        </div>
      )}
    </div>
  );
}
