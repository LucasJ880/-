/**
 * Server Component：非平台管理员直接 redirect。
 * 用于 layout 最前，避免客户端 useEffect 时数据已加载。
 */

import type { ReactNode } from "react";
import { requirePlatformAdminPage } from "@/lib/auth/platform-admin-guard";

export async function PlatformAdminGate({
  children,
  fallbackPath = "/",
}: {
  children: ReactNode;
  fallbackPath?: string;
}) {
  await requirePlatformAdminPage(fallbackPath);
  return children;
}
