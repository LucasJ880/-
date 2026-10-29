"use client";

import { useState, useEffect, useCallback, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Edit,
  Trash2,
  FileText,
  Ruler,
  Scissors,
  Download,
  CalendarCheck,
  Camera,
  Loader2,
} from "lucide-react";
import { calculateItem } from "@/lib/blinds/calculation-engine";
import { apiFetch } from "@/lib/api-fetch";
import { blockingIssues, computeIssues, type ProcessIssue } from "@/lib/sunny-process/issues";
import type { ProcessSpec } from "@/lib/sunny-process/process-spec";
import {
  DomesticSection,
  DrapesSection,
  IssuesPanel,
  PurchaseSection,
  SourceBanner,
  VinylSection,
} from "./process-sections";
import type { InstallTaskDetailData } from "@/components/install/install-types";

interface BlindsOrderItem {
  id: string;
  itemNumber: number;
  location: string;
  width: number;
  height: number;
  fabricSku: string;
  productType: string;
  measureType: string;
  controlType: string;
  controlSide: string;
  headrailType: string;
  mountType: string;
  fabricRatio: number | null;
  silkRatio: number | null;
  bottomBarWidth: number | null;
  itemRemark: string | null;
  cutHeadrail: number | null;
  cutTube38: number | null;
  cutRollerBar: number | null;
  cutZebraBar: number | null;
  cutCoreRod: number | null;
  cutShangrilaBar: number | null;
  cutFabricWidth: number | null;
  cutFabricLength: number | null;
  insertSize: number | null;
  cordLength: number | null;
  cordSleeveLen: number | null;
  squareFeet: number | null;
  sortOrder: number;
}

interface BlindsOrder {
  id: string;
  code: string;
  status: string;
  ruleVersion: string;
  customerName: string;
  phone: string | null;
  address: string | null;
  installDate: string | null;
  remarks: string | null;
  appointmentId: string | null;
  customerId: string | null;
  /** PERM-3：按品类的修改权摘要（由详情接口附带） */
  access?: {
    canEdit: boolean;
    categories: string[];
    missingCategories: string[];
    responsiblePositions: string[];
  };
  createdAt: string;
  updatedAt: string;
  items: BlindsOrderItem[];
  project: { id: string; name: string; color: string } | null;
  creator: { id: string; name: string };
}

const STATUS_MAP: Record<string, { label: string; color: string; next?: string; nextLabel?: string }> = {
  draft: { label: "草稿", color: "bg-[rgba(110,125,118,0.08)] text-[#6e7d76]", next: "confirmed", nextLabel: "确认工艺单" },
  confirmed: { label: "已确认", color: "bg-accent-soft text-accent", next: "completed", nextLabel: "标记完成" },
  in_production: { label: "生产中", color: "bg-[rgba(79,70,229,0.08)] text-[#4f46e5]" },
  ready: { label: "待安装", color: "bg-[rgba(201,138,34,0.12)] text-[#9a6a12]" },
  scheduled: { label: "已排期", color: "bg-[rgba(8,145,178,0.1)] text-[#0e7490]" },
  installed: { label: "已安装", color: "bg-[rgba(46,122,86,0.08)] text-[#2e7a56]", next: "completed", nextLabel: "标记完成" },
  completed: { label: "已完成", color: "bg-[rgba(46,122,86,0.08)] text-[#2e7a56]" },
  cancelled: { label: "已取消", color: "bg-[rgba(166,61,61,0.08)] text-danger" },
};

/** INSTALL-1：可从这些状态直接"安排安装" */
const CAN_SCHEDULE_FROM = new Set(["confirmed", "in_production", "ready"]);

function fmt(v: number | null | undefined): string {
  if (v == null) return "-";
  return v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

export default function BlindsOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [order, setOrder] = useState<BlindsOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"overview" | "parts" | "fabric" | "closeout" | "domestic" | "drapes" | "vinyl" | "purchase">("overview");
  const [exporting, setExporting] = useState(false);
  const [spec, setSpec] = useState<ProcessSpec | null>(null);
  const [specDirty, setSpecDirty] = useState(false);
  const [savingSpec, setSavingSpec] = useState(false);
  // INSTALL-1：安排安装 + 收口标签
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [closeout, setCloseout] = useState<InstallTaskDetailData | null>(null);

  const loadOrder = useCallback(async () => {
    const res = await apiFetch(`/api/blinds-orders/${id}`);
    if (res.ok) {
      setOrder(await res.json());
    }
    const sres = await apiFetch(`/api/blinds-orders/${id}/spec`);
    if (sres.ok) {
      const data = (await sres.json()) as { spec: ProcessSpec };
      setSpec(data.spec);
      setSpecDirty(false);
    }
    setLoading(false);
  }, [id]);

  // 待核对：用当前（含未保存的）参数实时重算，与服务端门禁同一函数
  const issues: ProcessIssue[] = order && spec ? computeIssues(order.items, spec, order.code) : [];

  function editSpec(next: ProcessSpec) {
    setSpec(next);
    setSpecDirty(true);
  }

  async function saveSpec() {
    if (!spec) return;
    setSavingSpec(true);
    try {
      const res = await apiFetch(`/api/blinds-orders/${id}/spec`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec, baseVersion: spec.version }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || "保存失败");
        // 版本冲突：重新加载最新参数（本地未保存的修改会丢弃，提示里已说明）
        if (res.status === 409) void loadOrder();
        return;
      }
      setSpec(data.spec);
      setSpecDirty(false);
    } finally {
      setSavingSpec(false);
    }
  }

  useEffect(() => {
    void loadOrder();
  }, [loadOrder]);

  /** 发给国内 / 退回自产：草稿内挪行，服务端一次事务写自产行 + 新一版工艺参数；不对外发送 */
  async function moveLines(body: Record<string, unknown>, confirmText: string) {
    if (!spec) return;
    if (specDirty) {
      alert("工艺参数有未保存的修改，请先保存");
      return;
    }
    if (!confirm(confirmText)) return;
    const res = await apiFetch(`/api/blinds-orders/${id}/move-lines`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, baseVersion: spec.version }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || "操作失败");
      if (res.status === 409) void loadOrder();
      return;
    }
    setOrder(data.order);
    setSpec(data.spec);
    setSpecDirty(false);
    if (body.to === "domestic") setTab("domestic");
  }

  // 收口标签只对持 install.photo.read（或被分配人）显示：接口 403 时不显示标签
  useEffect(() => {
    const apptId = order?.appointmentId;
    if (!apptId) {
      setCloseout(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/install/tasks/${apptId}`);
        if (!res.ok) {
          if (!cancelled) setCloseout(null);
          return;
        }
        const data = (await res.json()) as { task: InstallTaskDetailData };
        if (!cancelled) setCloseout(data.task);
      } catch {
        if (!cancelled) setCloseout(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [order?.appointmentId, order?.status]);

  async function updateStatus(newStatus: string) {
    if (specDirty) {
      alert("工艺参数有未保存的修改，请先保存");
      return;
    }
    const res = await apiFetch(`/api/blinds-orders/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    if (res.ok) {
      const updated = await res.json();
      setOrder((prev) => (prev ? { ...prev, ...updated } : updated));
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (data.code === "PROCESS_ORDER_BLOCKED") {
      alert(`${data.error}：\n\n${(data.issues as ProcessIssue[]).map((i) => `· ${i.messageZh}`).join("\n")}`);
    } else {
      alert(data.error || "状态更新失败");
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const res = await apiFetch(`/api/blinds-orders/${id}/export`);
      if (!res.ok) {
        alert("导出失败");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${order?.code || "blinds"}_工艺单.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      alert("导出请求失败");
    } finally {
      setExporting(false);
    }
  }

  /** PERM-3：作废走审批（老板提交 → 另一位老板批准）；平台管理员直接生效 */
  async function handleCancel() {
    const reason = prompt("作废原因（将提交另一位老板审批）：");
    if (reason === null) return;
    const res = await apiFetch(`/api/blinds-orders/${id}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toStatus: "cancelled", cancelReason: reason.trim() }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string; pending?: boolean; message?: string };
    if (res.status === 202) {
      alert(data.message || "作废申请已提交，等待另一位老板批准");
      return;
    }
    if (!res.ok) {
      alert(data.error || "作废失败");
      return;
    }
    await loadOrder();
  }

  async function handleDelete() {
    if (!confirm("确定删除此工艺单？此操作不可恢复。")) return;
    const res = await apiFetch(`/api/blinds-orders/${id}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/blinds-orders");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-accent" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-muted">工艺单不存在</p>
        <Link href="/blinds-orders" className="mt-4 text-accent hover:underline">
          返回列表
        </Link>
      </div>
    );
  }

  const st = STATUS_MAP[order.status] || STATUS_MAP.draft;
  const totalSF = order.items.reduce((sum, item) => sum + (item.squareFeet || 0), 0);
  // 旧接口无 access 字段时按可编辑处理（服务端仍会拦）
  const canEdit = order.access ? order.access.canEdit : true;
  const CATEGORY_LABEL: Record<string, string> = { vinyl: "Vinyl", drapery: "布帘", shades: "Roller/Zebra/Roman" };
  const categoryText = order.access?.categories.length
    ? order.access.categories.map((c) => CATEGORY_LABEL[c] ?? c).join("、")
    : "未识别";
  const canCancel = canEdit && !["cancelled", "completed"].includes(order.status);
  // 草稿参数 / 挪行同样按品类修改权（服务端 403）
  const editable = canEdit && order.status === "draft";
  const blockedCount = blockingIssues(issues).length;
  const lineCount = order.items.length + (spec ? spec.domestic.length + spec.drapes.length + spec.vinyl.length + spec.purchase.length : 0);
  // 当前分页的行被挪空 / 删空后分页按钮会隐藏：回到总览，避免停在看不见的分页上
  const tabHasRows: Record<typeof tab, boolean> = {
    overview: true,
    parts: order.items.length > 0,
    fabric: order.items.length > 0,
    domestic: !!spec?.domestic.length,
    drapes: !!spec?.drapes.length,
    vinyl: !!spec?.vinyl.length,
    purchase: !!spec?.purchase.length,
    closeout: !!closeout,
  };
  const view = tabHasRows[tab] ? tab : "overview";

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Link href="/blinds-orders" className="text-muted transition-colors hover:text-muted">
              <ArrowLeft size={20} />
            </Link>
            <h1 className="text-2xl font-bold text-foreground">{order.code}</h1>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${st.color}`}>
              {st.label}
            </span>
          </div>
          <p className="mt-1 ml-8 text-sm text-muted">
            {order.customerName}
            {order.address ? ` · ${order.address}` : ""}
            {order.installDate ? ` · 安装: ${order.installDate}` : ""}
          </p>
          {order.access && (
            <p className="mt-0.5 ml-8 text-xs text-muted">
              本单品类：{categoryText}
              {order.access.responsiblePositions.length > 0 ? ` · 负责岗位：${order.access.responsiblePositions.join("、")}` : ""}
              {!canEdit && <span className="ml-2 rounded bg-[rgba(26,36,32,0.06)] px-1.5 py-0.5">只读</span>}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-1.5 rounded-lg bg-[#2e7a56] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#2e7a56]/90 disabled:opacity-50"
          >
            <Download size={14} />
            {exporting ? "导出中..." : "导出 Excel"}
          </button>
          {canEdit && specDirty && (
            <button
              onClick={saveSpec}
              disabled={savingSpec}
              className="rounded-lg border border-accent px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent-soft disabled:opacity-50"
            >
              {savingSpec ? "保存中..." : "保存工艺参数"}
            </button>
          )}
          {canEdit && CAN_SCHEDULE_FROM.has(order.status) && (
            <button
              onClick={() => setScheduleOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-[rgba(43,96,85,0.25)] bg-[rgba(43,96,85,0.06)] px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-[rgba(43,96,85,0.1)]"
            >
              <CalendarCheck size={14} />
              安排安装
            </button>
          )}
          {canEdit && st.next && (
            <button
              onClick={() => updateStatus(st.next!)}
              disabled={order.status === "draft" && blockedCount > 0}
              title={order.status === "draft" && blockedCount > 0 ? `还有 ${blockedCount} 项阻断待核对` : undefined}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-[color:var(--on-accent)] transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {st.nextLabel}
            </button>
          )}
          {canEdit && (
            <Link
              href={`/blinds-orders/${id}/edit`}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-[rgba(26,36,32,0.03)]"
            >
              <Edit size={14} />
              编辑
            </Link>
          )}
          {canCancel && (
            <button
              onClick={handleCancel}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-muted transition-colors hover:bg-[rgba(26,36,32,0.03)]"
              title="提交作废申请（需另一位老板批准）"
            >
              作废
            </button>
          )}
          {canEdit && (
            <button
              onClick={handleDelete}
              className="flex items-center gap-1.5 rounded-lg border border-[rgba(166,61,61,0.15)] px-3 py-2 text-sm text-danger transition-colors hover:bg-[rgba(166,61,61,0.04)]"
            >
              <Trash2 size={14} />
              删除
            </button>
          )}
        </div>
      </div>

      <SourceBanner spec={spec} />
      {spec && <IssuesPanel issues={issues} />}

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="rounded-lg border border-border bg-card-bg p-4">
          <div className="text-xs text-muted">窗户数</div>
          <div className="mt-1 text-2xl font-bold text-foreground">{lineCount}</div>
        </div>
        <div className="rounded-lg border border-border bg-card-bg p-4">
          <div className="text-xs text-muted">总面积</div>
          <div className="mt-1 text-2xl font-bold text-foreground">{totalSF.toFixed(2)} <span className="text-sm font-normal">SF</span></div>
        </div>
        <div className="rounded-lg border border-border bg-card-bg p-4">
          <div className="text-xs text-muted">规则版本</div>
          <div className="mt-1 font-mono text-sm text-foreground/80">{order.ruleVersion}</div>
        </div>
        <div className="rounded-lg border border-border bg-card-bg p-4">
          <div className="text-xs text-muted">创建时间</div>
          <div className="mt-1 text-sm text-foreground/80">
            {new Date(order.createdAt).toLocaleString("zh-CN", {
              timeZone: "America/Toronto",
            })}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {[
          { key: "overview" as const, label: "订单总览", icon: FileText, show: true },
          { key: "parts" as const, label: "配件开料表", icon: Ruler, show: order.items.length > 0 },
          { key: "fabric" as const, label: "面料开料表", icon: Scissors, show: order.items.length > 0 },
          { key: "domestic" as const, label: `国内下单 (${spec?.domestic.length ?? 0})`, icon: FileText, show: !!spec?.domestic.length },
          { key: "drapes" as const, label: `窗帘 (${spec?.drapes.length ?? 0})`, icon: Scissors, show: !!spec?.drapes.length },
          { key: "vinyl" as const, label: `Vinyl 百叶 (${spec?.vinyl.length ?? 0})`, icon: Ruler, show: !!spec?.vinyl.length },
          { key: "purchase" as const, label: `外采购 (${spec?.purchase.length ?? 0})`, icon: FileText, show: !!spec?.purchase.length },
          ...(closeout
            ? [{ key: "closeout" as const, label: `收口 ${closeout.closeout.completed}/${closeout.closeout.total}`, icon: Camera, show: true }]
            : []),
        ].filter((t) => t.show).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              view === t.key
                ? "border-accent text-accent"
                : "border-transparent text-muted hover:text-foreground/80"
            }`}
          >
            <t.icon size={15} />
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {view === "overview" && (
        <OverviewTab
          order={order}
          canMove={editable && !!spec}
          onSendDomestic={(itemIds, label) => void moveLines(
            { to: "domestic", itemIds },
            `把${label}移到「国内下单表」？\n\n按销售填写的内容原样生成，交外采购下单；这些行不再按自产工艺计算。\n不会自动发送给任何人，需要时可在国内下单页「退回自产」。`,
          )}
        />
      )}
      {view === "parts" && <PartsCuttingTab items={order.items} />}
      {view === "fabric" && <FabricCuttingTab items={order.items} />}
      {spec && view === "domestic" && (
        <DomesticSection
          spec={spec} onChange={editSpec} editable={editable} issues={issues}
          onReturnInHouse={(line) => void moveLines({ to: "in_house", domesticLines: [line] }, `把国内下单第 ${line} 行退回 Blinds 自产？\n\n将按自产工艺重新计算开料；斑马帘布纱比按对照表取值。`)}
        />
      )}
      {spec && view === "drapes" && <DrapesSection spec={spec} onChange={editSpec} editable={editable} issues={issues} />}
      {spec && view === "vinyl" && <VinylSection spec={spec} onChange={editSpec} editable={editable} issues={issues} orderCode={order.code} />}
      {spec && view === "purchase" && <PurchaseSection spec={spec} onChange={editSpec} editable={editable} issues={issues} />}
      {view === "closeout" && closeout && <CloseoutTab task={closeout} />}

      {scheduleOpen && (
        <ScheduleInstallDialog
          orderId={order.id}
          hasCustomer={Boolean(order.customerId)}
          defaultDate={order.installDate}
          onClose={() => setScheduleOpen(false)}
          onScheduled={async () => {
            setScheduleOpen(false);
            await loadOrder();
          }}
        />
      )}
    </div>
  );
}

/**
 * INSTALL-1：安排安装——选安装工（/api/install/installers）+ 安装时间 → transition scheduled
 * 只有持 install.task.assign（运营 / 会计 / 老板）的人能提交成功；否则接口 403。
 */
function ScheduleInstallDialog({
  orderId,
  hasCustomer,
  defaultDate,
  onClose,
  onScheduled,
}: {
  orderId: string;
  hasCustomer: boolean;
  defaultDate: string | null;
  onClose: () => void;
  onScheduled: () => Promise<void>;
}) {
  const [installers, setInstallers] = useState<Array<{ id: string; name: string }> | null>(null);
  const [assignedToId, setAssignedToId] = useState("");
  const [installAt, setInstallAt] = useState(() =>
    defaultDate && /^\d{4}-\d{2}-\d{2}$/.test(defaultDate) ? `${defaultDate}T09:00` : "",
  );
  const [err, setErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/api/install/installers");
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          if (!cancelled) {
            setInstallers([]);
            setErr(data.error || (res.status === 403 ? "只有运营 / 会计 / 老板岗位可以安排安装" : "无法加载安装工名单"));
          }
          return;
        }
        const data = (await res.json()) as { installers: Array<{ id: string; name: string }> };
        if (!cancelled) {
          setInstallers(data.installers);
          if (data.installers.length === 1) setAssignedToId(data.installers[0].id);
        }
      } catch {
        if (!cancelled) {
          setInstallers([]);
          setErr("网络错误");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit() {
    setErr(null);
    if (!hasCustomer) {
      setErr("工艺单未关联客户，请先编辑工艺单选择客户");
      return;
    }
    if (!assignedToId) {
      setErr("请选择安装工");
      return;
    }
    if (!installAt) {
      setErr("请选择安装时间");
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiFetch(`/api/blinds-orders/${orderId}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toStatus: "scheduled",
          installDate: new Date(installAt).toISOString(),
          assignedToId,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setErr(data.error || "安排失败");
        return;
      }
      await onScheduled();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 md:items-center md:p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-2xl bg-card-bg p-5 shadow-xl md:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <h3 className="text-base font-semibold text-foreground">安排安装</h3>
        <p className="mt-1 text-xs text-muted">选择安装工与安装时间；安装工会在「安装任务」里看到，并可逐窗拍照收口。</p>

        <label className="mt-4 block text-xs font-medium text-muted">安装工</label>
        {installers === null ? (
          <div className="mt-1 flex items-center gap-2 text-sm text-muted">
            <Loader2 size={14} className="animate-spin" /> 加载中…
          </div>
        ) : installers.length === 0 ? (
          <div className="mt-1 text-sm text-muted">企业内还没有安装工岗位的人，请先在岗位绑定里加上。</div>
        ) : (
          <select
            value={assignedToId}
            onChange={(e) => setAssignedToId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
          >
            <option value="">请选择</option>
            {installers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        )}

        <label className="mt-3 block text-xs font-medium text-muted">安装时间（默认 2 小时）</label>
        <input
          type="datetime-local"
          value={installAt}
          onChange={(e) => setInstallAt(e.target.value)}
          className="mt-1 w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
        />

        {err && <div className="mt-3 text-sm text-danger">{err}</div>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm text-foreground"
          >
            取消
          </button>
          <button
            type="button"
            disabled={submitting || !installers?.length}
            onClick={submit}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-[color:var(--on-accent)] disabled:opacity-50"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            确认安排
          </button>
        </div>
      </div>
    </div>
  );
}

/** INSTALL-1：收口标签——每窗缩略图 / 时间 / 张数（持 install.photo.read 才拿得到数据）；INSTALL-2a：含工艺参数单元 */
function CloseoutTab({ task }: { task: InstallTaskDetailData }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
        <span>
          安装：<b className="text-foreground">{task.assignedTo.name}</b>
        </span>
        <span>
          {new Date(task.startAt).toLocaleString("zh-CN", { timeZone: "America/Toronto" })}
        </span>
        <span>
          已收口 <b className="text-foreground">{task.closeout.completed}</b> / {task.closeout.total} 项
        </span>
        {task.completedAt && (
          <span className="text-[#2e7a56]">
            完成于 {new Date(task.completedAt).toLocaleString("zh-CN", { timeZone: "America/Toronto" })}
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {task.windows.map((w) => (
          <div key={w.itemId} className="rounded-xl border border-border bg-card-bg p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-foreground">
                #{w.itemNumber} {w.location}
                {w.section !== "blinds" && (
                  <span className="ml-1.5 rounded-full bg-[rgba(26,36,32,0.06)] px-1.5 py-0.5 text-[10px] font-normal text-muted">
                    {w.sectionLabel}
                  </span>
                )}
              </span>
              <span className={`text-xs ${w.photoCount > 0 ? "text-[#2e7a56]" : "text-muted"}`}>
                {w.photoCount > 0 ? `${w.photoCount} 张` : w.locationChanged ? "位置已变" : "未收口"}
              </span>
            </div>
            <div className="mt-0.5 text-xs text-muted">
              {[`${w.width} × ${w.height}`, w.productType, w.fabricSku].filter((p) => p && p.trim()).join(" · ")}
            </div>
            {w.latest ? (
              <a href={w.latest.proxyUrl} target="_blank" rel="noreferrer" className="mt-2 block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={w.latest.proxyUrl}
                  alt={`窗 ${w.itemNumber} 收口照片`}
                  className="h-40 w-full rounded-lg border border-border object-cover"
                />
                <div className="mt-1 text-xs text-muted">
                  {new Date(w.latest.at).toLocaleString("zh-CN", { timeZone: "America/Toronto" })}
                  {w.latest.note ? ` · ${w.latest.note}` : ""}
                </div>
              </a>
            ) : (
              <div className="mt-2 flex h-40 items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted">
                尚无照片
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function OverviewTab({ order, canMove, onSendDomestic }: { order: BlindsOrder; canMove: boolean; onSendDomestic: (itemIds: string[] | "all", label: string) => void }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card-bg shadow-sm">
      {canMove && order.items.length > 0 && (
        <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 text-xs text-muted">
          <span>自产 Blinds 行（卷帘 / 斑马帘 / 香格里拉）。要交国内供应商做的，点「发给国内」移到国内下单表（按销售填写原样，交外采购；不会自动发送）。</span>
          <button
            type="button"
            onClick={() => onSendDomestic("all", `全部 ${order.items.length} 行自产 Blinds`)}
            className="shrink-0 rounded-lg border border-accent px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent-soft"
          >
            全部发给国内
          </button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-[rgba(26,36,32,0.02)] text-left text-muted">
              <th className="px-3 py-2.5 font-medium">#</th>
              <th className="px-3 py-2.5 font-medium">位置</th>
              <th className="px-3 py-2.5 font-medium">宽×高</th>
              <th className="px-3 py-2.5 font-medium">面料号</th>
              <th className="px-3 py-2.5 font-medium">产品</th>
              <th className="px-3 py-2.5 font-medium">测量</th>
              <th className="px-3 py-2.5 font-medium">操控</th>
              <th className="px-3 py-2.5 font-medium">侧</th>
              <th className="px-3 py-2.5 font-medium">罩盒</th>
              <th className="px-3 py-2.5 font-medium">安装</th>
              <th className="px-3 py-2.5 font-medium">底杆覆盖</th>
              <th className="px-3 py-2.5 font-medium">SF</th>
              <th className="px-3 py-2.5 font-medium">备注</th>
              {canMove && <th className="px-3 py-2.5" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {order.items.map((item) => (
              <tr key={item.id} className="hover:bg-[rgba(43,96,85,0.02)]">
                <td className="px-3 py-2 text-muted">{item.itemNumber}</td>
                <td className="px-3 py-2 font-medium text-foreground/80">{item.location}</td>
                <td className="px-3 py-2 font-mono">{item.width} × {item.height}</td>
                <td className="px-3 py-2">{item.fabricSku}</td>
                <td className="px-3 py-2">{item.productType}</td>
                <td className="px-3 py-2">{item.measureType}</td>
                <td className="px-3 py-2">{item.controlType}</td>
                <td className="px-3 py-2">{item.controlSide}</td>
                <td className="px-3 py-2">{item.headrailType}</td>
                <td className="px-3 py-2">{item.mountType}</td>
                <td className="px-3 py-2 font-mono">{item.bottomBarWidth ?? "-"}</td>
                <td className="px-3 py-2 font-mono">{item.squareFeet?.toFixed(2) ?? "-"}</td>
                <td className="px-3 py-2 text-muted">{item.itemRemark || "-"}</td>
                {canMove && (
                  <td className="whitespace-nowrap px-3 py-2">
                    <button type="button" className="text-accent hover:underline" onClick={() => onSendDomestic([item.id], `第 ${item.itemNumber} 行（${item.location || item.productType}）`)}>
                      发给国内
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PartsCuttingTab({ items }: { items: BlindsOrderItem[] }) {
  const sorted = [...items].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card-bg shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-[rgba(26,36,32,0.02)] text-left text-muted">
              <th className="px-3 py-2.5 font-medium">#</th>
              <th className="px-3 py-2.5 font-medium">位置</th>
              <th className="px-3 py-2.5 font-medium">产品</th>
              <th className="px-3 py-2.5 font-medium">操控</th>
              <th className="px-3 py-2.5 font-medium">罩盒</th>
              <th className="px-3 py-2.5 font-medium">罩盒尺寸</th>
              <th className="px-3 py-2.5 font-medium">38管</th>
              <th className="px-3 py-2.5 font-medium">下杆</th>
              <th className="px-3 py-2.5 font-medium">圆芯杆</th>
              <th className="px-3 py-2.5 font-medium">面料宽</th>
              <th className="px-3 py-2.5 font-medium">插片</th>
              <th className="px-3 py-2.5 font-medium">件数</th>
              <th className="px-3 py-2.5 font-medium">切割类型</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sorted.map((item) => {
              const barLabel =
                item.productType === "卷帘" ? "卷帘下杆"
                : item.productType === "斑马帘" ? "斑马帘下杆"
                : "香格里拉下杆";
              const barVal =
                item.productType === "卷帘" ? item.cutRollerBar
                : item.productType === "斑马帘" ? item.cutZebraBar
                : item.cutShangrilaBar;
              const calc = calculateItem(item);

              return (
                <tr key={item.id} className="hover:bg-[rgba(43,96,85,0.02)]">
                  <td className="px-3 py-2 text-muted">{item.itemNumber}</td>
                  <td className="px-3 py-2 font-medium text-foreground/80">{item.location}</td>
                  <td className="px-3 py-2">{item.productType}</td>
                  <td className="px-3 py-2">{item.controlType}</td>
                  <td className="px-3 py-2">{item.headrailType}</td>
                  <td className="px-3 py-2 font-mono">{fmt(item.cutHeadrail)}</td>
                  <td className="px-3 py-2 font-mono">{fmt(item.cutTube38)}</td>
                  <td className="px-3 py-2 font-mono" title={barLabel}>
                    {fmt(barVal)}
                  </td>
                  <td className="px-3 py-2 font-mono">{fmt(item.cutCoreRod)}</td>
                  <td className="px-3 py-2 font-mono">{fmt(item.cutFabricWidth)}</td>
                  <td className="px-3 py-2 font-mono">{fmt(item.insertSize)}</td>
                  <td className="px-3 py-2">{calc.quantities.tube38}</td>
                  <td className="px-3 py-2">{calc.cutCategory}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FabricCuttingTab({ items }: { items: BlindsOrderItem[] }) {
  const sorted = [...items].sort((a, b) => a.sortOrder - b.sortOrder);
  const totalCord = sorted.reduce((s, i) => s + (i.cordLength || 0), 0);
  const totalSleeve = sorted.reduce((s, i) => s + (i.cordSleeveLen || 0), 0);

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl border border-border bg-card-bg shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-[rgba(26,36,32,0.02)] text-left text-muted">
                <th className="px-3 py-2.5 font-medium">#</th>
                <th className="px-3 py-2.5 font-medium">面料号</th>
                <th className="px-3 py-2.5 font-medium">面料宽</th>
                <th className="px-3 py-2.5 font-medium">面料长</th>
                <th className="px-3 py-2.5 font-medium">拉绳(m)</th>
                <th className="px-3 py-2.5 font-medium">绳套(m)</th>
                <th className="px-3 py-2.5 font-medium">拉绳分档</th>
                <th className="px-3 py-2.5 font-medium">操控侧</th>
                <th className="px-3 py-2.5 font-medium">位置</th>
                <th className="px-3 py-2.5 font-medium">斑马帘裁剪位</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sorted.map((item) => (
                <tr key={item.id} className="hover:bg-[rgba(43,96,85,0.02)]">
                  <td className="px-3 py-2 text-muted">{item.itemNumber}</td>
                  <td className="px-3 py-2 font-medium">{item.fabricSku}</td>
                  <td className="px-3 py-2 font-mono">{fmt(item.cutFabricWidth)}</td>
                  <td className="px-3 py-2 font-mono">{fmt(item.cutFabricLength)}</td>
                  <td className="px-3 py-2 font-mono">{fmt(item.cordLength)}</td>
                  <td className="px-3 py-2 font-mono">{fmt(item.cordSleeveLen)}</td>
                  <td className="px-3 py-2">
                    {calculateItem(item).cordTier || "-"}
                  </td>
                  <td className="px-3 py-2">{item.controlSide}</td>
                  <td className="px-3 py-2 text-muted">{item.location}</td>
                  <td className="px-3 py-2 font-mono">{fmt(calculateItem(item).zebraCutPos)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border bg-[rgba(26,36,32,0.02)] font-medium">
                <td className="px-3 py-2" colSpan={4}>合计</td>
                <td className="px-3 py-2 font-mono">{totalCord.toFixed(4)} m</td>
                <td className="px-3 py-2 font-mono">{totalSleeve.toFixed(4)} m</td>
                <td colSpan={4}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
