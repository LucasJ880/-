"use client";

/**
 * CatalogProductDialog — 创建 / 编辑 本组织私有产品
 *
 * - 创建：必填 name / category / 至少一个颜色 / 至少一种安装方式
 * - 编辑：所有字段可改（仅自家产品；平台预置入口不暴露此弹窗）
 * - 产品资产：按安装效果、材质、结构和风格参考分类上传
 *
 * 父组件保存成功后应自行 reload 产品列表。
 */

import { useEffect, useMemo, useState } from "react";
import { Check, ImageIcon, Loader2, Plus, Trash2, Upload, X } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { useToast } from "@/components/ui/toast";
import { resizeImageForUpload } from "@/lib/visualizer/client-resize";
import { cn } from "@/lib/utils";
import type {
  VisualizerCatalogAssetDetail,
  VisualizerCatalogAssetRole,
  VisualizerCatalogColor,
  VisualizerCatalogMounting,
  VisualizerCatalogProductDetail,
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
  required?: boolean;
}> = [
  {
    role: "installed",
    label: "安装效果",
    description: "完整展示产品装在窗户上的形态，AI 生成必需",
    limit: 3,
    required: true,
  },
  {
    role: "texture",
    label: "材质纹理",
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
    role: "style_reference",
    label: "效果参考",
    description: "ChatGPT 等工具生成的理想效果，只用于风格参考",
    limit: 2,
  },
];

function emptyColors(): VisualizerCatalogColor[] {
  return [{ name: "Default", hex: "#cccccc" }];
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
        });
      }
      setAssets(editing.assets.length > 0 ? editing.assets : legacyAssets);
      setDefaultOpacity(editing.defaultOpacity);
      setColors(editing.colors.length > 0 ? editing.colors : emptyColors());
      setMountings(editing.mountings.length > 0 ? editing.mountings : ["inside", "outside"]);
      setPricingProductName(editing.pricingProductName ?? "");
      setNotes(editing.notes ?? "");
    } else {
      setName("");
      setCategory("roller");
      setAssets([]);
      setDefaultOpacity(0.85);
      setColors(emptyColors());
      setMountings(["inside", "outside"]);
      setPricingProductName("");
      setNotes("");
    }
  }, [open, editing]);

  const canSave = useMemo(() => {
    if (!name.trim()) return false;
    if (!category) return false;
    if (colors.length === 0) return false;
    if (colors.some((c) => !c.name.trim() || !/^#[0-9a-fA-F]{6}$/.test(c.hex))) return false;
    if (mountings.length === 0) return false;
    if (!assets.some((asset) => asset.role === "installed")) return false;
    return !busy && !uploadingRole;
  }, [name, category, colors, mountings, assets, busy, uploadingRole]);

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
            sourceType: role === "style_reference" ? "ai_generated" : "real",
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

  const save = async () => {
    if (!orgId) {
      toast.error("无法确定当前组织");
      return;
    }
    if (!canSave) return;
    setBusy(true);
    try {
      const payload = {
        orgId,
        name: name.trim(),
        category,
        previewImageUrl:
          assets.find((asset) => asset.role === "installed" && asset.isPrimary)?.fileUrl ??
          assets.find((asset) => asset.role === "installed")?.fileUrl ??
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
      const url = isEdit
        ? `/api/visualizer/catalog/${editing!.id}`
        : "/api/visualizer/catalog";
      const method = isEdit ? "PATCH" : "POST";
      const res = await apiFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(j.error ?? (isEdit ? "保存失败" : "创建失败"));
        return;
      }
      toast.success(isEdit ? "已保存" : "产品已添加");
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  const updateColor = (idx: number, patch: Partial<VisualizerCatalogColor>) => {
    setColors((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
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
      <div className="relative z-10 w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-white p-5 shadow-2xl"
        style={{ maxHeight: "90vh" }}>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-foreground">
              {isEdit ? "编辑产品" : "添加本组织产品"}
            </h3>
            <p className="mt-0.5 text-xs text-muted">
              {isEdit
                ? "本组织产品仅对本组织可见，不影响平台预置库。"
                : "客户在现场提到的款式可以快速加进来，下次不用再录入。"}
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

        <div className="space-y-3">
          <div>
            <label className="text-[11px] font-medium text-muted">产品名称</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：客户带来的高端遮光卷帘"
              className="mt-0.5 w-full rounded-md border border-border bg-white px-2 py-1.5 text-xs"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-medium text-muted">类别</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="mt-0.5 w-full rounded-md border border-border bg-white px-2 py-1.5 text-xs"
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
            <div className="divide-y divide-border rounded-md border border-border bg-slate-50/60">
              {ASSET_SECTIONS.map((section) => {
                const sectionAssets = assets.filter((asset) => asset.role === section.role);
                const isUploading = uploadingRole === section.role;
                return (
                  <div key={section.role} className="grid gap-2 p-3 sm:grid-cols-[150px_1fr]">
                    <div>
                      <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                        {section.label}
                        {section.required ? (
                          sectionAssets.length > 0 ? (
                            <Check className="h-3.5 w-3.5 text-emerald-600" aria-label="已完成" />
                          ) : (
                            <span className="text-[10px] text-red-600">必填</span>
                          )
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-[10px] leading-4 text-muted">{section.description}</p>
                    </div>
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      {sectionAssets.map((asset) => (
                        <div key={asset.fileUrl} className="group relative h-16 w-20 overflow-hidden rounded border border-border bg-white">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={asset.fileUrl} alt={section.label} className="h-full w-full object-cover" />
                          {asset.isPrimary ? (
                            <span className="absolute bottom-1 left-1 rounded bg-black/65 px-1 text-[9px] text-white">主图</span>
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
                        <label className="flex h-16 w-20 cursor-pointer flex-col items-center justify-center gap-1 rounded border border-dashed border-border bg-white text-[10px] text-muted hover:border-foreground/40 hover:text-foreground">
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            className="hidden"
                            disabled={!!uploadingRole}
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
                          {isUploading ? "上传中" : `${sectionAssets.length}/${section.limit}`}
                        </label>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
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
                  className="flex items-center gap-1.5 rounded-md border border-border bg-white px-2 py-1.5"
                >
                  <input
                    type="color"
                    value={/^#[0-9a-fA-F]{6}$/.test(c.hex) ? c.hex : "#cccccc"}
                    onChange={(e) => updateColor(idx, { hex: e.target.value })}
                    className="h-7 w-9 cursor-pointer rounded border border-border"
                    aria-label="颜色色值"
                  />
                  <input
                    value={c.name}
                    onChange={(e) => updateColor(idx, { name: e.target.value })}
                    placeholder="颜色名（如 White）"
                    className="min-w-0 flex-1 rounded border border-border bg-white px-1.5 py-1 text-[11px]"
                  />
                  <input
                    value={c.hex}
                    onChange={(e) => updateColor(idx, { hex: e.target.value })}
                    placeholder="#RRGGBB"
                    className="w-20 rounded border border-border bg-white px-1.5 py-1 text-[11px]"
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
                        : "border-border bg-white text-muted hover:text-foreground",
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
              placeholder="例如：Zebra / Roller / Drapery（与 pricing-data 中的 ProductName 对应）"
              className="mt-0.5 w-full rounded-md border border-border bg-white px-2 py-1.5 text-xs"
            />
          </div>

          <div>
            <label className="text-[11px] font-medium text-muted">备注</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="如：客户带来的某品牌系列，建议销售推这款"
              rows={2}
              className="mt-0.5 w-full rounded-md border border-border bg-white px-2 py-1.5 text-xs"
            />
          </div>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-border bg-white px-3 py-1.5 text-xs text-muted hover:text-foreground disabled:opacity-60"
          >
            取消
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!canSave}
            className="inline-flex items-center gap-1 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-white hover:bg-foreground/90 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {isEdit ? "保存修改" : "添加产品"}
          </button>
        </div>
      </div>
    </div>
  );
}
