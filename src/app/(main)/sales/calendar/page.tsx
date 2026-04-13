"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { apiFetch } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  MapPin,
  Phone,
  Clock,
  User,
  CalendarDays,
  Ruler,
  Wrench,
  RotateCcw,
  MessageSquare,
} from "lucide-react";
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

type ViewMode = "month" | "week" | "list";

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

function isSameDay(d1: Date, d2: Date) {
  return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
}

export default function SalesCalendarPage() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showCreate, setShowCreate] = useState(false);
  const [selectedAppt, setSelectedAppt] = useState<Appointment | null>(null);
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const loadAppointments = useCallback(async () => {
    setLoading(true);
    const start = new Date(year, month, 1).toISOString();
    const end = new Date(year, month + 1, 0, 23, 59, 59).toISOString();
    try {
      const res = await apiFetch(`/api/sales/appointments?start=${start}&end=${end}`).then((r) => r.json());
      setAppointments(res.appointments ?? []);
    } catch {
      setAppointments([]);
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => { loadAppointments(); }, [loadAppointments]);

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));
  const goToday = () => setCurrentDate(new Date());

  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfWeek(year, month);
  const today = new Date();

  const calendarDays = useMemo(() => {
    const days: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let d = 1; d <= daysInMonth; d++) days.push(d);
    return days;
  }, [firstDay, daysInMonth]);

  const getApptsForDay = useCallback(
    (day: number) => {
      const target = new Date(year, month, day);
      return appointments.filter((a) => isSameDay(new Date(a.startAt), target));
    },
    [appointments, year, month],
  );

  const todayAppts = appointments.filter((a) => isSameDay(new Date(a.startAt), today));
  const upcomingAppts = appointments
    .filter((a) => new Date(a.startAt) >= today && a.status !== "cancelled")
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
    .slice(0, 10);

  return (
    <div className="space-y-6">
      <PageHeader
        title="预约日历"
        description="量房 · 安装 · 回访预约管理"
        actions={
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/90 transition-colors"
          >
            <Plus size={16} />
            新建预约
          </button>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "今日预约", value: todayAppts.length, color: "text-blue-600" },
          { label: "本月总计", value: appointments.length, color: "text-emerald-600" },
          { label: "待量房", value: appointments.filter((a) => a.type === "measure" && a.status === "scheduled").length, color: "text-orange-600" },
          { label: "待安装", value: appointments.filter((a) => a.type === "install" && a.status === "scheduled").length, color: "text-purple-600" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-white/60 p-4">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className={cn("mt-1 text-2xl font-bold", s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* View controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="rounded-lg p-1.5 hover:bg-muted transition-colors">
            <ChevronLeft size={18} />
          </button>
          <h2 className="text-lg font-semibold min-w-[140px] text-center">
            {year}年{month + 1}月
          </h2>
          <button onClick={nextMonth} className="rounded-lg p-1.5 hover:bg-muted transition-colors">
            <ChevronRight size={18} />
          </button>
          <button
            onClick={goToday}
            className="ml-2 rounded-lg border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted transition-colors"
          >
            今天
          </button>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border bg-white/60 p-0.5">
          {(["month", "week", "list"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setViewMode(v)}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                viewMode === v ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v === "month" ? "月" : v === "week" ? "周" : "列表"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-[1fr_300px] gap-6">
        {/* Calendar grid */}
        <div className="rounded-xl border border-border bg-white/60 overflow-hidden">
          {viewMode === "month" ? (
            <>
              <div className="grid grid-cols-7 border-b border-border">
                {["日", "一", "二", "三", "四", "五", "六"].map((d) => (
                  <div key={d} className="py-2 text-center text-xs font-medium text-muted-foreground">
                    {d}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {calendarDays.map((day, i) => {
                  const isToday = day !== null && isSameDay(new Date(year, month, day), today);
                  const dayAppts = day ? getApptsForDay(day) : [];
                  return (
                    <div
                      key={i}
                      className={cn(
                        "min-h-[100px] border-b border-r border-border/50 p-1.5",
                        day === null && "bg-muted/20",
                      )}
                    >
                      {day !== null && (
                        <>
                          <div
                            className={cn(
                              "mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium",
                              isToday ? "bg-primary text-white" : "text-foreground",
                            )}
                          >
                            {day}
                          </div>
                          <div className="space-y-0.5">
                            {dayAppts.slice(0, 3).map((a) => {
                              const tc = TYPE_CONFIG[a.type] ?? TYPE_CONFIG.measure;
                              return (
                                <button
                                  key={a.id}
                                  onClick={() => setSelectedAppt(a)}
                                  className={cn(
                                    "flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[10px] text-white truncate",
                                    tc.color,
                                    a.status === "cancelled" && "opacity-40 line-through",
                                  )}
                                >
                                  {formatTime(a.startAt)} {a.customer?.name}
                                </button>
                              );
                            })}
                            {dayAppts.length > 3 && (
                              <p className="text-[10px] text-muted-foreground px-1">+{dayAppts.length - 3} more</p>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          ) : viewMode === "list" ? (
            <div className="divide-y divide-border/50">
              {loading ? (
                <div className="py-20 text-center text-sm text-muted-foreground">加载中...</div>
              ) : upcomingAppts.length === 0 ? (
                <div className="py-20 text-center text-sm text-muted-foreground">
                  <CalendarDays size={40} className="mx-auto mb-3 opacity-30" />
                  暂无预约
                </div>
              ) : (
                upcomingAppts.map((a) => <AppointmentRow key={a.id} appt={a} onClick={() => setSelectedAppt(a)} />)
              )}
            </div>
          ) : (
            <div className="p-8 text-center text-sm text-muted-foreground">
              <CalendarDays size={40} className="mx-auto mb-3 opacity-30" />
              周视图开发中
            </div>
          )}
        </div>

        {/* Side panel — today & upcoming */}
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-white/60 p-4">
            <h3 className="mb-3 text-sm font-semibold">今日预约 ({todayAppts.length})</h3>
            {todayAppts.length === 0 ? (
              <p className="text-xs text-muted-foreground">今天没有预约</p>
            ) : (
              <div className="space-y-2">
                {todayAppts.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setSelectedAppt(a)}
                    className="w-full rounded-lg border border-border/50 p-2.5 text-left hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <div className={cn("h-2 w-2 rounded-full", TYPE_CONFIG[a.type]?.color ?? "bg-gray-400")} />
                      <span className="text-xs font-medium">{formatTime(a.startAt)}</span>
                      <span className="text-xs text-muted-foreground">{TYPE_CONFIG[a.type]?.label}</span>
                    </div>
                    <p className="mt-1 text-sm font-medium truncate">{a.customer?.name}</p>
                    {a.address && (
                      <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground truncate">
                        <MapPin size={10} /> {a.address}
                      </p>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-border bg-white/60 p-4">
            <h3 className="mb-3 text-sm font-semibold">即将到来</h3>
            <div className="space-y-2">
              {upcomingAppts.slice(0, 5).map((a) => (
                <button
                  key={a.id}
                  onClick={() => setSelectedAppt(a)}
                  className="w-full rounded-lg p-2 text-left hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <div className={cn("h-2 w-2 rounded-full", TYPE_CONFIG[a.type]?.color ?? "bg-gray-400")} />
                    <span className="text-[11px] text-muted-foreground">{formatDate(a.startAt)} {formatTime(a.startAt)}</span>
                  </div>
                  <p className="mt-0.5 text-xs font-medium truncate">{a.title}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Detail dialog */}
      <Dialog open={!!selectedAppt} onOpenChange={() => setSelectedAppt(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{selectedAppt?.title}</DialogTitle>
          </DialogHeader>
          {selectedAppt && (
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2">
                <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", TYPE_CONFIG[selectedAppt.type]?.color, "text-white")}>
                  {TYPE_CONFIG[selectedAppt.type]?.label}
                </span>
                <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_CONFIG[selectedAppt.status]?.color)}>
                  {STATUS_CONFIG[selectedAppt.status]?.label}
                </span>
              </div>
              <div className="space-y-2 text-muted-foreground">
                <p className="flex items-center gap-2"><User size={14} /> 客户：{selectedAppt.customer?.name}</p>
                <p className="flex items-center gap-2"><Clock size={14} /> {formatDate(selectedAppt.startAt)} {formatTime(selectedAppt.startAt)} - {formatTime(selectedAppt.endAt)}</p>
                {selectedAppt.address && <p className="flex items-center gap-2"><MapPin size={14} /> {selectedAppt.address}</p>}
                {selectedAppt.contactPhone && <p className="flex items-center gap-2"><Phone size={14} /> {selectedAppt.contactPhone}</p>}
                {selectedAppt.assignedTo && <p className="flex items-center gap-2"><User size={14} /> 负责人：{selectedAppt.assignedTo.name}</p>}
                {selectedAppt.description && <p className="mt-2 rounded-lg bg-muted/30 p-2 text-xs">{selectedAppt.description}</p>}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                {selectedAppt.status === "scheduled" && (
                  <button
                    onClick={async () => {
                      await apiFetch(`/api/sales/appointments/${selectedAppt.id}`, { method: "PATCH", body: JSON.stringify({ status: "completed" }) });
                      setSelectedAppt(null);
                      loadAppointments();
                    }}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                  >
                    标记完成
                  </button>
                )}
                <button
                  onClick={() => setSelectedAppt(null)}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
                >
                  关闭
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Create dialog */}
      <CreateAppointmentDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => { setShowCreate(false); loadAppointments(); }}
      />
    </div>
  );
}

function AppointmentRow({ appt, onClick }: { appt: Appointment; onClick: () => void }) {
  const tc = TYPE_CONFIG[appt.type] ?? TYPE_CONFIG.measure;
  const sc = STATUS_CONFIG[appt.status] ?? STATUS_CONFIG.scheduled;
  return (
    <button onClick={onClick} className="flex w-full items-center gap-4 p-4 text-left hover:bg-muted/20 transition-colors">
      <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg text-white", tc.color)}>
        <tc.icon size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{appt.title}</p>
        <p className="text-xs text-muted-foreground">{appt.customer?.name} · {formatDate(appt.startAt)} {formatTime(appt.startAt)}</p>
      </div>
      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", sc.color)}>{sc.label}</span>
    </button>
  );
}

function CreateAppointmentDialog({
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
