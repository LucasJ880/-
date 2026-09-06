/**
 * 询盘收件箱 — 把各通道的进线消息按买家聚成会话
 *
 * 纯函数 buildInquiryThreads 负责聚合与「待回复」判定；loadInquiryThreads 负责取数。
 * 待回复 = 最后一条进线之后没有出站消息，且线索未处于终态。
 */

import { db } from "@/lib/db";

export interface InboxMessageRow {
  id: string;
  prospectId: string;
  direction: string;
  channel: string;
  subject: string | null;
  content: string;
  createdAt: Date;
}

export interface InboxProspectRow {
  id: string;
  companyName: string;
  contactName: string | null;
  contactEmail: string | null;
  country: string | null;
  stage: string;
  source: string;
  score: number | null;
  nextFollowUpAt: Date | null;
  lastContactAt: Date | null;
}

export interface InquiryThread {
  prospectId: string;
  companyName: string;
  contactName: string | null;
  contactEmail: string | null;
  country: string | null;
  stage: string;
  source: string;
  score: number | null;
  channel: string;
  lastInboundAt: Date;
  lastInboundSubject: string | null;
  lastInboundExcerpt: string;
  inboundCount: number;
  /** 最后一条进线之后是否有出站回复 */
  replied: boolean;
  /** 未回复时距最后进线的分钟数 */
  waitingMinutes: number | null;
  nextFollowUpAt: Date | null;
}

const TERMINAL_STAGES = new Set(["converted", "lost", "archived"]);

export function excerpt(content: string, max = 160): string {
  const flat = content.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function buildInquiryThreads(
  messages: InboxMessageRow[],
  prospects: InboxProspectRow[],
  now: Date = new Date(),
): InquiryThread[] {
  const byProspect = new Map<string, InboxMessageRow[]>();
  for (const m of messages) {
    const list = byProspect.get(m.prospectId);
    if (list) list.push(m);
    else byProspect.set(m.prospectId, [m]);
  }
  const prospectById = new Map(prospects.map((p) => [p.id, p]));

  const threads: InquiryThread[] = [];
  for (const [prospectId, list] of byProspect) {
    const p = prospectById.get(prospectId);
    if (!p) continue;
    const sorted = [...list].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const inbound = sorted.filter((m) => m.direction === "inbound");
    if (inbound.length === 0) continue;
    const lastIn = inbound[inbound.length - 1];
    const repliedAfter = sorted.some(
      (m) => m.direction === "outbound" && m.createdAt.getTime() >= lastIn.createdAt.getTime(),
    );
    const replied = repliedAfter || TERMINAL_STAGES.has(p.stage);
    threads.push({
      prospectId,
      companyName: p.companyName,
      contactName: p.contactName,
      contactEmail: p.contactEmail,
      country: p.country,
      stage: p.stage,
      source: p.source,
      score: p.score,
      channel: lastIn.channel,
      lastInboundAt: lastIn.createdAt,
      lastInboundSubject: lastIn.subject,
      lastInboundExcerpt: excerpt(lastIn.content),
      inboundCount: inbound.length,
      replied,
      waitingMinutes: replied
        ? null
        : Math.max(0, Math.round((now.getTime() - lastIn.createdAt.getTime()) / 60000)),
      nextFollowUpAt: p.nextFollowUpAt,
    });
  }

  // 待回复优先，其内按等待时长降序；已回复按最后进线时间降序
  threads.sort((a, b) => {
    if (a.replied !== b.replied) return a.replied ? 1 : -1;
    if (!a.replied && !b.replied) return (b.waitingMinutes ?? 0) - (a.waitingMinutes ?? 0);
    return b.lastInboundAt.getTime() - a.lastInboundAt.getTime();
  });
  return threads;
}

export async function loadInquiryThreads(
  orgId: string,
  opts: { limit?: number; sinceDays?: number } = {},
): Promise<InquiryThread[]> {
  const sinceDays = opts.sinceDays ?? 90;
  const since = new Date();
  since.setDate(since.getDate() - sinceDays);

  const messages = await db.tradeMessage.findMany({
    where: {
      createdAt: { gte: since },
      prospect: { orgId },
    },
    select: {
      id: true,
      prospectId: true,
      direction: true,
      channel: true,
      subject: true,
      content: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 2000,
  });

  const prospectIds = [...new Set(messages.map((m) => m.prospectId))];
  if (prospectIds.length === 0) return [];
  const prospects = await db.tradeProspect.findMany({
    where: { id: { in: prospectIds }, orgId },
    select: {
      id: true,
      companyName: true,
      contactName: true,
      contactEmail: true,
      country: true,
      stage: true,
      source: true,
      score: true,
      nextFollowUpAt: true,
      lastContactAt: true,
    },
  });

  const threads = buildInquiryThreads(messages, prospects);
  return threads.slice(0, opts.limit ?? 200);
}
