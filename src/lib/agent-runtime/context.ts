/**
 * 最小上下文加载 — Session + 近史 + 本 org 长期记忆（限量）
 */

import { db } from "@/lib/db";
import { appendAgentRunEvent } from "./run";

export interface MinimalContext {
  recentMessages: Array<{ role: "user" | "assistant"; content: string }>;
  sessionSummary: string | null;
  project?: { id: string; name: string; status: string } | null;
  customer?: { id: string; name: string } | null;
  memoryBlock: string;
  loadedTypes: string[];
}

export async function loadMinimalContext(input: {
  orgId: string;
  userId: string;
  channel: string;
  runId: string;
  session: {
    id: string;
    summary: string | null;
    currentProjectId: string | null;
    currentCustomerId: string | null;
  };
  content: string;
}): Promise<MinimalContext> {
  await appendAgentRunEvent({
    orgId: input.orgId,
    runId: input.runId,
    eventType: "context.loading",
    title: "加载上下文",
    visibleToUser: false,
  });

  const loadedTypes: string[] = ["recent_messages"];
  const recent = await db.weChatMessage.findMany({
    where: {
      userId: input.userId,
      channel: input.channel,
      orgId: input.orgId,
    },
    orderBy: { createdAt: "desc" },
    take: 8,
    select: { direction: true, content: true },
  });

  const recentMessages = recent
    .reverse()
    .map((m) => ({
      role: (m.direction === "inbound" ? "user" : "assistant") as
        | "user"
        | "assistant",
      content: m.content.slice(0, 500),
    }));

  let project: MinimalContext["project"] = null;
  let customer: MinimalContext["customer"] = null;

  const wantsProject =
    Boolean(input.session.currentProjectId) ||
    /项目|任务|进度|deadline/.test(input.content);
  const wantsCustomer =
    Boolean(input.session.currentCustomerId) ||
    /客户|跟进|商机/.test(input.content);

  if (wantsProject && input.session.currentProjectId) {
    project = await db.project.findFirst({
      where: {
        id: input.session.currentProjectId,
        orgId: input.orgId,
      },
      select: { id: true, name: true, status: true },
    });
    if (project) loadedTypes.push("current_project");
  }

  if (wantsCustomer && input.session.currentCustomerId) {
    customer = await db.salesCustomer.findFirst({
      where: {
        id: input.session.currentCustomerId,
        orgId: input.orgId,
        archivedAt: null,
      },
      select: { id: true, name: true },
    });
    if (customer) loadedTypes.push("current_customer");
  }

  if (input.session.summary) loadedTypes.push("session_summary");

  // 长期记忆：限量 + 超时降级，失败不阻塞
  let memoryBlock = "";
  try {
    const {
      getWakeUpMemories,
      recallMemories,
      buildUserMemoryBlock,
    } = await import("@/lib/ai/user-memory");

    const memoryPromise = (async () => {
      const [wakeUp, l2] = await Promise.all([
        getWakeUpMemories(input.userId, input.orgId, 6),
        recallMemories(input.userId, input.orgId, input.content, {
          limit: 3,
          projectId: input.session.currentProjectId || undefined,
          customerId: input.session.currentCustomerId || undefined,
        }),
      ]);
      return buildUserMemoryBlock(wakeUp.l0, wakeUp.l1, l2);
    })();

    const timeout = new Promise<string>((resolve) =>
      setTimeout(() => resolve(""), 2500),
    );
    memoryBlock = await Promise.race([memoryPromise, timeout]);
    if (memoryBlock) loadedTypes.push("user_memory");
  } catch {
    memoryBlock = "";
  }

  await appendAgentRunEvent({
    orgId: input.orgId,
    runId: input.runId,
    eventType: "context.loaded",
    title: "上下文已就绪",
    payload: { types: loadedTypes },
    visibleToUser: false,
  });

  return {
    recentMessages,
    sessionSummary: input.session.summary,
    project,
    customer,
    memoryBlock,
    loadedTypes,
  };
}
