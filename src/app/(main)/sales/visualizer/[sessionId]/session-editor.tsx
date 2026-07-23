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
  ArrowLeftRight,
  Check,
  Copy,
  Download,
  Image as ImageCoverIcon,
  ImagePlus,
  Images,
  Layers,
  Loader2,
  MousePointer2,
  Pencil,
  Plus,
  Share2,
  Sparkles,
  Square,
  Trash2,
  Spline,
  Tv,
  Wand2,
  X,
} from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { useToast } from "@/components/ui/toast";
import { resizeImageForUpload } from "@/lib/visualizer/client-resize";
import { cn } from "@/lib/utils";
import { lockAppScroll } from "@/lib/mobile/scroll-lock";
import type {
  VisualizerProductOptionDetail,
  VisualizerProductOptionTransform,
  VisualizerDetectedRegionDraft,
  VisualizerRegionShape,
  VisualizerSessionDetail,
  VisualizerSessionStatus,
  VisualizerSourceImageSummary,
  VisualizerVariantSummary,
} from "@/lib/visualizer/types";
import { VISUALIZER_SESSION_STATUS_LABEL } from "@/lib/visualizer/types";
import type {
  VisualizerCatalogProductDetail,
  VisualizerCatalogListResponse,
} from "@/lib/visualizer/types";
import type { VisualizerStageHandle, VisualizerTool } from "./visualizer-stage";
import ReusePhotosDialog from "./reuse-photos-dialog";
import ShareDialog from "./share-dialog";
import PresentationMode from "./presentation-mode";
import ProductPanel from "./product-panel";
import CatalogProductDialog from "./catalog-product-dialog";
import ComparisonMode, {
  type CompareImage,
  type CompareVariantInput,
} from "./comparison-mode";
import { useSalesCurrentOrgId } from "@/lib/hooks/use-sales-current-org-id";

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
  const toast = useToast();
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
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [reuseDialogOpen, setReuseDialogOpen] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [presentationOpen, setPresentationOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareVariantAId, setCompareVariantAId] = useState<string | null>(null);
  const [compareVariantBId, setCompareVariantBId] = useState<string | null>(null);
  const [autoDetecting, setAutoDetecting] = useState(false);
  const [detectingRegions, setDetectingRegions] = useState(false);
  const [cleaningRegionId, setCleaningRegionId] = useState<string | null>(null);
  const [applyAllBusy, setApplyAllBusy] = useState(false);
  const [detectedRegions, setDetectedRegions] = useState<
    VisualizerDetectedRegionDraft[]
  >([]);

  const { orgId: currentOrgId } = useSalesCurrentOrgId();
  const [catalog, setCatalog] = useState<VisualizerCatalogProductDetail[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogDialogOpen, setCatalogDialogOpen] = useState(false);
  const [catalogEditing, setCatalogEditing] =
    useState<VisualizerCatalogProductDetail | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 960, height: 540 });

  const stageHandleRef = useRef<VisualizerStageHandle | null>(null);
  const [exporting, setExporting] = useState<null | "download" | "cover" | "hd">(null);

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

  /** 拉取产品库（平台预置 + 本组织私有） */
  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const url = currentOrgId
        ? `/api/visualizer/catalog?orgId=${encodeURIComponent(currentOrgId)}`
        : "/api/visualizer/catalog";
      const res = await apiFetch(url);
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setCatalogError(j.error ?? "产品库加载失败");
        setCatalog([]);
        return;
      }
      const data = (await res.json()) as VisualizerCatalogListResponse;
      setCatalog([...data.org, ...data.platform]);
    } catch {
      setCatalogError("产品库加载失败");
      setCatalog([]);
    } finally {
      setCatalogLoading(false);
    }
  }, [currentOrgId]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    setDetectedRegions([]);
  }, [selectedImageId]);

  // 手机端配置面板打开时锁住页面滚动，避免抽屉和画布同时跟手滚动。
  useEffect(() => {
    if (!mobilePanelOpen) return;
    return lockAppScroll("visualizer-mobile-panel");
  }, [mobilePanelOpen]);

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

  const autoAcceptHighConfidenceForImage = useCallback(
    async (imageId: string) => {
      if (!imageId) return;
      setAutoDetecting(true);
      try {
        const res = await apiFetch(
          `/api/visualizer/images/${imageId}/detect-regions`,
          { method: "POST" },
        );
        const raw = await res.json().catch(() => ({}));
        if (!res.ok) return;
        const data = raw as { candidates?: VisualizerDetectedRegionDraft[] };
        const candidates = data.candidates ?? [];
        const auto = candidates.filter((c) => (c.confidence ?? 0) >= 0.7);
        const drafts = candidates.filter((c) => (c.confidence ?? 0) < 0.7);

        let accepted = 0;
        for (const c of auto) {
          const r = await apiFetch(
            `/api/visualizer/images/${imageId}/regions`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                shape: c.shape,
                points: c.points,
                label: c.label,
              }),
            },
          );
          if (r.ok) accepted += 1;
        }
        setDetectedRegions(drafts);
        if (accepted > 0) {
          toast.success(
            `AI 已自动识别并保存 ${accepted} 处窗户${drafts.length ? `，另有 ${drafts.length} 处待确认` : ""}`,
          );
          await load();
        } else if (drafts.length > 0) {
          toast.info(`AI 识别到 ${drafts.length} 处窗户草稿，请逐个确认`);
        } else {
          toast.info("AI 未识别到明显窗户，请手动标记");
        }
      } catch (err) {
        console.error("Auto detect regions failed:", err);
      } finally {
        setAutoDetecting(false);
      }
    },
    [load, toast],
  );

  const handleUploadImage = async (file: File) => {
    if (!session) return;
    setUploading(true);
    try {
      const resized = await resizeImageForUpload(file);
      const fd = new FormData();
      fd.append("file", resized.file);
      const res = await apiFetch(
        `/api/visualizer/sessions/${session.id}/images`,
        { method: "POST", body: fd },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error((j as { error?: string }).error ?? "上传失败");
        return;
      }
      const data = (await res.json()) as { image: VisualizerSourceImageSummary };
      await load();
      setSelectedImageId(data.image.id);
      if (!resized.skipped) {
        const reduced = Math.round(
          (1 - resized.resultBytes / resized.originalBytes) * 100,
        );
        if (reduced > 5) toast.info(`已自动压缩 ${reduced}% 上传`);
      }
      void autoAcceptHighConfidenceForImage(data.image.id);
    } catch (err) {
      console.error("Upload image failed:", err);
      toast.error("上传失败");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (cameraInputRef.current) cameraInputRef.current.value = "";
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
      label?: string | null;
    }) => {
      if (!selectedImage) return false;
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
              label: args.label,
            }),
          },
        );
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          alert((j as { error?: string }).error ?? "保存区域失败");
          return false;
        }
        await load();
        setTool("move");
        return true;
      } finally {
        setMutating(false);
      }
    },
    [load, selectedImage],
  );

  const handleDetectRegions = useCallback(async () => {
    if (!selectedImage || detectingRegions) return;
    setDetectingRegions(true);
    try {
      const res = await apiFetch(
        `/api/visualizer/images/${selectedImage.id}/detect-regions`,
        { method: "POST" },
      );
      const raw = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert((raw as { error?: string }).error ?? "AI 识别失败");
        return;
      }
      const data = raw as { candidates?: VisualizerDetectedRegionDraft[] };
      const candidates = data.candidates ?? [];
      setDetectedRegions(candidates);
      if (candidates.length === 0) {
        alert("AI 没有识别到明确的窗户区域，请手动标记。");
      } else {
        setTool("move");
      }
    } catch (err) {
      console.error("Detect visualizer regions failed:", err);
      alert("AI 识别失败");
    } finally {
      setDetectingRegions(false);
    }
  }, [detectingRegions, selectedImage]);

  const handleAcceptDetectedRegion = useCallback(
    async (draft: VisualizerDetectedRegionDraft) => {
      const ok = await handleCreateRegion({
        shape: draft.shape,
        points: draft.points,
        label: draft.label,
      });
      if (ok) {
        setDetectedRegions((prev) => prev.filter((x) => x.id !== draft.id));
      }
    },
    [handleCreateRegion],
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

  const handleCleanRegion = async (regionId: string) => {
    if (!selectedImage || cleaningRegionId) return;
    const ok = confirm(
      "AI 会尝试清理该窗户区域内的旧窗帘/杂物，并生成一张新的现场照片。原图不会被覆盖。继续吗？",
    );
    if (!ok) return;
    setCleaningRegionId(regionId);
    try {
      const res = await apiFetch(
        `/api/visualizer/images/${selectedImage.id}/clean-region`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ regionId }),
        },
      );
      const raw = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert((raw as { error?: string }).error ?? "AI 清理失败");
        return;
      }
      const data = raw as {
        image?: VisualizerSourceImageSummary;
        copiedRegions?: number;
      };
      await load();
      if (data.image?.id) {
        setSelectedImageId(data.image.id);
        setSelectedRegionId(null);
        setSelectedProductOptionId(null);
      }
      alert(
        `AI 清理图已生成${data.copiedRegions ? `，已复制 ${data.copiedRegions} 个窗户区域` : ""}。`,
      );
    } catch (err) {
      console.error("Clean visualizer region failed:", err);
      alert("AI 清理失败");
    } finally {
      setCleaningRegionId(null);
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
  const handlePickProduct = async (product: VisualizerCatalogProductDetail) => {
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
              color: product.colors[0]?.name ?? null,
              colorHex: product.colors[0]?.hex ?? null,
              opacity: product.defaultOpacity,
            }),
          },
        );
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          toast.error((j as { error?: string }).error ?? "切换产品失败");
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
          toast.error((j as { error?: string }).error ?? "添加产品失败");
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

  /** 软删本组织私有产品 */
  const handleArchiveCatalog = async (product: VisualizerCatalogProductDetail) => {
    if (!product.isOwn) return;
    if (!confirm(`确定删除产品「${product.name}」？\n\n已使用该产品的方案不会受影响。`)) {
      return;
    }
    try {
      const res = await apiFetch(`/api/visualizer/catalog/${product.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(j.error ?? "删除失败");
        return;
      }
      toast.success("已删除");
      await loadCatalog();
    } catch {
      toast.error("删除失败");
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
        toast.error((j as { error?: string }).error ?? "删除失败");
        return;
      }
      await load();
      if (selectedProductOptionId === id) setSelectedProductOptionId(null);
    } finally {
      setMutating(false);
    }
  };

  /**
   * 全屋一键套用：把当前选中 region 的产品/颜色/透明度套用到「该照片」中所有 region
   * - 已有 productOption 的 region：PATCH 覆盖
   * - 没有 productOption 的 region：POST 新建
   * - 不动其他照片
   */
  const handleApplyToAllRegions = async () => {
    if (!selectedVariant || !selectedImage || !currentRegionOption) return;
    if (selectedImage.regions.length <= 1) {
      toast.info("当前照片只有一个窗户区域，无需批量套用");
      return;
    }
    if (
      !confirm(
        `将「${currentRegionOption.productName}」套用到本照片所有 ${selectedImage.regions.length} 处窗户？已有产品的窗户会被覆盖。`,
      )
    )
      return;

    setApplyAllBusy(true);
    try {
      const targets = selectedImage.regions.filter(
        (r) => r.id !== currentRegionOption.regionId,
      );
      let updated = 0;
      let created = 0;
      for (const region of targets) {
        const existing = selectedVariant.productOptions.find(
          (po) => po.regionId === region.id,
        );
        if (existing) {
          const r = await apiFetch(
            `/api/visualizer/product-options/${existing.id}`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                productCatalogId: currentRegionOption.productCatalogId,
                color: currentRegionOption.color,
                colorHex: currentRegionOption.colorHex,
                opacity: currentRegionOption.opacity,
              }),
            },
          );
          if (r.ok) updated += 1;
        } else {
          const r = await apiFetch(
            `/api/visualizer/variants/${selectedVariant.id}/product-options`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                regionId: region.id,
                productCatalogId: currentRegionOption.productCatalogId,
                color: currentRegionOption.color,
                colorHex: currentRegionOption.colorHex,
                opacity: currentRegionOption.opacity,
              }),
            },
          );
          if (r.ok) created += 1;
        }
      }
      await load();
      toast.success(
        `全屋套用完成：新增 ${created} 处，更新 ${updated} 处${created + updated < targets.length ? `（失败 ${targets.length - created - updated}）` : ""}`,
      );
    } catch (err) {
      console.error("Apply to all regions failed:", err);
      toast.error("全屋套用失败");
    } finally {
      setApplyAllBusy(false);
    }
  };

  // ============ 导出 PNG ============
  /**
   * 同步捕获画布当前状态为 PNG dataURL。
   *
   * 为什么要先 setState(null) + requestAnimationFrame 两帧？
   *  - transformer 内部由 Stage 根据 selectedProductOptionId 异步挂接
   *  - 不等两帧直接 toDataURL 会把 transformer 的 8 个控制点烤进 PNG
   *  - VisualizerStage 内部导出时也会临时解挂 transformer，这里再加一道保险
   */
  const captureDataUrl = useCallback(async (): Promise<string | null> => {
    const clearSel =
      selectedProductOptionId !== null || selectedRegionId !== null;
    if (clearSel) {
      setSelectedProductOptionId(null);
      setSelectedRegionId(null);
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
    }
    return stageHandleRef.current?.toPngDataURL() ?? null;
  }, [selectedProductOptionId, selectedRegionId]);

  const handleDownloadPng = useCallback(async () => {
    if (!selectedImage || !selectedVariant) return;
    setExporting("download");
    try {
      const dataUrl = await captureDataUrl();
      if (!dataUrl) {
        toast.error("画布尚未就绪，请稍候再试");
        return;
      }
      const safeSession = session?.title.replace(/[^\w\u4e00-\u9fa5-]+/g, "_") ?? "visualizer";
      const safeVariant = selectedVariant.name.replace(/[^\w\u4e00-\u9fa5-]+/g, "_");
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `${safeSession}-${safeVariant}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast.success("PNG 已下载");
    } catch (err) {
      console.error("Download PNG failed:", err);
      toast.error("导出失败");
    } finally {
      setExporting(null);
    }
  }, [captureDataUrl, selectedImage, selectedVariant, session?.title, toast]);

  const handleSaveCover = useCallback(async () => {
    if (!selectedImage || !selectedVariant) return;
    setExporting("cover");
    try {
      const dataUrl = await captureDataUrl();
      if (!dataUrl) {
        toast.error("画布尚未就绪，请稍候再试");
        return;
      }
      const res = await apiFetch(
        `/api/visualizer/variants/${selectedVariant.id}/export`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dataUrl }),
        },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error((j as { error?: string }).error ?? "保存封面失败");
        return;
      }
      await load();
      toast.success("已保存为该方案的封面");
    } catch (err) {
      console.error("Save cover failed:", err);
      toast.error("保存封面失败");
    } finally {
      setExporting(null);
    }
  }, [captureDataUrl, load, selectedImage, selectedVariant, toast]);

  const handleRenderHdCover = useCallback(async () => {
    if (!selectedImage || !selectedVariant) return;
    const ok = confirm(
      "AI 会基于当前画布生成高清写实封面，并替换该方案封面。原始照片和产品叠加不会被修改。继续吗？",
    );
    if (!ok) return;
    setExporting("hd");
    toast.info("AI 正在生成高清封面，请稍候…");
    try {
      const dataUrl = await captureDataUrl();
      if (!dataUrl) {
        toast.error("画布尚未就绪，请稍候再试");
        return;
      }
      const res = await apiFetch(
        `/api/visualizer/variants/${selectedVariant.id}/render-hd`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dataUrl }),
        },
      );
      const raw = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error((raw as { error?: string }).error ?? "高清渲染失败");
        return;
      }
      await load();
      toast.success("高清封面已生成");
    } catch (err) {
      console.error("Render HD cover failed:", err);
      toast.error("高清渲染失败");
    } finally {
      setExporting(null);
    }
  }, [captureDataUrl, load, selectedImage, selectedVariant, toast]);

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
            {/* 顶部：标题 + 状态 + 导出按钮；导出按钮需要 selectedImage+selectedVariant 才启用 */}
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
              {session.customerSelections.length > 0 && (
                <>
                  <span>·</span>
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                    客户已标记 {session.customerSelections.length} 套方案
                  </span>
                </>
              )}
              {session.shareToken && session.shareExpiresAt && (
                <>
                  <span>·</span>
                  <span className="text-emerald-700">
                    分享中 · 至{" "}
                    {new Date(session.shareExpiresAt).toLocaleDateString("zh-CN")}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* 导出按钮组 */}
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setPresentationOpen(true)}
              disabled={!selectedImage || exporting !== null}
              className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-60"
              title="进入全屏客户演示模式（隐藏所有面板）"
            >
              <Tv className="h-3.5 w-3.5" />
              客户演示
            </button>
            <button
              type="button"
              onClick={() => {
                if (!selectedImage || session.variants.length < 2) return;
                const a =
                  selectedVariantId && session.variants.some((v) => v.id === selectedVariantId)
                    ? selectedVariantId
                    : session.variants[0]?.id ?? null;
                const b =
                  session.variants.find((v) => v.id !== a)?.id ?? null;
                setCompareVariantAId(a);
                setCompareVariantBId(b);
                setCompareOpen(true);
              }}
              disabled={!selectedImage || session.variants.length < 2}
              className="inline-flex items-center gap-1 rounded-md border border-purple-300 bg-purple-50 px-2.5 py-1.5 text-xs font-medium text-purple-800 hover:bg-purple-100 disabled:opacity-60"
              title={
                session.variants.length < 2
                  ? "需要至少两个方案才能对比"
                  : "全屏对比两个方案，帮客户做最终决定"
              }
            >
              <ArrowLeftRight className="h-3.5 w-3.5" />
              A/B 对比
            </button>
            <button
              type="button"
              onClick={() => setShareDialogOpen(true)}
              className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
              title="生成只读链接发给客户"
            >
              <Share2 className="h-3.5 w-3.5" />
              分享给客户
              {session.customerSelections.length > 0 && (
                <span className="ml-1 rounded-full bg-amber-100 px-1.5 text-[10px] font-medium text-amber-800">
                  {session.customerSelections.reduce(
                    (n, s) => n + s.customerCount,
                    0,
                  )}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={handleDownloadPng}
              disabled={
                !selectedImage || !selectedVariant || exporting !== null
              }
              className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-2.5 py-1.5 text-xs text-foreground hover:bg-slate-50 disabled:opacity-60"
              title={
                !selectedImage
                  ? "请先选择一张照片"
                  : !selectedVariant
                  ? "请先选择/创建一个方案"
                  : "导出当前画布为 PNG 并下载到本地"
              }
            >
              {exporting === "download" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              下载 PNG
            </button>
            <button
              type="button"
              onClick={handleSaveCover}
              disabled={
                !selectedImage || !selectedVariant || exporting !== null
              }
              className="inline-flex items-center gap-1 rounded-md bg-foreground px-2.5 py-1.5 text-xs font-medium text-white hover:bg-foreground/90 disabled:opacity-60"
              title={
                !selectedImage
                  ? "请先选择一张照片"
                  : !selectedVariant
                  ? "请先选择/创建一个方案"
                  : "保存当前画布为该方案的封面（在客户 tab 的方案卡片里展示）"
              }
            >
              {exporting === "cover" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ImageCoverIcon className="h-3.5 w-3.5" />
              )}
              保存为方案封面
            </button>
            <button
              type="button"
              onClick={handleRenderHdCover}
              disabled={
                !selectedImage || !selectedVariant || exporting !== null
              }
              className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-60"
              title={
                !selectedImage
                  ? "请先选择一张照片"
                  : !selectedVariant
                  ? "请先选择/创建一个方案"
                  : "AI 生成高清写实方案封面"
              }
            >
              {exporting === "hd" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              高清渲染
            </button>
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
            <button
              type="button"
              onClick={handleDetectRegions}
              disabled={!selectedImage || detectingRegions || mutating}
              className="inline-flex items-center gap-1 rounded-md border border-purple-200 bg-purple-50 px-2 py-1 text-xs font-medium text-purple-700 hover:bg-purple-100 disabled:cursor-not-allowed disabled:opacity-50"
              title="AI 识别照片中的窗户区域，生成待确认草稿"
            >
              {detectingRegions ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              AI识别窗户
            </button>
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
            style={{ height: "min(70dvh, 540px)", minHeight: 360 }}
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
                aiDraftRegions={detectedRegions}
                onSelectRegion={setSelectedRegionId}
                onSelectProductOption={setSelectedProductOptionId}
                onCreateRegion={handleCreateRegion}
                onUpdateProductOptionTransform={handleUpdateTransform}
                onStageReady={(h) => {
                  stageHandleRef.current = h;
                }}
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

        {/* 移动端遮罩：右侧面板在手机上变成底部抽屉 */}
        {mobilePanelOpen && (
          <button
            type="button"
            aria-label="关闭配置面板"
            onClick={() => setMobilePanelOpen(false)}
            className="fixed inset-0 z-30 bg-black/35 lg:hidden"
          />
        )}

        {/* 右：面板 / 移动端底部抽屉 */}
        <div
          className={cn(
            "fixed inset-x-0 bottom-0 z-40 max-h-[78dvh] overflow-y-auto rounded-t-2xl border border-border/70 bg-white p-3 shadow-2xl transition-transform lg:static lg:z-auto lg:max-h-none lg:translate-y-0 lg:overflow-visible lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none",
            mobilePanelOpen ? "translate-y-0" : "translate-y-full",
          )}
        >
          <div className="mb-3 flex items-center justify-between lg:hidden">
            <div>
              <div className="text-sm font-semibold text-foreground">方案配置</div>
              <div className="text-[11px] text-muted">
                照片、窗户区域、方案与产品都在这里调整
              </div>
            </div>
            <button
              type="button"
              onClick={() => setMobilePanelOpen(false)}
              className="rounded-full border border-border bg-white p-2 text-muted"
              aria-label="关闭配置面板"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex flex-col gap-3">
          {/* 图片列表 */}
          {panelSection(
            "现场照片",
            <Images className="h-3.5 w-3.5 text-muted" />,
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  onClick={() => cameraInputRef.current?.click()}
                  disabled={uploading || autoDetecting}
                  className="flex items-center justify-center gap-1 rounded-md border border-dashed border-blue-200 bg-blue-50/60 px-2 py-2 text-xs text-blue-700 hover:bg-blue-50 disabled:opacity-60"
                  title="调用手机相机直接拍照（仅移动端有效）"
                >
                  {uploading || autoDetecting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ImagePlus className="h-3.5 w-3.5" />
                  )}
                  拍照
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading || autoDetecting}
                  className="flex items-center justify-center gap-1 rounded-md border border-dashed border-border/80 bg-white/40 px-2 py-2 text-xs text-muted hover:text-foreground disabled:opacity-60"
                >
                  {uploading || autoDetecting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ImagePlus className="h-3.5 w-3.5" />
                  )}
                  上传照片
                </button>
                <button
                  onClick={() => setReuseDialogOpen(true)}
                  disabled={uploading || mutating}
                  className="flex items-center justify-center gap-1 rounded-md border border-dashed border-emerald-200 bg-emerald-50/60 px-2 py-2 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
                  title="从该客户的其他可视化方案复用已有现场照片"
                >
                  <Copy className="h-3.5 w-3.5" />
                  复用
                </button>
              </div>
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleUploadImage(file);
                }}
              />
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
              <div className="space-y-2">
                {detectedRegions.length > 0 && (
                  <div className="rounded-lg border border-purple-200 bg-purple-50/70 p-2">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-purple-800">
                        <Sparkles className="h-3 w-3" />
                        AI 识别草稿
                      </div>
                      <button
                        type="button"
                        onClick={() => setDetectedRegions([])}
                        className="text-[10px] text-purple-600 hover:text-purple-900"
                      >
                        清空
                      </button>
                    </div>
                    <ul className="space-y-1">
                      {detectedRegions.map((draft) => {
                        const [[x1, y1], [x2, y2]] = draft.points;
                        return (
                          <li
                            key={draft.id}
                            className="rounded-md border border-purple-100 bg-white/80 px-2 py-1.5 text-xs"
                          >
                            <div className="flex items-center gap-2">
                              <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                                {draft.label}
                              </span>
                              <span className="text-[10px] text-purple-600">
                                {Math.round(draft.confidence * 100)}%
                              </span>
                            </div>
                            <div className="mt-0.5 text-[10px] text-muted">
                              {Math.round(x2 - x1)}×{Math.round(y2 - y1)} px ·
                              ({Math.round(x1)}, {Math.round(y1)})
                            </div>
                            {draft.reason && (
                              <div className="mt-0.5 line-clamp-2 text-[10px] text-muted">
                                {draft.reason}
                              </div>
                            )}
                            <div className="mt-1 flex justify-end gap-1">
                              <button
                                type="button"
                                onClick={() =>
                                  setDetectedRegions((prev) =>
                                    prev.filter((x) => x.id !== draft.id),
                                  )
                                }
                                className="rounded border border-border bg-white px-2 py-1 text-[10px] text-muted hover:text-foreground"
                              >
                                忽略
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleAcceptDetectedRegion(draft)}
                                disabled={mutating}
                                className="rounded bg-purple-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-purple-700 disabled:opacity-60"
                              >
                                添加为窗户
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
                {selectedImage.regions.length === 0 ? (
                  <div className="text-[11px] text-muted">
                    使用上方工具栏的矩形/多边形工具标记窗户，或点击 AI 识别生成草稿
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
                              void handleCleanRegion(region.id);
                            }}
                            disabled={mutating || cleaningRegionId !== null}
                            className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-1 text-[10px] text-purple-700 hover:bg-purple-50 disabled:opacity-60"
                            title="AI 清理该区域内的旧窗帘/杂物，生成新现场图"
                          >
                            {cleaningRegionId === region.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Sparkles className="h-3 w-3" />
                            )}
                            AI清理
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleDeleteRegion(region.id);
                            }}
                            disabled={mutating}
                            className="rounded p-1 text-muted hover:bg-red-50 hover:text-red-600 disabled:opacity-60"
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

          <ReusePhotosDialog
            open={reuseDialogOpen}
            sessionId={session.id}
            onClose={() => setReuseDialogOpen(false)}
            onImported={(summary) => {
              setReuseDialogOpen(false);
              if (summary.imported === 0 && summary.skipped === 0) {
                alert("没有可复用的照片");
                return;
              }
              const msg =
                summary.skipped > 0
                  ? `成功复用 ${summary.imported} 张，跳过 ${summary.skipped} 张重复。`
                  : `成功复用 ${summary.imported} 张照片。`;
              void load().then(() => alert(msg));
            }}
          />

          {/* 产品面板 */}
          {panelSection(
            "产品库",
            <Plus className="h-3.5 w-3.5 text-muted" />,
            !selectedVariant ? (
              <div className="text-[11px] text-muted">请先选择或创建一个方案</div>
            ) : !selectedRegionId ? (
              <div className="text-[11px] text-muted">
                请先在画布上点选一个窗户区域
              </div>
            ) : (
              <ProductPanel
                catalog={catalog}
                catalogLoading={catalogLoading}
                catalogError={catalogError}
                currentOption={currentRegionOption}
                selectedProductOption={selectedProductOption}
                onPick={handlePickProduct}
                onPatch={handlePatchProductOption}
                onDelete={handleDeleteProductOption}
                onApplyToAll={handleApplyToAllRegions}
                applyAllBusy={applyAllBusy}
                regionsOnImage={selectedImage?.regions.length ?? 0}
                onCreateRequest={() => {
                  setCatalogEditing(null);
                  setCatalogDialogOpen(true);
                }}
                onEditRequest={(p) => {
                  setCatalogEditing(p);
                  setCatalogDialogOpen(true);
                }}
                onArchiveRequest={handleArchiveCatalog}
              />
            ),
          )}
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setMobilePanelOpen(true)}
        className="fixed bottom-4 right-4 z-30 inline-flex items-center gap-1 rounded-full bg-foreground px-4 py-3 text-sm font-medium text-white shadow-xl lg:hidden"
      >
        <Layers className="h-4 w-4" />
        配置
      </button>

      <ShareDialog
        open={shareDialogOpen}
        session={session}
        onClose={() => setShareDialogOpen(false)}
        onChanged={() => {
          void load();
        }}
      />

      <PresentationMode
        open={presentationOpen}
        session={session}
        initialImageId={selectedImageId}
        initialVariantId={selectedVariantId}
        onClose={() => setPresentationOpen(false)}
      />

      <CatalogProductDialog
        open={catalogDialogOpen}
        orgId={currentOrgId}
        editing={catalogEditing}
        onClose={() => setCatalogDialogOpen(false)}
        onSaved={() => {
          setCatalogDialogOpen(false);
          setCatalogEditing(null);
          void loadCatalog();
        }}
      />

      <ComparisonMode
        open={compareOpen}
        title={`${session.title} · A/B 对比`}
        subtitle={
          selectedImage ? (selectedImage.roomLabel || selectedImage.fileName) : null
        }
        image={mapCompareImage(selectedImage)}
        variantA={mapCompareVariant(
          session.variants.find((v) => v.id === compareVariantAId) ?? null,
        )}
        variantB={mapCompareVariant(
          session.variants.find((v) => v.id === compareVariantBId) ?? null,
        )}
        variantOptions={session.variants.map((v) => ({ id: v.id, name: v.name }))}
        onChangeVariantA={setCompareVariantAId}
        onChangeVariantB={setCompareVariantBId}
        onClose={() => setCompareOpen(false)}
      />
    </div>
  );
}

/** SessionEditor 内部的 image → CompareImage 映射 */
function mapCompareImage(
  image: VisualizerSourceImageSummary | null | undefined,
): CompareImage | null {
  if (!image) return null;
  return {
    id: image.id,
    fileUrl: image.fileUrl,
    width: image.width,
    height: image.height,
    regions: image.regions.map((r) => ({
      id: r.id,
      shape: r.shape,
      points: r.points,
    })),
  };
}

/** SessionEditor 内部的 variant → CompareVariantInput 映射 */
function mapCompareVariant(
  variant: VisualizerVariantSummary | null | undefined,
): CompareVariantInput | null {
  if (!variant) return null;
  return {
    id: variant.id,
    name: variant.name,
    exportImageUrl: variant.exportImageUrl,
    options: variant.productOptions.map((p) => ({
      regionId: p.regionId,
      colorHex: p.colorHex,
      opacity: p.opacity,
    })),
  };
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

