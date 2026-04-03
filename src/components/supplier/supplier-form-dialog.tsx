"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  X,
  Loader2,
  Upload,
  FileText,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Tag,
  Award,
  Globe,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";
import type {
  BrochureParseResult,
  BrochureParseResponse,
} from "@/lib/supplier/brochure-types";

interface SupplierData {
  id: string;
  name: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  category: string | null;
  region: string | null;
  notes: string | null;
  status: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  editing: SupplierData | null;
  orgId: string;
}

type UploadState = "idle" | "uploading" | "parsing" | "done" | "failed";

const MAX_SIZE_MB = 10;
const MAX_SIZE = MAX_SIZE_MB * 1024 * 1024;

export function SupplierFormDialog({ open, onClose, onSaved, editing, orgId }: Props) {
  const [name, setName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [category, setCategory] = useState("");
  const [region, setRegion] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [uploadError, setUploadError] = useState("");
  const [brochureUrl, setBrochureUrl] = useState<string | null>(null);
  const [parseResult, setParseResult] = useState<BrochureParseResult | null>(null);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setName(editing.name);
      setContactName(editing.contactName || "");
      setContactEmail(editing.contactEmail || "");
      setContactPhone(editing.contactPhone || "");
      setCategory(editing.category || "");
      setRegion(editing.region || "");
      setNotes(editing.notes || "");
    } else {
      setName("");
      setContactName("");
      setContactEmail("");
      setContactPhone("");
      setCategory("");
      setRegion("");
      setNotes("");
    }
    setError("");
    setUploadState("idle");
    setUploadError("");
    setBrochureUrl(null);
    setParseResult(null);
    setShowAnalysis(false);
  }, [open, editing]);

  const handleFile = useCallback(async (file: File) => {
    if (file.type !== "application/pdf") {
      setUploadError("仅支持 PDF 文件");
      setUploadState("failed");
      return;
    }
    if (file.size > MAX_SIZE) {
      setUploadError(`文件过大，最大支持 ${MAX_SIZE_MB}MB`);
      setUploadState("failed");
      return;
    }

    setUploadState("uploading");
    setUploadError("");
    setParseResult(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      setUploadState("parsing");
      const res = await apiFetch("/api/suppliers/parse-brochure", {
        method: "POST",
        body: formData,
      });

      const data: BrochureParseResponse = await res.json();

      if (!data.success || !data.result) {
        setUploadError(data.error || "解析失败");
        setUploadState("failed");
        setBrochureUrl(data.brochureUrl);
        return;
      }

      setBrochureUrl(data.brochureUrl);
      setParseResult(data.result);
      setUploadState("done");

      const s = data.result.supplier;
      const a = data.result.analysis;
      if (s.name && !name) setName(s.name);
      if (s.contactName && !contactName) setContactName(s.contactName);
      if (s.contactEmail && !contactEmail) setContactEmail(s.contactEmail);
      if (s.contactPhone && !contactPhone) setContactPhone(s.contactPhone);
      if (s.region && !region) setRegion(s.region);
      if (a.categories.length > 0 && !category) setCategory(a.categories.join("、"));
      if ((a.notes || a.summary) && !notes) setNotes(a.notes || a.summary || "");

      setShowAnalysis(true);
    } catch {
      setUploadError("上传失败，请检查网络后重试");
      setUploadState("failed");
    }
  }, [name, contactName, contactEmail, contactPhone, region, category, notes]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError("");

    try {
      const url = editing ? `/api/suppliers/${editing.id}` : "/api/suppliers";
      const method = editing ? "PATCH" : "POST";
      const body: Record<string, unknown> = {
        name: name.trim(),
        contactName: contactName.trim() || null,
        contactEmail: contactEmail.trim() || null,
        contactPhone: contactPhone.trim() || null,
        category: category.trim() || null,
        region: region.trim() || null,
        notes: notes.trim() || null,
      };
      if (!editing) {
        body.orgId = orgId;
        if (brochureUrl) body.brochureUrl = brochureUrl;
        if (parseResult) {
          body.brochureParseStatus = parseResult.meta.parseStatus;
          body.brochureParseResult = parseResult;
          body.brochureParseWarning = parseResult.meta.parseWarning || null;
        }
      }

      const res = await apiFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `保存失败 (${res.status})`);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const isCreate = !editing;
  const meta = parseResult?.meta;
  const analysis = parseResult?.analysis;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card-bg p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">
            {editing ? "编辑供应商" : "新建供应商"}
          </h3>
          <button onClick={onClose} className="rounded p-1 text-muted hover:bg-background">
            <X size={18} />
          </button>
        </div>

        {/* PDF Upload Zone — only in create mode */}
        {isCreate && (
          <div className="mb-5">
            {uploadState === "idle" || uploadState === "failed" ? (
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  "flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 transition-colors",
                  dragOver
                    ? "border-accent bg-accent/5"
                    : "border-border hover:border-accent/50 hover:bg-background/50"
                )}
              >
                <Upload size={24} className="text-muted" />
                <span className="text-sm font-medium">上传供应商画册（PDF）</span>
                <span className="text-xs text-muted">
                  拖拽文件到此处，或点击选择 · AI 将自动识别供应商信息
                </span>
                {uploadState === "failed" && uploadError && (
                  <span className="mt-1 flex items-center gap-1 text-xs text-[#a63d3d]">
                    <AlertTriangle size={12} />
                    {uploadError}
                  </span>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  onChange={handleInputChange}
                  className="hidden"
                />
              </div>
            ) : uploadState === "uploading" || uploadState === "parsing" ? (
              <div className="flex items-center gap-3 rounded-xl border border-border bg-background px-4 py-4">
                <Loader2 size={18} className="animate-spin text-accent" />
                <div>
                  <span className="text-sm font-medium">
                    {uploadState === "uploading" ? "上传中..." : "AI 正在分析画册内容..."}
                  </span>
                  <p className="text-xs text-muted">这可能需要几秒钟</p>
                </div>
              </div>
            ) : uploadState === "done" ? (
              <div className="rounded-xl border border-[rgba(46,122,86,0.2)] bg-[rgba(46,122,86,0.04)]">
                <div className="flex items-center gap-2 px-4 py-3">
                  <CheckCircle2 size={16} className="text-[#2e7a56]" />
                  <span className="text-sm font-medium text-[#2e7a56]">
                    已从画册中识别出供应商信息，请核实后保存
                  </span>
                </div>

                {meta?.parseWarning && (
                  <div className="flex items-start gap-2 border-t border-[rgba(46,122,86,0.1)] px-4 py-2">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0 text-[#9a6a2f]" />
                    <span className="text-xs text-[#9a6a2f]">{meta.parseWarning}</span>
                  </div>
                )}

                {/* AI Analysis Panel */}
                {analysis && (
                  <div className="border-t border-[rgba(46,122,86,0.1)]">
                    <button
                      type="button"
                      onClick={() => setShowAnalysis(!showAnalysis)}
                      className="flex w-full items-center justify-between px-4 py-2 text-xs font-medium text-[#2e7a56] hover:bg-[rgba(46,122,86,0.04)]"
                    >
                      <span className="flex items-center gap-1.5">
                        <Sparkles size={12} />
                        AI 分析结果
                        {meta && (
                          <span className={cn(
                            "rounded-full px-1.5 py-0.5 text-[10px]",
                            meta.confidence === "high" ? "bg-[rgba(46,122,86,0.1)] text-[#2e7a56]" :
                            meta.confidence === "medium" ? "bg-[rgba(154,106,47,0.1)] text-[#9a6a2f]" :
                            "bg-[rgba(166,61,61,0.1)] text-[#a63d3d]"
                          )}>
                            置信度: {meta.confidence === "high" ? "高" : meta.confidence === "medium" ? "中" : "低"}
                          </span>
                        )}
                      </span>
                      {showAnalysis ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>

                    {showAnalysis && (
                      <div className="space-y-2.5 px-4 pb-3">
                        {analysis.summary && (
                          <p className="text-xs leading-relaxed text-foreground">{analysis.summary}</p>
                        )}

                        {analysis.categories.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Tag size={11} className="text-muted" />
                            {analysis.categories.map((c, i) => (
                              <span key={i} className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">{c}</span>
                            ))}
                          </div>
                        )}

                        {analysis.mainProducts.length > 0 && (
                          <div>
                            <span className="text-[10px] font-medium text-muted">主要产品/服务：</span>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {analysis.mainProducts.map((p, i) => (
                                <span key={i} className="rounded bg-background px-1.5 py-0.5 text-[10px] text-foreground">{p}</span>
                              ))}
                            </div>
                          </div>
                        )}

                        {analysis.certifications.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Award size={11} className="text-muted" />
                            {analysis.certifications.map((c, i) => (
                              <span key={i} className="rounded-full bg-[rgba(154,106,47,0.08)] px-2 py-0.5 text-[10px] font-medium text-[#9a6a2f]">{c}</span>
                            ))}
                          </div>
                        )}

                        {analysis.targetMarkets.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Globe size={11} className="text-muted" />
                            {analysis.targetMarkets.map((m, i) => (
                              <span key={i} className="rounded bg-background px-1.5 py-0.5 text-[10px] text-foreground">{m}</span>
                            ))}
                          </div>
                        )}

                        {analysis.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {analysis.tags.map((t, i) => (
                              <span key={i} className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted">#{t}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : null}

            {uploadState === "done" && (
              <div className="mt-2 flex items-center gap-2 text-[11px] text-muted">
                <FileText size={11} />
                <span>画册已上传</span>
                <span className="mx-1">·</span>
                <button
                  type="button"
                  onClick={() => {
                    setUploadState("idle");
                    setParseResult(null);
                    setBrochureUrl(null);
                    setShowAnalysis(false);
                  }}
                  className="text-accent hover:underline"
                >
                  重新上传
                </button>
              </div>
            )}
          </div>
        )}

        {/* Divider when upload zone is shown */}
        {isCreate && uploadState !== "idle" && uploadState !== "failed" && (
          <div className="mb-4 flex items-center gap-3 text-xs text-muted">
            <div className="h-px flex-1 bg-border" />
            供应商信息
            <div className="h-px flex-1 bg-border" />
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">
              供应商名称 <span className="text-[#a63d3d]">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="公司全称或简称"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
              autoFocus={!isCreate || uploadState === "idle"}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium">联系人</label>
              <input
                type="text"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="姓名"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">电话</label>
              <input
                type="text"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                placeholder="电话号码"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">邮箱</label>
            <input
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="email@example.com"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium">品类</label>
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="如：建材、电气、IT"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">地区</label>
              <input
                type="text"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                placeholder="如：多伦多、温哥华"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">备注</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="备注信息（可选）"
              rows={2}
              className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>

          {error && (
            <p className="rounded-lg border border-[rgba(166,61,61,0.15)] bg-[rgba(166,61,61,0.04)] px-3 py-2 text-sm text-[#a63d3d]">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-background"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!name.trim() || saving}
              className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {editing ? "保存修改" : "创建供应商"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
