"use client";

/**
 * ShareViewer — 客户公开只读视图
 *
 * 设计目标：
 * - 不依赖项目登录态、不调用 apiFetch（避免误跳登录）
 * - 简单清爽：底图 + 当前 variant 的产品叠加 + 底部 variant 缩略图条
 * - 客户可点「我喜欢这套」记录偏好（写入 VisualizerSelection）
 * - 支持多张照片（一户多窗 / 多个房间）
 *
 * 渲染：
 * - 优先 `variant.exportImageUrl`（销售已保存或 HD 渲染过）
 * - 否则用 HTML <canvas> 实时绘制：底图 + 每 region 半透明色块（colorHex/opacity）
 *   不引入 Konva（公开页越轻越好）
 *
 * 安全：
 * - 全部数据来自服务端校验过的 token；本组件仅展示
 * - 顶部固定水印（防截图）
 * - selectedVariantId / anonId 缓存在 localStorage，幂等
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Heart,
  Loader2,
  ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  VisualizerSharePublicDetail,
  VisualizerSharePublicImage,
  VisualizerSharePublicVariant,
} from "@/lib/visualizer/types";
import ComparisonMode, {
  type CompareImage,
  type CompareVariantInput,
} from "@/app/(main)/sales/visualizer/[sessionId]/comparison-mode";

const ANON_KEY = "qy_visualizer_share_anon";

function ensureAnonId(): string {
  if (typeof window === "undefined") return "";
  try {
    const cur = localStorage.getItem(ANON_KEY);
    if (cur && /^[a-zA-Z0-9_-]{8,64}$/.test(cur)) return cur;
    const next = `vs-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36).slice(-6)}`;
    localStorage.setItem(ANON_KEY, next);
    return next;
  } catch {
    return "";
  }
}

interface ShareViewerProps {
  token: string;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ok"; data: VisualizerSharePublicDetail }
  | { kind: "error"; status: number; message: string };

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

export default function ShareViewer({ token }: ShareViewerProps) {
  const [anonId, setAnonId] = useState<string>("");
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [imageId, setImageId] = useState<string | null>(null);
  const [variantId, setVariantId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareAId, setCompareAId] = useState<string | null>(null);
  const [compareBId, setCompareBId] = useState<string | null>(null);

  useEffect(() => {
    setAnonId(ensureAnonId());
  }, []);

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const url = `/api/visualizer/share/${encodeURIComponent(token)}${anonId ? `?anonId=${encodeURIComponent(anonId)}` : ""}`;
      const res = await fetch(url, { credentials: "omit", cache: "no-store" });
      if (res.status === 410) {
        setState({ kind: "error", status: 410, message: "链接已过期，请联系销售获取新的链接。" });
        return;
      }
      if (res.status === 404) {
        setState({ kind: "error", status: 404, message: "链接无效。请确认链接是否完整。" });
        return;
      }
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setState({ kind: "error", status: res.status, message: j.error ?? "无法加载" });
        return;
      }
      const data = (await res.json()) as VisualizerSharePublicDetail;
      setState({ kind: "ok", data });
      setImageId((cur) => cur ?? data.sourceImages[0]?.id ?? null);
      setVariantId(
        (cur) => cur ?? data.selectedVariantId ?? data.variants[0]?.id ?? null,
      );
    } catch {
      setState({ kind: "error", status: 0, message: "网络异常，请重试。" });
    }
  }, [token, anonId]);

  useEffect(() => {
    if (anonId !== "") void load();
  }, [load, anonId]);

  const data = state.kind === "ok" ? state.data : null;

  const image = useMemo<VisualizerSharePublicImage | null>(() => {
    if (!data || !imageId) return null;
    return data.sourceImages.find((i) => i.id === imageId) ?? null;
  }, [data, imageId]);

  const variant = useMemo<VisualizerSharePublicVariant | null>(() => {
    if (!data || !variantId) return null;
    return data.variants.find((v) => v.id === variantId) ?? null;
  }, [data, variantId]);

  const cycleVariant = useCallback(
    (delta: number) => {
      if (!data || data.variants.length === 0) return;
      const idx = data.variants.findIndex((v) => v.id === variantId);
      const next = (idx + delta + data.variants.length) % data.variants.length;
      setVariantId(data.variants[next]?.id ?? null);
    },
    [data, variantId],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") cycleVariant(1);
      if (e.key === "ArrowLeft") cycleVariant(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cycleVariant]);

  const submitSelectionFor = useCallback(
    async (vid: string, opts?: { compared?: string | null }) => {
      if (!data || !vid || !anonId) return;
      setSubmitting(true);
      try {
        const note = opts?.compared ? `compared:${opts.compared}` : null;
        const res = await fetch(`/api/visualizer/share/${encodeURIComponent(token)}/select`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "omit",
          body: JSON.stringify({ variantId: vid, anonId, note }),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          setHint(j.error ?? "提交失败，请稍后再试");
          return;
        }
        setState((prev) =>
          prev.kind === "ok"
            ? { ...prev, data: { ...prev.data, selectedVariantId: vid } }
            : prev,
        );
        setHint("已记录！销售会看到您的选择。");
        setTimeout(() => setHint(null), 3500);
      } catch {
        setHint("网络异常，请重试");
      } finally {
        setSubmitting(false);
      }
    },
    [token, anonId, data],
  );

  const submitSelection = async () => {
    if (!variantId || submitting) return;
    await submitSelectionFor(variantId);
  };

  if (state.kind === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 text-white">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 px-6 text-center text-white">
        <div className="max-w-md space-y-3">
          <ShieldAlert className="mx-auto h-10 w-10 text-amber-400" />
          <h1 className="text-lg font-semibold">{state.status === 410 ? "链接已过期" : "无法打开"}</h1>
          <p className="text-sm text-white/70">{state.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-white">
      <Header title={data!.title} customerName={data!.customerName} expiresAt={data!.expiresAt} />

      <main className="relative flex-1">
        {data!.sourceImages.length > 1 && (
          <div className="absolute left-3 top-3 z-10 flex flex-wrap gap-1 rounded-full bg-black/40 p-1 backdrop-blur">
            {data!.sourceImages.map((img) => (
              <button
                key={img.id}
                onClick={() => setImageId(img.id)}
                className={cn(
                  "rounded-full px-2.5 py-1 text-[11px] font-medium",
                  img.id === imageId
                    ? "bg-white text-black"
                    : "text-white/70 hover:bg-white/10 hover:text-white",
                )}
              >
                {img.roomLabel || "现场照"}
              </button>
            ))}
          </div>
        )}

        {data!.variants.length > 1 && (
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

        <Stage image={image} variant={variant} />
      </main>

      {/* 偏好按钮 */}
      <div className="border-t border-white/10 bg-black/70 px-3 py-2 backdrop-blur">
        <div className="mb-2 flex items-center gap-2 text-xs text-white/80">
          <span className="truncate">
            当前方案：<strong className="text-white">{variant?.name ?? "—"}</strong>
          </span>
          {data!.variants.length >= 2 && (
            <button
              type="button"
              onClick={() => {
                const a = variantId ?? data!.variants[0]?.id ?? null;
                const b = data!.variants.find((v) => v.id !== a)?.id ?? null;
                setCompareAId(a);
                setCompareBId(b);
                setCompareOpen(true);
              }}
              className="ml-auto inline-flex items-center gap-1 rounded-md border border-white/30 bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/20"
              title="A/B 对比两个方案"
            >
              <ArrowLeftRight className="h-3.5 w-3.5" />
              对比
            </button>
          )}
          <button
            type="button"
            onClick={submitSelection}
            disabled={!variantId || submitting}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium",
              data!.variants.length < 2 ? "ml-auto" : "",
              data!.selectedVariantId === variantId
                ? "bg-emerald-500/90 text-white hover:bg-emerald-500"
                : "bg-white text-black hover:bg-white/90",
              "disabled:opacity-60",
            )}
          >
            {data!.selectedVariantId === variantId ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : (
              <Heart className="h-3.5 w-3.5" />
            )}
            {submitting
              ? "提交中…"
              : data!.selectedVariantId === variantId
              ? "已选这套"
              : "我喜欢这套"}
          </button>
        </div>
        {hint && (
          <div className="mb-1 text-center text-[11px] text-emerald-300">{hint}</div>
        )}
        <VariantStrip
          variants={data!.variants}
          activeId={variantId}
          selectedVariantId={data!.selectedVariantId}
          onPick={setVariantId}
        />
      </div>

      <ComparisonMode
        open={compareOpen}
        title={`${data!.title} · A/B 对比`}
        subtitle={image ? image.roomLabel : null}
        image={mapShareCompareImage(image)}
        variantA={mapShareCompareVariant(
          data!.variants.find((v) => v.id === compareAId) ?? null,
        )}
        variantB={mapShareCompareVariant(
          data!.variants.find((v) => v.id === compareBId) ?? null,
        )}
        variantOptions={data!.variants.map((v) => ({ id: v.id, name: v.name }))}
        onChangeVariantA={setCompareAId}
        onChangeVariantB={setCompareBId}
        selectedVariantId={data!.selectedVariantId}
        onSelectVariant={async (vid) => {
          const other = vid === compareAId ? compareBId : compareAId;
          await submitSelectionFor(vid, { compared: other });
        }}
        isPublic
        onClose={() => setCompareOpen(false)}
      />
    </div>
  );
}

function mapShareCompareImage(
  image: VisualizerSharePublicImage | null,
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

function mapShareCompareVariant(
  variant: VisualizerSharePublicVariant | null,
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

function Header({
  title,
  customerName,
  expiresAt,
}: {
  title: string;
  customerName: string;
  expiresAt: string;
}) {
  return (
    <header className="flex items-center justify-between gap-3 border-b border-white/10 bg-black/40 px-4 py-2 backdrop-blur">
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-white">{title}</div>
        <div className="truncate text-[11px] text-white/60">
          客户：{customerName} · 链接有效至 {fmtDate(expiresAt)}
        </div>
      </div>
      <div className="select-none text-[10px] text-white/40">青砚 · 仅供查看</div>
    </header>
  );
}

function VariantStrip(props: {
  variants: VisualizerSharePublicVariant[];
  activeId: string | null;
  selectedVariantId: string | null;
  onPick: (id: string) => void;
}) {
  const { variants, activeId, selectedVariantId, onPick } = props;
  if (variants.length === 0) {
    return <div className="text-center text-[11px] text-white/60">销售尚未创建方案</div>;
  }
  return (
    <div className="flex items-center gap-2 overflow-x-auto">
      {variants.map((v) => {
        const active = v.id === activeId;
        const liked = v.id === selectedVariantId;
        return (
          <button
            key={v.id}
            onClick={() => onPick(v.id)}
            className={cn(
              "relative flex shrink-0 items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition",
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
                {v.productOptions.length} 处产品
              </div>
            </div>
            {liked && (
              <span className="absolute right-1 top-1 rounded-full bg-emerald-500 p-0.5">
                <CheckCircle2 className="h-3 w-3 text-white" />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Stage：底图 + 各窗 region 半透明色块叠加（参考客户演示）
 *
 * 优先用 variant.exportImageUrl（高清封面）；否则按 region 实时绘制 colorHex/opacity。
 */
function Stage({
  image,
  variant,
}: {
  image: VisualizerSharePublicImage | null;
  variant: VisualizerSharePublicVariant | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [container, setContainer] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const cr = entry.contentRect;
        setContainer({ w: Math.floor(cr.width), h: Math.floor(cr.height) });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 用导出封面：直接 <img>，干净清晰
  const exportUrl = variant?.exportImageUrl ?? null;

  // Canvas 实时绘制 fallback
  useEffect(() => {
    if (exportUrl) return; // 用 <img>，不需要 canvas
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cw = container.w;
    const ch = container.h;
    if (!cw || !ch) return;
    canvas.width = cw;
    canvas.height = ch;
    ctx.clearRect(0, 0, cw, ch);

    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const iw = image.width || img.naturalWidth;
      const ih = image.height || img.naturalHeight;
      if (!iw || !ih) return;
      const scale = Math.min(cw / iw, ch / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      const dx = (cw - dw) / 2;
      const dy = (ch - dh) / 2;
      ctx.drawImage(img, 0, 0, iw, ih, dx, dy, dw, dh);

      // 叠加 productOptions
      if (variant) {
        for (const po of variant.productOptions) {
          const region = image.regions.find((r) => r.id === po.regionId);
          if (!region) continue;
          ctx.save();
          ctx.beginPath();
          if (region.shape === "rect") {
            const xs = region.points.map((p) => p[0]);
            const ys = region.points.map((p) => p[1]);
            const x1 = Math.min(...xs);
            const y1 = Math.min(...ys);
            const x2 = Math.max(...xs);
            const y2 = Math.max(...ys);
            ctx.rect(dx + x1 * scale, dy + y1 * scale, (x2 - x1) * scale, (y2 - y1) * scale);
          } else {
            const pts = region.points;
            if (pts.length === 0) {
              ctx.restore();
              continue;
            }
            ctx.moveTo(dx + pts[0][0] * scale, dy + pts[0][1] * scale);
            for (let i = 1; i < pts.length; i++) {
              ctx.lineTo(dx + pts[i][0] * scale, dy + pts[i][1] * scale);
            }
            ctx.closePath();
          }
          ctx.fillStyle = po.colorHex || "#cccccc";
          ctx.globalAlpha = Math.max(0, Math.min(1, po.opacity));
          ctx.fill();
          ctx.restore();
        }
      }

      // 水印
      ctx.save();
      ctx.font = "12px sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fillText("青砚 · 仅供客户查看", 12, ch - 12);
      ctx.restore();
    };
    img.src = image.fileUrl;

    return () => {
      img.onload = null;
    };
  }, [container, image, variant, exportUrl]);

  return (
    <div ref={containerRef} className="relative h-full w-full">
      {exportUrl ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={exportUrl} alt={variant?.name ?? "方案预览"} className="h-full w-full object-contain" />
          <div className="pointer-events-none absolute bottom-3 left-3 rounded bg-black/40 px-2 py-1 text-[10px] text-white/60">
            青砚 · 仅供客户查看
          </div>
        </>
      ) : image ? (
        <canvas ref={canvasRef} className="block h-full w-full" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-sm text-white/60">
          销售尚未上传现场照片
        </div>
      )}
    </div>
  );
}
