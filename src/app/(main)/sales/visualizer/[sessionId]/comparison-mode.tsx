"use client";

/**
 * ComparisonMode — A/B 方案对比全屏
 *
 * 用途：销售或客户在同一画面里左右对比两个 variant，帮助客户做最终决定。
 *
 * 复用：销售编辑页 / 客户演示模式 / 公开分享页（公开页强制水印 + 选择回调）
 *
 * 接口：通过抽象 Compare* 类型解耦数据来源，调用方各自把自己的 variant/image 转成最小入参。
 *
 * 渲染策略：
 * - 优先 variant.exportImageUrl（已保存封面 / HD 渲染）→ 直接 <img>，最快最清
 * - 否则用 <canvas> 实时绘制：底图 + 半透明色块叠加（不引入 Konva，公开页保持轻量）
 *
 * 模式：
 * - side-by-side：左右各一半（窄屏自动上下排）
 * - slider：两层叠加，中间分隔条左右拖动揭示
 *
 * 客户选择回调：
 * - 若提供 onSelectVariant，左右各一个「我喜欢这套」按钮，点了即写入 selection
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  ArrowLeftRight,
  CheckCircle2,
  Heart,
  Layers,
  Loader2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { lockAppScroll } from "@/lib/mobile/scroll-lock";

export type CompareMode = "side-by-side" | "slider";

export interface CompareRegion {
  id: string;
  shape: "rect" | "polygon";
  points: Array<[number, number]>;
}

export interface CompareImage {
  id: string;
  fileUrl: string;
  width: number | null;
  height: number | null;
  regions: CompareRegion[];
}

export interface CompareProductOption {
  regionId: string;
  colorHex: string | null;
  opacity: number;
}

export interface CompareVariantInput {
  id: string;
  name: string;
  exportImageUrl: string | null;
  options: CompareProductOption[];
}

export interface CompareVariantOption {
  id: string;
  name: string;
}

export interface ComparisonModeProps {
  open: boolean;

  /** 顶栏标题（如：客户家 · 主卧），副标题（如：客户偏好待确认） */
  title: string;
  subtitle?: string | null;

  image: CompareImage | null;

  variantA: CompareVariantInput | null;
  variantB: CompareVariantInput | null;

  /** 可在对比模式中切换的全部 variant（用于 A/B 下拉） */
  variantOptions: CompareVariantOption[];
  onChangeVariantA: (id: string) => void;
  onChangeVariantB: (id: string) => void;

  /** 客户偏好回调：传入则显示「我喜欢这套」按钮 */
  onSelectVariant?: (variantId: string) => Promise<void> | void;
  /** 当前已被客户标记的 variantId（用于按钮态展示） */
  selectedVariantId?: string | null;

  /** 公开页：强制底部水印 */
  isPublic?: boolean;

  onClose: () => void;
}

export default function ComparisonMode(props: ComparisonModeProps) {
  const {
    open,
    title,
    subtitle,
    image,
    variantA,
    variantB,
    variantOptions,
    onChangeVariantA,
    onChangeVariantB,
    onSelectVariant,
    selectedVariantId,
    isPublic,
    onClose,
  } = props;

  const [mode, setMode] = useState<CompareMode>("side-by-side");
  const [sliderPct, setSliderPct] = useState(50);
  const [submittingSide, setSubmittingSide] = useState<"A" | "B" | null>(null);

  // ESC 退出
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // 锁定 body 滚动
  useEffect(() => {
    if (!open) return;
    return lockAppScroll("visualizer-comparison");
  }, [open]);

  const handleSelect = useCallback(
    async (variant: CompareVariantInput | null, side: "A" | "B") => {
      if (!variant || !onSelectVariant || submittingSide) return;
      setSubmittingSide(side);
      try {
        await onSelectVariant(variant.id);
      } finally {
        setSubmittingSide(null);
      }
    },
    [onSelectVariant, submittingSide],
  );

  const swapAB = () => {
    if (!variantA || !variantB) return;
    const a = variantA.id;
    const b = variantB.id;
    onChangeVariantA(b);
    onChangeVariantB(a);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-black text-white">
      {/* 顶栏 */}
      <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-black/80 px-4 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{title}</div>
          {subtitle ? (
            <div className="truncate text-[11px] text-white/60">{subtitle}</div>
          ) : (
            <div className="truncate text-[11px] text-white/60">
              方案 A/B 对比 · ESC 退出
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {/* 模式切换 */}
          <div className="hidden items-center gap-0.5 rounded-md border border-white/20 bg-white/5 p-0.5 sm:flex">
            <ModeBtn active={mode === "side-by-side"} onClick={() => setMode("side-by-side")}>
              <Layers className="h-3.5 w-3.5" /> 并排
            </ModeBtn>
            <ModeBtn active={mode === "slider"} onClick={() => setMode("slider")}>
              <ArrowLeftRight className="h-3.5 w-3.5" /> 滑块
            </ModeBtn>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1 rounded-md border border-white/30 bg-white/10 px-3 py-1.5 text-xs hover:bg-white/20"
          >
            <X className="h-4 w-4" />
            退出
          </button>
        </div>
      </div>

      {/* A/B 选择条 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-black/60 px-4 py-2 text-[11px]">
        <SidePicker
          label="A"
          accent="amber"
          variantOptions={variantOptions}
          currentId={variantA?.id ?? null}
          excludeId={variantB?.id ?? null}
          onChange={onChangeVariantA}
        />
        <button
          type="button"
          onClick={swapAB}
          disabled={!variantA || !variantB}
          title="互换 A 与 B"
          className="rounded-md border border-white/20 bg-white/5 p-1.5 text-white/80 hover:bg-white/10 disabled:opacity-40"
        >
          <ArrowLeftRight className="h-3.5 w-3.5" />
        </button>
        <SidePicker
          label="B"
          accent="sky"
          variantOptions={variantOptions}
          currentId={variantB?.id ?? null}
          excludeId={variantA?.id ?? null}
          onChange={onChangeVariantB}
        />

        {/* 客户偏好按钮（移动端单独放） */}
        {onSelectVariant && (
          <div className="ml-auto flex items-center gap-1.5">
            <SelectButton
              label="A 我喜欢"
              variant={variantA}
              accent="amber"
              isSelected={!!variantA && selectedVariantId === variantA.id}
              busy={submittingSide === "A"}
              onClick={() => handleSelect(variantA, "A")}
            />
            <SelectButton
              label="B 我喜欢"
              variant={variantB}
              accent="sky"
              isSelected={!!variantB && selectedVariantId === variantB.id}
              busy={submittingSide === "B"}
              onClick={() => handleSelect(variantB, "B")}
            />
          </div>
        )}
      </div>

      {/* 主体 */}
      <div className="relative flex-1 overflow-hidden bg-black">
        {!image ? (
          <div className="flex h-full w-full items-center justify-center text-sm text-white/60">
            尚未选择照片
          </div>
        ) : !variantA || !variantB ? (
          <div className="flex h-full w-full items-center justify-center text-sm text-white/60">
            请至少创建两个方案才能进行 A/B 对比
          </div>
        ) : mode === "side-by-side" ? (
          <SideBySide image={image} variantA={variantA} variantB={variantB} />
        ) : (
          <SliderCompare
            image={image}
            variantA={variantA}
            variantB={variantB}
            pct={sliderPct}
            onPct={setSliderPct}
          />
        )}

        {isPublic && (
          <div className="pointer-events-none absolute bottom-3 left-3 rounded bg-black/40 px-2 py-1 text-[10px] text-white/60">
            青砚 · 仅供客户查看
          </div>
        )}
      </div>
    </div>
  );
}

function ModeBtn(props: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded px-2 py-1 text-[11px]",
        props.active ? "bg-white text-black" : "text-white/80 hover:bg-white/10",
      )}
    >
      {props.children}
    </button>
  );
}

function SidePicker(props: {
  label: "A" | "B";
  accent: "amber" | "sky";
  variantOptions: CompareVariantOption[];
  currentId: string | null;
  excludeId: string | null;
  onChange: (id: string) => void;
}) {
  const { label, accent, variantOptions, currentId, excludeId, onChange } = props;
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={cn(
          "inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold",
          accent === "amber"
            ? "bg-amber-400 text-black"
            : "bg-sky-400 text-black",
        )}
      >
        {label}
      </span>
      <select
        value={currentId ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-white/20 bg-white/10 px-2 py-1 text-xs text-white"
      >
        {variantOptions.map((v) => (
          <option
            key={v.id}
            value={v.id}
            disabled={v.id === excludeId}
            className="text-black"
          >
            {v.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function SelectButton(props: {
  label: string;
  variant: CompareVariantInput | null;
  accent: "amber" | "sky";
  isSelected: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  const { label, variant, accent, isSelected, busy, onClick } = props;
  return (
    <button
      type="button"
      disabled={!variant || busy}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition disabled:opacity-50",
        isSelected
          ? "bg-emerald-500 text-white"
          : accent === "amber"
            ? "bg-amber-300 text-black hover:bg-amber-200"
            : "bg-sky-300 text-black hover:bg-sky-200",
      )}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : isSelected ? (
        <CheckCircle2 className="h-3.5 w-3.5" />
      ) : (
        <Heart className="h-3.5 w-3.5" />
      )}
      {isSelected ? "已选" : label}
    </button>
  );
}

/** 并排：flex 左右各一份；窄屏 fallback 上下排 */
function SideBySide(props: {
  image: CompareImage;
  variantA: CompareVariantInput;
  variantB: CompareVariantInput;
}) {
  return (
    <div className="flex h-full w-full flex-col sm:flex-row">
      <div className="relative h-1/2 w-full border-b border-white/10 sm:h-full sm:w-1/2 sm:border-b-0 sm:border-r">
        <SideLabel side="A" name={props.variantA.name} />
        <CompositeStage image={props.image} variant={props.variantA} />
      </div>
      <div className="relative h-1/2 w-full sm:h-full sm:w-1/2">
        <SideLabel side="B" name={props.variantB.name} />
        <CompositeStage image={props.image} variant={props.variantB} />
      </div>
    </div>
  );
}

function SideLabel(props: { side: "A" | "B"; name: string }) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute left-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold backdrop-blur",
        props.side === "A"
          ? "bg-amber-400/90 text-black"
          : "bg-sky-400/90 text-black",
      )}
    >
      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-black/20 text-[10px]">
        {props.side}
      </span>
      <span className="max-w-[12rem] truncate">{props.name}</span>
    </div>
  );
}

/**
 * 滑块对比：A 在底层，B 在上层用 clip-path 由分隔条 X 控制 inset。
 * 中线可拖；touch + mouse 兼容。
 */
function SliderCompare(props: {
  image: CompareImage;
  variantA: CompareVariantInput;
  variantB: CompareVariantInput;
  pct: number;
  onPct: (n: number) => void;
}) {
  const { image, variantA, variantB, pct, onPct } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const moveTo = useCallback(
    (clientX: number) => {
      const el = wrapRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const ratio = ((clientX - rect.left) / Math.max(1, rect.width)) * 100;
      onPct(Math.max(0, Math.min(100, ratio)));
    },
    [onPct],
  );

  useEffect(() => {
    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!draggingRef.current) return;
      const x =
        "touches" in e ? e.touches[0]?.clientX ?? 0 : (e as MouseEvent).clientX;
      moveTo(x);
    };
    const onUp = () => {
      draggingRef.current = false;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove);
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
    };
  }, [moveTo]);

  return (
    <div ref={wrapRef} className="relative h-full w-full select-none overflow-hidden">
      {/* A 底层全幅 */}
      <div className="absolute inset-0">
        <SideLabel side="A" name={variantA.name} />
        <CompositeStage image={image} variant={variantA} />
      </div>
      {/* B 上层按 pct 揭示 */}
      <div
        className="absolute inset-0"
        style={{ clipPath: `inset(0 ${100 - pct}% 0 0)` }}
      >
        <SideLabel side="B" name={variantB.name} />
        <CompositeStage image={image} variant={variantB} />
      </div>
      {/* 分隔条 */}
      <div
        className="absolute top-0 z-20 flex h-full -translate-x-1/2 cursor-ew-resize items-center justify-center"
        style={{ left: `${pct}%`, width: 24 }}
        onMouseDown={(e) => {
          draggingRef.current = true;
          moveTo(e.clientX);
        }}
        onTouchStart={(e) => {
          draggingRef.current = true;
          if (e.touches[0]) moveTo(e.touches[0].clientX);
        }}
      >
        <div className="h-full w-0.5 bg-white/80" />
        <div className="absolute flex h-9 w-9 items-center justify-center rounded-full bg-white text-black shadow-lg">
          <ArrowLeftRight className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}

/**
 * CompositeStage — 单侧渲染：优先 exportImageUrl，否则 canvas 绘制
 * 和 share-viewer 的 Stage 思路一致，但作为组件抽出以便对比共用
 */
function CompositeStage(props: {
  image: CompareImage;
  variant: CompareVariantInput;
}) {
  const { image, variant } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const exportUrl = variant.exportImageUrl;
  const size = useContainerSize(containerRef);

  useEffect(() => {
    if (exportUrl) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const cw = size.w;
    const ch = size.h;
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

      for (const po of variant.options) {
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
          ctx.rect(
            dx + x1 * scale,
            dy + y1 * scale,
            (x2 - x1) * scale,
            (y2 - y1) * scale,
          );
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
    };
    img.src = image.fileUrl;
    return () => {
      img.onload = null;
    };
  }, [exportUrl, image, variant, size]);

  return (
    <div ref={containerRef} className="relative h-full w-full">
      {exportUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={exportUrl}
          alt={variant.name}
          className="h-full w-full object-contain"
        />
      ) : (
        <canvas ref={canvasRef} className="block h-full w-full" />
      )}
    </div>
  );
}

function useContainerSize(ref: RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const cr = entry.contentRect;
        setSize({ w: Math.floor(cr.width), h: Math.floor(cr.height) });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}
