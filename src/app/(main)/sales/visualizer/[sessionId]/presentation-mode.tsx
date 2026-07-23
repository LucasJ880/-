"use client";

/**
 * PresentationMode — 客户演示全屏
 *
 * - 全屏遮罩 + 大画布 + 底部 variant 缩略图条
 * - 隐藏所有编辑工具/面板，只保留切换 variant、切换 image、退出
 * - 左右键 / 滑动切换 variant；ESC 退出
 *
 * 渲染策略：
 * - 优先使用 variant.exportImageUrl（销售保存的封面 / HD 渲染）
 * - 否则退回到 sourceImage + Konva 实时叠加（动态 import VisualizerStage）
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  ArrowLeftRight,
  ChevronLeft,
  ChevronRight,
  Loader2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { lockAppScroll } from "@/lib/mobile/scroll-lock";
import type {
  VisualizerSessionDetail,
  VisualizerSourceImageSummary,
  VisualizerVariantSummary,
} from "@/lib/visualizer/types";
import ComparisonMode, {
  type CompareImage,
  type CompareVariantInput,
} from "./comparison-mode";

const VisualizerStage = dynamic(() => import("./visualizer-stage"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-black text-xs text-white/80">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 画布加载中…
    </div>
  ),
});

interface PresentationModeProps {
  open: boolean;
  session: VisualizerSessionDetail;
  initialImageId: string | null;
  initialVariantId: string | null;
  onClose: () => void;
}

export default function PresentationMode(props: PresentationModeProps) {
  const { open, session, initialImageId, initialVariantId, onClose } = props;

  const [imageId, setImageId] = useState<string | null>(initialImageId);
  const [variantId, setVariantId] = useState<string | null>(initialVariantId);
  const [stageSize, setStageSize] = useState({ width: 1280, height: 720 });
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareAId, setCompareAId] = useState<string | null>(null);
  const [compareBId, setCompareBId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setImageId(initialImageId ?? session.sourceImages[0]?.id ?? null);
    setVariantId(initialVariantId ?? session.variants[0]?.id ?? null);
  }, [open, initialImageId, initialVariantId, session.sourceImages, session.variants]);

  // ESC 退出
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") cycleVariant(1);
      if (e.key === "ArrowLeft") cycleVariant(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, variantId, session.variants]);

  // 锁定 AppShell 主滚动（引用计数）
  useEffect(() => {
    if (!open) return;
    return lockAppScroll("visualizer-presentation");
  }, [open]);

  // 容器尺寸
  useEffect(() => {
    if (!open) return;
    const compute = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      setStageSize({
        width: Math.max(640, w),
        height: Math.max(360, h - 132),
      });
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, [open]);

  const image = useMemo<VisualizerSourceImageSummary | null>(() => {
    if (!imageId) return null;
    return session.sourceImages.find((i) => i.id === imageId) ?? null;
  }, [imageId, session.sourceImages]);

  const variant = useMemo<VisualizerVariantSummary | null>(() => {
    if (!variantId) return null;
    return session.variants.find((v) => v.id === variantId) ?? null;
  }, [variantId, session.variants]);

  const cycleVariant = useCallback(
    (delta: number) => {
      if (session.variants.length === 0) return;
      const idx = session.variants.findIndex((v) => v.id === variantId);
      const next =
        (idx + delta + session.variants.length) % session.variants.length;
      setVariantId(session.variants[next]?.id ?? null);
    },
    [session.variants, variantId],
  );

  if (!open) return null;

  const exportUrl = variant?.exportImageUrl ?? null;

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-black">
      {/* 顶栏 */}
      <div className="flex items-center justify-between gap-3 px-4 py-2 text-white">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{session.title}</div>
          <div className="truncate text-[11px] text-white/60">
            客户演示 · {session.customer.name}
            {variant ? ` · ${variant.name}` : ""}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {session.sourceImages.length > 1 && (
            <select
              value={imageId ?? ""}
              onChange={(e) => setImageId(e.target.value || null)}
              className="rounded-md border border-white/30 bg-white/10 px-2 py-1 text-xs text-white"
            >
              {session.sourceImages.map((img) => (
                <option key={img.id} value={img.id} className="text-black">
                  {img.roomLabel || img.fileName}
                </option>
              ))}
            </select>
          )}
          {session.variants.length >= 2 && (
            <button
              type="button"
              onClick={() => {
                const a =
                  variantId && session.variants.some((v) => v.id === variantId)
                    ? variantId
                    : session.variants[0]?.id ?? null;
                const b =
                  session.variants.find((v) => v.id !== a)?.id ?? null;
                setCompareAId(a);
                setCompareBId(b);
                setCompareOpen(true);
              }}
              className="inline-flex items-center gap-1 rounded-md border border-purple-300/70 bg-purple-500/30 px-3 py-1.5 text-xs text-white hover:bg-purple-500/50"
              title="A/B 对比两个方案"
            >
              <ArrowLeftRight className="h-4 w-4" />
              A/B 对比
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1 rounded-md border border-white/30 bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/20"
          >
            <X className="h-4 w-4" />
            退出演示
          </button>
        </div>
      </div>

      {/* 画布 */}
      <div className="relative flex-1 overflow-hidden">
        {session.variants.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => cycleVariant(-1)}
              aria-label="上一套方案"
              className="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/15 p-2 text-white hover:bg-white/30"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
            <button
              type="button"
              onClick={() => cycleVariant(1)}
              aria-label="下一套方案"
              className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/15 p-2 text-white hover:bg-white/30"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          </>
        )}

        {exportUrl ? (
          // 优先用销售已保存 / HD 渲染过的封面，更清晰且不依赖 Konva
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={exportUrl}
            alt={variant?.name ?? "方案预览"}
            className="h-full w-full object-contain"
          />
        ) : image ? (
          <VisualizerStage
            image={image}
            variant={variant}
            tool="move"
            width={stageSize.width}
            height={stageSize.height}
            selectedRegionId={null}
            selectedProductOptionId={null}
            aiDraftRegions={[]}
            onSelectRegion={() => {}}
            onSelectProductOption={() => {}}
            onCreateRegion={() => {}}
            onUpdateProductOptionTransform={() => {}}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm text-white/70">
            尚未选择照片
          </div>
        )}
      </div>

      {/* 底部 variant 缩略图条 */}
      <div className="border-t border-white/10 bg-black/80 px-3 py-2">
        {session.variants.length === 0 ? (
          <div className="text-center text-[11px] text-white/60">尚未创建方案</div>
        ) : (
          <div className="flex items-center gap-2 overflow-x-auto">
            {session.variants.map((v) => {
              const active = v.id === variantId;
              return (
                <button
                  key={v.id}
                  onClick={() => setVariantId(v.id)}
                  className={cn(
                    "group flex shrink-0 items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition",
                    active
                      ? "border-amber-400 bg-amber-400/10 text-white"
                      : "border-white/20 bg-white/5 text-white/80 hover:bg-white/10",
                  )}
                >
                  {v.exportImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={v.exportImageUrl}
                      alt={v.name}
                      className="h-12 w-16 shrink-0 rounded object-cover"
                    />
                  ) : (
                    <div className="flex h-12 w-16 shrink-0 items-center justify-center rounded border border-white/20 bg-white/10 text-[10px] text-white/60">
                      预览
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="truncate font-medium">{v.name}</div>
                    <div className="text-[10px] text-white/60">
                      {v.productOptionCount} 处产品
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <ComparisonMode
        open={compareOpen}
        title={`${session.title} · A/B 对比`}
        subtitle={image ? image.roomLabel || image.fileName : null}
        image={mapPresentationCompareImage(image)}
        variantA={mapPresentationCompareVariant(
          session.variants.find((v) => v.id === compareAId) ?? null,
        )}
        variantB={mapPresentationCompareVariant(
          session.variants.find((v) => v.id === compareBId) ?? null,
        )}
        variantOptions={session.variants.map((v) => ({ id: v.id, name: v.name }))}
        onChangeVariantA={setCompareAId}
        onChangeVariantB={setCompareBId}
        onClose={() => setCompareOpen(false)}
      />
    </div>
  );
}

function mapPresentationCompareImage(
  image: VisualizerSourceImageSummary | null,
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

function mapPresentationCompareVariant(
  variant: VisualizerVariantSummary | null,
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
