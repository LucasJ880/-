const FIRECRAWL_API_BASE = "https://api.firecrawl.dev";

export interface FirecrawlMonitorRecord {
  id: string;
  status: string;
  schedule?: { cron?: string; timezone?: string };
  nextRunAt?: string | null;
  lastRunAt?: string | null;
  currentCheckId?: string | null;
  estimatedCreditsPerMonth?: number | null;
}

export interface FirecrawlMonitorRun {
  id: string;
  monitorId: string;
  status: string;
}

interface FirecrawlResponse<T> {
  success?: boolean;
  data?: T;
  error?: string;
}

function apiKey(): string {
  const key = process.env.FIRECRAWL_API_KEY?.trim();
  if (!key) throw new Error("FIRECRAWL_API_KEY 未配置");
  return key;
}

export function marketIntelligenceWebhookUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_BASE_URL?.trim() ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "");
  if (!raw || /localhost|127\.0\.0\.1/.test(raw)) {
    throw new Error("请配置公开的 NEXT_PUBLIC_APP_URL 后再启用自动监听");
  }
  return `${raw.replace(/\/$/, "")}/api/webhooks/firecrawl/market-intelligence`;
}

function webhookHeaders(): Record<string, string> {
  const token = process.env.MARKET_INTELLIGENCE_WEBHOOK_TOKEN?.trim();
  return token ? { "X-Qingyan-Webhook-Token": token } : {};
}

async function firecrawlRequest<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${FIRECRAWL_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let payload: FirecrawlResponse<T> = {};
  try {
    payload = JSON.parse(text) as FirecrawlResponse<T>;
  } catch {
    throw new Error(`Firecrawl 返回了无效响应（HTTP ${response.status}）`);
  }
  if (!response.ok || payload.success === false || !payload.data) {
    throw new Error(payload.error || `Firecrawl 请求失败（HTTP ${response.status}）`);
  }
  return payload.data;
}

const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    pageType: { type: "string" },
    headline: { type: "string" },
    valueProposition: { type: "string" },
    products: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          category: { type: "string" },
          price: { type: "string" },
          priceQualifier: { type: "string" },
        },
      },
    },
    offers: { type: "array", items: { type: "string" } },
    primaryCta: { type: "string" },
    trustSignals: { type: "array", items: { type: "string" } },
    serviceAreas: { type: "array", items: { type: "string" } },
    measurement: { type: "string" },
    installation: { type: "string" },
    leadTime: { type: "string" },
    warranty: { type: "string" },
  },
};

export async function createFirecrawlMonitor(input: {
  competitorId: string;
  orgId: string;
  competitorName: string;
  urls: string[];
  scheduleText: string;
  timezone: string;
  goal: string;
}): Promise<FirecrawlMonitorRecord> {
  return firecrawlRequest<FirecrawlMonitorRecord>("/v2/monitor", {
    method: "POST",
    body: JSON.stringify({
      name: `青砚 · ${input.competitorName}`,
      schedule: { text: input.scheduleText, timezone: input.timezone },
      retentionDays: 90,
      goal: input.goal,
      judgeEnabled: true,
      targets: [
        {
          type: "scrape",
          urls: input.urls,
          scrapeOptions: {
            onlyMainContent: true,
            maxAge: 0,
            formats: [
              {
                type: "changeTracking",
                modes: ["json", "git-diff"],
                prompt:
                  "Extract only directly observed commercial facts. Track products, visible prices, promotions, calls to action, trust proof, service areas, measurement, installation, lead time and warranty. Do not infer missing values.",
                schema: EXTRACTION_SCHEMA,
              },
            ],
          },
        },
      ],
      webhook: {
        url: marketIntelligenceWebhookUrl(),
        headers: webhookHeaders(),
        events: ["monitor.page", "monitor.check.completed"],
        metadata: {
          qingyanOrgId: input.orgId,
          qingyanCompetitorId: input.competitorId,
        },
      },
    }),
  });
}

export async function updateFirecrawlMonitor(
  monitorId: string,
  status: "active" | "paused",
): Promise<FirecrawlMonitorRecord> {
  return firecrawlRequest<FirecrawlMonitorRecord>(`/v2/monitor/${monitorId}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export async function runFirecrawlMonitor(monitorId: string): Promise<FirecrawlMonitorRun> {
  return firecrawlRequest<FirecrawlMonitorRun>(`/v2/monitor/${monitorId}/run`, {
    method: "POST",
    body: "{}",
  });
}

export async function deleteFirecrawlMonitor(monitorId: string): Promise<void> {
  const response = await fetch(`${FIRECRAWL_API_BASE}/v2/monitor/${monitorId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${apiKey()}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok && response.status !== 404) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error || `Firecrawl 删除监控失败（HTTP ${response.status}）`);
  }
}
