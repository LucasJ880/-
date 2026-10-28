"use client";

/**
 * INSTALL-1：安装任务页（手机优先）
 * — 任务头：时间 / 客户 / 地址 / 开始安装
 * — 每扇窗：序号 / 位置 / 尺寸 / 产品 / 面料 / 拍照（原生相机）/ 缩略图 + 时间 + 张数
 * — 全部收口后"完成收口"；409 时列出未收口窗
 * INSTALL-2a：收口单元含工艺参数行（Vinyl / 窗帘 / 国内下单 / 外采购，显示段标签）；位置已变提示补拍；
 * 零单元显示"工艺单没有可收口的行"，不显示"还差 0 扇"。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Camera, CheckCircle2, Loader2, MapPin, Phone, Play } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import {
  compressImage,
  fmtDateTime,
  fmtTime,
  INSTALL_STATUS_LABEL,
  type InstallPhoto,
  type InstallTaskDetailData,
  type InstallWindow,
  unitSpecLine,
} from "./install-types";

type MissingWindow = { itemNumber: number; location: string };

export function InstallTaskDetail({ id }: { id: string }) {
  const [task, setTask] = useState<InstallTaskDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // "start" | "complete"
  const [missing, setMissing] = useState<MissingWindow[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/install/tasks/${id}`);
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error || (res.status === 403 ? "这不是分配给你的任务" : "加载失败"));
        setTask(null);
        return;
      }
      const data = (await res.json()) as { task: InstallTaskDetailData };
      setTask(data.task);
    } catch {
      setError("网络错误");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function startTask() {
    setBusy("start");
    setNotice(null);
    try {
      const res = await apiFetch(`/api/install/tasks/${id}/start`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setNotice(data.error || "无法开始");
        return;
      }
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function completeTask() {
    setBusy("complete");
    setNotice(null);
    setMissing(null);
    try {
      const res = await apiFetch(`/api/install/tasks/${id}/complete`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
        missing?: MissingWindow[];
      };
      // NO_UNITS / ORDER_STATUS 等其余错误原样提示（落到下面 !res.ok）
      if (res.status === 409 && data.code === "WINDOWS_MISSING") {
        setMissing(data.missing ?? []);
        return;
      }
      if (!res.ok) {
        setNotice(data.error || "无法完成收口");
        return;
      }
      setNotice("收口完成，工艺单已标记为已安装");
      await load();
    } finally {
      setBusy(null);
    }
  }

  function onPhotoUploaded(itemId: string, photoCount: number, latest: InstallPhoto) {
    setTask((prev) => {
      if (!prev) return prev;
      const windows = prev.windows.map((w) =>
        w.itemId === itemId
          ? { ...w, photoCount, latest, photos: [latest, ...w.photos], locationChanged: null }
          : w,
      );
      const completed = windows.filter((w) => w.photoCount > 0).length;
      return {
        ...prev,
        windows,
        closeout: { total: windows.length, completed, allCompleted: windows.length > 0 && completed === windows.length },
      };
    });
    setMissing(null);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </div>
    );
  }

  if (error || !task) {
    return (
      <div className="mx-auto max-w-2xl space-y-3">
        <Link href="/install" className="inline-flex items-center gap-1 text-sm text-muted">
          <ArrowLeft size={16} /> 返回
        </Link>
        <div className="rounded-lg border border-[rgba(166,61,61,0.2)] bg-[rgba(166,61,61,0.04)] p-4 text-sm text-danger">
          {error ?? "安装任务不存在"}
        </div>
      </div>
    );
  }

  const canStart = task.status === "scheduled" || task.status === "confirmed";
  const isDone = task.status === "completed";
  const canUpload = !isDone && task.status !== "cancelled";
  const noUnits = task.closeout.total === 0;

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-24">
      <Link href="/install" className="inline-flex items-center gap-1 text-sm text-muted">
        <ArrowLeft size={16} /> 安装任务
      </Link>

      {/* 任务头 */}
      <div className="rounded-xl border border-border bg-card-bg p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-mono text-sm text-muted">
              {fmtDateTime(task.startAt)} – {fmtTime(task.endAt)}
            </div>
            <h1 className="mt-1 truncate text-lg font-bold text-foreground">{task.customer.name}</h1>
            {task.address && (
              <a
                href={`https://maps.google.com/?q=${encodeURIComponent(task.address)}`}
                target="_blank"
                rel="noreferrer"
                className="mt-1 flex items-start gap-1 text-sm text-accent"
              >
                <MapPin size={14} className="mt-0.5 shrink-0" />
                <span>{task.address}</span>
              </a>
            )}
            {task.contactPhone && (
              <a href={`tel:${task.contactPhone}`} className="mt-1 flex items-center gap-1 text-sm text-accent">
                <Phone size={14} /> {task.contactPhone}
              </a>
            )}
          </div>
          <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
            {INSTALL_STATUS_LABEL[task.status] ?? task.status}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          {task.order && <span className="font-mono">工艺单 {task.order.code}</span>}
          <span>安装：{task.assignedTo.name}</span>
          <span>
            已收口 <b className="text-foreground">{task.closeout.completed}</b> / {task.closeout.total} 项
          </span>
        </div>
        {(task.remarks || task.notes) && (
          <p className="mt-2 whitespace-pre-wrap text-xs text-muted">{task.remarks || task.notes}</p>
        )}
        {canStart && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={startTask}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-[color:var(--on-accent)] disabled:opacity-50"
          >
            {busy === "start" ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
            开始安装
          </button>
        )}
      </div>

      {notice && (
        <div className="rounded-lg border border-border bg-card-bg px-3 py-2 text-sm text-foreground">{notice}</div>
      )}
      {missing && missing.length > 0 && (
        <div className="rounded-lg border border-[rgba(201,138,34,0.4)] bg-[rgba(201,138,34,0.08)] px-3 py-2 text-sm text-foreground">
          还有 {missing.length} 项没有照片：
          {missing.map((m) => `#${m.itemNumber} ${m.location}`).join("、")}
        </div>
      )}

      {noUnits && !isDone && (
        <div className="rounded-lg border border-[rgba(201,138,34,0.4)] bg-[rgba(201,138,34,0.08)] px-3 py-2 text-sm text-foreground">
          工艺单没有可收口的行，请联系出单补齐后再收口。
        </div>
      )}

      {/* 收口单元列表 */}
      <div className="space-y-2">
        {task.windows.map((w) => (
          <WindowRow
            key={w.itemId}
            taskId={task.id}
            window={w}
            canUpload={canUpload}
            onUploaded={onPhotoUploaded}
          />
        ))}
      </div>

      {/* 完成收口 */}
      {!isDone && !noUnits && (
        <div className="fixed inset-x-0 bottom-[calc(var(--mobile-tabbar-height,56px)+env(safe-area-inset-bottom,0px))] z-20 border-t border-border bg-[rgba(250,248,244,0.95)] p-3 backdrop-blur md:static md:border-0 md:bg-transparent md:p-0">
          <button
            type="button"
            disabled={busy !== null || !task.closeout.allCompleted}
            onClick={completeTask}
            className={`mx-auto flex w-full max-w-2xl items-center justify-center gap-1.5 rounded-lg px-4 py-3 text-sm font-semibold ${
              task.closeout.allCompleted
                ? "bg-[#2e7a56] text-white"
                : "bg-[rgba(26,36,32,0.06)] text-muted"
            } disabled:opacity-60`}
          >
            {busy === "complete" ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
            {task.closeout.allCompleted
              ? "完成收口"
              : `完成收口（还差 ${task.closeout.total - task.closeout.completed} 项）`}
          </button>
        </div>
      )}
      {isDone && (
        <div className="rounded-lg border border-[rgba(46,122,86,0.3)] bg-[rgba(46,122,86,0.06)] px-3 py-2 text-sm text-[#2e7a56]">
          已于 {task.completedAt ? fmtDateTime(task.completedAt) : "—"} 完成收口
        </div>
      )}
    </div>
  );
}

function WindowRow({
  taskId,
  window: w,
  canUpload,
  onUploaded,
}: {
  taskId: string;
  window: InstallWindow;
  canUpload: boolean;
  onUploaded: (itemId: string, photoCount: number, latest: InstallPhoto) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    setErr(null);
    try {
      const blob = await compressImage(file);
      const form = new FormData();
      const name = blob === file ? file.name : file.name.replace(/\.[^.]+$/, "") + ".jpg";
      form.append("file", blob, name || `window-${w.itemNumber}.jpg`);
      const res = await apiFetch(`/api/install/tasks/${taskId}/items/${w.itemId}/photo`, {
        method: "POST",
        body: form,
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        photoCount?: number;
        latest?: InstallPhoto;
      };
      if (!res.ok || !data.latest) {
        setErr(data.error || "上传失败");
        return;
      }
      onUploaded(w.itemId, data.photoCount ?? w.photoCount + 1, data.latest);
    } catch {
      setErr("网络错误，请重试");
    } finally {
      setUploading(false);
    }
  }

  const done = w.photoCount > 0;
  return (
    <div
      className={`rounded-xl border bg-card-bg p-3 shadow-sm ${done ? "border-[rgba(46,122,86,0.35)]" : "border-border"}`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
            done ? "bg-[rgba(46,122,86,0.12)] text-[#2e7a56]" : "bg-[rgba(26,36,32,0.06)] text-muted"
          }`}
        >
          {w.itemNumber}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-foreground">{w.location || "（未写位置）"}</span>
            <span className="font-mono text-xs text-muted">
              {w.width} × {w.height}
            </span>
            {w.section !== "blinds" && (
              <span className="shrink-0 rounded-full bg-[rgba(26,36,32,0.06)] px-1.5 py-0.5 text-[10px] text-muted">
                {w.sectionLabel}
              </span>
            )}
          </div>
          <div className="mt-0.5 text-xs text-muted">{unitSpecLine(w)}</div>
          {w.itemRemark && <div className="mt-0.5 text-xs text-muted">备注：{w.itemRemark}</div>}
          {w.locationChanged && (
            <div className="mt-1 text-xs text-[#a86a12]">
              位置已变（拍照时：{w.locationChanged.previousLocation || "—"}），请补拍
            </div>
          )}
          {w.latest && (
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md border border-border"
                aria-label="查看照片"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={w.latest.proxyUrl} alt={`窗 ${w.itemNumber} 收口照片`} className="h-full w-full object-cover" />
                {w.photoCount > 1 && (
                  <span className="absolute bottom-0 right-0 rounded-tl bg-black/60 px-1 text-[10px] text-white">
                    {w.photoCount} 张
                  </span>
                )}
              </button>
              <div className="text-xs text-muted">
                <div className="text-[#2e7a56]">已收口</div>
                <div>{fmtDateTime(w.latest.at)}</div>
                {w.latest.note && <div>{w.latest.note}</div>}
              </div>
            </div>
          )}
          {showAll && w.photos.length > 1 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {w.photos.map((p) => (
                <a key={p.pathname} href={p.proxyUrl} target="_blank" rel="noreferrer" className="block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.proxyUrl} alt="" className="h-14 w-14 rounded border border-border object-cover" />
                  <div className="mt-0.5 w-14 truncate text-[10px] text-muted">{fmtTime(p.at)}</div>
                </a>
              ))}
            </div>
          )}
          {err && <div className="mt-1 text-xs text-danger">{err}</div>}
        </div>
        {canUpload && (
          <div className="shrink-0">
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={onFile}
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
              className={`flex h-11 w-11 items-center justify-center rounded-lg ${
                done ? "border border-border text-muted" : "bg-accent text-[color:var(--on-accent)]"
              } disabled:opacity-50`}
              aria-label={done ? "补拍" : "拍照收口"}
            >
              {uploading ? <Loader2 size={18} className="animate-spin" /> : <Camera size={18} />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
