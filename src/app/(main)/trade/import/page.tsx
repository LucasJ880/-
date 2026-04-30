"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Loader2, FileSpreadsheet, CheckCircle2, AlertCircle } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";
import { useCurrentOrgId } from "@/lib/hooks/use-current-org-id";

interface Campaign {
  id: string;
  name: string;
}

export default function TradeImportPage() {
  const router = useRouter();
  const { orgId, ambiguous, loading: orgLoading } = useCurrentOrgId();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState("");
  const [source, setSource] = useState("exhibition");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{
    total: number;
    created: number;
    skipped: number;
    errors: string[];
  } | null>(null);

  const loadCampaigns = useCallback(async () => {
    if (!orgId || ambiguous) {
      setCampaigns([]);
      return;
    }
    const res = await apiFetch(`/api/trade/campaigns?orgId=${encodeURIComponent(orgId)}`);
    if (res.ok) {
      const data = (await res.json()) as Campaign[];
      setCampaigns(data);
      setCampaignId((prev) => prev || data[0]?.id || "");
    } else {
      setCampaigns([]);
    }
  }, [orgId, ambiguous]);

  useEffect(() => {
    if (orgLoading) return;
    void loadCampaigns();
  }, [loadCampaigns, orgLoading]);

  const handleUpload = async () => {
    if (!file || !campaignId || !orgId || ambiguous) return;
    setUploading(true);
    setResult(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("campaignId", campaignId);
    formData.append("orgId", orgId);
    formData.append("source", source);

    try {
      const res = await apiFetch("/api/trade/prospects/import", {
        method: "POST",
        body: formData,
      });
      if (res.ok) {
        setResult(await res.json());
        setFile(null);
      } else {
        const err = await res.json();
        setResult({ total: 0, created: 0, skipped: 0, errors: [err.error ?? "上传失败"] });
      }
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="展会/名片导入"
        description="上传 CSV 或 Excel 文件，批量创建线索"
      />

      {orgLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted" />
        </div>
      ) : !orgId || ambiguous ? (
        <div className="space-y-4 py-16 text-center">
          <p className="text-sm text-muted">请先选择当前组织后再使用导入。</p>
          <button type="button" onClick={() => router.push("/organizations")} className="text-sm text-accent underline-offset-2 hover:underline">
            前往组织
          </button>
        </div>
      ) : (
      <div className="mx-auto max-w-lg space-y-4 rounded-xl border border-border/60 bg-card-bg p-6">
        {/* Campaign Select */}
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">目标活动</label>
          <select
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-blue-500 focus:outline-none"
          >
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        {/* Source */}
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">来源</label>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-blue-500 focus:outline-none"
          >
            <option value="exhibition">展会</option>
            <option value="1688">1688</option>
            <option value="linkedin">LinkedIn</option>
            <option value="manual">手动收集</option>
            <option value="other">其他</option>
          </select>
        </div>

        {/* File Upload */}
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">上传文件</label>
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border bg-background px-6 py-8 transition hover:border-blue-500/50">
            <FileSpreadsheet className="h-8 w-8 text-muted" />
            <span className="text-sm text-muted">
              {file ? file.name : "点击选择 CSV / Excel 文件"}
            </span>
            <span className="text-[10px] text-muted">
              文件需包含"公司名称"列（支持中英文列名自动识别）
            </span>
            <input
              type="file"
              accept=".csv,.txt,.xlsx,.xls"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>

        <button
          onClick={handleUpload}
          disabled={uploading || !file || !campaignId}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
        >
          {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
          {uploading ? "导入中..." : "开始导入"}
        </button>

        {/* Result */}
        {result && (
          <div className={`rounded-lg p-4 ${result.errors.length > 0 && result.created === 0 ? "bg-red-500/10" : "bg-emerald-500/10"}`}>
            <div className="flex items-center gap-2">
              {result.created > 0 ? (
                <CheckCircle2 size={16} className="text-emerald-400" />
              ) : (
                <AlertCircle size={16} className="text-red-400" />
              )}
              <span className="text-sm font-medium text-foreground">
                解析 {result.total} 条，成功导入 {result.created} 条，跳过 {result.skipped} 条（重复）
              </span>
            </div>
            {result.errors.length > 0 && (
              <div className="mt-2 space-y-1">
                {result.errors.map((e, i) => (
                  <p key={i} className="text-xs text-red-400">{e}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      )}
    </div>
  );
}
