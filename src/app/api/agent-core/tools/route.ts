/**
 * GET /api/agent-core/tools
 *
 * 列出 Agent Core 注册表中所有可用工具。
 * query: ?domain=trade — 按域过滤
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { registry } from "@/lib/agent-core";
import type { ToolDomain } from "@/lib/agent-core";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const domain = request.nextUrl.searchParams.get("domain") as ToolDomain | null;
  const tools = registry.list(domain ? { domains: [domain] } : undefined);

  return NextResponse.json({
    total: tools.length,
    tools: tools.map((t) => ({
      name: t.name,
      domain: t.domain,
      description: t.description,
      riskLevel: t.riskLevel ?? "low",
      parameters: t.parameters,
    })),
  });
}
