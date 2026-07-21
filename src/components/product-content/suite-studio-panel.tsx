"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Upload, X } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { toProxyUrl } from "@/lib/files/blob-access";
import { cn } from "@/lib/utils";

type AspectRatio = "1:1" | "3:4" | "4:3" | "9:16" | "16:9";
type Resolution = "1K" | "2K";
type SlotId =
  | "product_front"
  | "product_side"
  | "product_detail"
  | "product_texture";

interface UploadSlot {
  id: SlotId;
  label: string;
  required: boolean;
  description?: string;
}

interface SuiteSummary {
  id: string;
  name: string;
  category: string;
  description: string;
  shotCount: number;
  shots: Array<{ key: string; label: string; styleGroup: string }>;
  uploadSlots: UploadSlot[];
  fidelityRules: string[];
  supportedAspectRatios: AspectRatio[];
  supportedResolutions: Resolution[];
  previewImage: string | null;
}

interface SlotState {
  pathname?: string;
  proxyUrl?: string;
  fileName?: string;
}

interface SuiteStudioPanelProps {
  orgId: string;
  jobId: string;
  initialSuiteId?: string | null;
  onGenerated?: () => void;
}

export function SuiteStudioPanel({
  orgId,
  jobId,
  initialSuiteId,
  onGenerated,
}: SuiteStudioPanelProps) {
  const [suites, setSuites] = useState<SuiteSummary[]>([]);
  const [defaults, setDefaults] = useState<{
    aspectRatio: AspectRatio;
    resolution: Resolution;
  }>({ aspectRatio: "3:4", resolution: "1K" });
  const [suiteId, setSuiteId] = useState<string>("");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("3:4");
  const [resolution, setResolution] = useState<Resolution>("1K");
  const [slots, setSlots] = useState<Partial<Record<SlotId, SlotState>>>({});
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<SlotId | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const selected = useMemo(
    () => suites.find((s) => s.id === suiteId) ?? null,
    [suites, suiteId],
  );

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/product-content/templates");
      if (!res.ok) {
        setError("加载模版库失败");
        return;
      }
      const data = (await res.json()) as {
        suites: SuiteSummary[];
        defaults: { aspectRatio: AspectRatio; resolution: Resolution };
      };
      setSuites(data.suites ?? []);
      setDefaults(data.defaults);
      const pick =
        (initialSuiteId &&
          data.suites.some((s) => s.id === initialSuiteId) &&
          initialSuiteId) ||
        data.suites[0]?.id ||
        "";
      setSuiteId(pick);
      setAspectRatio(data.defaults.aspectRatio);
      setResolution(data.defaults.resolution);
    } finally {
      setLoading(false);
    }
  }, [initialSuiteId]);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  useEffect(() => {
    if (!selected) return;
    if (!selected.supportedAspectRatios.includes(aspectRatio)) {
      setAspectRatio(selected.supportedAspectRatios[0] ?? defaults.aspectRatio);
    }
    if (!selected.supportedResolutions.includes(resolution)) {
      setResolution(selected.supportedResolutions[0] ?? defaults.resolution);
    }
  }, [selected, aspectRatio, resolution, defaults]);

  async function uploadSlot(slotId: SlotId, file: File) {
    setUploading(slotId);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("orgId", orgId);
      form.append("jobId", jobId);
      form.append("inputType", "image");
      form.append("purpose", slotId);

      const up = await apiFetch("/api/product-content/upload", {
        method: "POST",
        body: form,
      });
      if (!up.ok) {
        const err = (await up.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "上传失败");
      }
      const uploaded = (await up.json()) as {
        pathname: string;
        proxyUrl?: string;
        fileName?: string;
        mimeType?: string;
      };

      const inputRes = await apiFetch(
        `/api/product-content/jobs/${jobId}/inputs`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orgId,
            inputType: "image",
            blobPathname: uploaded.pathname,
            mimeType: uploaded.mimeType,
            fileName: uploaded.fileName ?? file.name,
            purpose: slotId,
          }),
        },
      );
      if (!inputRes.ok) {
        const err = (await inputRes.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(err.error ?? "登记输入失败");
      }

      setSlots((prev) => ({
        ...prev,
        [slotId]: {
          pathname: uploaded.pathname,
          proxyUrl: uploaded.proxyUrl || toProxyUrl(uploaded.pathname),
          fileName: uploaded.fileName ?? file.name,
        },
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(null);
    }
  }

  async function generateSuite() {
    if (!selected) return;
    if (!slots.product_front?.pathname) {
      setError("请先上传正面产品图");
      return;
    }
    setGenerating(true);
    setError(null);
    setLastResult(null);
    try {
      const res = await apiFetch(
        `/api/product-content/jobs/${jobId}/generate-suite`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orgId,
            suiteId: selected.id,
            aspectRatio,
            resolution,
          }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        shotCount?: number;
        suiteName?: string;
      };
      if (!res.ok) {
        throw new Error(data.error ?? "套图生成失败");
      }
      setLastResult(
        `已生成 ${data.shotCount ?? selected.shotCount} 张（${data.suiteName ?? selected.name} · ${aspectRatio} · ${resolution}）`,
      );
      onGenerated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  if (loading) {
    return (
      <section className="rounded-xl border border-border bg-white p-4">
        <div className="flex items-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 加载套图模版库…
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border bg-white p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">套图工作室</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            从模版库选择套图，上传产品图后一键生成。模版库可继续追加，不限于本套。
          </p>
        </div>
        {selected && (
          <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
            {selected.shotCount} 张构图
          </span>
        )}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[220px_1fr]">
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">
            模版套图
          </label>
          <div className="space-y-2">
            {suites.map((suite) => (
              <button
                key={suite.id}
                type="button"
                onClick={() => setSuiteId(suite.id)}
                className={cn(
                  "w-full rounded-lg border p-2 text-left transition",
                  suiteId === suite.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-muted/40",
                )}
              >
                {suite.previewImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={suite.previewImage}
                    alt=""
                    className="mb-2 h-20 w-full rounded object-cover"
                  />
                ) : null}
                <div className="text-sm font-medium">{suite.name}</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground line-clamp-2">
                  {suite.description}
                </div>
              </button>
            ))}
            {suites.length === 0 && (
              <p className="text-xs text-muted-foreground">暂无可用模版</p>
            )}
          </div>
        </div>

        <div className="space-y-4">
          {selected && (
            <>
              <div>
                <div className="mb-2 text-xs font-medium text-muted-foreground">
                  产品图片
                </div>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  {selected.uploadSlots.map((slot) => {
                    const state = slots[slot.id];
                    return (
                      <label
                        key={slot.id}
                        className={cn(
                          "relative flex aspect-square cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed p-2 text-center",
                          state?.proxyUrl
                            ? "border-border bg-muted/20"
                            : "border-muted-foreground/30 hover:border-primary/50",
                        )}
                      >
                        {state?.proxyUrl ? (
                          <>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={state.proxyUrl}
                              alt={slot.label}
                              className="absolute inset-0 h-full w-full rounded-lg object-cover"
                            />
                            <button
                              type="button"
                              className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white"
                              onClick={(e) => {
                                e.preventDefault();
                                setSlots((prev) => {
                                  const next = { ...prev };
                                  delete next[slot.id];
                                  return next;
                                });
                              }}
                            >
                              <X size={12} />
                            </button>
                          </>
                        ) : (
                          <>
                            {uploading === slot.id ? (
                              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                            ) : (
                              <Upload className="h-5 w-5 text-muted-foreground" />
                            )}
                            <span className="mt-2 text-xs font-medium">
                              {slot.label}
                              {slot.required ? " *" : ""}
                            </span>
                            <span className="mt-0.5 text-[10px] text-muted-foreground">
                              {slot.description}
                            </span>
                          </>
                        )}
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          disabled={Boolean(uploading) || generating}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) void uploadSlot(slot.id, file);
                            e.target.value = "";
                          }}
                        />
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <label className="flex flex-col gap-1 text-xs">
                  <span className="text-muted-foreground">图片比例</span>
                  <select
                    value={aspectRatio}
                    onChange={(e) =>
                      setAspectRatio(e.target.value as AspectRatio)
                    }
                    className="rounded-md border px-2 py-1.5 text-sm"
                  >
                    {selected.supportedAspectRatios.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs">
                  <span className="text-muted-foreground">分辨率</span>
                  <select
                    value={resolution}
                    onChange={(e) =>
                      setResolution(e.target.value as Resolution)
                    }
                    className="rounded-md border px-2 py-1.5 text-sm"
                  >
                    {selected.supportedResolutions.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {selected.fidelityRules.length > 0 && (
                <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-muted-foreground">
                  {selected.fidelityRules.map((rule) => (
                    <li key={rule}>{rule}</li>
                  ))}
                </ul>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={generating || !slots.product_front?.pathname}
                  onClick={() => void generateSuite()}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  {generating ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      生成中（约 {selected.shotCount} 张）…
                    </span>
                  ) : (
                    `立即生成套图（${selected.shotCount} 张）`
                  )}
                </button>
                {lastResult && (
                  <span className="text-xs text-emerald-700">{lastResult}</span>
                )}
              </div>
            </>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      </div>
    </section>
  );
}
