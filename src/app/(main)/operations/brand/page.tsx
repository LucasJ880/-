"use client";

/**
 * 品牌记忆中枢 — 每组织一份品牌语料
 * 文案变体引擎与所有运营内容技能自动引用（{{brandContext}} 注入）。
 */

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Save } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { useCurrentOrgId } from "@/lib/hooks/use-current-org-id";
import { OrgSelectBanner } from "@/components/org-select-banner";
import { cn } from "@/lib/utils";

interface BrandProfile {
  brandName: string;
  tagline: string | null;
  positioning: string | null;
  sellingPoints: string | null;
  targetAudience: string | null;
  toneOfVoice: string | null;
  serviceScope: string | null;
  caseStudies: string | null;
  forbiddenClaims: string | null;
  updatedAt?: string;
}

const EMPTY: BrandProfile = {
  brandName: "",
  tagline: null,
  positioning: null,
  sellingPoints: null,
  targetAudience: null,
  toneOfVoice: null,
  serviceScope: null,
  caseStudies: null,
  forbiddenClaims: null,
};

const TEXTAREA_FIELDS: Array<{
  key: keyof BrandProfile;
  label: string;
  placeholder: string;
  rows?: number;
}> = [
  {
    key: "positioning",
    label: "品牌定位与故事",
    placeholder: "我们是谁、为谁服务、凭什么不同（如：面向北美商业与家庭的智能遮阳系统…）",
    rows: 3,
  },
  {
    key: "sellingPoints",
    label: "核心卖点（一行一条）",
    placeholder: "电动遮阳帘节能改造\n全国上门测量安装\nLutron/Somfy 等大厂电机",
    rows: 4,
  },
  {
    key: "targetAudience",
    label: "目标客群",
    placeholder: "商业楼宇业主、连锁品牌门店、高端住宅业主…",
    rows: 2,
  },
  {
    key: "toneOfVoice",
    label: "语气与声音",
    placeholder: "家的温暖 + 绿色能源专业感；亲切但不过度促销",
    rows: 2,
  },
  {
    key: "serviceScope",
    label: "服务范围",
    placeholder: "加拿大全国服务；多伦多本地上门测量…",
    rows: 2,
  },
  {
    key: "caseStudies",
    label: "代表案例（一行一条）",
    placeholder: "BMO、TD Bank、PCL、Mott 32…",
    rows: 3,
  },
  {
    key: "forbiddenClaims",
    label: "内容禁忌（一行一条）",
    placeholder: "不承诺终身质保\n不出现「全网最低价」\n不贬低竞品品牌名",
    rows: 3,
  },
];

export default function BrandProfilePage() {
  const { orgId, ambiguous, loading: orgLoading } = useCurrentOrgId();
  const [profile, setProfile] = useState<BrandProfile>(EMPTY);
  const [exists, setExists] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/operations/brand-profile");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "加载失败");
      if (data.profile) {
        setProfile(data.profile);
        setExists(true);
      } else {
        setProfile(EMPTY);
        setExists(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (orgLoading || ambiguous) return;
    load();
  }, [orgLoading, ambiguous, orgId, load]);

  function setField(key: keyof BrandProfile, value: string) {
    setProfile((p) => ({ ...p, [key]: value }));
    setSavedAt(null);
  }

  async function handleSave() {
    if (!profile.brandName.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch("/api/operations/brand-profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, ...profile }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存失败");
      setProfile(data.profile);
      setExists(true);
      setSavedAt(new Date().toLocaleTimeString());
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">品牌记忆</h1>
          <p className="mt-1 text-sm text-muted">
            本组织的统一品牌语料。文案变体引擎与所有内容技能会自动引用，保证矩阵全部账号口径一致、不触碰内容禁忌。
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-muted transition-colors hover:bg-background"
        >
          <RefreshCw size={14} className={cn(loading && "animate-spin")} />
          刷新
        </button>
      </div>

      <OrgSelectBanner />

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      {!loading && !exists && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          尚未配置品牌档案。配置前，AI 生成的文案只依赖每次输入，不带统一品牌口径。
        </div>
      )}

      <div className="space-y-3 rounded-xl border border-border bg-card-bg p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-xs text-muted">
            品牌名 *
            <input
              value={profile.brandName}
              onChange={(e) => setField("brandName", e.target.value)}
              placeholder="Sunny Shutter"
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
            />
          </label>
          <label className="space-y-1 text-xs text-muted">
            一句话定位 / slogan
            <input
              value={profile.tagline ?? ""}
              onChange={(e) => setField("tagline", e.target.value)}
              placeholder="SmartShade Retrofit & Energy Optimization"
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
            />
          </label>
        </div>

        {TEXTAREA_FIELDS.map(({ key, label, placeholder, rows }) => (
          <label key={key} className="block space-y-1 text-xs text-muted">
            {label}
            <textarea
              value={(profile[key] as string | null) ?? ""}
              onChange={(e) => setField(key, e.target.value)}
              placeholder={placeholder}
              rows={rows ?? 3}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
            />
          </label>
        ))}

        <div className="flex items-center justify-end gap-3 pt-1">
          {savedAt && <span className="text-xs text-muted">已保存 {savedAt}</span>}
          <button
            type="button"
            onClick={handleSave}
            disabled={!profile.brandName.trim() || saving}
            className="flex items-center gap-1.5 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Save size={14} />
            {saving ? "保存中…" : "保存品牌档案"}
          </button>
        </div>
      </div>
    </div>
  );
}
