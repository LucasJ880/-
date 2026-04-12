"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Phone,
  Mail,
  Globe,
  MapPin,
  Clock,
  Tags,
  Brain,
  Sparkles,
  Star,
  FolderKanban,
  FileText,
  Loader2,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SupplierHistory } from "@/components/supplier/supplier-history";

/* ── Types ── */
interface SupplierDetail {
  id: string;
  orgId: string;
  name: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  category: string | null;
  region: string | null;
  notes: string | null;
  website: string | null;
  source: string | null;
  sourceDetail: string | null;
  tags: string | null;
  capabilities: string | null;
  aiClassification: {
    mainCategory?: string;
    subCategories?: string[];
    confidence?: number;
    classifiedAt?: string;
  } | null;
  rating: number | null;
  ratingDetail: {
    quality?: number;
    response?: number;
    price?: number;
    delivery?: number;
  } | null;
  lastContactAt: string | null;
  status: string;
  createdAt: string;
}

const SOURCE_LABELS: Record<string, string> = {
  exhibition: "展会",
  referral: "转介绍",
  online: "线上搜索",
  xiaohongshu: "小红书",
  "1688": "1688",
  cold_call: "陌生拜访",
  other: "其他",
};

const CATEGORY_LABELS: Record<string, string> = {
  blinds_fabric: "窗帘面料",
  blinds_components: "窗饰配件",
  blinds_finished: "成品窗饰",
  textile_yarn: "纱线",
  textile_fabric: "面料",
  textile_finishing: "后整理",
  hardware: "五金",
  packaging: "包装",
  logistics: "物流",
  testing: "检测认证",
  design: "设计打样",
  trading: "贸易公司",
  other: "其他",
};

const RATING_DIMS = [
  { key: "quality", label: "质量", icon: "🏭" },
  { key: "response", label: "响应速度", icon: "⚡" },
  { key: "price", label: "价格竞争力", icon: "💰" },
  { key: "delivery", label: "交付准时", icon: "📦" },
] as const;

/* ── Page ── */
export default function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [supplier, setSupplier] = useState<SupplierDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [classifying, setClassifying] = useState(false);
  const [ratingEdit, setRatingEdit] = useState(false);
  const [ratingValues, setRatingValues] = useState({
    quality: 0, response: 0, price: 0, delivery: 0,
  });

  const loadSupplier = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/suppliers/${id}`);
      if (!res.ok) {
        router.push("/suppliers");
        return;
      }
      const data = await res.json();
      setSupplier(data);
      if (data.ratingDetail) {
        setRatingValues({
          quality: data.ratingDetail.quality || 0,
          response: data.ratingDetail.response || 0,
          price: data.ratingDetail.price || 0,
          delivery: data.ratingDetail.delivery || 0,
        });
      }
    } catch {
      router.push("/suppliers");
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    loadSupplier();
  }, [loadSupplier]);

  const handleClassify = async () => {
    setClassifying(true);
    try {
      await apiFetch(`/api/suppliers/${id}/classify`, { method: "POST" });
      await loadSupplier();
    } catch {
      alert("AI 分类失败");
    } finally {
      setClassifying(false);
    }
  };

  const handleSaveRating = async () => {
    const avg =
      (ratingValues.quality + ratingValues.response + ratingValues.price + ratingValues.delivery) / 4;
    await apiFetch(`/api/suppliers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rating: Math.round(avg * 10) / 10,
        ratingDetail: ratingValues,
      }),
    });
    setRatingEdit(false);
    loadSupplier();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (!supplier) return null;

  const tagList = supplier.tags ? supplier.tags.split(",").filter(Boolean) : [];
  const aiClass = supplier.aiClassification;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/suppliers"
          className="rounded-lg border border-border bg-white/80 p-1.5 text-muted hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <PageHeader
          title={supplier.name}
          description={`${supplier.source ? SOURCE_LABELS[supplier.source] || supplier.source : "供应商"} · ${supplier.region || "未知地区"} · ${new Date(supplier.createdAt).toLocaleDateString("zh-CN")} 创建`}
        />
        <div className="ml-auto flex items-center gap-2">
          <span className={cn(
            "rounded-full px-2.5 py-1 text-xs font-medium",
            supplier.status === "active"
              ? "bg-[rgba(46,122,86,0.08)] text-[#2e7a56]"
              : "bg-[rgba(110,125,118,0.08)] text-[#6e7d76]"
          )}>
            {supplier.status === "active" ? "活跃" : "停用"}
          </span>
        </div>
      </div>

      {/* Top cards */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Contact info */}
        <div className="rounded-xl border border-border bg-white/70 p-5">
          <h3 className="text-sm font-semibold text-foreground">联系信息</h3>
          <div className="mt-3 space-y-2.5 text-sm">
            {supplier.contactName && (
              <div className="flex items-center gap-2 text-foreground font-medium">
                {supplier.contactName}
              </div>
            )}
            {supplier.contactPhone && (
              <div className="flex items-center gap-2 text-muted">
                <Phone className="h-4 w-4 shrink-0" />
                <a href={`tel:${supplier.contactPhone}`} className="hover:text-foreground">
                  {supplier.contactPhone}
                </a>
              </div>
            )}
            {supplier.contactEmail && (
              <div className="flex items-center gap-2 text-muted">
                <Mail className="h-4 w-4 shrink-0" />
                <a href={`mailto:${supplier.contactEmail}`} className="hover:text-foreground">
                  {supplier.contactEmail}
                </a>
              </div>
            )}
            {supplier.website && (
              <div className="flex items-center gap-2 text-muted">
                <Globe className="h-4 w-4 shrink-0" />
                <a
                  href={supplier.website.startsWith("http") ? supplier.website : `https://${supplier.website}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground inline-flex items-center gap-1"
                >
                  {supplier.website.replace(/^https?:\/\//, "")}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
            {supplier.region && (
              <div className="flex items-center gap-2 text-muted">
                <MapPin className="h-4 w-4 shrink-0" />
                <span>{supplier.region}</span>
              </div>
            )}
            {supplier.lastContactAt && (
              <div className="flex items-center gap-2 text-muted">
                <Clock className="h-4 w-4 shrink-0" />
                <span>最近联系: {new Date(supplier.lastContactAt).toLocaleDateString("zh-CN")}</span>
              </div>
            )}
          </div>
          {supplier.sourceDetail && (
            <div className="mt-3 rounded-lg bg-foreground/[0.03] px-3 py-2 text-xs text-muted">
              来源: {supplier.sourceDetail}
            </div>
          )}
          {supplier.notes && (
            <div className="mt-3 rounded-lg bg-white/50 p-3 text-xs text-muted leading-relaxed">
              {supplier.notes}
            </div>
          )}
        </div>

        {/* AI Classification */}
        <div className="rounded-xl border border-border bg-white/70 p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
              <Brain className="h-4 w-4 text-accent" />
              AI 分类
            </h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClassify}
              disabled={classifying}
              className="h-7 px-2 text-xs"
            >
              {classifying ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              {supplier.tags ? "重新分类" : "AI 分类"}
            </Button>
          </div>

          {aiClass?.mainCategory && (
            <div className="mt-3">
              <Badge className="bg-accent/10 text-accent">
                {CATEGORY_LABELS[aiClass.mainCategory] || aiClass.mainCategory}
              </Badge>
              {aiClass.subCategories && aiClass.subCategories.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {aiClass.subCategories.map((sub) => (
                    <Badge key={sub} variant="outline" className="text-[10px]">
                      {sub}
                    </Badge>
                  ))}
                </div>
              )}
              {aiClass.confidence !== undefined && (
                <p className="mt-2 text-[10px] text-muted">
                  置信度: {Math.round(aiClass.confidence * 100)}%
                  {aiClass.classifiedAt &&
                    ` · ${new Date(aiClass.classifiedAt).toLocaleDateString("zh-CN")}`}
                </p>
              )}
            </div>
          )}

          {tagList.length > 0 && (
            <div className="mt-3">
              <p className="text-[11px] text-muted mb-1.5 flex items-center gap-1">
                <Tags className="h-3 w-3" />
                标签
              </p>
              <div className="flex flex-wrap gap-1.5">
                {tagList.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-[11px]">
                    {tag.trim()}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {supplier.capabilities && (
            <div className="mt-3">
              <p className="text-[11px] text-muted mb-1">能力画像</p>
              <p className="text-xs text-foreground/80 leading-relaxed">
                {supplier.capabilities}
              </p>
            </div>
          )}

          {!aiClass?.mainCategory && tagList.length === 0 && !classifying && (
            <div className="mt-4 flex flex-col items-center py-4 text-muted">
              <Sparkles className="h-6 w-6 opacity-30" />
              <p className="mt-2 text-xs">
                点击"AI 分类"自动分析
              </p>
            </div>
          )}
        </div>

        {/* Rating */}
        <div className="rounded-xl border border-border bg-white/70 p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
              <Star className="h-4 w-4 text-amber-500" />
              评分
            </h3>
            {!ratingEdit ? (
              <button
                onClick={() => setRatingEdit(true)}
                className="text-xs text-accent hover:underline"
              >
                编辑
              </button>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => setRatingEdit(false)}
                  className="text-xs text-muted hover:text-foreground"
                >
                  取消
                </button>
                <button
                  onClick={handleSaveRating}
                  className="text-xs font-medium text-accent hover:underline"
                >
                  保存
                </button>
              </div>
            )}
          </div>

          {supplier.rating !== null && supplier.rating > 0 && (
            <div className="mt-3 flex items-center gap-2">
              <div className="flex items-center gap-0.5">
                {[1, 2, 3, 4, 5].map((s) => (
                  <Star
                    key={s}
                    className={cn(
                      "h-5 w-5",
                      s <= Math.round(supplier.rating || 0)
                        ? "fill-amber-400 text-amber-400"
                        : "text-gray-200"
                    )}
                  />
                ))}
              </div>
              <span className="text-lg font-semibold text-foreground">
                {supplier.rating?.toFixed(1)}
              </span>
            </div>
          )}

          <div className="mt-3 space-y-2">
            {RATING_DIMS.map((dim) => {
              const value = ratingEdit
                ? ratingValues[dim.key]
                : (supplier.ratingDetail as Record<string, number> | null)?.[dim.key] || 0;
              return (
                <div key={dim.key} className="flex items-center gap-2">
                  <span className="w-5 text-center text-sm">{dim.icon}</span>
                  <span className="w-20 text-xs text-muted">{dim.label}</span>
                  <div className="flex-1">
                    {ratingEdit ? (
                      <div className="flex items-center gap-1">
                        {[1, 2, 3, 4, 5].map((s) => (
                          <button
                            key={s}
                            onClick={() =>
                              setRatingValues((prev) => ({ ...prev, [dim.key]: s }))
                            }
                            className="p-0.5"
                          >
                            <Star
                              className={cn(
                                "h-4 w-4",
                                s <= value
                                  ? "fill-amber-400 text-amber-400"
                                  : "text-gray-200 hover:text-amber-200"
                              )}
                            />
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <div className="h-2 flex-1 rounded-full bg-foreground/5">
                          <div
                            className="h-full rounded-full bg-amber-400 transition-all"
                            style={{ width: `${(value / 5) * 100}%` }}
                          />
                        </div>
                        <span className="w-6 text-right text-[10px] text-muted">
                          {value > 0 ? value : "—"}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {!supplier.rating && !ratingEdit && (
            <p className="mt-3 text-center text-xs text-muted/60">
              暂未评分，点击"编辑"添加
            </p>
          )}
        </div>
      </div>

      {/* History */}
      <div className="rounded-xl border border-border bg-white/70 p-5">
        <div className="flex items-center gap-2 mb-4">
          <FolderKanban className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">合作历史</h3>
        </div>
        <SupplierHistory supplierId={supplier.id} />
      </div>
    </div>
  );
}
