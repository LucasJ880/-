/**
 * Autopilot 页面门禁：未授权 redirect，不加载 Autopilot 数据。
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { hasAutopilotCapability } from "./access";
import type { AutopilotCapability } from "./types";

const COOKIE_NAME = "qy_session";

export async function requireAutopilotPage(
  capability: AutopilotCapability = "autopilot.view",
  fallbackPath = "/",
): Promise<{ id: string; role: string }> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) redirect("/login");

  const payload = await verifySession(token);
  if (!payload?.sub) redirect("/login");

  const user = await db.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, role: true, status: true },
  });
  if (!user || user.status !== "active") redirect("/login");
  if (!hasAutopilotCapability({ id: user.id, role: user.role }, capability)) {
    redirect(fallbackPath);
  }
  return { id: user.id, role: user.role };
}
