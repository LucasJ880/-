"use client";

import { useEffect, useState, useCallback } from "react";
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

type Tab = "playbooks" | "faqs";

/* ── Page ── */
export default function KnowledgePage() {
  const [tab, setTab] = useState<Tab>("playbooks");
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
      {loading ? (
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
