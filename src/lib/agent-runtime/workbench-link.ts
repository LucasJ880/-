/**
 * AI 工作台深链 — 微信/企微终答附带 Web 详情链接
 */

const DEFAULT_APP_ORIGIN = "https://qingyan.ai";

/** 解析对外可访问的站点根 URL（无尾斜杠） */
export function resolveAppOrigin(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw =
    (env.NEXT_PUBLIC_APP_URL || "").trim() ||
    (env.VERCEL_URL || "").trim() ||
    DEFAULT_APP_ORIGIN;
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withProtocol.replace(/\/+$/, "");
}

export function buildAgentWorkbenchUrl(input: {
  runId?: string | null;
  sessionId?: string | null;
  env?: NodeJS.ProcessEnv;
}): string {
  const origin = resolveAppOrigin(input.env);
  const params = new URLSearchParams();
  if (input.runId) params.set("runId", input.runId);
  if (input.sessionId) params.set("sessionId", input.sessionId);
  const qs = params.toString();
  return qs ? `${origin}/agent-trace?${qs}` : `${origin}/agent-trace`;
}

/** 终答是否需要附工作台链接（待确认 / 编号确认文案） */
export function shouldAttachWorkbenchLink(
  text: string,
  opts?: { force?: boolean; runStatus?: string | null },
): boolean {
  if (opts?.force) return true;
  if (opts?.runStatus === "awaiting_approval") return true;
  const t = text || "";
  if (t.includes("可执行动作：")) return true;
  if (t.includes("回复编号即可确认")) return true;
  if (t.includes("等待你确认") || t.includes("等待确认")) return true;
  return false;
}

/** 追加工作台链接块；已含同 run 链接则不重复 */
export function appendWorkbenchLink(
  text: string,
  runId: string,
  env?: NodeJS.ProcessEnv,
): string {
  const url = buildAgentWorkbenchUrl({ runId, env });
  const body = (text || "").trimEnd();
  if (body.includes(url) || body.includes(`/agent-trace?runId=${runId}`)) {
    return body;
  }
  if (!body) {
    return `详情与确认：\n${url}`;
  }
  return `${body}\n\n详情与确认：\n${url}`;
}
