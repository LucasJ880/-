/**
 * Aivora 成片拉取适配器
 *
 * Aivora 是外部 AI 批量视频生产软件（约 200 条/天）。
 * 青砚只登记元数据与视频 URL，视频文件不经过青砚存储。
 *
 * 环境变量：
 * - AIVORA_API_URL：Aivora API 基地址
 * - AIVORA_API_KEY：鉴权密钥
 *
 * ⚠️ 接口路径与响应字段基于占位约定，待拿到 Aivora API 文档后
 *    只需调整 fetchAivoraVideos 内的 endpoint 与 mapAivoraItem 的字段映射。
 */

export interface AivoraVideo {
  externalId: string;
  title: string;
  videoUrl: string;
  coverUrl?: string | null;
  durationSec?: number | null;
  topic?: string | null;
  language?: string | null;
}

export function isAivoraConfigured(): boolean {
  return Boolean(process.env.AIVORA_API_URL && process.env.AIVORA_API_KEY);
}

function mapAivoraItem(item: Record<string, unknown>): AivoraVideo | null {
  const externalId = String(item.id ?? "").trim();
  const videoUrl = String(item.video_url ?? item.videoUrl ?? "").trim();
  if (!externalId || !videoUrl) return null;
  return {
    externalId,
    title: String(item.title ?? `Aivora ${externalId}`),
    videoUrl,
    coverUrl: item.cover_url ? String(item.cover_url) : null,
    durationSec:
      typeof item.duration === "number" ? Math.round(item.duration) : null,
    topic: item.topic ? String(item.topic) : null,
    language: item.language ? String(item.language) : null,
  };
}

/** 拉取最近完成的成片列表（幂等由调用方按 externalId 去重） */
export async function fetchAivoraVideos(): Promise<AivoraVideo[]> {
  const baseUrl = process.env.AIVORA_API_URL;
  const apiKey = process.env.AIVORA_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error("Aivora 未配置：缺少 AIVORA_API_URL / AIVORA_API_KEY");
  }

  const res = await fetch(
    `${baseUrl.replace(/\/$/, "")}/videos?status=completed&limit=100`,
    {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!res.ok) {
    throw new Error(`Aivora API ${res.status}: ${await res.text().catch(() => "")}`);
  }

  const data = (await res.json()) as { videos?: unknown[] } | unknown[];
  const items = Array.isArray(data) ? data : (data.videos ?? []);
  return items
    .map((it) => mapAivoraItem(it as Record<string, unknown>))
    .filter((v): v is AivoraVideo => v !== null);
}
