"use client";

import { useState, useEffect } from "react";
import {
  User,
  Clock,
  MapPin,
  Phone,
  CalendarDays,
  CheckCircle2,
  RefreshCw,
  Loader2,
  Ruler,
  Wrench,
  RotateCcw,
  MessageSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

interface Appointment {
  id: string;
  customerId: string;
  customer: { id: string; name: string; phone?: string; address?: string };
  opportunity?: { id: string; title: string; stage: string } | null;
  assignedTo: { id: string; name: string };
  type: string;
  title: string;
  description?: string;
  startAt: string;
  endAt: string;
  address?: string;
  contactPhone?: string;
  status: string;
  notes?: string;
  googleEventId?: string | null;
  googleSyncedAt?: string | null;
}

const TYPE_CONFIG: Record<string, { label: string; color: string; icon: typeof Ruler }> = {
  measure: { label: "量房", color: "bg-blue-500", icon: Ruler },
  install: { label: "安装", color: "bg-emerald-500", icon: Wrench },
  revisit: { label: "回访", color: "bg-purple-500", icon: RotateCcw },
  consultation: { label: "咨询", color: "bg-orange-500", icon: MessageSquare },
};

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  scheduled: { label: "已排期", color: "bg-blue-100 text-blue-700" },
  confirmed: { label: "已确认", color: "bg-emerald-100 text-emerald-700" },
  in_progress: { label: "进行中", color: "bg-amber-100 text-amber-700" },
  completed: { label: "已完成", color: "bg-green-100 text-green-700" },
  cancelled: { label: "已取消", color: "bg-gray-100 text-gray-500" },
  no_show: { label: "未到", color: "bg-red-100 text-red-700" },
};

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

/* ── Detail Dialog ── */
export function AppointmentDetailDialog({
  appointment,
  onClose,
  onMarkComplete,
  gcalConnected,
  syncing,
  onSyncToGoogle,
}: {
  appointment: Appointment | null;
  onClose: () => void;
  onMarkComplete: (id: string) => void;
  gcalConnected: boolean;
  syncing: string | null;
  onSyncToGoogle: (id: string) => void;
}) {
  return (
    <Dialog open={!!appointment} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{appointment?.title}</DialogTitle>
        </DialogHeader>
        {appointment && (
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", TYPE_CONFIG[appointment.type]?.color, "text-white")}>
                {TYPE_CONFIG[appointment.type]?.label}
              </span>
              <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_CONFIG[appointment.status]?.color)}>
                {STATUS_CONFIG[appointment.status]?.label}
              </span>
            </div>
            <div className="space-y-2 text-muted-foreground">
              <p className="flex items-center gap-2"><User size={14} /> 客户：{appointment.customer?.name}</p>
              <p className="flex items-center gap-2"><Clock size={14} /> {formatDate(appointment.startAt)} {formatTime(appointment.startAt)} - {formatTime(appointment.endAt)}</p>
              {appointment.address && <p className="flex items-center gap-2"><MapPin size={14} /> {appointment.address}</p>}
              {appointment.contactPhone && <p className="flex items-center gap-2"><Phone size={14} /> {appointment.contactPhone}</p>}
              {appointment.assignedTo && <p className="flex items-center gap-2"><User size={14} /> 负责人：{appointment.assignedTo.name}</p>}
              {appointment.description && <p className="mt-2 rounded-lg bg-muted/30 p-2 text-xs">{appointment.description}</p>}
            </div>
            {gcalConnected && (
              <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/20 p-2.5">
                <CalendarDays size={14} className="text-muted-foreground" />
                {appointment.googleEventId ? (
                  <span className="flex items-center gap-1.5 text-xs text-emerald-600">
                    <CheckCircle2 size={12} />
                    已同步到 Google Calendar
                    {appointment.googleSyncedAt && (
                      <span className="text-muted-foreground">
                        · {new Date(appointment.googleSyncedAt).toLocaleString("zh-CN")}
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">未同步到 Google Calendar</span>
                )}
                <button
                  onClick={() => onSyncToGoogle(appointment.id)}
                  disabled={syncing === appointment.id}
                  className="ml-auto inline-flex items-center gap-1 rounded-md border border-border bg-white px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50"
                >
                  {syncing === appointment.id ? (
                    <Loader2 size={10} className="animate-spin" />
                  ) : (
                    <RefreshCw size={10} />
                  )}
                  {appointment.googleEventId ? "重新同步" : "同步"}
                </button>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              {appointment.status === "scheduled" && (
                <button
                  onClick={() => onMarkComplete(appointment.id)}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                >
                  标记完成
                </button>
              )}
              <button
                onClick={onClose}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
              >
                关闭
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ── Create Dialog ── */
export function CreateAppointmentDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    customerId: "",
    title: "",
    type: "measure",
    startAt: "",
    endAt: "",
    address: "",
    contactPhone: "",
    description: "",
  });
  const [customers, setCustomers] = useState<{ id: string; name: string; phone?: string; address?: string }[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    apiFetch("/api/sales/customers?limit=100")
      .then((r) => r.json())
      .then((d) => setCustomers(d.customers ?? []));
  }, [open]);

  const handleCustomerChange = (cid: string) => {
    const c = customers.find((x) => x.id === cid);
    setForm((f) => ({
      ...f,
      customerId: cid,
      address: c?.address || f.address,
      contactPhone: c?.phone || f.contactPhone,
      title: f.title || `${c?.name ?? ""} 量房`,
    }));
  };

  const handleSubmit = async () => {
    if (!form.customerId || !form.startAt || !form.endAt) return;
    setSaving(true);
    try {
      await apiFetch("/api/sales/appointments", {
        method: "POST",
        body: JSON.stringify(form),
      });
      onCreated();
      setForm({ customerId: "", title: "", type: "measure", startAt: "", endAt: "", address: "", contactPhone: "", description: "" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>新建预约</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>客户 *</Label>
            <select
              value={form.customerId}
              onChange={(e) => handleCustomerChange(e.target.value)}
              className="w-full rounded-lg border border-border bg-white/80 px-3 py-2 text-sm"
            >
              <option value="">选择客户</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>类型</Label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="w-full rounded-lg border border-border bg-white/80 px-3 py-2 text-sm"
              >
                {Object.entries(TYPE_CONFIG).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>标题</Label>
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="w-full rounded-lg border border-border bg-white/80 px-3 py-2 text-sm"
                placeholder="如：张先生 量房"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>开始时间 *</Label>
              <input
                type="datetime-local"
                value={form.startAt}
                onChange={(e) => {
                  const start = e.target.value;
                  setForm((f) => ({
                    ...f,
                    startAt: start,
                    endAt: f.endAt || new Date(new Date(start).getTime() + 2 * 3600000).toISOString().slice(0, 16),
                  }));
                }}
                className="w-full rounded-lg border border-border bg-white/80 px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label>结束时间 *</Label>
              <input
                type="datetime-local"
                value={form.endAt}
                onChange={(e) => setForm({ ...form, endAt: e.target.value })}
                className="w-full rounded-lg border border-border bg-white/80 px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>地址</Label>
            <input
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              className="w-full rounded-lg border border-border bg-white/80 px-3 py-2 text-sm"
              placeholder="客户地址"
            />
          </div>
          <div className="space-y-1.5">
            <Label>联系电话</Label>
            <input
              value={form.contactPhone}
              onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
              className="w-full rounded-lg border border-border bg-white/80 px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label>备注</Label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2}
              className="w-full rounded-lg border border-border bg-white/80 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted">
              取消
            </button>
            <button
              onClick={handleSubmit}
              disabled={saving || !form.customerId || !form.startAt || !form.endAt}
              className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? "创建中..." : "创建预约"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
