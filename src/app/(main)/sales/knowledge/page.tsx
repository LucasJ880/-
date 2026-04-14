"use client";

import { useEffect, useState, useCallback } from "react";
import {
  BookOpen,
  HelpCircle,
  Search,
  Plus,
  Loader2,
  Brain,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";
import { Button } from "@/components/ui/button";
import { SCENES, CHANNELS, FAQ_CATEGORIES } from "./constants";
import type { Playbook, FAQ, Tab } from "./types";
import { FilterSelect } from "./filter-select";
import { PlaybookGrid } from "./playbook-grid";
import { FAQList } from "./faq-list";
import { NewPlaybookDialog } from "./new-playbook-dialog";
import { NewFAQDialog } from "./new-faq-dialog";
import { RAGPanel } from "./rag-panel";

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

      <NewPlaybookDialog
        open={showNewPlaybook}
        onOpenChange={setShowNewPlaybook}
        onSuccess={() => {
          setShowNewPlaybook(false);
          loadData();
        }}
      />

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
