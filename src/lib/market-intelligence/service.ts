import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { mapSite } from "@/lib/trade/research-fetch-provider";
import {
  createFirecrawlMonitor,
  deleteFirecrawlMonitor,
  runFirecrawlMonitor,
  updateFirecrawlMonitor,
} from "./firecrawl-monitor";
import {
  classifyMarketChange,
  hashUrl,
  normalizeCompetitorUrl,
  selectCompetitorUrls,
  verifyFirecrawlSignature,
  verifySharedWebhookToken,
} from "./rules";
import { ensureMarketingSkill, MARKETING_SKILL_SLUG } from "./skill";

const DEFAULT_TIMEZONE = "America/Toronto";
const ALLOWED_SCHEDULES = new Set(["daily", "weekly", "daily at 9:00", "weekly at 9:00"]);

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function optionalDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildGoal(name: string, focus?: string): string {
  return [
    `Alert when ${name} makes a substantive commercial change.`,
    "Prioritize visible prices, promotions, product assortment, calls to action, service areas, measurement, installation, lead time, warranty and trust proof.",
    focus?.trim() ? `Pay special attention to: ${focus.trim()}.` : "",
    "Ignore navigation, cookie notices, timestamps, tracking parameters and formatting-only changes.",
  ]
    .filter(Boolean)
    .join(" ");
}

export interface CreateMarketCompetitorInput {
  orgId: string;
  userId: string;
  name: string;
  websiteUrl: string;
  targetGeography?: string;
  primaryProduct?: string;
  salesModel?: string;
  watchFocus?: string;
  scheduleText?: string;
}

export async function createMarketCompetitor(input: CreateMarketCompetitorInput) {
  if (
    !process.env.FIRECRAWL_WEBHOOK_SECRET?.trim() &&
    !process.env.MARKET_INTELLIGENCE_WEBHOOK_TOKEN?.trim()
  ) {
    throw new Error(
      "请先配置 FIRECRAWL_WEBHOOK_SECRET 或 MARKET_INTELLIGENCE_WEBHOOK_TOKEN",
    );
  }
  const name = input.name.trim();
  if (!name) throw new Error("请填写竞品名称");
  if (name.length > 120) throw new Error("竞品名称过长");
  const normalized = normalizeCompetitorUrl(input.websiteUrl);
  const scheduleText = ALLOWED_SCHEDULES.has(input.scheduleText ?? "")
    ? input.scheduleText!
    : "weekly";
  const goal = buildGoal(name, input.watchFocus);

  const existing = await db.marketCompetitor.findUnique({
    where: {
      orgId_normalizedDomain: {
        orgId: input.orgId,
        normalizedDomain: normalized.normalizedDomain,
      },
    },
    select: { id: true },
  });
  if (existing) throw new Error("该竞品网站已经在监听列表中");

  const competitor = await db.marketCompetitor.create({
    data: {
      orgId: input.orgId,
      name,
      websiteUrl: normalized.websiteUrl,
      normalizedDomain: normalized.normalizedDomain,
      targetGeography: input.targetGeography?.trim() || null,
      primaryProduct: input.primaryProduct?.trim() || null,
      salesModel: input.salesModel?.trim() || "询价报价 + 预约量房",
      watchFocus: input.watchFocus?.trim()
        ? jsonValue({ notes: input.watchFocus.trim() })
        : undefined,
      createdById: input.userId,
    },
  });

  let urls = [normalized.websiteUrl];
  try {
    const links = await mapSite(normalized.websiteUrl);
    urls = selectCompetitorUrls(normalized.websiteUrl, links, 5);
  } catch {
    // Root-page monitoring is still useful when map is temporarily unavailable.
  }

  const localMonitor = await db.marketMonitor.create({
    data: {
      orgId: input.orgId,
      competitorId: competitor.id,
      status: "provisioning",
      scheduleText,
      timezone: DEFAULT_TIMEZONE,
      goal,
      targetUrls: jsonValue(urls),
    },
  });

  try {
    const remote = await createFirecrawlMonitor({
      competitorId: competitor.id,
      orgId: input.orgId,
      competitorName: name,
      urls,
      scheduleText,
      timezone: DEFAULT_TIMEZONE,
      goal,
    });
    await db.marketMonitor.update({
      where: { id: localMonitor.id },
      data: {
        providerMonitorId: remote.id,
        status: remote.status === "paused" ? "paused" : "active",
        scheduleCron: remote.schedule?.cron ?? null,
        nextRunAt: optionalDate(remote.nextRunAt),
        lastRunAt: optionalDate(remote.lastRunAt),
        lastCheckId: remote.currentCheckId ?? null,
        lastError: null,
      },
    });

    try {
      await runFirecrawlMonitor(remote.id);
    } catch (error) {
      await db.marketMonitor.update({
        where: { id: localMonitor.id },
        data: { lastError: error instanceof Error ? error.message.slice(0, 2000) : "首次基线任务启动失败" },
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Firecrawl 监控创建失败";
    await db.$transaction([
      db.marketMonitor.update({
        where: { id: localMonitor.id },
        data: { status: "error", lastError: message.slice(0, 2000) },
      }),
      db.marketCompetitor.update({
        where: { id: competitor.id },
        data: { status: "setup_error" },
      }),
    ]);
    throw new Error(`竞品已保存，但自动监听配置失败：${message}`);
  }

  return getMarketCompetitor(input.orgId, competitor.id);
}

export async function getMarketCompetitor(orgId: string, competitorId: string) {
  return db.marketCompetitor.findFirst({
    where: { id: competitorId, orgId },
    include: {
      monitors: { orderBy: { createdAt: "desc" }, take: 1 },
      _count: { select: { analysisRuns: true } },
    },
  });
}

export async function listMarketIntelligenceWorkspace(orgId: string) {
  const [competitors, signals] = await Promise.all([
    db.marketCompetitor.findMany({
      where: { orgId },
      orderBy: { updatedAt: "desc" },
      include: {
        monitors: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { _count: { select: { snapshots: true } } },
        },
      },
    }),
    db.marketSignal.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: {
        snapshot: {
          select: { url: true, pageStatus: true, capturedAt: true, diffJson: true },
        },
        analysisRuns: {
          where: { status: "completed" },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, outputMarkdown: true, completedAt: true },
        },
      },
    }),
  ]);

  const competitorNames = new Map(competitors.map((item) => [item.id, item.name]));
  return {
    configured: Boolean(process.env.FIRECRAWL_API_KEY?.trim()),
    webhookSecure: Boolean(
      process.env.FIRECRAWL_WEBHOOK_SECRET?.trim() ||
        process.env.MARKET_INTELLIGENCE_WEBHOOK_TOKEN?.trim(),
    ),
    competitors,
    signals: signals.map((signal) => ({
      ...signal,
      competitorName: competitorNames.get(signal.competitorId) ?? "未知竞品",
      analysis: signal.analysisRuns[0] ?? null,
      analysisRuns: undefined,
    })),
  };
}

export async function setMarketCompetitorActive(input: {
  orgId: string;
  competitorId: string;
  active: boolean;
}) {
  const competitor = await db.marketCompetitor.findFirst({
    where: { id: input.competitorId, orgId: input.orgId },
    include: { monitors: { take: 1, orderBy: { createdAt: "desc" } } },
  });
  if (!competitor) throw new Error("竞品不存在");
  const monitor = competitor.monitors[0];
  if (!monitor?.providerMonitorId) throw new Error("该竞品尚未建立 Firecrawl 监听");

  const status = input.active ? "active" : "paused";
  const remote = await updateFirecrawlMonitor(monitor.providerMonitorId, status);
  await db.$transaction([
    db.marketCompetitor.update({ where: { id: competitor.id }, data: { status } }),
    db.marketMonitor.update({
      where: { id: monitor.id },
      data: {
        status,
        nextRunAt: optionalDate(remote.nextRunAt),
        lastError: null,
      },
    }),
  ]);
  return getMarketCompetitor(input.orgId, input.competitorId);
}

export async function runMarketCompetitorNow(orgId: string, competitorId: string) {
  const competitor = await db.marketCompetitor.findFirst({
    where: { id: competitorId, orgId },
    include: { monitors: { take: 1, orderBy: { createdAt: "desc" } } },
  });
  const monitor = competitor?.monitors[0];
  if (!competitor || !monitor?.providerMonitorId) throw new Error("竞品监听尚未就绪");
  const remote = await runFirecrawlMonitor(monitor.providerMonitorId);
  await db.marketMonitor.update({
    where: { id: monitor.id },
    data: {
      status: "active",
      lastCheckId: remote.id,
      lastError: null,
    },
  });
  return remote;
}

export async function deleteMarketCompetitor(orgId: string, competitorId: string) {
  const competitor = await db.marketCompetitor.findFirst({
    where: { id: competitorId, orgId },
    include: { monitors: { select: { providerMonitorId: true } } },
  });
  if (!competitor) throw new Error("竞品不存在");
  for (const monitor of competitor.monitors) {
    if (monitor.providerMonitorId) await deleteFirecrawlMonitor(monitor.providerMonitorId);
  }
  await db.marketCompetitor.delete({ where: { id: competitor.id } });
}

function signalSummary(page: FirecrawlMonitorPage): string {
  const judgment = page.judgment as { reason?: unknown; meaningfulChanges?: unknown } | undefined;
  if (typeof judgment?.reason === "string" && judgment.reason.trim()) return judgment.reason.trim();
  const jsonDiff = (page.diff as { json?: Record<string, unknown> } | undefined)?.json;
  if (jsonDiff && Object.keys(jsonDiff).length > 0) {
    return `检测到 ${Object.keys(jsonDiff).slice(0, 5).join("、")} 等字段发生变化。`;
  }
  const statusCopy: Record<string, string> = {
    new: "发现新的竞品页面。",
    removed: "竞品页面已下线或被移除。",
    changed: "竞品页面出现实质内容变化。",
  };
  return statusCopy[page.status ?? ""] ?? "竞品页面状态发生变化。";
}

interface FirecrawlMonitorPage {
  monitorId?: string;
  checkId?: string;
  url?: string;
  status?: string;
  isMeaningful?: boolean;
  judgment?: unknown;
  diff?: unknown;
  snapshot?: unknown;
  error?: unknown;
  finishedAt?: string;
  [key: string]: unknown;
}

interface FirecrawlWebhookPayload {
  type?: string;
  id?: string;
  data?: FirecrawlMonitorPage[];
  error?: unknown;
}

export async function processFirecrawlMarketWebhook(
  rawBody: string,
  signatureHeader: string | null,
  sharedTokenHeader: string | null,
) {
  const secret = process.env.FIRECRAWL_WEBHOOK_SECRET?.trim() ?? "";
  const sharedSecret = process.env.MARKET_INTELLIGENCE_WEBHOOK_TOKEN?.trim() ?? "";
  const signatureValid = verifyFirecrawlSignature(rawBody, signatureHeader, secret);
  const sharedTokenValid = verifySharedWebhookToken(sharedTokenHeader, sharedSecret);
  if (!signatureValid && !sharedTokenValid) {
    throw new Error("invalid_signature");
  }

  const payload = JSON.parse(rawBody) as FirecrawlWebhookPayload;
  const pages = Array.isArray(payload.data) ? payload.data : [];
  if (!payload.type || pages.length === 0) return { accepted: 0, queued: 0 };

  if (payload.type === "monitor.check.completed") {
    let accepted = 0;
    for (const row of pages) {
      if (!row.monitorId) continue;
      const result = await db.marketMonitor.updateMany({
        where: { providerMonitorId: row.monitorId },
        data: {
          lastCheckId: row.checkId ?? null,
          lastRunAt: optionalDate(row.finishedAt) ?? new Date(),
          lastError: row.error ? String(row.error).slice(0, 2000) : null,
        },
      });
      accepted += result.count;
    }
    return { accepted, queued: 0 };
  }

  if (payload.type !== "monitor.page") return { accepted: 0, queued: 0 };

  let accepted = 0;
  let queued = 0;
  for (const page of pages) {
    if (!page.monitorId || !page.checkId || !page.url || !page.status) continue;
    const monitor = await db.marketMonitor.findUnique({
      where: { providerMonitorId: page.monitorId },
      include: { competitor: true },
    });
    if (!monitor) continue;

    const snapshot = await db.marketSnapshot.upsert({
      where: {
        monitorId_providerCheckId_urlHash: {
          monitorId: monitor.id,
          providerCheckId: page.checkId,
          urlHash: hashUrl(page.url),
        },
      },
      create: {
        orgId: monitor.orgId,
        monitorId: monitor.id,
        providerEventId: payload.id ?? null,
        providerCheckId: page.checkId,
        url: page.url,
        urlHash: hashUrl(page.url),
        pageStatus: page.status,
        isMeaningful: typeof page.isMeaningful === "boolean" ? page.isMeaningful : null,
        diffJson: page.diff == null ? undefined : jsonValue(page.diff),
        snapshotJson: page.snapshot == null ? undefined : jsonValue(page.snapshot),
        judgmentJson: page.judgment == null ? undefined : jsonValue(page.judgment),
      },
      update: {
        providerEventId: payload.id ?? undefined,
        pageStatus: page.status,
        isMeaningful: typeof page.isMeaningful === "boolean" ? page.isMeaningful : null,
        diffJson: page.diff == null ? undefined : jsonValue(page.diff),
        snapshotJson: page.snapshot == null ? undefined : jsonValue(page.snapshot),
        judgmentJson: page.judgment == null ? undefined : jsonValue(page.judgment),
      },
    });
    accepted++;

    if (!["changed", "new", "removed"].includes(page.status) || page.isMeaningful === false) continue;
    const classification = classifyMarketChange({
      pageStatus: page.status,
      diff: page.diff,
      judgment: page.judgment,
    });
    const summary = signalSummary(page);
    const signal = await db.marketSignal.upsert({
      where: { snapshotId: snapshot.id },
      create: {
        orgId: monitor.orgId,
        competitorId: monitor.competitorId,
        snapshotId: snapshot.id,
        signalType: classification.signalType,
        severity: classification.severity,
        title: `${monitor.competitor.name} · ${classification.severity === "high" ? "关键变化" : classification.severity === "medium" ? "值得关注" : "内容更新"}`,
        summary,
        evidenceJson: jsonValue({
          url: page.url,
          checkId: page.checkId,
          pageStatus: page.status,
          diff: page.diff ?? null,
          judgment: page.judgment ?? null,
        }),
        analysisStatus: classification.severity === "low" ? "skipped" : "queued",
      },
      update: {},
    });
    if (signal.analysisStatus === "queued") queued++;
  }
  return { accepted, queued };
}

export async function processQueuedMarketAnalyses(limit = 3) {
  const queuedSignals = await db.marketSignal.findMany({
    where: { analysisStatus: "queued" },
    orderBy: { createdAt: "asc" },
    take: Math.max(1, Math.min(limit, 10)),
    select: { id: true },
  });
  const result = { attempted: 0, completed: 0, failed: 0 };
  for (const row of queuedSignals) {
    const claimed = await db.marketSignal.updateMany({
      where: { id: row.id, analysisStatus: "queued" },
      data: { analysisStatus: "running" },
    });
    if (claimed.count === 0) continue;
    result.attempted++;
    const ok = await runMarketSignalAnalysis(row.id);
    if (ok) result.completed++;
    else result.failed++;
  }
  return result;
}

export async function runMarketSignalAnalysis(signalId: string): Promise<boolean> {
  const signal = await db.marketSignal.findUnique({
    where: { id: signalId },
    include: {
      snapshot: { include: { monitor: { include: { competitor: true } } } },
    },
  });
  if (!signal) return false;
  const competitor = signal.snapshot.monitor.competitor;
  const variables = {
    objective: `判断 ${competitor.name} 本次网站变化是否需要青砚调整 offer、落地页、内容或渠道动作。`,
    targetGeography: competitor.targetGeography ?? "未提供",
    primaryProduct: competitor.primaryProduct ?? "未提供",
    salesModel: competitor.salesModel ?? "询价报价 + 预约量房",
    competitors: `${competitor.name} · ${competitor.websiteUrl}`,
    marketEvidence: JSON.stringify({
      observedAt: signal.snapshot.capturedAt.toISOString(),
      evidenceUrl: signal.snapshot.url,
      pageStatus: signal.snapshot.pageStatus,
      summary: signal.summary,
      diff: signal.snapshot.diffJson,
      currentSnapshot: signal.snapshot.snapshotJson,
      firecrawlJudgment: signal.snapshot.judgmentJson,
    }),
    firstPartyData: "本次为自动竞品变化分析；未附加一方经营数据。",
    unitEconomics: "未提供，不得推断预算、CPL、CPA 或 ROAS。",
    outputType: "competitor-profile",
  };

  const run = await db.marketAnalysisRun.create({
    data: {
      orgId: signal.orgId,
      competitorId: competitor.id,
      signalId: signal.id,
      trigger: "webhook",
      status: "running",
      inputJson: jsonValue(variables),
      createdById: competitor.createdById,
    },
  });

  try {
    await ensureMarketingSkill(signal.orgId);
    const { runSkill } = await import("@/lib/agent-core/skills/runtime");
    const output = await runSkill({
      slug: MARKETING_SKILL_SLUG,
      variables,
      userId: competitor.createdById,
      orgId: signal.orgId,
    });
    await db.$transaction([
      db.marketAnalysisRun.update({
        where: { id: run.id },
        data: {
          status: "completed",
          skillExecutionId: output.executionId,
          outputMarkdown: output.content,
          completedAt: new Date(),
        },
      }),
      db.marketSignal.update({
        where: { id: signal.id },
        data: { analysisStatus: "completed" },
      }),
    ]);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "自动分析失败";
    await db.$transaction([
      db.marketAnalysisRun.update({
        where: { id: run.id },
        data: { status: "failed", error: message.slice(0, 2000), completedAt: new Date() },
      }),
      db.marketSignal.update({
        where: { id: signal.id },
        data: { analysisStatus: "failed" },
      }),
    ]);
    return false;
  }
}

export async function reviewMarketSignal(input: {
  orgId: string;
  signalId: string;
  userId: string;
  status: "reviewed" | "dismissed";
  note?: string;
}) {
  const signal = await db.marketSignal.findFirst({
    where: { id: input.signalId, orgId: input.orgId },
    select: { id: true },
  });
  if (!signal) throw new Error("市场信号不存在");
  return db.marketSignal.update({
    where: { id: signal.id },
    data: {
      status: input.status,
      reviewedById: input.userId,
      reviewedAt: new Date(),
      reviewNote: input.note?.trim().slice(0, 2000) || null,
    },
  });
}
