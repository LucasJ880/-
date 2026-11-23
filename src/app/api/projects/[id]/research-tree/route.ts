import { NextRequest, NextResponse } from "next/server";
import { requireProjectReadAccess, requireProjectWriteAccess } from "@/lib/projects/access";
import { isResearchTreeEnabledForOrg } from "@/lib/tender-research-tree/flags";
import { startResearchTree } from "@/lib/tender-research-tree/start";
import { loadResearchTreeView } from "@/lib/tender-research-tree/view";

/**
 * TREE-2 情报调研树 — 人发起
 *
 * POST /api/projects/[id]/research-tree   body（可省略）: { action?: "start", requestId?: string }
 *   → { jobId, reused, status }
 *
 * 第一步、不带条件地校验项目写权限（发起会花模型与搜索的钱，口径同一键分析的发起）；项目没有组织或开关对该组织
 * 关着 → 404，不建 Job、不发任何外部请求；只收招投标项目（否则 409）。
 *
 * TREE-3 情报调研树 — 读取（只读）
 *
 * GET /api/projects/[id]/research-tree
 *   → { job: { id, status, createdAt } | null, clauses: { state: "pending" } | { state: "done", status, statusZh, reasonZh, messagesZh, findings } | null }
 *
 * 第一步、不带条件地校验项目读权限；项目没有组织或开关关着 → 404（招标要求页的条款卡片据此不显示）。
 * 只给条款结果（标书文件名、页码、标书摘录与答案），不给金额、网页内容与网址；TREE-5 在这里加整棵树。
 */

const NOT_FOUND = { error: "未找到" } as const;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireProjectWriteAccess(request, id);
  if (access instanceof NextResponse) return access;

  const orgId = access.project.orgId;
  if (!orgId || !isResearchTreeEnabledForOrg(orgId)) {
    return NextResponse.json(NOT_FOUND, { status: 404 });
  }

  // 请求体可以省略；省略 action 等于 start；给了就只认 "start"
  const raw = await request.text().catch(() => "");
  let body: Record<string, unknown> = {};
  if (raw.trim()) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      body = parsed as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
    }
  }
  if (body.action !== undefined && body.action !== "start") {
    return NextResponse.json({ error: "不支持的操作" }, { status: 400 });
  }
  if (access.project.workDomain !== "tender") {
    return NextResponse.json({ error: "只有招投标项目能开始调研" }, { status: 409 });
  }

  try {
    const started = await startResearchTree({
      orgId,
      projectId: access.project.id,
      userId: access.user.id,
      role: access.user.role,
      trigger: "human_start",
      requestId: typeof body.requestId === "string" ? body.requestId : null,
    });
    if (!started.ok) {
      if (started.code === "FEATURE_DISABLED") return NextResponse.json(NOT_FOUND, { status: 404 });
      if (started.code === "BUSY") return NextResponse.json({ error: "正在开始调研，请稍后再看", code: started.code }, { status: 409 });
      if (started.code === "WORKFORCE_DISABLED") {
        return NextResponse.json({ error: "后台任务服务未开启，暂时不能开始调研，请联系管理员", code: started.code }, { status: 503 });
      }
      return NextResponse.json({ error: "开始调研失败，请稍后重试", code: started.code }, { status: 500 });
    }
    return NextResponse.json({ jobId: started.jobId, reused: started.reused, status: started.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("配额")) {
      return NextResponse.json({ error: "AI 任务额度不够（今日次数或同时运行数到上限），请稍后再试或联系管理员" }, { status: 429 });
    }
    return NextResponse.json({ error: "开始调研失败，请稍后重试" }, { status: 500 });
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireProjectReadAccess(request, id);
  if (access instanceof NextResponse) return access;

  const orgId = access.project.orgId;
  if (!orgId || !isResearchTreeEnabledForOrg(orgId)) {
    return NextResponse.json(NOT_FOUND, { status: 404 });
  }
  try {
    return NextResponse.json(await loadResearchTreeView(orgId, access.project.id));
  } catch {
    return NextResponse.json({ error: "调研结果暂时读不出来，请稍后再试" }, { status: 500 });
  }
}
