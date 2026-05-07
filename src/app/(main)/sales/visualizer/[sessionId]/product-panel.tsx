"use client";

/**
 * ProductPanel — 产品库面板
 *
 * 职责：
 * - 列出可见的「我组织产品」+「平台预置」两段
 * - 点击 = 给当前 region 挂该产品（onPick）
 * - 当 region 已挂产品：显示当前产品颜色切换、opacity、移除、全屋套用
 * - 顶部「+ 添加产品」打开 onCreateRequest 让父组件弹窗
 * - 自家产品行支持「编辑 / 删除」（onEditRequest / onDelete）
 *
 * 数据：catalog 数组由父组件从 GET /api/visualizer/catalog 拉取后传入
 *      （父组件负责 reload；本组件不发起 fetch）
 */

import { useMemo, useState } from "react";
import { Plus, Trash2, Pencil, Wand2, MoreHorizontal, ChevronDown, ChevronUp, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  VisualizerCatalogProductDetail,
  VisualizerProductOptionDetail,
} from "@/lib/visualizer/types";

interface ProductPanelProps {
  catalog: VisualizerCatalogProductDetail[];
  catalogLoading: boolean;
  catalogError: string | null;
  /** 当前 region 已挂载的 productOption（可能为 null） */
  currentOption: VisualizerProductOptionDetail | null;
  selectedProductOption: VisualizerProductOptionDetail | null;
  /** 点击产品挂到当前 region */
  onPick: (product: VisualizerCatalogProductDetail) => void;
  /** 修改 productOption（颜色、opacity） */
  onPatch: (id: string, patch: Record<string, unknown>) => void;
  /** 移除产品叠加 */
  onDelete: (id: string) => void;
  /** 全屋套用当前产品到本图所有窗户 */
  onApplyToAll?: () => void;
  applyAllBusy?: boolean;
  regionsOnImage?: number;
  /** 父组件触发「+ 添加产品」弹窗 */
  onCreateRequest: () => void;
  /** 父组件触发「编辑产品」弹窗 */
  onEditRequest: (product: VisualizerCatalogProductDetail) => void;
  /** 父组件触发「软删该自家产品」 */
  onArchiveRequest: (product: VisualizerCatalogProductDetail) => void;
}

export default function ProductPanel(props: ProductPanelProps) {
  const {
    catalog,
    catalogLoading,
    catalogError,
    currentOption,
    onPick,
    onPatch,
    onDelete,
    onApplyToAll,
    applyAllBusy,
    regionsOnImage = 0,
    onCreateRequest,
    onEditRequest,
    onArchiveRequest,
  } = props;

  const [keyword, setKeyword] = useState("");
  const [showPlatform, setShowPlatform] = useState(true);

  const currentProduct = currentOption
    ? catalog.find((p) => p.id === currentOption.productCatalogId) ?? null
    : null;

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    const passes = (p: VisualizerCatalogProductDetail) => {
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.categoryLabel.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
      );
    };
    return {
      org: catalog.filter((p) => p.isOwn && passes(p)),
      platform: catalog.filter((p) => p.isPlatform && passes(p)),
    };
  }, [catalog, keyword]);

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
            <span className="text-[10px] text-muted">{currentProduct.categoryLabel}</span>
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
              {currentProduct.colors.map((c) => {
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

          {onApplyToAll && regionsOnImage > 1 && (
            <button
              type="button"
              onClick={onApplyToAll}
              disabled={!!applyAllBusy}
              className="flex w-full items-center justify-center gap-1 rounded-md border border-amber-300 bg-white px-2 py-1.5 text-[11px] font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-60"
              title="把当前产品/颜色/透明度套用到本照片所有窗户"
            >
              <Wand2 className="h-3.5 w-3.5" />
              {applyAllBusy ? "套用中…" : `全屋套用（${regionsOnImage} 处窗户）`}
            </button>
          )}
        </div>
      )}

      {/* 工具条：搜索 + 添加 */}
      <div className="flex items-center gap-1.5">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted" />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索产品..."
            className="w-full rounded-md border border-border bg-white py-1 pl-6 pr-2 text-[11px]"
          />
        </div>
        <button
          type="button"
          onClick={onCreateRequest}
          className="inline-flex items-center gap-0.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-800 hover:bg-amber-100"
          title="添加本组织私有产品"
        >
          <Plus className="h-3 w-3" />
          产品
        </button>
      </div>

      {catalogError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-700">
          {catalogError}
        </div>
      )}

      {catalogLoading && catalog.length === 0 && (
        <div className="text-[11px] text-muted">加载中…</div>
      )}

      {/* 我组织产品 */}
      <div>
        <div className="mb-1 flex items-center justify-between text-[10px] font-medium text-muted">
          <span>本组织产品 · {filtered.org.length}</span>
        </div>
        {filtered.org.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/60 bg-white/40 px-2 py-3 text-center text-[10px] text-muted">
            尚无本组织产品。点上方「+ 产品」添加客户带来的款式。
          </div>
        ) : (
          <ProductGrid
            products={filtered.org}
            currentId={currentOption?.productCatalogId ?? null}
            onPick={onPick}
            onEdit={onEditRequest}
            onArchive={onArchiveRequest}
          />
        )}
      </div>

      {/* 平台预置 */}
      <div>
        <button
          type="button"
          onClick={() => setShowPlatform((v) => !v)}
          className="mb-1 flex w-full items-center justify-between text-[10px] font-medium text-muted hover:text-foreground"
        >
          <span>平台预置 · {filtered.platform.length}</span>
          {showPlatform ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
        </button>
        {showPlatform &&
          (filtered.platform.length === 0 ? (
            <div className="text-[10px] text-muted">未匹配到平台产品</div>
          ) : (
            <ProductGrid
              products={filtered.platform}
              currentId={currentOption?.productCatalogId ?? null}
              onPick={onPick}
              onEdit={null}
              onArchive={null}
            />
          ))}
      </div>
    </div>
  );
}

function ProductGrid(props: {
  products: VisualizerCatalogProductDetail[];
  currentId: string | null;
  onPick: (p: VisualizerCatalogProductDetail) => void;
  onEdit: ((p: VisualizerCatalogProductDetail) => void) | null;
  onArchive: ((p: VisualizerCatalogProductDetail) => void) | null;
}) {
  const { products, currentId, onPick, onEdit, onArchive } = props;
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {products.map((p) => {
        const isCurrent = currentId === p.id;
        const firstColor = p.colors[0];
        return (
          <div
            key={p.id}
            className={cn(
              "group relative flex items-start gap-1.5 rounded-md border px-2 py-1.5 text-left text-[11px]",
              isCurrent
                ? "border-amber-400 bg-amber-50/80"
                : "border-border/60 bg-white/70 hover:bg-white",
            )}
          >
            <button
              type="button"
              onClick={() => onPick(p)}
              className="flex min-w-0 flex-1 items-start gap-1.5 text-left"
              title={p.notes ?? p.name}
            >
              {p.previewImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={p.previewImageUrl}
                  alt={p.name}
                  className="mt-0.5 h-7 w-7 shrink-0 rounded border border-black/10 object-cover"
                />
              ) : (
                <span
                  className="mt-0.5 h-7 w-7 shrink-0 rounded border border-black/10"
                  style={{ background: firstColor?.hex ?? "#ccc" }}
                />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-foreground">
                  {p.name}
                </span>
                <span className="block truncate text-[10px] text-muted">
                  {p.categoryLabel}
                </span>
              </span>
            </button>
            {(onEdit || onArchive) && (
              <ProductRowActions
                product={p}
                onEdit={onEdit}
                onArchive={onArchive}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function ProductRowActions(props: {
  product: VisualizerCatalogProductDetail;
  onEdit: ((p: VisualizerCatalogProductDetail) => void) | null;
  onArchive: ((p: VisualizerCatalogProductDetail) => void) | null;
}) {
  const { product, onEdit, onArchive } = props;
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="rounded p-0.5 text-muted opacity-0 hover:bg-slate-100 hover:text-foreground group-hover:opacity-100"
        aria-label="更多"
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label="关闭菜单"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-5 z-20 w-28 rounded-md border border-border bg-white py-1 text-[11px] shadow-md">
            {onEdit && (
              <button
                type="button"
                onClick={() => {
                  onEdit(product);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-1.5 px-2 py-1 text-foreground hover:bg-slate-50"
              >
                <Pencil className="h-3 w-3" />
                编辑
              </button>
            )}
            {onArchive && (
              <button
                type="button"
                onClick={() => {
                  onArchive(product);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-1.5 px-2 py-1 text-red-700 hover:bg-red-50"
              >
                <Trash2 className="h-3 w-3" />
                删除
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
