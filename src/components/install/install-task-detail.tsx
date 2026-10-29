"use client";

/**
 * INSTALL-1：安装任务页（手机优先）
 * — 任务头：时间 / 客户 / 地址 / 开始安装
 * — 每扇窗：序号 / 位置 / 尺寸 / 产品 / 面料 / 拍照（原生相机）/ 缩略图 + 时间 + 张数
 * — 全部收口后"完成收口"；409 时列出未收口窗
 * INSTALL-2a：收口单元含工艺参数行（Vinyl / 窗帘 / 国内下单 / 外采购，显示段标签）；位置已变提示补拍；
 * 零单元显示"工艺单没有可收口的行"，不显示"还差 0 扇"。
 * INSTALL-2d：每单元"拍照完成"或"有问题"（类型 / 描述 / 问题照）；底部按钮：全部已收口 →「完成收口」，
 * 没有未处理且有问题 →「提交维修单（N 项有问题）」，还有未处理 → 禁用并列出位置；维修单表单（预填客户名 / 电话）。
 * INSTALL-2e：返修任务标明"返修 R-…"，只列维修单上的行（接口已按范围返回）。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Camera, CheckCircle2, ClipboardList, Loader2, MapPin, Phone, Play, X } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { addDays, ISSUE_TYPE_LABEL, ISSUE_TYPES, type IssueType } from "@/lib/install/repair";
import {
  closeoutCounts,
  compressImage,
  dayKey,
  fmtDateTime,
  fmtTime,
  INSTALL_STATUS_LABEL,
  type InstallPhoto,
  type InstallTaskDetailData,
  type InstallUnitIssue,
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
  const [repairOpen, setRepairOpen] = useState(false);

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
          ? { ...w, photoCount, latest, photos: [latest, ...w.photos], locationChanged: null, state: "done" as const, issue: null }
          : w,
      );
      return { ...prev, windows, closeout: closeoutCounts(windows) };
    });
    setMissing(null);
  }

  function onIssueMarked(itemId: string, issue: InstallUnitIssue) {
    setTask((prev) => {
      if (!prev) return prev;
      const windows = prev.windows.map((w) => (w.itemId === itemId ? { ...w, locationChanged: null, state: "issue" as const, issue } : w));
      return { ...prev, windows, closeout: closeoutCounts(windows) };
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
  const unhandled = task.windows.filter((w) => w.state === "pending");
  const canSubmitRepair = task.closeout.issueCount > 0 && unhandled.length === 0;

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
          {task.returnRepair && (
            <span className="rounded-full bg-[rgba(201,138,34,0.14)] px-2 py-0.5 font-medium text-[#a86a12]">
              返修 {task.returnRepair.repairNo} · 只装维修单上的行
            </span>
          )}
          <span>
            已收口 <b className="text-foreground">{task.closeout.completed}</b> / {task.closeout.total} 项
          </span>
          {task.closeout.issueCount > 0 && (
            <span className="text-[#a86a12]">
              有问题 <b>{task.closeout.issueCount}</b> 项
            </span>
          )}
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
          还有 {missing.length} 项没有处理（拍完工照或标记问题）：
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
            onIssue={onIssueMarked}
          />
        ))}
      </div>

      {/* 完成收口 / 提交维修单（二选一，spec「完成收口与提交维修单二选一」） */}
      {!isDone && !noUnits && (
        <div className="fixed inset-x-0 bottom-[calc(var(--mobile-tabbar-height,56px)+env(safe-area-inset-bottom,0px))] z-20 border-t border-border bg-[rgba(250,248,244,0.95)] p-3 backdrop-blur md:static md:border-0 md:bg-transparent md:p-0">
          {canSubmitRepair ? (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => setRepairOpen(true)}
              className="mx-auto flex w-full max-w-2xl items-center justify-center gap-1.5 rounded-lg bg-[#a86a12] px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
            >
              <ClipboardList size={16} />
              {`提交维修单（${task.closeout.issueCount} 项有问题）`}
            </button>
          ) : (
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
                : `还差 ${unhandled.length} 项：${unhandled
                    .slice(0, 3)
                    .map((w) => `#${w.itemNumber} ${w.location || "—"}`)
                    .join("、")}${unhandled.length > 3 ? " 等" : ""}`}
            </button>
          )}
        </div>
      )}
      {isDone && task.repair && (
        <div className="rounded-lg border border-[rgba(201,138,34,0.4)] bg-[rgba(201,138,34,0.08)] px-3 py-2 text-sm text-foreground">
          已于 {task.completedAt ? fmtDateTime(task.completedAt) : "—"} 提交维修单 <b className="font-mono">{task.repair.repairNo}</b>：
          {task.repair.rowCount} 项待返修，目标返修日 {task.repair.targetDate}
        </div>
      )}
      {isDone && !task.repair && (
        <div className="rounded-lg border border-[rgba(46,122,86,0.3)] bg-[rgba(46,122,86,0.06)] px-3 py-2 text-sm text-[#2e7a56]">
          已于 {task.completedAt ? fmtDateTime(task.completedAt) : "—"} 完成收口
        </div>
      )}
      {repairOpen && (
        <RepairDialog
          task={task}
          onClose={() => setRepairOpen(false)}
          onSubmitted={async (msg) => {
            setRepairOpen(false);
            setNotice(msg);
            await load();
          }}
          onUnhandled={(list) => {
            setRepairOpen(false);
            setMissing(list);
          }}
        />
      )}
    </div>
  );
}

function WindowRow({
  taskId,
  window: w,
  canUpload,
  onUploaded,
  onIssue,
}: {
  taskId: string;
  window: InstallWindow;
  canUpload: boolean;
  onUploaded: (itemId: string, photoCount: number, latest: InstallPhoto) => void;
  onIssue: (itemId: string, issue: InstallUnitIssue) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);

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

  const done = w.state === "done";
  const hasIssue = w.state === "issue" && w.issue;
  return (
    <div
      id={`unit-${w.itemId}`}
      className={`rounded-xl border bg-card-bg p-3 shadow-sm ${
        done ? "border-[rgba(46,122,86,0.35)]" : hasIssue ? "border-[rgba(201,138,34,0.55)]" : "border-border"
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
            done
              ? "bg-[rgba(46,122,86,0.12)] text-[#2e7a56]"
              : hasIssue
                ? "bg-[rgba(201,138,34,0.15)] text-[#a86a12]"
                : "bg-[rgba(26,36,32,0.06)] text-muted"
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
          {hasIssue && w.issue && (
            <div className="mt-2 rounded-lg bg-[rgba(201,138,34,0.08)] px-2 py-1.5 text-xs text-foreground">
              <div className="flex flex-wrap items-center gap-1.5 font-medium text-[#a86a12]">
                <AlertTriangle size={13} /> 有问题：{w.issue.issueTypeLabel}
                <span className="rounded-full bg-white/70 px-1.5 py-0.5 text-[10px] font-normal text-muted">
                  {w.issue.needsFactory ? "需工厂出单" : "不需工厂"}
                </span>
              </div>
              <div className="mt-0.5 whitespace-pre-wrap">{w.issue.description}</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {w.issue.photos.map((p) => (
                  <a key={p.pathname} href={p.proxyUrl} target="_blank" rel="noreferrer" className="block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.proxyUrl} alt={`窗 ${w.itemNumber} 问题照片`} className="h-12 w-12 rounded border border-border object-cover" />
                  </a>
                ))}
              </div>
              <div className="mt-0.5 text-[10px] text-muted">修好后再拍完工照即恢复为已收口</div>
            </div>
          )}
          {w.latest && done && (
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
          {issueOpen && canUpload && (
            <IssueForm
              taskId={taskId}
              unit={w}
              onCancel={() => setIssueOpen(false)}
              onSaved={(issue) => {
                setIssueOpen(false);
                onIssue(w.itemId, issue);
              }}
            />
          )}
        </div>
        {canUpload && (
          <div className="flex shrink-0 flex-col gap-1.5">
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
            <button
              type="button"
              onClick={() => setIssueOpen((v) => !v)}
              className={`flex h-11 w-11 items-center justify-center rounded-lg border ${
                hasIssue ? "border-[#a86a12] bg-[rgba(201,138,34,0.12)] text-[#a86a12]" : "border-border text-[#a86a12]"
              }`}
              aria-label="有问题"
            >
              <AlertTriangle size={18} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** 标记"有问题"：类型 / 描述 / 问题照（必填）；"其他"可选是否需工厂（默认需） */
function IssueForm({
  taskId,
  unit,
  onCancel,
  onSaved,
}: {
  taskId: string;
  unit: InstallWindow;
  onCancel: () => void;
  onSaved: (issue: InstallUnitIssue) => void;
}) {
  const photoRef = useRef<HTMLInputElement>(null);
  const [issueType, setIssueType] = useState<IssueType | "">(unit.issue?.issueType ?? "");
  const [description, setDescription] = useState(unit.issue?.description ?? "");
  const [needsFactory, setNeedsFactory] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const ready = !!issueType && description.trim().length > 0 && !!file;

  async function save() {
    if (!ready || !file || !issueType) return;
    setBusy(true);
    setErr(null);
    try {
      const blob = await compressImage(file);
      const form = new FormData();
      form.append("file", blob, blob === file ? file.name : `issue-${unit.itemNumber}.jpg`);
      form.append("issueType", issueType);
      form.append("description", description.trim());
      if (issueType === "other") form.append("needsFactory", needsFactory ? "true" : "false");
      const res = await apiFetch(`/api/install/tasks/${taskId}/items/${unit.itemId}/issue`, { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { error?: string; issue?: InstallUnitIssue };
      if (!res.ok || !data.issue) {
        setErr(data.error || "保存失败");
        return;
      }
      onSaved(data.issue);
    } catch {
      setErr("网络错误，请重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-[rgba(201,138,34,0.4)] bg-[rgba(201,138,34,0.05)] p-2">
      <select
        aria-label="问题类型"
        value={issueType}
        onChange={(e) => setIssueType(e.target.value as IssueType | "")}
        className="w-full rounded-md border border-border bg-white px-2 py-2 text-sm"
      >
        <option value="">选择问题类型</option>
        {ISSUE_TYPES.map((t) => (
          <option key={t} value={t}>
            {ISSUE_TYPE_LABEL[t]}
          </option>
        ))}
      </select>
      {issueType === "other" && (
        <label className="flex items-center gap-1.5 text-xs text-foreground">
          <input type="checkbox" checked={needsFactory} onChange={(e) => setNeedsFactory(e.target.checked)} aria-label="需工厂出单" />
          需工厂出单
        </label>
      )}
      <textarea
        aria-label="问题描述"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        maxLength={300}
        rows={2}
        placeholder="写清楚问题，例如：高度短 2cm / 漏发支架"
        className="w-full rounded-md border border-border bg-white px-2 py-1.5 text-sm"
      />
      <input
        ref={photoRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        aria-label="问题照片"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => photoRef.current?.click()}
          className="flex items-center gap-1 rounded-md border border-border bg-white px-2 py-1.5 text-xs text-foreground"
        >
          <Camera size={14} /> {file ? "已选照片，重拍" : "拍问题照（必填）"}
        </button>
        <span className="truncate text-[11px] text-muted">{file?.name}</span>
      </div>
      {err && <div className="text-xs text-danger">{err}</div>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!ready || busy}
          onClick={save}
          className="flex flex-1 items-center justify-center gap-1 rounded-md bg-[#a86a12] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy && <Loader2 size={14} className="animate-spin" />}保存问题
        </button>
        <button type="button" onClick={onCancel} className="rounded-md border border-border px-3 py-2 text-sm text-foreground">
          取消
        </button>
      </div>
    </div>
  );
}

/** 维修单表单（纸质模板数字化）：表头预填，行由服务端按有问题的单元生成 */
function RepairDialog({
  task,
  onClose,
  onSubmitted,
  onUnhandled,
}: {
  task: InstallTaskDetailData;
  onClose: () => void;
  onSubmitted: (message: string) => void | Promise<void>;
  onUnhandled: (list: MissingWindow[]) => void;
}) {
  const today = dayKey(new Date());
  const [customerName, setCustomerName] = useState(task.customer.name);
  const [phone, setPhone] = useState(task.contactPhone ?? "");
  const [notes, setNotes] = useState("");
  const [preferred, setPreferred] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const rows = task.windows.filter((w) => w.state === "issue" && w.issue);
  const target = preferred || addDays(today, 7);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const res = await apiFetch(`/api/install/tasks/${task.id}/repair`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerName, phone, notes, customerPreferredDate: preferred || null, customerConfirmed: confirmed }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
        missing?: MissingWindow[];
        repair?: { repairNo: string; targetDate: string };
      };
      if (res.status === 409 && data.code === "UNITS_UNHANDLED") {
        onUnhandled(data.missing ?? []);
        return;
      }
      if (!res.ok || !data.repair) {
        setErr(data.error || "提交失败");
        return;
      }
      await onSubmitted(`已提交维修单 ${data.repair.repairNo}，目标返修日 ${data.repair.targetDate}；出单、运营、会计、销售已收到通知`);
    } catch {
      setErr("网络错误，请重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-3 sm:items-center" role="dialog" aria-modal="true" aria-label="提交维修单">
      <div className="max-h-[92vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-xl border border-border bg-card-bg p-4 shadow-lg">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">维修单</h2>
            <p className="mt-0.5 font-mono text-xs text-muted">Order# {task.order?.code ?? "—"} · Filling Date {today}</p>
          </div>
          <button type="button" onClick={onClose} className="text-muted" aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <label className="col-span-2 space-y-1 sm:col-span-1">
            <span className="text-xs text-muted">Name 客户名</span>
            <input aria-label="客户名" value={customerName} onChange={(e) => setCustomerName(e.target.value)} className="w-full rounded-md border border-border px-2 py-1.5" />
          </label>
          <label className="col-span-2 space-y-1 sm:col-span-1">
            <span className="text-xs text-muted">Phone 电话</span>
            <input aria-label="电话" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full rounded-md border border-border px-2 py-1.5" />
          </label>
          <label className="col-span-2 space-y-1">
            <span className="text-xs text-muted">Notes 备注</span>
            <textarea aria-label="备注" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={1000} className="w-full rounded-md border border-border px-2 py-1.5" />
          </label>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted">问题行（{rows.length}）</div>
          <ol className="space-y-1 text-sm">
            {rows.map((w, i) => (
              <li key={w.itemId} className="rounded-md bg-[rgba(201,138,34,0.06)] px-2 py-1">
                <span className="font-mono text-xs text-muted">{i + 1}.</span> #{w.itemNumber} {w.location || "—"} · {w.issue!.issueTypeLabel}
                <span className="text-xs text-muted"> · {w.issue!.needsFactory ? "需工厂" : "不需工厂"}</span>
                <div className="text-xs text-foreground">{w.issue!.description}</div>
              </li>
            ))}
          </ol>
        </div>
        <div className="space-y-1.5 rounded-lg border border-border p-2 text-sm">
          <label className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted">客户期望返修日（可不填）</span>
            <input type="date" aria-label="客户期望返修日" min={today} value={preferred} onChange={(e) => setPreferred(e.target.value)} className="rounded-md border border-border px-2 py-1" />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-foreground">
            <input type="checkbox" aria-label="已和客户确认" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            已和客户确认返修时间
          </label>
          <div className="text-xs text-muted">
            目标返修日：<b className="text-foreground">{target}</b>
            {!preferred && "（默认填写日 + 7 天）"}
          </div>
        </div>
        {err && <p className="text-sm text-danger">{err}</p>}
        <button
          type="button"
          disabled={busy || !customerName.trim() || rows.length === 0}
          onClick={submit}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#a86a12] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <ClipboardList size={16} />}
          提交维修单
        </button>
        <p className="text-[11px] text-muted">提交后本次安装结束（结果：需返修），工艺单保持已排期；出单、运营、会计与销售会收到通知。</p>
      </div>
    </div>
  );
}
