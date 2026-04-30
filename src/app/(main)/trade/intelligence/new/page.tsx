"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, Loader2, ImageIcon, Keyboard, AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";
import { useCurrentOrgId } from "@/lib/hooks/use-current-org-id";
import { cn } from "@/lib/utils";
import type { LabelExtractedFields, LabelFieldSlot } from "@/lib/trade/intelligence-label-types";
import { LABEL_USER_EDITABLE_KEYS } from "@/lib/trade/intelligence-label-user-merge";

const ASSET_TYPES: { value: string; label: string }[] = [
  { value: "tag_image", label: "吊牌照片" },
  { value: "carton_label", label: "外箱标签" },
  { value: "package_image", label: "包装图" },
  { value: "screenshot", label: "网页/资料截图" },
  { value: "receipt", label: "票据/小票" },
];

const FIELD_LABELS: Record<(typeof LABEL_USER_EDITABLE_KEYS)[number], string> = {
  productName: "产品名",
  brand: "品牌",
  upc: "UPC",
  gtin: "GTIN",
  sku: "SKU",
  mpn: "MPN",
  itemNumber: "Item #",
  styleNumber: "Style #",
  material: "材质",
  size: "尺寸",
  color: "颜色",
  countryOfOrigin: "产地",
  manufacturer: "制造商",
  importer: "进口商",
  distributor: "分销商",
  retailer: "零售商",
  address: "地址",
  barcodeDigits: "条码数字",
  marketRegion: "市场区域",
};

type ExtractPreview = {
  assetId: string;
  imageBlobUrl: string;
  extractedFields: LabelExtractedFields;
  confidence: number;
  warnings: string[];
  extractedSummary: string;
};

function slotInputValue(slot: LabelFieldSlot | undefined, edited: Record<string, string>, key: string): string {
  if (Object.prototype.hasOwnProperty.call(edited, key)) return edited[key] ?? "";
  return slot?.value ?? "";
}

function isLowConfidenceSlot(slot: LabelFieldSlot | undefined): boolean {
  if (!slot?.value) return false;
  if (slot.source === "user_confirmed") return false;
  return slot.confidence < 0.5;
}

export default function TradeIntelligenceNewPage() {
  const router = useRouter();
  const { orgId, ambiguous, loading: orgLoading } = useCurrentOrgId();
  const [tab, setTab] = useState<"manual" | "image">("manual");

  const [submitting, setSubmitting] = useState(false);
  const [productName, setProductName] = useState("");
  const [brand, setBrand] = useState("");
  const [upc, setUpc] = useState("");
  const [gtin, setGtin] = useState("");
  const [sku, setSku] = useState("");
  const [mpn, setMpn] = useState("");
  const [productUrl, setProductUrl] = useState("");
  const [retailerName, setRetailerName] = useState("");
  const [notes, setNotes] = useState("");

  const [imageAssetType, setImageAssetType] = useState("tag_image");
  const [imageNotes, setImageNotes] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imgBusy, setImgBusy] = useState(false);
  const [preview, setPreview] = useState<ExtractPreview | null>(null);
  const [editedStrings, setEditedStrings] = useState<Record<string, string>>({});

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId) return;
    setSubmitting(true);
    try {
      const res = await apiFetch("/api/trade/intelligence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId,
          productName: productName.trim() || undefined,
          brand: brand.trim() || undefined,
          upc: upc.trim() || undefined,
          gtin: gtin.trim() || undefined,
          sku: sku.trim() || undefined,
          mpn: mpn.trim() || undefined,
          productUrl: productUrl.trim() || undefined,
          retailerName: retailerName.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        window.alert(j.error ?? `创建失败（${res.status}）`);
        return;
      }
      const row = (await res.json()) as { id: string };
      router.push(`/trade/intelligence/${row.id}`);
    } finally {
      setSubmitting(false);
    }
  };

  const runExtractOnly = async () => {
    if (!orgId || !imageFile) {
      window.alert("请选择图片文件（JPEG / PNG / WebP，最大 6MB）");
      return;
    }
    setImgBusy(true);
    try {
      const fd = new FormData();
      fd.set("orgId", orgId);
      fd.set("assetType", imageAssetType);
      if (imageNotes.trim()) fd.set("notes", imageNotes.trim());
      fd.set("image", imageFile);
      const res = await apiFetch("/api/trade/intelligence/extract-image", {
        method: "POST",
        body: fd,
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        assetId?: string;
        imageBlobUrl?: string;
        extractedFields?: LabelExtractedFields;
        confidence?: number;
        warnings?: string[];
        rawVisionResult?: { extractedSummary?: string };
      };
      if (!res.ok) {
        window.alert(j.error ?? `识别失败（${res.status}）`);
        return;
      }
      if (!j.assetId || !j.extractedFields) {
        window.alert("响应缺少 assetId 或 extractedFields");
        return;
      }
      setPreview({
        assetId: j.assetId,
        imageBlobUrl: j.imageBlobUrl ?? "",
        extractedFields: j.extractedFields,
        confidence: typeof j.confidence === "number" ? j.confidence : 0,
        warnings: Array.isArray(j.warnings) ? j.warnings : [],
        extractedSummary: j.rawVisionResult?.extractedSummary ?? "",
      });
      setEditedStrings({});
    } finally {
      setImgBusy(false);
    }
  };

  const runFromImageImmediate = async () => {
    if (!orgId || !imageFile) {
      window.alert("请选择图片文件（JPEG / PNG / WebP，最大 6MB）");
      return;
    }
    setImgBusy(true);
    try {
      const fd = new FormData();
      fd.set("orgId", orgId);
      fd.set("assetType", imageAssetType);
      if (imageNotes.trim()) fd.set("notes", imageNotes.trim());
      fd.set("image", imageFile);
      const res = await apiFetch("/api/trade/intelligence/from-image", {
        method: "POST",
        body: fd,
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; caseId?: string };
      if (!res.ok) {
        window.alert(j.error ?? `创建失败（${res.status}）`);
        return;
      }
      if (j.caseId) router.push(`/trade/intelligence/${j.caseId}`);
    } finally {
      setImgBusy(false);
    }
  };

  const buildEditedFieldsPayload = (): Record<string, string | null> => {
    if (!preview) return {};
    const out: Record<string, string | null> = {};
    for (const key of LABEL_USER_EDITABLE_KEYS) {
      const orig = (preview.extractedFields[key]?.value ?? "").trim();
      const cur = (slotInputValue(preview.extractedFields[key], editedStrings, key) ?? "").trim();
      if (orig !== cur) {
        out[key] = cur.length ? cur : null;
      }
    }
    return out;
  };

  const createFromExtracted = async () => {
    if (!orgId || !preview) return;
    setImgBusy(true);
    try {
      const editedFields = buildEditedFieldsPayload();
      const res = await apiFetch("/api/trade/intelligence/create-from-extracted", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId,
          assetId: preview.assetId,
          assetType: imageAssetType,
          extractedFields: preview.extractedFields,
          editedFields,
          notes: imageNotes.trim() || undefined,
          extractedSummary: preview.extractedSummary || undefined,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; caseId?: string };
      if (!res.ok) {
        window.alert(j.error ?? `创建失败（${res.status}）`);
        return;
      }
      if (j.caseId) router.push(`/trade/intelligence/${j.caseId}`);
    } finally {
      setImgBusy(false);
    }
  };

  if (orgLoading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (!orgId || ambiguous) {
    return (
      <div className="space-y-4 py-16 text-center">
        <p className="text-sm text-muted">请先选择当前组织。</p>
        <button
          type="button"
          onClick={() => router.push("/organizations")}
          className="text-sm text-accent underline-offset-2 hover:underline"
        >
          前往组织
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link
        href="/trade/intelligence"
        className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground"
      >
        <ChevronLeft size={14} />
        返回列表
      </Link>
      <PageHeader
        title="新建竞品溯源"
        description="手动填写线索，或上传吊牌/包装图：先提取字段并核对编辑后再创建案例（推荐）。快捷路径可一键创建。均不会自动运行买家发现。"
      />

      <div className="flex gap-1 rounded-lg border border-border/60 bg-card-bg p-1">
        <button
          type="button"
          onClick={() => setTab("manual")}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition",
            tab === "manual" ? "bg-blue-600 text-white" : "text-muted hover:text-foreground",
          )}
        >
          <Keyboard size={14} />
          手动输入
        </button>
        <button
          type="button"
          onClick={() => setTab("image")}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition",
            tab === "image" ? "bg-blue-600 text-white" : "text-muted hover:text-foreground",
          )}
        >
          <ImageIcon size={14} />
          图片上传
        </button>
      </div>

      {tab === "manual" ? (
        <form onSubmit={submit} className="space-y-4 rounded-xl border border-border/60 bg-card-bg p-6">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">产品名称</label>
            <input
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              placeholder="例如 Harman Luxe Sculpted Fur Throw"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted/70 focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">品牌</label>
            <input
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              placeholder="例如 Harman / Goods & textiles"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted/70 focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">UPC</label>
              <input
                value={upc}
                onChange={(e) => setUpc(e.target.value)}
                placeholder="620104426355"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted/70 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">GTIN</label>
              <input
                value={gtin}
                onChange={(e) => setGtin(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">MPN</label>
              <input
                value={mpn}
                onChange={(e) => setMpn(e.target.value)}
                placeholder="1153847"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted/70 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">SKU</label>
              <input
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">零售产品页 URL</label>
            <input
              value={productUrl}
              onChange={(e) => setProductUrl(e.target.value)}
              placeholder="https://…"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted/70 focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">零售商名称</label>
            <input
              value={retailerName}
              onChange={(e) => setRetailerName(e.target.value)}
              placeholder="例如 Kitchen Stuff Plus"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted/70 focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">备注</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="例如 100% polyester, Made in China, 50x60 throw"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted/70 focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Link
              href="/trade/intelligence"
              className="rounded-lg border border-border px-4 py-2 text-xs text-foreground hover:bg-border/20"
            >
              取消
            </Link>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {submitting ? "创建中…" : "创建并进入详情"}
            </button>
          </div>
        </form>
      ) : (
        <div className="space-y-4 rounded-xl border border-border/60 bg-card-bg p-6">
          <p className="text-[11px] text-muted">
            支持 JPEG / PNG / WebP，单张最大 6MB。默认流程：提取 → 核对编辑 →
            创建案例。快捷按钮可跳过核对。不会自动运行买家发现。
          </p>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">图片</label>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
              onChange={(e) => {
                setImageFile(e.target.files?.[0] ?? null);
                setPreview(null);
                setEditedStrings({});
              }}
              className="w-full text-xs text-foreground file:mr-3 file:rounded-md file:border-0 file:bg-blue-600 file:px-3 file:py-1.5 file:text-xs file:text-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">图片类型</label>
            <select
              value={imageAssetType}
              onChange={(e) => setImageAssetType(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-2 py-2 text-xs text-foreground focus:outline-none"
            >
              {ASSET_TYPES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">备注（可选）</label>
            <textarea
              value={imageNotes}
              onChange={(e) => setImageNotes(e.target.value)}
              rows={3}
              placeholder="如拍摄环境、批次等"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted/70 focus:border-blue-500 focus:outline-none"
            />
          </div>

          {!preview ? (
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <Link
                href="/trade/intelligence"
                className="rounded-lg border border-border px-4 py-2 text-xs text-foreground hover:bg-border/20"
              >
                取消
              </Link>
              <button
                type="button"
                disabled={imgBusy || !imageFile}
                onClick={runFromImageImmediate}
                className="rounded-lg border border-amber-600/50 bg-amber-950/20 px-4 py-2 text-xs font-medium text-amber-200 hover:bg-amber-950/40 disabled:opacity-50"
              >
                {imgBusy ? "处理中…" : "Extract 并立即创建"}
              </button>
              <button
                type="button"
                disabled={imgBusy || !imageFile}
                onClick={runExtractOnly}
                className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {imgBusy ? "识别中…" : "Extract 提取字段"}
              </button>
            </div>
          ) : (
            <>
              {preview.imageBlobUrl ? (
                <div className="flex gap-4 rounded-lg border border-border/50 bg-background/40 p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={preview.imageBlobUrl}
                    alt="上传预览"
                    className="h-40 w-auto max-w-[45%] rounded object-contain"
                  />
                  <div className="min-w-0 flex-1 text-[11px] text-muted">
                    <p className="mb-1 font-medium text-foreground">整体置信度：{preview.confidence.toFixed(2)}</p>
                    {preview.extractedSummary ? (
                      <p className="line-clamp-6">Vision 摘要：{preview.extractedSummary}</p>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {preview.warnings.length > 0 ? (
                <div className="rounded-lg border border-amber-600/40 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-100">
                  <div className="mb-1 flex items-center gap-1 font-medium">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    提示与低置信告警
                  </div>
                  <ul className="list-inside list-disc space-y-0.5">
                    {preview.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="overflow-x-auto rounded-lg border border-border/60">
                <table className="w-full min-w-[640px] border-collapse text-left text-[11px]">
                  <thead>
                    <tr className="border-b border-border/60 bg-background/50 text-muted">
                      <th className="px-2 py-2 font-medium">字段</th>
                      <th className="px-2 py-2 font-medium">值（可编辑）</th>
                      <th className="px-2 py-2 font-medium">置信度</th>
                      <th className="px-2 py-2 font-medium">来源</th>
                      <th className="px-2 py-2 font-medium">证据摘录</th>
                    </tr>
                  </thead>
                  <tbody>
                    {LABEL_USER_EDITABLE_KEYS.map((key) => {
                      const slot = preview.extractedFields[key];
                      const low = isLowConfidenceSlot(slot);
                      return (
                        <tr
                          key={key}
                          className={cn(
                            "border-b border-border/40",
                            low ? "bg-amber-950/15" : "hover:bg-background/30",
                          )}
                        >
                          <td className="whitespace-nowrap px-2 py-1.5 text-foreground">{FIELD_LABELS[key]}</td>
                          <td className="px-2 py-1.5">
                            <input
                              value={slotInputValue(slot, editedStrings, key)}
                              onChange={(e) =>
                                setEditedStrings((prev) => ({
                                  ...prev,
                                  [key]: e.target.value,
                                }))
                              }
                              className="w-full min-w-[8rem] rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground"
                            />
                          </td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-muted">
                            {slot?.confidence != null ? slot.confidence.toFixed(2) : "—"}
                          </td>
                          <td className="px-2 py-1.5 text-muted">{slot?.source ?? "—"}</td>
                          <td className="max-w-[220px] truncate px-2 py-1.5 text-muted" title={slot?.evidence}>
                            {slot?.evidence || "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setPreview(null);
                    setEditedStrings({});
                  }}
                  className="rounded-lg border border-border px-4 py-2 text-xs text-foreground hover:bg-border/20"
                >
                  重新选择图片
                </button>
                <button
                  type="button"
                  disabled={imgBusy}
                  onClick={createFromExtracted}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                >
                  {imgBusy ? "创建中…" : "Create Case 创建案例"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
