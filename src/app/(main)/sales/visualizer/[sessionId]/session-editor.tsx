"use client";

/**
 * SessionEditor — Visualizer 画布编辑器主容器
 *
 * 数据流原则：
 * - 任何写操作完成后，直接 reload() 整份 session detail（方案小、数据量有限，简单可靠）
 * - transform 的 onDragEnd/onTransformEnd 上报，**每次改动都立刻 PATCH**，不做本地 debounce 以保持 MVP 简单
 * - 颜色 / opacity 改变采用乐观更新 + PATCH（失败则 reload 兜底）
 */

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Download,
  ImagePlus,
  Images,
  Layers,
  Loader2,
  MousePointer2,
  Pencil,
  Plus,
  Square,
  Trash2,
  Spline,
  X,
} from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { cn } from "@/lib/utils";
import type {
  VisualizerProductOptionDetail,
  VisualizerProductOptionTransform,
  VisualizerRegionShape,
  VisualizerSessionDetail,
  VisualizerSessionStatus,
  VisualizerSourceImageSummary,
  VisualizerVariantSummary,
} from "@/lib/visualizer/types";
import { VISUALIZER_SESSION_STATUS_LABEL } from "@/lib/visualizer/types";
import {
  VISUALIZER_MOCK_PRODUCTS,
  findMockProductById,
  type VisualizerMockProduct,
} from "@/lib/visualizer/mock-products";
import type { VisualizerTool } from "./visualizer-stage";
import MeasurementImportDialog from "./measurement-import-dialog";

const VisualizerStage = dynamic(() => import("./visualizer-stage"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-black/90 text-xs text-white">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 画布加载中…
    </div>
  ),
});

const STATUS_COLOR: Record<VisualizerSessionStatus, string> = {
  draft: "bg-gray-100 text-gray-600",
  active: "bg-blue-100 text-blue-800",
  archived: "bg-slate-100 text-slate-500",
};

function panelSection(title: string, icon: React.ReactNode, body: React.ReactNode) {
  return (
    <section className="rounded-xl border border-border/60 bg-white/60 p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-foreground">
        {icon}
        {title}
      </div>
      <div>{body}</div>
    </section>
  );
}

export default function SessionEditor({ sessionId }: { sessionId: string }) {
  const [session, setSession] = useState<VisualizerSessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [savingTitle, setSavingTitle] = useState(false);

  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [selectedProductOptionId, setSelectedProductOptionId] = useState<
    string | null
  >(null);
  const [tool, setTool] = useState<VisualizerTool>("move");

  const [uploading, setUploading] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 960, height: 540 });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/visualizer/sessions/${sessionId}`);
      if (res.status === 403) {
        setError("无权访问该可视化方案");
        setSession(null);
        return;
      }
      if (res.status === 404) {
        setError("可视化方案不存在");
        setSession(null);
        return;
      }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError((j as { error?: string }).error ?? "加载失败");
        setSession(null);
        return;
      }
      const data = (await res.json()) as VisualizerSessionDetail;
      setSession(data);
      setSelectedImageId((prev) => {
        if (prev && data.sourceImages.some((i) => i.id === prev)) return prev;
        return data.sourceImages[0]?.id ?? null;
      });
      setSelectedVariantId((prev) => {
        if (prev && data.variants.some((v) => v.id === prev)) return prev;
        return data.variants[0]?.id ?? null;
      });
    } catch (err) {
      console.error("Load visualizer session failed:", err);
      setError("加载失败");
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  // 容器尺寸监听
  useEffect(() => {
    const el = canvasContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const cr = entry.contentRect;
        const w = Math.max(320, Math.floor(cr.width));
        const h = Math.max(320, Math.floor(cr.height));
        setCanvasSize({ width: w, height: h });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const selectedImage = useMemo<VisualizerSourceImageSummary | null>(() => {
    if (!session) return null;
    return session.sourceImages.find((i) => i.id === selectedImageId) ?? null;
  }, [session, selectedImageId]);

  const selectedVariant = useMemo<VisualizerVariantSummary | null>(() => {
    if (!session) return null;
    return session.variants.find((v) => v.id === selectedVariantId) ?? null;
  }, [session, selectedVariantId]);

  const selectedProductOption = useMemo<VisualizerProductOptionDetail | null>(() => {
    if (!selectedVariant) return null;
    return (
      selectedVariant.productOptions.find((po) => po.id === selectedProductOptionId) ??
      null
    );
  }, [selectedVariant, selectedProductOptionId]);

  // 当前选中 region 在当前 variant 下是否已有 productOption
  const currentRegionOption = useMemo<VisualizerProductOptionDetail | null>(() => {
    if (!selectedVariant || !selectedRegionId) return null;
    return (
      selectedVariant.productOptions.find((po) => po.regionId === selectedRegionId) ??
      null
    );
  }, [selectedVariant, selectedRegionId]);

  // ================== 写操作 ==================
  const saveTitle = async () => {
    if (!session) return;
    const next = titleDraft.trim();
    if (!next) return;
    if (next === session.title) {
      setEditingTitle(false);
      return;
    }
    setSavingTitle(true);
    try {
      const res = await apiFetch(`/api/visualizer/sessions/${session.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: next }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert((j as { error?: string }).error ?? "保存失败");
        return;
      }
      setSession((prev) => (prev ? { ...prev, title: next } : prev));
      setEditingTitle(false);
    } catch (err) {
      console.error("Save title failed:", err);
      alert("保存失败");
    } finally {
      setSavingTitle(false);
    }
  };

  const handleUploadImage = async (file: File) => {
    if (!session) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await apiFetch(
        `/api/visualizer/sessions/${session.id}/images`,
        { method: "POST", body: fd },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert((j as { error?: string }).error ?? "上传失败");
        return;
      }
      const data = (await res.json()) as { image: VisualizerSourceImageSummary };
      await load();
      setSelectedImageId(data.image.id);
    } catch (err) {
      console.error("Upload image failed:", err);
      alert("上传失败");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDeleteImage = async (imageId: string) => {
    if (!confirm("删除这张图片将同时删除其下的所有窗户区域与产品叠加，确定吗？")) return;
    setMutating(true);
    try {
      const res = await apiFetch(`/api/visualizer/images/${imageId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert((j as { error?: string }).error ?? "删除失败");
        return;
      }
      await load();
    } finally {
      setMutating(false);
    }
  };

  const handleCreateRegion = useCallback(
    async (args: {
      shape: VisualizerRegionShape;
      points: Array<[number, number]>;
    }) => {
      if (!selectedImage) return;
      setMutating(true);
      try {
        const res = await apiFetch(
          `/api/visualizer/images/${selectedImage.id}/regions`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              shape: args.shape,
              points: args.points,
            }),
          },
        );
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          alert((j as { error?: string }).error ?? "保存区域失败");
          return;
        }
        await load();
        setTool("move");
      } finally {
        setMutating(false);
      }
    },
    [load, selectedImage],
  );

  const handleDeleteRegion = async (regionId: string) => {
    if (!confirm("删除该窗户区域将同时移除所有方案中挂在其上的产品叠加，确定吗？")) return;
    setMutating(true);
    try {
      const res = await apiFetch(`/api/visualizer/regions/${regionId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert((j as { error?: string }).error ?? "删除失败");
        return;
      }
      await load();
      if (selectedRegionId === regionId) setSelectedRegionId(null);
    } finally {
      setMutating(false);
    }
  };

  const handleCreateVariant = async () => {
    if (!session) return;
    setMutating(true);
    try {
      const res = await apiFetch(
        `/api/visualizer/sessions/${session.id}/variants`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert((j as { error?: string }).error ?? "创建方案失败");
        return;
      }
      const data = (await res.json()) as { variant: VisualizerVariantSummary };
      await load();
      setSelectedVariantId(data.variant.id);
    } finally {
      setMutating(false);
    }
  };

  const handleRenameVariant = async (variantId: string) => {
    const v = session?.variants.find((x) => x.id === variantId);
    if (!v) return;
    const next = prompt("输入新的方案名称：", v.name)?.trim();
    if (!next || next === v.name) return;
    setMutating(true);
    try {
      const res = await apiFetch(`/api/visualizer/variants/${variantId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: next }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert((j as { error?: string }).error ?? "改名失败");
        return;
      }
      await load();
    } finally {
      setMutating(false);
    }
  };

  const handleDeleteVariant = async (variantId: string) => {
    if (!confirm("删除该方案？其下的所有产品叠加都会一起删除。")) return;
    setMutating(true);
    try {
      const res = await apiFetch(`/api/visualizer/variants/${variantId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert((j as { error?: string }).error ?? "删除失败");
        return;
      }
      await load();
      if (selectedVariantId === variantId) setSelectedVariantId(null);
    } finally {
      setMutating(false);
    }
  };

  /** 给当前 region 挂一个产品（若该 region 已有，则替换产品目录 ID） */
  const handlePickProduct = async (product: VisualizerMockProduct) => {
    if (!selectedVariant || !selectedRegionId) return;
    setMutating(true);
    try {
      if (currentRegionOption) {
        const res = await apiFetch(
          `/api/visualizer/product-options/${currentRegionOption.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              productCatalogId: product.id,
              color: product.supportedColors[0]?.name ?? null,
              colorHex: product.supportedColors[0]?.hex ?? null,
              opacity: product.defaultOpacity,
            }),
          },
        );
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          alert((j as { error?: string }).error ?? "切换产品失败");
          return;
        }
      } else {
        const res = await apiFetch(
          `/api/visualizer/variants/${selectedVariant.id}/product-options`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              regionId: selectedRegionId,
              productCatalogId: product.id,
            }),
          },
        );
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          alert((j as { error?: string }).error ?? "添加产品失败");
          return;
        }
        const data = (await res.json()) as { productOption: VisualizerProductOptionDetail };
        setSelectedProductOptionId(data.productOption.id);
      }
      await load();
    } finally {
      setMutating(false);
    }
  };

  const handlePatchProductOption = async (
    id: string,
    patch: Record<string, unknown>,
  ) => {
    setMutating(true);
    try {
      const res = await apiFetch(`/api/visualizer/product-options/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert((j as { error?: string }).error ?? "保存失败");
        await load();
        return;
      }
      await load();
    } finally {
      setMutating(false);
    }
  };

  const handleDeleteProductOption = async (id: string) => {
    if (!confirm("移除该产品叠加？")) return;
    setMutating(true);
    try {
      const res = await apiFetch(`/api/visualizer/product-options/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert((j as { error?: string }).error ?? "删除失败");
        return;
      }
      await load();
      if (selectedProductOptionId === id) setSelectedProductOptionId(null);
    } finally {
      setMutating(false);
    }
  };

  const handleUpdateTransform = useCallback(
    (args: { id: string; transform: VisualizerProductOptionTransform }) => {
      // 乐观更新
      setSession((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          variants: prev.variants.map((v) => ({
            ...v,
            productOptions: v.productOptions.map((po) =>
              po.id === args.id ? { ...po, transform: args.transform } : po,
            ),
          })),
        };
      });
      // 后台 PATCH，不 reload（reload 会覆盖用户后续交互）
      apiFetch(`/api/visualizer/product-options/${args.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transform: args.transform }),
      }).catch(() => {
        void load();
      });
    },
    [load],
  );

  // ================== 渲染 ==================
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="space-y-4">
        <Link
          href="/sales"
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> 返回销售
        </Link>
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error ?? "加载失败"}
        </div>
      </div>
    );
  }

  const status = session.status as VisualizerSessionStatus;

  return (
    <div className="space-y-4">
      {/* 顶部：返回 + 基本信息 */}
      <Link
        href={`/sales/customers/${session.customer.id}?tab=visualizer`}
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> 返回客户
      </Link>

      <div className="rounded-xl border border-border/60 bg-white/60 p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {editingTitle ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void saveTitle();
                    if (e.key === "Escape") setEditingTitle(false);
                  }}
                  className="h-9 flex-1 rounded-md border border-border bg-white px-2 text-sm"
                />
                <button
                  onClick={saveTitle}
                  disabled={savingTitle}
                  className="inline-flex items-center gap-1 rounded-md bg-foreground px-2 py-1.5 text-xs text-white hover:bg-foreground/90 disabled:opacity-60"
                >
                  {savingTitle ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  保存
                </button>
                <button
                  onClick={() => setEditingTitle(false)}
                  disabled={savingTitle}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-2 py-1.5 text-xs text-muted hover:text-foreground disabled:opacity-60"
                >
                  <X className="h-3.5 w-3.5" /> 取消
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h2 className="truncate text-base font-semibold text-foreground">
                  {session.title}
                </h2>
                <button
                  onClick={() => {
                    setTitleDraft(session.title);
                    setEditingTitle(true);
                  }}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-2 py-1 text-xs text-muted hover:text-foreground"
                >
                  <Pencil className="h-3 w-3" /> 改名
                </button>
              </div>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-medium",
                  STATUS_COLOR[status] ?? STATUS_COLOR.draft,
                )}
              >
                {VISUALIZER_SESSION_STATUS_LABEL[status] ?? status}
              </span>
              <span>·</span>
              <span>
                客户：
                <Link
                  href={`/sales/customers/${session.customer.id}`}
                  className="text-foreground underline underline-offset-2"
                >
                  {session.customer.name}
                </Link>
              </span>
              {session.opportunity && (
                <>
                  <span>·</span>
                  <span className="truncate">机会：{session.opportunity.title}</span>
                </>
              )}
              {session.quote && (
                <>
                  <span>·</span>
                  <span>报价 v{session.quote.version}</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 编辑器：左画布 + 右面板 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        {/* 左：画布 */}
        <div className="flex flex-col gap-2">
          {/* 工具条 */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-white/60 p-2">
            <ToolBtn
              active={tool === "move"}
              onClick={() => setTool("move")}
              icon={<MousePointer2 className="h-3.5 w-3.5" />}
              label="选择"
            />
            <ToolBtn
              active={tool === "rect"}
              onClick={() => setTool("rect")}
              icon={<Square className="h-3.5 w-3.5" />}
              label="矩形窗"
              disabled={!selectedImage}
            />
            <ToolBtn
              active={tool === "polygon"}
              onClick={() => setTool("polygon")}
              icon={<Spline className="h-3.5 w-3.5" />}
              label="多边形窗"
              disabled={!selectedImage}
            />
            <div className="ml-auto text-[11px] text-muted">
              {selectedImage
                ? `${selectedImage.fileName}${
                    selectedImage.width && selectedImage.height
                      ? ` · ${selectedImage.width}×${selectedImage.height}`
                      : ""
                  }`
                : "请先上传 / 选择一张现场照片"}
            </div>
          </div>

          <div
            ref={canvasContainerRef}
            className="relative overflow-hidden rounded-xl border border-border/60 bg-black"
            style={{ height: 540 }}
          >
            {selectedImage ? (
              <VisualizerStage
                image={selectedImage}
                variant={selectedVariant}
                tool={tool}
                width={canvasSize.width}
                height={canvasSize.height}
                selectedRegionId={selectedRegionId}
                selectedProductOptionId={selectedProductOptionId}
                onSelectRegion={setSelectedRegionId}
                onSelectProductOption={setSelectedProductOptionId}
                onCreateRegion={handleCreateRegion}
                onUpdateProductOptionTransform={handleUpdateTransform}
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-center">
                <div className="text-sm text-white/80">尚未上传现场照片</div>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="inline-flex items-center gap-1 rounded-md bg-white px-3 py-1.5 text-xs font-medium text-black hover:bg-white/90 disabled:opacity-60"
                >
                  {uploading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ImagePlus className="h-3.5 w-3.5" />
                  )}
                  上传照片
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 右：面板 */}
        <div className="flex flex-col gap-3">
          {/* 图片列表 */}
          {panelSection(
            "现场照片",
            <Images className="h-3.5 w-3.5 text-muted" />,
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="flex items-center justify-center gap-1 rounded-md border border-dashed border-border/80 bg-white/40 px-2 py-2 text-xs text-muted hover:text-foreground disabled:opacity-60"
                >
                  {uploading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ImagePlus className="h-3.5 w-3.5" />
                  )}
                  上传照片
                </button>
                <button
                  onClick={() => setImportDialogOpen(true)}
                  disabled={uploading || mutating}
                  className="flex items-center justify-center gap-1 rounded-md border border-dashed border-emerald-200 bg-emerald-50/60 px-2 py-2 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
                  title="从该客户的量房记录复用已有照片"
                >
                  <Download className="h-3.5 w-3.5" />
                  从量房导入
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleUploadImage(file);
                }}
              />
              {session.sourceImages.length === 0 ? (
                <div className="text-[11px] text-muted">暂无照片</div>
              ) : (
                <ul className="space-y-1.5">
                  {session.sourceImages.map((img) => {
                    const active = img.id === selectedImageId;
                    return (
                      <li
                        key={img.id}
                        className={cn(
                          "flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs cursor-pointer",
                          active
                            ? "border-blue-400 bg-blue-50/60"
                            : "border-border/60 bg-white/70 hover:bg-white",
                        )}
                        onClick={() => {
                          setSelectedImageId(img.id);
                          setSelectedRegionId(null);
                          setSelectedProductOptionId(null);
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={img.fileUrl}
                          alt={img.fileName}
                          className="h-9 w-9 rounded object-cover"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium text-foreground">
                            {img.roomLabel || img.fileName}
                          </div>
                          <div className="text-[10px] text-muted">
                            {img.regionCount} 个窗户区域
                          </div>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleDeleteImage(img.id);
                          }}
                          disabled={mutating}
                          className="rounded p-1 text-muted hover:bg-red-50 hover:text-red-600 disabled:opacity-60"
                          title="删除图片"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>,
          )}

          {/* 区域列表 */}
          {selectedImage &&
            panelSection(
              "窗户区域",
              <Square className="h-3.5 w-3.5 text-muted" />,
              <div>
                {selectedImage.regions.length === 0 ? (
                  <div className="text-[11px] text-muted">
                    使用上方工具栏的矩形/多边形工具标记窗户
                  </div>
                ) : (
                  <ul className="space-y-1">
                    {selectedImage.regions.map((region, idx) => {
                      const active = region.id === selectedRegionId;
                      const hasPO = selectedVariant?.productOptions.some(
                        (po) => po.regionId === region.id,
                      );
                      return (
                        <li
                          key={region.id}
                          className={cn(
                            "flex items-center gap-2 rounded-md border px-2 py-1 text-xs cursor-pointer",
                            active
                              ? "border-blue-400 bg-blue-50/60"
                              : "border-border/60 bg-white/70 hover:bg-white",
                          )}
                          onClick={() => {
                            setSelectedRegionId(region.id);
                            if (hasPO) {
                              const po = selectedVariant?.productOptions.find(
                                (x) => x.regionId === region.id,
                              );
                              if (po) setSelectedProductOptionId(po.id);
                            } else {
                              setSelectedProductOptionId(null);
                            }
                          }}
                        >
                          <span className="font-medium text-foreground">
                            W{idx + 1}
                          </span>
                          <span className="text-[10px] text-muted">
                            {region.shape === "rect" ? "矩形" : "多边形"}
                          </span>
                          {hasPO && (
                            <span className="rounded-full bg-amber-100 px-1.5 text-[10px] text-amber-700">
                              已配产品
                            </span>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleDeleteRegion(region.id);
                            }}
                            disabled={mutating}
                            className="ml-auto rounded p-1 text-muted hover:bg-red-50 hover:text-red-600 disabled:opacity-60"
                            title="删除窗户区域"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>,
            )}

          {/* 方案列表 */}
          {panelSection(
            "方案 Variants",
            <Layers className="h-3.5 w-3.5 text-muted" />,
            <div className="space-y-1.5">
              <button
                onClick={handleCreateVariant}
                disabled={mutating}
                className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-border/80 bg-white/40 px-2 py-1.5 text-xs text-muted hover:text-foreground disabled:opacity-60"
              >
                <Plus className="h-3.5 w-3.5" /> 新建方案
              </button>
              {session.variants.length === 0 ? (
                <div className="text-[11px] text-muted">暂无方案</div>
              ) : (
                <ul className="space-y-1">
                  {session.variants.map((v) => {
                    const active = v.id === selectedVariantId;
                    return (
                      <li
                        key={v.id}
                        className={cn(
                          "flex items-center gap-2 rounded-md border px-2 py-1 text-xs cursor-pointer",
                          active
                            ? "border-blue-400 bg-blue-50/60"
                            : "border-border/60 bg-white/70 hover:bg-white",
                        )}
                        onClick={() => {
                          setSelectedVariantId(v.id);
                          setSelectedProductOptionId(null);
                        }}
                      >
                        <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                          {v.name}
                        </span>
                        <span className="text-[10px] text-muted">
                          {v.productOptionCount} 产品
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleRenameVariant(v.id);
                          }}
                          disabled={mutating}
                          className="rounded p-1 text-muted hover:bg-slate-100 disabled:opacity-60"
                          title="改名"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleDeleteVariant(v.id);
                          }}
                          disabled={mutating}
                          className="rounded p-1 text-muted hover:bg-red-50 hover:text-red-600 disabled:opacity-60"
                          title="删除方案"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>,
          )}

          <MeasurementImportDialog
            open={importDialogOpen}
            sessionId={session.id}
            customerId={session.customer.id}
            defaultRecordId={session.measurementRecordId}
            onClose={() => setImportDialogOpen(false)}
            onImported={(summary) => {
              setImportDialogOpen(false);
              if (summary.imported === 0 && summary.skipped === 0) {
                alert("当前窗位没有照片可导入");
                return;
              }
              const msg =
                summary.skipped > 0
                  ? `成功导入 ${summary.imported} 张，跳过 ${summary.skipped} 张已存在。`
                  : `成功导入 ${summary.imported} 张照片。`;
              void load().then(() => alert(msg));
            }}
          />

          {/* 产品面板 */}
          {panelSection(
            "产品库 · 10 款 Mock",
            <Plus className="h-3.5 w-3.5 text-muted" />,
            !selectedVariant ? (
              <div className="text-[11px] text-muted">请先选择或创建一个方案</div>
            ) : !selectedRegionId ? (
              <div className="text-[11px] text-muted">
                请先在画布上点选一个窗户区域
              </div>
            ) : (
              <ProductPanel
                currentOption={currentRegionOption}
                selectedProductOption={selectedProductOption}
                onPick={handlePickProduct}
                onPatch={handlePatchProductOption}
                onDelete={handleDeleteProductOption}
              />
            ),
          )}
        </div>
      </div>
    </div>
  );
}

function ToolBtn(props: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={props.onClick}
      disabled={props.disabled}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs",
        props.active
          ? "border-blue-500 bg-blue-50 text-blue-700"
          : "border-border bg-white text-muted hover:text-foreground",
        props.disabled && "opacity-50 cursor-not-allowed",
      )}
    >
      {props.icon}
      {props.label}
    </button>
  );
}

/**
 * ProductPanel：
 * - 10 款 mock 产品网格，点击 = 给当前 region 的 current variant 挂该产品
 * - 当前 region 已有 option 时：显示当前产品信息、颜色切换、opacity 滑块、移除按钮
 */
function ProductPanel(props: {
  currentOption: VisualizerProductOptionDetail | null;
  selectedProductOption: VisualizerProductOptionDetail | null;
  onPick: (p: VisualizerMockProduct) => void;
  onPatch: (id: string, patch: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
}) {
  const { currentOption, onPick, onPatch, onDelete } = props;
  const currentProduct = currentOption
    ? findMockProductById(currentOption.productCatalogId)
    : null;

  return (
    <div className="space-y-3">
      {currentOption && currentProduct && (
        <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50/60 p-2">
          <div className="flex items-center gap-2 text-xs">
            <span
              className="h-4 w-4 rounded border border-black/10"
              style={{ background: currentOption.colorHex ?? "#ccc" }}
            />
            <span className="min-w-0 flex-1 truncate font-medium text-foreground">
              {currentProduct.name}
            </span>
            <span className="text-[10px] text-muted">
              {currentProduct.categoryLabel}
            </span>
            <button
              onClick={() => onDelete(currentOption.id)}
              className="rounded p-1 text-muted hover:bg-red-50 hover:text-red-600"
              title="移除产品叠加"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* 颜色 */}
          <div className="space-y-1">
            <div className="text-[10px] font-medium text-muted">颜色</div>
            <div className="flex flex-wrap gap-1">
              {currentProduct.supportedColors.map((c) => {
                const active = currentOption.colorHex === c.hex;
                return (
                  <button
                    key={c.hex}
                    onClick={() =>
                      onPatch(currentOption.id, { color: c.name, colorHex: c.hex })
                    }
                    className={cn(
                      "h-6 w-6 rounded border-2",
                      active ? "border-amber-500" : "border-white/80",
                    )}
                    style={{ background: c.hex }}
                    title={c.name}
                  />
                );
              })}
            </div>
          </div>

          {/* opacity */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px] text-muted">
              <span>透明度</span>
              <span>{Math.round(currentOption.opacity * 100)}%</span>
            </div>
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={currentOption.opacity}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                onPatch(currentOption.id, { opacity: v });
              }}
              className="w-full"
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-1.5">
        {VISUALIZER_MOCK_PRODUCTS.map((p) => {
          const isCurrent = currentOption?.productCatalogId === p.id;
          const firstColor = p.supportedColors[0];
          return (
            <button
              key={p.id}
              onClick={() => onPick(p)}
              className={cn(
                "flex items-start gap-1.5 rounded-md border px-2 py-1.5 text-left text-[11px]",
                isCurrent
                  ? "border-amber-400 bg-amber-50/80"
                  : "border-border/60 bg-white/70 hover:bg-white",
              )}
              title={p.notes}
            >
              <span
                className="mt-0.5 h-4 w-4 shrink-0 rounded border border-black/10"
                style={{ background: firstColor?.hex ?? "#ccc" }}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-foreground">
                  {p.name}
                </span>
                <span className="block truncate text-[10px] text-muted">
                  {p.categoryLabel}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
