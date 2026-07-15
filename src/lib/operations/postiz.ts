/** Postiz Cloud / self-hosted Public API helpers. */

export const POSTIZ_IMPORTABLE_PROVIDERS = ["facebook", "instagram"] as const;

export interface PostizIntegration {
  id: string;
  name: string;
  identifier: string;
  picture?: string;
  disabled: boolean;
  profile?: string;
  customer?: { id: string; name: string } | null;
}

export interface PostizMediaAsset {
  id: string;
  path: string;
}

interface PostizConfig {
  apiBaseUrl: string;
  apiKey: string;
}

export function getPostizApiBaseUrl(rawUrl: string): string {
  const baseUrl = rawUrl.trim().replace(/\/+$/, "");
  if (!baseUrl) return "";
  if (baseUrl.endsWith("/public/v1")) return baseUrl;
  if (baseUrl.endsWith("/api")) return `${baseUrl}/public/v1`;

  try {
    if (new URL(baseUrl).hostname === "api.postiz.com") {
      return `${baseUrl}/public/v1`;
    }
  } catch {
    return baseUrl;
  }

  return `${baseUrl}/api/public/v1`;
}

export function getPostizConfig(): PostizConfig | null {
  const apiBaseUrl = getPostizApiBaseUrl(process.env.POSTIZ_API_URL ?? "");
  const apiKey = process.env.POSTIZ_API_KEY?.trim() ?? "";
  return apiBaseUrl && apiKey ? { apiBaseUrl, apiKey } : null;
}

export function isPostizConfigured(): boolean {
  return getPostizConfig() !== null;
}

async function postizFetch(path: string, init?: RequestInit): Promise<Response> {
  const config = getPostizConfig();
  if (!config) throw new Error("Postiz 未配置（POSTIZ_API_URL / POSTIZ_API_KEY）");

  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: config.apiKey,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const details = (await response.text().catch(() => "")).slice(0, 500);
    throw new Error(`Postiz API ${response.status}${details ? `: ${details}` : ""}`);
  }
  return response;
}

export async function listPostizIntegrations(): Promise<PostizIntegration[]> {
  const response = await postizFetch("/integrations");
  const data = await response.json().catch(() => []);
  return Array.isArray(data) ? data as PostizIntegration[] : [];
}

export async function uploadPostizMediaFromUrl(url: string): Promise<PostizMediaAsset> {
  const response = await postizFetch("/upload-from-url", {
    method: "POST",
    body: JSON.stringify({ url }),
  });
  const data = await response.json().catch(() => ({})) as Partial<PostizMediaAsset>;
  if (!data.id || !data.path) throw new Error("Postiz 未返回可用的媒体资产");
  return { id: data.id, path: data.path };
}

function postizSettings(platform: string): Record<string, unknown> | null {
  if (platform === "facebook") return { __type: "facebook" };
  if (platform === "instagram") {
    return {
      __type: "instagram",
      post_type: "post",
      is_trial_reel: false,
      collaborators: [],
    };
  }
  return null;
}

export function buildPostizPostPayload(input: {
  scheduledAt: Date | null;
  captionText: string;
  hashtags: string | null;
  platform: string;
  integrationId: string;
  media: PostizMediaAsset;
}): Record<string, unknown> | null {
  const settings = postizSettings(input.platform);
  if (!settings) return null;
  const content = input.hashtags
    ? `${input.captionText}\n\n${input.hashtags}`
    : input.captionText;

  return {
    type: input.scheduledAt ? "schedule" : "now",
    date: (input.scheduledAt ?? new Date()).toISOString(),
    shortLink: false,
    tags: [],
    posts: [{
      integration: { id: input.integrationId },
      value: [{ content, image: [input.media] }],
      settings,
    }],
  };
}

export async function createPostizPost(payload: Record<string, unknown>): Promise<string | null> {
  const response = await postizFetch("/posts", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => null) as unknown;
  if (Array.isArray(data)) {
    const first = data[0] as { postId?: string; id?: string } | undefined;
    return first?.postId ?? first?.id ?? null;
  }
  if (data && typeof data === "object") {
    const result = data as { postId?: string; id?: string };
    return result.postId ?? result.id ?? null;
  }
  return null;
}
