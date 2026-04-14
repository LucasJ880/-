"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  BookOpen,
  HelpCircle,
  Search,
  Plus,
  Star,
  Archive,
  Loader2,
  Copy,
  Check,
  Pencil,
  Trash2,
  Brain,
  Upload,
  Database,
  Sparkles,
  RefreshCw,
  FileText,
  MessageSquare,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select as ShadSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/* ── Constants ── */
const SCENES = [
  { key: "all", label: "全部场景" },
  { key: "first_contact", label: "首次接触" },
  { key: "follow_up", label: "跟进回访" },
  { key: "price_objection", label: "价格异议" },
  { key: "product_intro", label: "产品介绍" },
  { key: "closing", label: "促单成交" },
  { key: "after_sale", label: "售后关怀" },
  { key: "upsell", label: "追加推荐" },
  { key: "measurement", label: "预约测量" },
  { key: "installation", label: "安装安排" },
];

const CHANNELS = [
  { key: "all", label: "全部渠道" },
  { key: "wechat", label: "微信" },
  { key: "xiaohongshu", label: "小红书" },
  { key: "facebook", label: "Facebook" },
  { key: "email", label: "邮件" },
];

const FAQ_CATEGORIES = [
  { key: "all", label: "全部分类" },
  { key: "product", label: "产品相关" },
  { key: "pricing", label: "价格相关" },
  { key: "installation", label: "安装相关" },
  { key: "warranty", label: "保修售后" },
  { key: "delivery", label: "交付物流" },
  { key: "process", label: "流程说明" },
  { key: "measurement", label: "测量相关" },
  { key: "other", label: "其他" },
];

const CHANNEL_COLORS: Record<string, string> = {
  wechat: "bg-green-100 text-green-700",
  xiaohongshu: "bg-red-100 text-red-700",
  facebook: "bg-blue-100 text-blue-700",
  email: "bg-amber-100 text-amber-700",
  phone: "bg-purple-100 text-purple-700",
};

/* ── Types ── */
interface Playbook {
  id: string;
  channel: string;
  language: string;
  scene: string;
  sceneLabel: string;
  content: string;
  example: string | null;
  effectiveness: number;
  tags: string | null;
  usageCount: number;
  createdAt: string;
}

interface FAQ {
  id: string;
  question: string;
  answer: string;
  language: string;
  category: string;
  categoryLabel: string;
  productTags: string | null;
  frequency: number;
  createdAt: string;
}

type Tab = "playbooks" | "faqs" | "rag";

/* ── Page ── */
export default function KnowledgePage() {
  const [tab, setTab] = useState<Tab>("rag");
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [faqs, setFaqs] = useState<FAQ[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [channelFilter, setChannelFilter] = useState("all");
  const [sceneFilter, setSceneFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [showNewPlaybook, setShowNewPlaybook] = useState(false);
  const [showNewFAQ, setShowNewFAQ] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === "playbooks") {
        const params = new URLSearchParams();
        if (channelFilter !== "all") params.set("channel", channelFilter);
        if (sceneFilter !== "all") params.set("scene", sceneFilter);
        if (search) params.set("q", search);
        const res = await apiFetch(`/api/sales/playbooks?${params}`);
        setPlaybooks(await res.json());
      } else {
        const params = new URLSearchParams();
        if (categoryFilter !== "all") params.set("category", categoryFilter);
        if (search) params.set("q", search);
        const res = await apiFetch(`/api/sales/faqs?${params}`);
        setFaqs(await res.json());
      }
    } catch (err) {
      console.error("Load knowledge failed:", err);
    } finally {
      setLoading(false);
    }
  }, [tab, channelFilter, sceneFilter, categoryFilter, search]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="销售知识库"
        description="话术模板 · FAQ · 从真实对话中提炼"
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/sales"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white/80 px-3 py-1.5 text-sm font-medium text-foreground hover:bg-white transition-colors"
            >
              返回销售看板
            </Link>
            <Button
              onClick={() =>
                tab === "playbooks"
                  ? setShowNewPlaybook(true)
                  : setShowNewFAQ(true)
              }
            >
              <Plus className="h-4 w-4" />
              {tab === "playbooks" ? "新话术" : "新 FAQ"}
            </Button>
          </div>
        }
      />

      {/* Tabs */}
      <div className="flex items-center justify-between gap-4">
        <div className="inline-flex rounded-lg border border-border bg-white/60 p-0.5">
          <button
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              tab === "rag"
                ? "bg-white text-foreground shadow-sm"
                : "text-muted hover:text-foreground"
            )}
            onClick={() => setTab("rag")}
          >
            <Brain className="h-4 w-4" />
            AI 知识库
          </button>
          <button
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              tab === "playbooks"
                ? "bg-white text-foreground shadow-sm"
                : "text-muted hover:text-foreground"
            )}
            onClick={() => setTab("playbooks")}
          >
            <BookOpen className="h-4 w-4" />
            话术模板
          </button>
          <button
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              tab === "faqs"
                ? "bg-white text-foreground shadow-sm"
                : "text-muted hover:text-foreground"
            )}
            onClick={() => setTab("faqs")}
          >
            <HelpCircle className="h-4 w-4" />
            FAQ
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2">
          {tab === "playbooks" && (
            <>
              <FilterSelect
                options={CHANNELS}
                value={channelFilter}
                onChange={setChannelFilter}
              />
              <FilterSelect
                options={SCENES}
                value={sceneFilter}
                onChange={setSceneFilter}
              />
            </>
          )}
          {tab === "faqs" && (
            <FilterSelect
              options={FAQ_CATEGORIES}
              value={categoryFilter}
              onChange={setCategoryFilter}
            />
          )}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              type="text"
              placeholder="搜索…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded-lg border border-border bg-white/80 py-1.5 pl-9 pr-3 text-sm placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-foreground/20"
            />
          </div>
        </div>
      </div>

      {/* Content */}
      {tab === "rag" ? (
        <RAGPanel />
      ) : loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted" />
        </div>
      ) : tab === "playbooks" ? (
        <PlaybookGrid playbooks={playbooks} onRefresh={loadData} />
      ) : (
        <FAQList faqs={faqs} onRefresh={loadData} />
      )}

      {/* New Playbook Dialog */}
      <NewPlaybookDialog
        open={showNewPlaybook}
        onOpenChange={setShowNewPlaybook}
        onSuccess={() => {
          setShowNewPlaybook(false);
          loadData();
        }}
      />

      {/* New FAQ Dialog */}
      <NewFAQDialog
        open={showNewFAQ}
        onOpenChange={setShowNewFAQ}
        onSuccess={() => {
          setShowNewFAQ(false);
          loadData();
        }}
      />
    </div>
  );
}

/* ── Filter Select ── */
function FilterSelect({
  options,
  value,
  onChange,
}: {
  options: { key: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-border bg-white/80 py-1.5 px-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/20"
    >
      {options.map((o) => (
        <option key={o.key} value={o.key}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/* ── Playbook Grid ── */
function PlaybookGrid({
  playbooks,
  onRefresh,
}: {
  playbooks: Playbook[];
  onRefresh: () => void;
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (playbooks.length === 0) {
    return (
      <div className="flex flex-col items-center py-16 text-muted">
        <BookOpen className="h-10 w-10 opacity-30" />
        <p className="mt-3 text-sm">暂无话术模板</p>
        <p className="mt-1 text-xs opacity-60">
          导入客户对话后，点击"提取知识"自动生成
        </p>
      </div>
    );
  }

  async function handleCopy(content: string, id: string) {
    await navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  async function handleArchive(id: string) {
    await apiFetch(`/api/sales/playbooks/${id}`, {
      method: "DELETE",
    });
    onRefresh();
  }

  async function handleRate(id: string, score: number) {
    await apiFetch(`/api/sales/playbooks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ effectiveness: score }),
    });
    onRefresh();
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {playbooks.map((pb) => (
        <div
          key={pb.id}
          className="group relative rounded-xl border border-border bg-white/70 p-4 transition-shadow hover:shadow-md"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-wrap gap-1.5">
              <Badge
                className={CHANNEL_COLORS[pb.channel] || "bg-gray-100 text-gray-600"}
              >
                {pb.channel}
              </Badge>
              <Badge variant="outline">{pb.sceneLabel}</Badge>
              {pb.language !== "zh" && (
                <Badge variant="secondary">
                  {pb.language === "en" ? "EN" : "混合"}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => handleCopy(pb.content, pb.id)}
                className="rounded p-1 text-muted hover:text-foreground hover:bg-foreground/5"
                title="复制话术"
              >
                {copiedId === pb.id ? (
                  <Check className="h-3.5 w-3.5 text-success" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
              <button
                onClick={() => handleArchive(pb.id)}
                className="rounded p-1 text-muted hover:text-danger hover:bg-danger/5"
                title="归档"
              >
                <Archive className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <p className="mt-3 text-sm text-foreground leading-relaxed line-clamp-4">
            {pb.content}
          </p>

          {pb.example && (
            <div className="mt-2 rounded-lg bg-foreground/[0.03] px-3 py-2 text-xs text-muted italic line-clamp-2">
              {pb.example}
            </div>
          )}

          <div className="mt-3 flex items-center justify-between">
            <div className="flex items-center gap-0.5">
              {[1, 2, 3, 4, 5].map((s) => (
                <button
                  key={s}
                  onClick={() => handleRate(pb.id, s)}
                  className="p-0.5"
                >
                  <Star
                    className={cn(
                      "h-3.5 w-3.5",
                      s <= pb.effectiveness
                        ? "fill-amber-400 text-amber-400"
                        : "text-gray-200"
                    )}
                  />
                </button>
              ))}
            </div>
            <span className="text-[10px] text-muted">
              使用 {pb.usageCount} 次
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── FAQ List ── */
function FAQList({
  faqs,
  onRefresh,
}: {
  faqs: FAQ[];
  onRefresh: () => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (faqs.length === 0) {
    return (
      <div className="flex flex-col items-center py-16 text-muted">
        <HelpCircle className="h-10 w-10 opacity-30" />
        <p className="mt-3 text-sm">暂无 FAQ</p>
        <p className="mt-1 text-xs opacity-60">
          导入客户对话后自动提取，或手动创建
        </p>
      </div>
    );
  }

  async function handleArchive(id: string) {
    await apiFetch(`/api/sales/faqs/${id}`, { method: "DELETE" });
    onRefresh();
  }

  return (
    <div className="space-y-3">
      {faqs.map((faq) => (
        <div
          key={faq.id}
          className="group rounded-xl border border-border bg-white/70 overflow-hidden"
        >
          <button
            onClick={() =>
              setExpandedId(expandedId === faq.id ? null : faq.id)
            }
            className="flex w-full items-start gap-3 px-4 py-3 text-left"
          >
            <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">
                {faq.question}
              </p>
              <div className="mt-1 flex items-center gap-2">
                <Badge variant="outline" className="text-[10px]">
                  {faq.categoryLabel}
                </Badge>
                {faq.productTags &&
                  faq.productTags.split(",").map((tag) => (
                    <Badge
                      key={tag}
                      variant="secondary"
                      className="text-[10px]"
                    >
                      {tag.trim()}
                    </Badge>
                  ))}
                <span className="text-[10px] text-muted">
                  被问 {faq.frequency} 次
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleArchive(faq.id);
                }}
                className="rounded p-1 text-muted hover:text-danger hover:bg-danger/5"
                title="归档"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </button>

          {expandedId === faq.id && (
            <div className="border-t border-border/50 bg-foreground/[0.02] px-4 py-3 pl-11">
              <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                {faq.answer}
              </p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── New Playbook Dialog ── */
function NewPlaybookDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState({
    channel: "wechat",
    scene: "first_contact",
    sceneLabel: "首次接触",
    language: "zh",
    content: "",
    example: "",
  });
  const [saving, setSaving] = useState(false);

  const sceneOptions = SCENES.filter((s) => s.key !== "all");

  async function handleSave() {
    if (!form.content.trim()) return;
    setSaving(true);
    try {
      const res = await apiFetch("/api/sales/playbooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) onSuccess();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>新建话术模板</DialogTitle>
          <DialogDescription>
            手动添加销售话术模板
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>渠道</Label>
              <ShadSelect
                value={form.channel}
                onValueChange={(v) => setForm({ ...form, channel: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHANNELS.filter((c) => c.key !== "all").map((c) => (
                    <SelectItem key={c.key} value={c.key}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </ShadSelect>
            </div>
            <div className="space-y-1.5">
              <Label>场景</Label>
              <ShadSelect
                value={form.scene}
                onValueChange={(v) => {
                  const label =
                    sceneOptions.find((s) => s.key === v)?.label || v;
                  setForm({ ...form, scene: v, sceneLabel: label });
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sceneOptions.map((s) => (
                    <SelectItem key={s.key} value={s.key}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </ShadSelect>
            </div>
            <div className="space-y-1.5">
              <Label>语言</Label>
              <ShadSelect
                value={form.language}
                onValueChange={(v) => setForm({ ...form, language: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="zh">中文</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="mixed">中英混合</SelectItem>
                </SelectContent>
              </ShadSelect>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>话术内容 *</Label>
            <textarea
              className="flex w-full rounded-lg border border-border bg-white/80 px-3 py-2 text-sm transition-colors placeholder:text-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20 h-28 resize-none"
              placeholder="输入话术模板，可使用 [客户名] [产品名] 等占位符…"
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
            />
          </div>

          <div className="space-y-1.5">
            <Label>使用范例</Label>
            <textarea
              className="flex w-full rounded-lg border border-border bg-white/80 px-3 py-2 text-sm transition-colors placeholder:text-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20 h-16 resize-none"
              placeholder="可选：实际使用的话术范例…"
              value={form.example}
              onChange={(e) => setForm({ ...form, example: e.target.value })}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={!form.content.trim() || saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── RAG Panel ── */
function RAGPanel() {
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

/* ── New FAQ Dialog ── */
function NewFAQDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState({
    question: "",
    answer: "",
    category: "product",
    categoryLabel: "产品相关",
    language: "zh",
  });
  const [saving, setSaving] = useState(false);

  const catOptions = FAQ_CATEGORIES.filter((c) => c.key !== "all");

  async function handleSave() {
    if (!form.question.trim() || !form.answer.trim()) return;
    setSaving(true);
    try {
      const res = await apiFetch("/api/sales/faqs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) onSuccess();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>新建 FAQ</DialogTitle>
          <DialogDescription>
            添加客户常见问题和最佳回答
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>分类</Label>
              <ShadSelect
                value={form.category}
                onValueChange={(v) => {
                  const label =
                    catOptions.find((c) => c.key === v)?.label || v;
                  setForm({ ...form, category: v, categoryLabel: label });
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {catOptions.map((c) => (
                    <SelectItem key={c.key} value={c.key}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </ShadSelect>
            </div>
            <div className="space-y-1.5">
              <Label>语言</Label>
              <ShadSelect
                value={form.language}
                onValueChange={(v) => setForm({ ...form, language: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="zh">中文</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="mixed">中英混合</SelectItem>
                </SelectContent>
              </ShadSelect>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>常见问题 *</Label>
            <Input
              placeholder="客户常问的问题…"
              value={form.question}
              onChange={(e) => setForm({ ...form, question: e.target.value })}
            />
          </div>

          <div className="space-y-1.5">
            <Label>最佳回答 *</Label>
            <textarea
              className="flex w-full rounded-lg border border-border bg-white/80 px-3 py-2 text-sm transition-colors placeholder:text-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20 h-28 resize-none"
              placeholder="标准回答内容…"
              value={form.answer}
              onChange={(e) => setForm({ ...form, answer: e.target.value })}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            onClick={handleSave}
            disabled={
              !form.question.trim() || !form.answer.trim() || saving
            }
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
