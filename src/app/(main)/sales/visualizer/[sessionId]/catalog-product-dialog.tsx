"use client";

/**
 * CatalogProductDialog — 创建 / 编辑 本组织私有产品
 *
 * 保存规则：
 * - 草稿可保存（无素材）
 * - 有 texture/detail/swatch 可生成 AI 标准安装模板
 * - 有真实 installed 或 AI 模板才可用于客户效果图
 */

import { useEffect, useMemo, useState } from "react";
import { ImageIcon, Loader2, Plus, Sparkles, Trash2, Upload, X } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { useToast } from "@/components/ui/toast";
import { resizeImageForUpload } from "@/lib/visualizer/client-resize";
import {
  assetBadgeLabel,
  evaluateCatalogReadiness,
  readinessLabel,
} from "@/lib/visualizer/catalog-readiness";
import { cn } from "@/lib/utils";
import type {
  VisualizerCatalogAssetDetail,
  VisualizerCatalogAssetRole,
  VisualizerCatalogColor,
  VisualizerCatalogMounting,
  VisualizerCatalogProductDetail,
  VisualizerCatalogTemplateType,
} from "@/lib/visualizer/types";

interface CatalogProductDialogProps {
  open: boolean;
  orgId: string | null;
  /** null = 创建；非空 = 编辑 */
  editing: VisualizerCatalogProductDetail | null;
  onClose: () => void;
  onSaved: () => void;
}

const CATEGORY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "roller", label: "卷帘 Roller" },
  { value: "solar", label: "阳光帘 Solar" },
  { value: "blackout_roller", label: "遮光卷帘 Blackout" },
  { value: "zebra", label: "斑马帘 Zebra" },
  { value: "sheer", label: "纱帘 Sheer" },
  { value: "drapery", label: "布艺窗帘 Drapery" },
  { value: "dual", label: "双层帘 Dual" },
  { value: "honeycomb", label: "蜂巢帘 Honeycomb" },
  { value: "vertical", label: "垂直帘 Vertical" },
  { value: "motorized", label: "电动窗帘 Motorized" },
  { value: "custom", label: "自定义 Custom" },
];

const ASSET_SECTIONS: Array<{
  role: VisualizerCatalogAssetRole;
  label: string;
  description: string;
  limit: number;
}> = [
  {
    role: "installed",
    label: "真实安装图",
    description: "真实现场安装照片；有则优先用于客户效果图",
    limit: 3,
  },
  {
    role: "texture",
    label: "面料纹理",
    description: "近距离拍摄面料、透光和表面纹理",
    limit: 2,
  },
  {
    role: "detail",
    label: "结构细节",
    description: "帘头、轨道、褶皱、上下梁或控制结构",
    limit: 3,
  },
  {
    role: "swatch",
    label: "色卡",
    description: "色卡或色板照片，辅助还原准确颜色",
    limit: 2,
  },
  {
    role: "style_reference",
    label: "AI 参考模板",
    description: "AI 标准安装模板或风格参考（不会当作真实案例）",
    limit: 4,
  },
];

const TEMPLATE_OPTIONS: Array<{
  type: VisualizerCatalogTemplateType;
  label: string;
  description: string;
}> = [
  {
    type: "standard_floor_to_ceiling_day",
    label: "标准落地窗",
    description: "中性白墙、标准落地窗、白天自然光",
  },
  {
    type: "modern_living_room_day",
    label: "现代客厅",
    description: "简洁客厅、大型窗户、少量中性家具",
  },
];

function emptyColors(): VisualizerCatalogColor[] {
  return [{ name: "Default", hex: "#cccccc" }];
}

function withDefaultVerification(
  asset: VisualizerCatalogAssetDetail,
): VisualizerCatalogAssetDetail {
  return {
    ...asset,
    verificationStatus: asset.verificationStatus ?? "draft",
  };
}

export default function CatalogProductDialog(props: CatalogProductDialogProps) {
  const { open, orgId, editing, onClose, onSaved } = props;
  const toast = useToast();

  const isEdit = editing !== null;
  const [name, setName] = useState("");
  const [category, setCategory] = useState<string>("roller");
  const [assets, setAssets] = useState<VisualizerCatalogAssetDetail[]>([]);
  const [defaultOpacity, setDefaultOpacity] = useState(0.85);
  const [colors, setColors] = useState<VisualizerCatalogColor[]>(emptyColors());
  const [mountings, setMountings] = useState<VisualizerCatalogMounting[]>([
    "inside",
    "outside",
  ]);
  const [pricingProductName, setPricingProductName] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadingRole, setUploadingRole] = useState<VisualizerCatalogAssetRole | null>(null);
  const [generating, setGenerating] = useState(false);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [savedProductId, setSavedProductId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setName(editing.name);
      setCategory(editing.category);
      const legacyAssets: VisualizerCatalogAssetDetail[] = [];
      if (editing.assets.length === 0 && editing.previewImageUrl) {
        legacyAssets.push({
          role: "installed",
          fileUrl: editing.previewImageUrl,
          fileName: "legacy-preview",
          mimeType: "image/jpeg",
          width: null,
          height: null,
          bytes: null,
          sortOrder: 0,
          isPrimary: true,
          sourceType: "real",
          verificationStatus: "real_unverified",
        });
      }
      if (editing.assets.length === 0 && editing.textureUrl) {
        legacyAssets.push({
          role: "texture",
          fileUrl: editing.textureUrl,
          fileName: "legacy-texture",
          mimeType: "image/jpeg",
          width: null,
          height: null,
          bytes: null,
          sortOrder: 0,
          isPrimary: true,
          sourceType: "real",
          verificationStatus: "draft",
        });
      }
      setAssets(
        (editing.assets.length > 0 ? editing.assets : legacyAssets).map(
          withDefaultVerification,
        ),
      );
      setDefaultOpacity(editing.defaultOpacity);
      setColors(editing.colors.length > 0 ? editing.colors : emptyColors());
      setMountings(editing.mountings.length > 0 ? editing.mountings : ["inside", "outside"]);
      setPricingProductName(editing.pricingProductName ?? "");
      setNotes(editing.notes ?? "");
      setSavedProductId(editing.id);
    } else {
      setName("");
      setCategory("roller");
      setAssets([]);
      setDefaultOpacity(0.85);
      setColors(emptyColors());
      setMountings(["inside", "outside"]);
      setPricingProductName("");
      setNotes("");
      setSavedProductId(null);
    }
    setTemplatePickerOpen(false);
    setGenerating(false);
  }, [open, editing]);

  const readiness = useMemo(() => evaluateCatalogReadiness(assets), [assets]);

  const canSave = useMemo(() => {
    if (!name.trim()) return false;
    if (!category) return false;
    if (colors.length === 0) return false;
    if (colors.some((c) => !c.name.trim() || !/^#[0-9a-fA-F]{6}$/.test(c.hex))) return false;
    if (mountings.length === 0) return false;
    return !busy && !uploadingRole && !generating;
  }, [name, category, colors, mountings, busy, uploadingRole, generating]);

  const handleUpload = async (role: VisualizerCatalogAssetRole, file: File) => {
    const config = ASSET_SECTIONS.find((section) => section.role === role);
    if (!config) return;
    if (assets.filter((asset) => asset.role === role).length >= config.limit) {
      toast.error(`${config.label}最多上传 ${config.limit} 张`);
      return;
    }
    setUploadingRole(role);
    try {
      const resized = await resizeImageForUpload(file, { maxLongEdge: 2048, quality: 0.9 });
      const fd = new FormData();
      fd.append("file", resized.file);
      const res = await apiFetch("/api/visualizer/catalog/upload-preview", {
        method: "POST",
        body: fd,
      });
      const j = (await res.json().catch(() => ({}))) as {
        url?: string;
        fileName?: string;
        mimeType?: string;
        width?: number | null;
        height?: number | null;
        bytes?: number | null;
        error?: string;
      };
      if (!res.ok || !j.url) {
        toast.error(j.error ?? "上传失败");
        return;
      }
      const sourceType =
        role === "style_reference" ? ("ai_generated" as const) : ("real" as const);
      const verificationStatus =
        role === "installed" && sourceType === "real"
          ? ("real_unverified" as const)
          : role === "style_reference" && sourceType === "ai_generated"
            ? ("ai_reference" as const)
            : ("draft" as const);
      setAssets((prev) => {
        const roleAssets = prev.filter((asset) => asset.role === role);
        return [
          ...prev,
          {
            role,
            fileUrl: j.url!,
            fileName: j.fileName ?? resized.file.name,
            mimeType: j.mimeType ?? resized.file.type,
            width: j.width ?? null,
            height: j.height ?? null,
            bytes: j.bytes ?? resized.file.size,
            sortOrder: roleAssets.length,
            isPrimary: roleAssets.length === 0,
            sourceType,
            verificationStatus,
          },
        ];
      });
      toast.success(`${config.label}已上传`);
    } catch {
      toast.error("上传失败");
    } finally {
      setUploadingRole(null);
    }
  };

  const removeAsset = (fileUrl: string) => {
    setAssets((prev) => {
      const removed = prev.find((asset) => asset.fileUrl === fileUrl);
      const next = prev.filter((asset) => asset.fileUrl !== fileUrl);
      if (!removed?.isPrimary) return next;
      const replacementIndex = next.findIndex((asset) => asset.role === removed.role);
      return next.map((asset, index) =>
        index === replacementIndex ? { ...asset, isPrimary: true } : asset,
      );
    });
  };

  const save = async (): Promise<string | null> => {
    if (!orgId) {
      toast.error("无法确定当前组织");
      return null;
    }
    if (!canSave) return null;
    setBusy(true);
    try {
      const payload = {
        orgId,
        name: name.trim(),
        category,
        previewImageUrl:
          assets.find(
            (asset) =>
              asset.role === "installed" &&
              asset.sourceType === "real" &&
              asset.isPrimary,
          )?.fileUrl ??
          assets.find(
            (asset) => asset.role === "installed" && asset.sourceType === "real",
          )?.fileUrl ??
          assets.find(
            (asset) =>
              asset.role === "style_reference" &&
              asset.sourceType === "ai_generated",
          )?.fileUrl ??
          assets.find((asset) => asset.role === "texture")?.fileUrl ??
          null,
        textureUrl:
          assets.find((asset) => asset.role === "texture" && asset.isPrimary)?.fileUrl ??
          assets.find((asset) => asset.role === "texture")?.fileUrl ??
          null,
        assets,
        defaultOpacity,
        colors,
        mountings,
        pricingProductName: pricingProductName.trim() || null,
        notes: notes.trim() || null,
      };
      const productId = savedProductId ?? editing?.id ?? null;
      const url = productId
        ? `/api/visualizer/catalog/${productId}`
        : "/api/visualizer/catalog";
      const method = productId ? "PATCH" : "POST";
      const res = await apiFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        product?: VisualizerCatalogProductDetail;
      };
      if (!res.ok || !j.product) {
        toast.error(j.error ?? (productId ? "保存失败" : "创建失败"));
        return null;
      }
      setSavedProductId(j.product.id);
      setAssets(j.product.assets.map(withDefaultVerification));
      toast.success(
        readiness.status === "incomplete"
          ? "草稿已保存（素材待完善）"
          : productId
            ? "已保存"
            : "产品已添加",
      );
      onSaved();
      return j.product.id;
    } finally {
      setBusy(false);
    }
  };

  const generateTemplate = async (templateType: VisualizerCatalogTemplateType) => {
    let productId = savedProductId ?? editing?.id ?? null;
    if (!productId) {
      productId = await save();
    } else {
      // 确保最新素材已落库
      productId = await save();
    }
    if (!productId) return;

    setGenerating(true);
    setTemplatePickerOpen(false);
    try {
      const res = await apiFetch(
        `/api/visualizer/catalog/${productId}/generate-template`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ templateType }),
        },
      );
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
        product?: VisualizerCatalogProductDetail;
      };
      if (!res.ok || !j.product) {
        toast.error(j.error ?? "生成标准安装模板失败");
        return;
      }
      setAssets(j.product.assets.map(withDefaultVerification));
      setSavedProductId(j.product.id);
      toast.success("AI 标准安装模板已生成");
      onSaved();
    } finally {
      setGenerating(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="关闭"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div
        className="relative z-10 w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-card-bg p-5 shadow-2xl"
        style={{ maxHeight: "90vh" }}
      >
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-foreground">
              {isEdit || savedProductId ? "编辑产品" : "添加本组织产品"}
            </h3>
            <p className="mt-0.5 text-xs text-muted">
              真实安装图优先；暂无真实图时可上传纹理/色卡并生成 AI 标准安装模板。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-muted hover:bg-slate-100 hover:text-foreground"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div
          className={cn(
            "mb-3 rounded-lg border px-3 py-2 text-xs",
            readiness.status === "real_install_ready" &&
              "border-emerald-200 bg-emerald-50 text-emerald-900",
            readiness.status === "ai_template_ready" &&
              "border-sky-200 bg-sky-50 text-sky-900",
            readiness.status === "source_ready" &&
              "border-amber-200 bg-amber-50 text-amber-900",
            readiness.status === "incomplete" &&
              "border-slate-200 bg-accent-soft text-slate-700",
          )}
        >
          <p className="font-medium">
            产品素材状态：{readinessLabel(readiness.status)}
          </p>
          {readiness.warnings.map((w) => (
            <p key={w} className="mt-0.5 text-[11px] opacity-90">
              {w}
            </p>
          ))}
          {!readiness.canUseForCustomerRender ? (
            <p className="mt-0.5 text-[11px] opacity-90">
              当前不可用于正式客户效果图生成。
            </p>
          ) : null}
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-[11px] font-medium text-muted">产品名称</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：客户带来的高端遮光卷帘"
              className="mt-0.5 w-full rounded-md border border-border bg-card-bg px-2 py-1.5 text-xs"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-medium text-muted">类别</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="mt-0.5 w-full rounded-md border border-border bg-card-bg px-2 py-1.5 text-xs"
              >
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted">默认透明度</label>
              <div className="mt-0.5 flex items-center gap-2">
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={defaultOpacity}
                  onChange={(e) => setDefaultOpacity(parseFloat(e.target.value))}
                  className="flex-1"
                />
                <span className="w-10 text-right text-xs">
                  {Math.round(defaultOpacity * 100)}%
                </span>
              </div>
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-[11px] font-medium text-muted">产品参考资产</label>
              <span className="text-[10px] text-muted">建议横向图片，长边 1600px 以上</span>
            </div>
            <div className="divide-y divide-border rounded-md border border-border bg-accent-soft/60">
              {ASSET_SECTIONS.map((section) => {
                const sectionAssets = assets.filter((asset) => asset.role === section.role);
                const isUploading = uploadingRole === section.role;
                return (
                  <div key={section.role} className="grid gap-2 p-3 sm:grid-cols-[150px_1fr]">
                    <div>
                      <div className="text-xs font-medium text-foreground">
                        {section.label}
                      </div>
                      <p className="mt-0.5 text-[10px] leading-4 text-muted">
                        {section.description}
                      </p>
                    </div>
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      {sectionAssets.map((asset) => (
                        <div
                          key={asset.fileUrl}
                          className="group relative h-16 w-20 overflow-hidden rounded border border-border bg-white" /* canvas 需白底 */
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={asset.fileUrl}
                            alt={section.label}
                            className="h-full w-full object-cover"
                          />
                          <span className="absolute bottom-1 left-1 rounded bg-black/65 px-1 text-[9px] text-white">
                            {assetBadgeLabel(asset)}
                          </span>
                          {asset.isPrimary ? (
                            <span className="absolute left-1 top-1 rounded bg-amber-500/90 px-1 text-[9px] text-white">
                              主图
                            </span>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => removeAsset(asset.fileUrl)}
                            className="absolute right-1 top-1 rounded bg-black/60 p-0.5 text-white opacity-0 transition group-hover:opacity-100"
                            aria-label="移除图片"
                            title="移除图片"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                      {sectionAssets.length < section.limit ? (
                        <label
                          className="flex h-16 w-20 cursor-pointer flex-col items-center justify-center gap-1 rounded border border-dashed border-border bg-white text-[10px] text-muted hover:border-foreground/40 hover:text-foreground" /* canvas 需白底 */
                        >
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            className="hidden"
                            disabled={!!uploadingRole || generating}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) void handleUpload(section.role, file);
                              e.target.value = "";
                            }}
                          />
                          {isUploading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : sectionAssets.length === 0 ? (
                            <ImageIcon className="h-4 w-4" />
                          ) : (
                            <Upload className="h-4 w-4" />
                          )}
                          {isUploading
                            ? "上传中"
                            : `${sectionAssets.length}/${section.limit}`}
                        </label>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-1.5 text-[10px] text-muted">
              AI 生成参考，仅用于辅助客户预览，不代表真实项目或最终交付效果。
            </p>
          </div>

          <div className="rounded-md border border-border bg-card-bg p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-medium text-foreground">
                  AI 生成标准安装模板
                </p>
                <p className="text-[10px] text-muted">
                  {readiness.canGenerateTemplate
                    ? "未保存时将先保存产品，再生成模板"
                    : "需要至少一张面料纹理 / 色卡 / 结构细节图"}
                </p>
              </div>
              <button
                type="button"
                disabled={!readiness.canGenerateTemplate || generating || busy}
                onClick={() => setTemplatePickerOpen((v) => !v)}
                className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
              >
                {generating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                {generating ? "正在生成标准安装模板……" : "AI 生成标准安装模板"}
              </button>
            </div>
            {templatePickerOpen ? (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {TEMPLATE_OPTIONS.map((opt) => (
                  <button
                    key={opt.type}
                    type="button"
                    disabled={generating}
                    onClick={() => void generateTemplate(opt.type)}
                    className="rounded-md border border-border bg-accent-soft px-2.5 py-2 text-left hover:border-amber-300 hover:bg-amber-50 disabled:opacity-50"
                  >
                    <p className="text-xs font-medium text-foreground">{opt.label}</p>
                    <p className="text-[10px] text-muted">{opt.description}</p>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-[11px] font-medium text-muted">颜色（至少 1 个）</label>
              <button
                type="button"
                onClick={() =>
                  setColors((prev) => [...prev, { name: "", hex: "#cccccc" }])
                }
                className="inline-flex items-center gap-0.5 text-[11px] text-amber-700 hover:text-amber-900"
              >
                <Plus className="h-3 w-3" />
                添加颜色
              </button>
            </div>
            <div className="space-y-1.5">
              {colors.map((c, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-card-bg px-2 py-1.5"
                >
                  <input
                    type="color"
                    value={/^#[0-9a-fA-F]{6}$/.test(c.hex) ? c.hex : "#cccccc"}
                    onChange={(e) =>
                      setColors((prev) =>
                        prev.map((x, i) => (i === idx ? { ...x, hex: e.target.value } : x)),
                      )
                    }
                    className="h-7 w-9 cursor-pointer rounded border border-border"
                    aria-label="颜色色值"
                  />
                  <input
                    value={c.name}
                    onChange={(e) =>
                      setColors((prev) =>
                        prev.map((x, i) =>
                          i === idx ? { ...x, name: e.target.value } : x,
                        ),
                      )
                    }
                    placeholder="颜色名（如 White）"
                    className="min-w-0 flex-1 rounded border border-border bg-card-bg px-1.5 py-1 text-[11px]"
                  />
                  <input
                    value={c.hex}
                    onChange={(e) =>
                      setColors((prev) =>
                        prev.map((x, i) =>
                          i === idx ? { ...x, hex: e.target.value } : x,
                        ),
                      )
                    }
                    placeholder="#RRGGBB"
                    className="w-20 rounded border border-border bg-card-bg px-1.5 py-1 text-[11px]"
                  />
                  {colors.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        setColors((prev) => prev.filter((_, i) => i !== idx))
                      }
                      className="rounded p-0.5 text-muted hover:bg-red-50 hover:text-red-600"
                      title="移除颜色"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[11px] font-medium text-muted">安装方式</label>
            <div className="mt-0.5 flex items-center gap-2 text-[11px]">
              {(["inside", "outside"] as VisualizerCatalogMounting[]).map((m) => {
                const active = mountings.includes(m);
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() =>
                      setMountings((prev) =>
                        prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m],
                      )
                    }
                    className={cn(
                      "rounded-md border px-2 py-1",
                      active
                        ? "border-amber-400 bg-amber-50 text-amber-800"
                        : "border-border bg-card-bg text-muted hover:text-foreground",
                    )}
                  >
                    {m === "inside" ? "内装 Inside" : "外装 Outside"}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="text-[11px] font-medium text-muted">
              关联报价产品名（选填，用于未来一键带价）
            </label>
            <input
              value={pricingProductName}
              onChange={(e) => setPricingProductName(e.target.value)}
              placeholder="例如：Zebra / Roller / Drapery"
              className="mt-0.5 w-full rounded-md border border-border bg-card-bg px-2 py-1.5 text-xs"
            />
          </div>

          <div>
            <label className="text-[11px] font-medium text-muted">备注</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="如：客户带来的某品牌系列"
              rows={2}
              className="mt-0.5 w-full rounded-md border border-border bg-card-bg px-2 py-1.5 text-xs"
            />
          </div>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy || generating}
            className="rounded-md border border-border bg-card-bg px-3 py-1.5 text-xs text-muted hover:text-foreground disabled:opacity-60"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!canSave}
            className="inline-flex items-center gap-1 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-white hover:bg-foreground/90 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {isEdit || savedProductId ? "保存修改" : "保存产品"}
            {!busy && readiness.status === "incomplete" ? (
              <span className="opacity-80">（草稿）</span>
            ) : null}
          </button>
        </div>
      </div>
    </div>
  );
}
