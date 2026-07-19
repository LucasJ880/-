"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Loader2, Search, Trash2, Upload } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";
import { useCurrentOrgId } from "@/lib/hooks/use-current-org-id";

interface DocRow {
  id: string;
  title: string;
  category: string;
  tags: string | null;
  sourceType: string;
  sourcePath: string | null;
  updatedAt: string;
  _count?: { chunks: number };
}

export default function OrgKnowledgePage() {
  const router = useRouter();
  const { orgId, ambiguous, loading: orgLoading } = useCurrentOrgId();
  const [documents, setDocuments] = useState<DocRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searchHits, setSearchHits] = useState<string | null>(null);
  const [searchMode, setSearchMode] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "",
    category: "general",
    content: "",
    tags: "",
  });

  const load = useCallback(async () => {
    if (!orgId || ambiguous) {
      setDocuments([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const res = await apiFetch(
      `/api/org/knowledge?orgId=${encodeURIComponent(orgId)}`,
    );
    const body = await res.json();
    if (res.ok) setDocuments(body.documents || []);
    else setError(body.error || "加载失败");
    setLoading(false);
  }, [orgId, ambiguous]);

  useEffect(() => {
    if (orgLoading) return;
    void load();
  }, [load, orgLoading]);

  async function createDoc(e: FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    setBusy("create");
    setError(null);
    setMessage(null);
    const res = await apiFetch("/api/org/knowledge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...form, orgId }),
    });
    const body = await res.json();
    setBusy(null);
    if (!res.ok) return setError(body.error || "创建失败");
    setMessage("已写入组织知识库并建立向量索引（若 embedding 可用）");
    setForm({ title: "", category: "general", content: "", tags: "" });
    await load();
  }

  async function importFiles(files: FileList | null) {
    if (!orgId || !files?.length) return;
    setBusy("import");
    setError(null);
    setMessage(null);
    const data = new FormData();
    data.set("orgId", orgId);
    data.set("defaultCategory", "general");
    if (files.length === 1) data.set("file", files[0]!);
    else Array.from(files).forEach((f) => data.append("files", f));
    const res = await apiFetch("/api/org/knowledge/import", {
      method: "POST",
      body: data,
    });
    const body = await res.json();
    setBusy(null);
    if (!res.ok) return setError(body.error || "导入失败");
    setMessage(body.note || `已导入 ${body.created} 条`);
    await load();
  }

  async function runSearch(e: FormEvent) {
    e.preventDefault();
    if (!orgId || !query.trim()) return;
    setBusy("search");
    setError(null);
    const res = await apiFetch("/api/org/knowledge/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, query }),
    });
    const body = await res.json();
    setBusy(null);
    if (!res.ok) return setError(body.error || "检索失败");
    setSearchMode(body.mode);
    setSearchHits(body.context || "无结果");
  }

  async function removeDoc(id: string) {
    if (!orgId || !confirm("确定删除该知识条目？")) return;
    await apiFetch(
      `/api/org/knowledge/${id}?orgId=${encodeURIComponent(orgId)}`,
      { method: "DELETE" },
    );
    await load();
  }

  if (orgLoading || loading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="animate-spin text-muted" />
      </div>
    );
  }

  if (!orgId || ambiguous) {
    return (
      <div className="space-y-3 py-16 text-center">
        <p className="text-sm text-muted">请先选择当前组织。</p>
        <button
          type="button"
          onClick={() => router.push("/organizations")}
          className="text-sm text-accent underline"
        >
          前往组织
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-10">
      <PageHeader
        title="组织知识库"
        description="平台级真相源：支持 Markdown/Obsidian ZIP 导入与向量检索。数字员工从此读取；不反向同步本地笔记软件。"
      />

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">
          {message}
        </div>
      )}

      <section className="rounded-xl border border-border bg-card-bg p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">导入 Vault</h2>
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs">
            {busy === "import" ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Upload size={14} />
            )}
            导入 MD / ZIP
            <input
              type="file"
              accept=".md,.mdx,.txt,.markdown,.zip"
              multiple
              className="hidden"
              disabled={busy === "import"}
              onChange={(e) => {
                void importFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        <p className="mt-2 text-xs text-muted">
          文件夹名可映射 category（general / product / faq …）。导入后在青砚维护。
        </p>
      </section>

      <form
        onSubmit={runSearch}
        className="flex flex-wrap gap-2 rounded-xl border border-border bg-card-bg p-4"
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="检索组织知识（向量优先，失败回退关键词）"
          className="min-w-[220px] flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={busy === "search"}
          className="inline-flex items-center gap-1 rounded-lg bg-accent px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {busy === "search" ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Search size={14} />
          )}
          检索
        </button>
      </form>
      {searchHits && (
        <pre className="whitespace-pre-wrap rounded-xl border border-border bg-background p-4 text-xs">
          {searchMode ? `模式：${searchMode}\n\n` : ""}
          {searchHits}
        </pre>
      )}

      <form
        onSubmit={createDoc}
        className="space-y-3 rounded-xl border border-border bg-card-bg p-5"
      >
        <h2 className="font-semibold">手动添加</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            required
            placeholder="标题"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
          <input
            placeholder="分类 general / product / faq …"
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
        </div>
        <input
          placeholder="标签（逗号分隔）"
          value={form.tags}
          onChange={(e) => setForm({ ...form, tags: e.target.value })}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />
        <textarea
          required
          rows={6}
          placeholder="正文（Markdown 亦可）"
          value={form.content}
          onChange={(e) => setForm({ ...form, content: e.target.value })}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={busy === "create"}
          className="rounded-lg bg-accent px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {busy === "create" ? "保存中…" : "保存并索引"}
        </button>
      </form>

      <section className="rounded-xl border border-border bg-card-bg p-5">
        <h2 className="font-semibold">条目（{documents.length}）</h2>
        <div className="mt-3 space-y-2">
          {documents.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted">
              <BookOpen className="mx-auto mb-2 opacity-50" />
              暂无组织知识。可从 Obsidian 导出 ZIP 导入。
            </div>
          ) : (
            documents.map((doc) => (
              <div
                key={doc.id}
                className="flex items-start justify-between gap-3 rounded-lg bg-background px-3 py-2 text-sm"
              >
                <div>
                  <div className="font-medium">{doc.title}</div>
                  <div className="mt-0.5 text-xs text-muted">
                    {doc.category} · {doc.sourceType}
                    {doc._count ? ` · ${doc._count.chunks} 向量块` : ""}
                    {doc.sourcePath ? ` · ${doc.sourcePath}` : ""}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeDoc(doc.id)}
                  className="rounded p-1 text-muted hover:text-red-500"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
