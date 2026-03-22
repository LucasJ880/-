import crypto from "crypto";
import { db } from "@/lib/db";

export interface WebhookEvent {
  event: string;
  project_id: string;
  external_ref_id: string;
  external_ref_system: string;
  [key: string]: unknown;
}

function sign(secret: string, timestamp: number, body: string): string {
  const message = `${timestamp}.${body}`;
  return crypto.createHmac("sha256", secret).update(message).digest("hex");
}

/**
 * 向匹配的 WebhookEndpoint 发送事件。
 * 失败时静默记录，不阻塞主流程。
 */
export async function dispatchWebhook(
  targetSystem: string,
  payload: WebhookEvent
): Promise<void> {
  const endpoints = await db.webhookEndpoint.findMany({
    where: { system: targetSystem, isActive: true },
  });

  if (endpoints.length === 0) return;

  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);

  for (const ep of endpoints) {
    const subscribedEvents: string[] = (() => {
      try {
        return JSON.parse(ep.events);
      } catch {
        return ["*"];
      }
    })();

    if (
      !subscribedEvents.includes("*") &&
      !subscribedEvents.includes(payload.event)
    ) {
      continue;
    }

    const signature = sign(ep.secret, timestamp, body);

    try {
      const res = await fetch(ep.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Qingyan-Signature": signature,
          "X-Qingyan-Timestamp": String(timestamp),
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });

      await db.webhookEndpoint.update({
        where: { id: ep.id },
        data: {
          lastCalledAt: new Date(),
          failCount: res.ok ? 0 : ep.failCount + 1,
        },
      });

      if (!res.ok) {
        console.error(
          `[Webhook] ${ep.system}/${ep.id} returned ${res.status} for ${payload.event}`
        );
      }
    } catch (err) {
      console.error(`[Webhook] ${ep.system}/${ep.id} failed:`, err);
      await db.webhookEndpoint
        .update({
          where: { id: ep.id },
          data: { failCount: ep.failCount + 1 },
        })
        .catch(() => {});
    }
  }
}

/**
 * 在项目 tenderStatus 变更时调用，向关联的外部系统发送状态变更事件。
 */
export async function notifyProjectStatusChange(params: {
  projectId: string;
  oldStatus: string;
  newStatus: string;
  updatedBy: string;
}): Promise<void> {
  const { projectId, oldStatus, newStatus, updatedBy } = params;

  const extRef = await db.externalReference.findUnique({
    where: { projectId },
  });

  if (!extRef) return;

  await dispatchWebhook(extRef.system, {
    event: "project.status_changed",
    project_id: projectId,
    external_ref_id: extRef.externalId,
    external_ref_system: extRef.system,
    old_status: oldStatus,
    new_status: newStatus,
    updated_by: updatedBy,
    updated_at: new Date().toISOString(),
  });
}
