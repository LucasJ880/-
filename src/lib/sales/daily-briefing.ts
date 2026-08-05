export interface SalesBriefing {
  date: string;
  stats: Record<string, number>;
  urgentItems: Array<{
    title: string;
    description: string;
    severity: string;
    category: string;
    action?: unknown;
  }>;
  aiSummary: string;
  generatedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Notification.metadata is stored as JSON text; never return that text to clients. */
export function parseCachedSalesBriefing(metadata: string | null): SalesBriefing | null {
  if (!metadata) return null;

  try {
    const parsed: unknown = JSON.parse(metadata);
    if (!isRecord(parsed) || !isRecord(parsed.stats) || !Array.isArray(parsed.urgentItems)) {
      return null;
    }
    if (typeof parsed.generatedAt !== "string" || typeof parsed.aiSummary !== "string") {
      return null;
    }

    const stats = Object.fromEntries(
      Object.entries(parsed.stats).filter((entry): entry is [string, number] =>
        typeof entry[1] === "number" && Number.isFinite(entry[1]),
      ),
    );
    const urgentItems = parsed.urgentItems.filter((item) => isRecord(item)) as SalesBriefing["urgentItems"];

    return {
      date: typeof parsed.date === "string" ? parsed.date : "",
      stats,
      urgentItems,
      aiSummary: parsed.aiSummary,
      generatedAt: parsed.generatedAt,
    };
  } catch {
    return null;
  }
}
