/**
 * GET /api/agent-core/tools
 *
 * 列出 Agent Core 注册表中所有可用工具。
 * query: ?domain=trade — 按域过滤
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { registry } from "@/lib/agent-core";
import type { ToolDomain } from "@/lib/agent-core";

export const GET = withAuth(async (request) => {
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
});
