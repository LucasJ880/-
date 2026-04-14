"use client";

import { useEffect, useState } from "react";
import {
  Search,
  Loader2,
  Upload,
  Database,
  Sparkles,
  RefreshCw,
  FileText,
  MessageSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select as ShadSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function RAGPanel() {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{
    chunks?: Array<{ id: string; content: string; similarity: number; sentiment: string | null; intent: string | null; tags: string[]; isWinPattern: boolean }>;
    insights?: Array<{ id: string; title: string; description: string; similarity: number; effectiveness: number }>;
    knowledgeBaseSize?: number;
  } | null>(null);
  const [searching, setSearching] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [uploadText, setUploadText] = useState("");
  const [uploadSource, setUploadSource] = useState("bulk_upload");
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ total: number; indexed: number; errors: string[] } | null>(null);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState<{ processed: number; errors: string[] } | null>(null);
  const [initializing, setInitializing] = useState(false);
  const [extractingInsights, setExtractingInsights] = useState(false);
  const [refreshingProfiles, setRefreshingProfiles] = useState(false);
  const [stats, setStats] = useState<{ chunks: number; insights: number; profiles: number } | null>(null);

  useEffect(() => {
    loadStats();
  }, []);

  async function loadStats() {
    try {
      const [chunkRes, insightRes, profileRes] = await Promise.all([
        apiFetch("/api/sales/knowledge/search", {
          method: "POST",
          body: JSON.stringify({ query: "sales", mode: "hybrid", limit: 1 }),
        }),
        apiFetch("/api/sales/knowledge/insights"),
        apiFetch("/api/sales/knowledge/profile"),
      ]);
      const chunkData = await chunkRes.json();
      const insightData = await insightRes.json();
      const profileData = await profileRes.json();
      setStats({
        chunks: chunkData.knowledgeBaseSize ?? 0,
        insights: insightData.stats?.total ?? 0,
        profiles: profileData.stats?.total ?? 0,
      });
    } catch {
      setStats({ chunks: 0, insights: 0, profiles: 0 });
    }
  }

  async function handleSearch() {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await apiFetch("/api/sales/knowledge/search", {
        method: "POST",
        body: JSON.stringify({ query: searchQuery, mode: "hybrid", limit: 8 }),
      });
      const data = await res.json();
      setSearchResults(data);
    } catch (err) {
      console.error("Search failed:", err);
    } finally {
      setSearching(false);
    }
  }

  async function handleUpload() {
    if (!uploadText.trim()) return;
    setUploading(true);
    setUploadResult(null);
    try {
      const res = await apiFetch("/api/sales/knowledge/upload", {
        method: "POST",
        body: JSON.stringify({ format: "text", content: uploadText, sourceType: uploadSource }),
      });
      const data = await res.json();
      setUploadResult(data);
      if (data.success) {
        setUploadText("");
        loadStats();
      }
    } catch (err) {
      setUploadResult({ total: 0, indexed: 0, errors: [String(err)] });
    } finally {
      setUploading(false);
    }
  }

  async function handleBackfill() {
    setBackfilling(true);
    setBackfillResult(null);
    try {
      const res = await apiFetch("/api/sales/knowledge/backfill", {
        method: "POST",
        body: JSON.stringify({ limit: 50 }),
      });
      const data = await res.json();
      setBackfillResult(data);
      loadStats();
    } catch (err) {
      setBackfillResult({ processed: 0, errors: [String(err)] });
    } finally {
      setBackfilling(false);
    }
  }

  async function handleInitIndex() {
    setInitializing(true);
    try {
      await apiFetch("/api/sales/knowledge/init", { method: "POST" });
    } catch (err) {
      console.error("Init failed:", err);
    } finally {
      setInitializing(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-border bg-white/70 p-4">
          <div className="flex items-center gap-2 text-muted">
            <Database className="h-4 w-4" />
            <span className="text-xs font-medium">知识分块</span>
          </div>
          <p className="mt-1 text-2xl font-semibold">{stats?.chunks ?? "—"}</p>
        </div>
        <div className="rounded-xl border border-border bg-white/70 p-4">
          <div className="flex items-center gap-2 text-muted">
            <Sparkles className="h-4 w-4" />
            <span className="text-xs font-medium">AI 洞察</span>
          </div>
          <p className="mt-1 text-2xl font-semibold">{stats?.insights ?? "—"}</p>
        </div>
        <div className="rounded-xl border border-border bg-white/70 p-4">
          <div className="flex items-center gap-2 text-muted">
            <MessageSquare className="h-4 w-4" />
            <span className="text-xs font-medium">客户画像</span>
          </div>
          <p className="mt-1 text-2xl font-semibold">{stats?.profiles ?? "—"}</p>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-3">
        <Button onClick={() => setShowUpload(true)} className="gap-1.5">
          <Upload className="h-4 w-4" />
          上传沟通记录
        </Button>
        <Button variant="outline" onClick={handleBackfill} disabled={backfilling} className="gap-1.5">
          {backfilling ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          索引已有互动记录
        </Button>
        <Button variant="outline" onClick={handleInitIndex} disabled={initializing} className="gap-1.5">
          {initializing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
          初始化向量索引
        </Button>
        <Button
          variant="outline"
          onClick={async () => {
            setExtractingInsights(true);
            try {
              await apiFetch("/api/sales/knowledge/insights", {
                method: "POST",
                body: JSON.stringify({ lookbackDays: 90 }),
              });
              loadStats();
            } catch {}
            setExtractingInsights(false);
          }}
          disabled={extractingInsights}
          className="gap-1.5"
        >
          {extractingInsights ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          提炼赢单模式
        </Button>
        <Button
          variant="outline"
          onClick={async () => {
            setRefreshingProfiles(true);
            try {
              await apiFetch("/api/sales/knowledge/profile", {
                method: "POST",
                body: JSON.stringify({ action: "refresh_all", limit: 50 }),
              });
              loadStats();
            } catch {}
            setRefreshingProfiles(false);
          }}
          disabled={refreshingProfiles}
          className="gap-1.5"
        >
          {refreshingProfiles ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />}
          刷新客户画像
        </Button>
      </div>

      {backfillResult && (
        <div className={cn("rounded-lg px-4 py-3 text-sm", backfillResult.errors.length > 0 ? "bg-amber-50 text-amber-800" : "bg-green-50 text-green-800")}>
          已索引 {backfillResult.processed} 条互动记录
          {backfillResult.errors.length > 0 && ` (${backfillResult.errors.length} 个错误)`}
        </div>
      )}

      {/* Semantic search */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-foreground">语义搜索</h3>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              type="text"
              placeholder="输入搜索词，如 客户嫌贵怎么回应、zebra blinds installation…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="w-full rounded-lg border border-border bg-white/80 py-2 pl-9 pr-3 text-sm placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-foreground/20"
            />
          </div>
          <Button onClick={handleSearch} disabled={searching || !searchQuery.trim()}>
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            搜索
          </Button>
        </div>

        {searchResults && (
          <div className="space-y-4">
            {searchResults.insights && searchResults.insights.length > 0 && (
              <div className="space-y-2">
                <h4 className="flex items-center gap-1.5 text-xs font-medium text-muted">
                  <Sparkles className="h-3.5 w-3.5" />
                  AI 洞察
                </h4>
                {searchResults.insights.map((insight) => (
                  <div key={insight.id} className="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
                    <div className="flex items-start justify-between">
                      <p className="text-sm font-medium text-foreground">{insight.title}</p>
                      <Badge variant="outline" className="text-[10px] shrink-0 ml-2">
                        {(insight.similarity * 100).toFixed(0)}% 相关
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted line-clamp-3">{insight.description}</p>
                  </div>
                ))}
              </div>
            )}

            {searchResults.chunks && searchResults.chunks.length > 0 && (
              <div className="space-y-2">
                <h4 className="flex items-center gap-1.5 text-xs font-medium text-muted">
                  <FileText className="h-3.5 w-3.5" />
                  相关沟通片段 ({searchResults.chunks.length})
                </h4>
                {searchResults.chunks.map((chunk) => (
                  <div key={chunk.id} className="rounded-lg border border-border bg-white/70 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm text-foreground line-clamp-4">{chunk.content}</p>
                      <span className="shrink-0 text-[10px] text-muted">
                        {(chunk.similarity * 100).toFixed(0)}%
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {chunk.intent && (
                        <Badge variant="outline" className="text-[10px]">{chunk.intent}</Badge>
                      )}
                      {chunk.sentiment && (
                        <Badge variant={chunk.sentiment === "positive" ? "default" : "secondary"} className="text-[10px]">
                          {chunk.sentiment}
                        </Badge>
                      )}
                      {chunk.isWinPattern && (
                        <Badge className="bg-green-100 text-green-700 text-[10px]">赢单模式</Badge>
                      )}
                      {chunk.tags?.slice(0, 3).map((tag) => (
                        <Badge key={tag} variant="secondary" className="text-[10px]">{tag}</Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {(!searchResults.chunks || searchResults.chunks.length === 0) &&
             (!searchResults.insights || searchResults.insights.length === 0) && (
              <div className="text-center py-8 text-muted text-sm">
                未找到相关结果，试试上传更多沟通记录
              </div>
            )}
          </div>
        )}
      </div>

      {/* Upload dialog */}
      <Dialog open={showUpload} onOpenChange={setShowUpload}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>上传沟通记录</DialogTitle>
            <DialogDescription>
              粘贴客户沟通内容（邮件、微信聊天、通话记录），AI 将自动分析并索引到知识库。
              多段内容可用 --- 分隔。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>来源类型</Label>
              <ShadSelect value={uploadSource} onValueChange={setUploadSource}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">邮件</SelectItem>
                  <SelectItem value="wechat">微信聊天</SelectItem>
                  <SelectItem value="call_transcript">通话记录</SelectItem>
                  <SelectItem value="note">备忘/笔记</SelectItem>
                  <SelectItem value="bulk_upload">批量导入</SelectItem>
                </SelectContent>
              </ShadSelect>
            </div>

            <div className="space-y-1.5">
              <Label>沟通内容 *</Label>
              <textarea
                className="flex w-full rounded-lg border border-border bg-white/80 px-3 py-2 text-sm transition-colors placeholder:text-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20 h-64 resize-none font-mono"
                placeholder={`粘贴沟通内容，例：\n\nCustomer: Hi, I'm interested in zebra blinds for my living room.\nSales: Great choice! Zebra blinds offer both privacy and light control. What size windows do you have?\nCustomer: About 72 inches wide. What's the price range?\nSales: For 72" width, our premium zebra blinds start at $189. We're running a 15% off promotion this month.\n\n---\n\n（多段内容用 --- 分隔）`}
                value={uploadText}
                onChange={(e) => setUploadText(e.target.value)}
              />
            </div>

            {uploadResult && (
              <div className={cn(
                "rounded-lg px-4 py-3 text-sm",
                uploadResult.errors.length > 0
                  ? "bg-amber-50 text-amber-800"
                  : "bg-green-50 text-green-800"
              )}>
                {uploadResult.indexed > 0
                  ? `成功索引 ${uploadResult.indexed}/${uploadResult.total} 段内容`
                  : "索引失败"}
                {uploadResult.errors.length > 0 && (
                  <p className="mt-1 text-xs">{uploadResult.errors[0]}</p>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setShowUpload(false)}>取消</Button>
            <Button onClick={handleUpload} disabled={!uploadText.trim() || uploading}>
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {uploading ? "分析索引中…" : "上传并索引"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
