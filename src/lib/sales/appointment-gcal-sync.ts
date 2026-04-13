/**
 * Appointment ↔ Google Calendar 双向同步服务
 *
 * 创建预约 → 自动推送到 Google Calendar
 * 修改预约 → 自动更新 Google Calendar 事件
 * 取消/删除预约 → 自动删除 Google Calendar 事件
 */

import { db } from "@/lib/db";
import {
  pushEventToGoogle,
  updateGoogleEvent,
  deleteGoogleEvent,
  getGoogleProvider,
} from "@/lib/google-calendar";

const TYPE_LABELS: Record<string, string> = {
  measure: "📏 量房",
  install: "🔧 安装",
  revisit: "🔄 回访",
  consultation: "💬 咨询",
};

function buildDescription(appointment: {
  type: string;
  contactPhone?: string | null;
  notes?: string | null;
  customer?: { name: string; phone?: string | null } | null;
}): string {
  const lines: string[] = ["[青砚 Qingyan — 自动同步]"];
  lines.push(`类型: ${TYPE_LABELS[appointment.type] || appointment.type}`);
  if (appointment.customer?.name) lines.push(`客户: ${appointment.customer.name}`);
  if (appointment.contactPhone) lines.push(`电话: ${appointment.contactPhone}`);
  if (appointment.customer?.phone && appointment.customer.phone !== appointment.contactPhone) {
    lines.push(`客户电话: ${appointment.customer.phone}`);
  }
  if (appointment.notes) lines.push(`备注: ${appointment.notes}`);
  return lines.join("\n");
}

export async function syncAppointmentToGoogle(
  appointmentId: string,
  userId: string,
): Promise<{ synced: boolean; googleEventId?: string }> {
  const provider = await getGoogleProvider(userId);
  if (!provider) return { synced: false };

  const appointment = await db.appointment.findUnique({
    where: { id: appointmentId },
    include: { customer: { select: { name: true, phone: true } } },
  });
  if (!appointment) return { synced: false };

  const eventData = {
    title: `${TYPE_LABELS[appointment.type] || ""} ${appointment.title}`.trim(),
    startTime: appointment.startAt.toISOString(),
    endTime: appointment.endAt.toISOString(),
    allDay: appointment.allDay,
    location: appointment.address,
    description: buildDescription(appointment),
  };

  if (appointment.googleEventId) {
    const ok = await updateGoogleEvent(userId, appointment.googleEventId, eventData);
    if (ok) {
      await db.appointment.update({
        where: { id: appointmentId },
        data: { googleSyncedAt: new Date() },
      });
    }
    return { synced: ok, googleEventId: appointment.googleEventId };
  }

  const googleEventId = await pushEventToGoogle(userId, eventData);
  if (googleEventId) {
    await db.appointment.update({
      where: { id: appointmentId },
      data: { googleEventId, googleSyncedAt: new Date() },
    });
    return { synced: true, googleEventId };
  }

  return { synced: false };
}

export async function unsyncAppointmentFromGoogle(
  appointmentId: string,
  userId: string,
): Promise<boolean> {
  const appointment = await db.appointment.findUnique({
    where: { id: appointmentId },
    select: { googleEventId: true },
  });
  if (!appointment?.googleEventId) return true;

  const ok = await deleteGoogleEvent(userId, appointment.googleEventId);
  if (ok) {
    await db.appointment.update({
      where: { id: appointmentId },
      data: { googleEventId: null, googleSyncedAt: null },
    });
  }
  return ok;
}

export async function hasGoogleCalendar(userId: string): Promise<boolean> {
  const provider = await getGoogleProvider(userId);
  return !!provider?.accessToken;
}
