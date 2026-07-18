import crypto from "crypto";

export const MARKETING_FLOW_KEYS = [
  "sync-metrics",
  "health-scan",
  "daily-brief",
  "experiment-review",
  "mmm-run",
] as const;

export type MarketingFlowKey = (typeof MARKETING_FLOW_KEYS)[number];

const FLOW_ENV: Record<MarketingFlowKey, string> = {
  "sync-metrics": "ACTIVEPIECES_MARKETING_SYNC_WEBHOOK_URL",
  "health-scan": "ACTIVEPIECES_MARKETING_HEALTH_WEBHOOK_URL",
  "daily-brief": "ACTIVEPIECES_MARKETING_DAILY_BRIEF_WEBHOOK_URL",
  "experiment-review": "ACTIVEPIECES_MARKETING_EXPERIMENT_WEBHOOK_URL",
  "mmm-run": "ACTIVEPIECES_MMM_RUN_WEBHOOK_URL",
};

const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 20_000;

function webhookSecret(): string | null {
  return process.env.ACTIVEPIECES_WEBHOOK_SECRET?.trim() || null;
}

function signatureDigest(rawBody: string, timestamp: string, secret: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
}

export function signActivepiecesPayload(rawBody: string, timestamp = Date.now().toString()): {
  timestamp: string;
  signature: string;
} {
  const secret = webhookSecret();
  if (!secret) throw new Error("ACTIVEPIECES_WEBHOOK_SECRET 未配置");
  return {
    timestamp,
    signature: `sha256=${signatureDigest(rawBody, timestamp, secret)}`,
  };
}

export function verifyActivepiecesSignature(input: {
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
  now?: number;
}): { ok: true } | { ok: false; error: string } {
  const secret = webhookSecret();
  if (!secret) return { ok: false, error: "Activepieces 回调密钥未配置" };
  if (!input.timestamp || !input.signature) return { ok: false, error: "缺少签名头" };

  const signedAt = Number(input.timestamp);
  if (!Number.isFinite(signedAt)) return { ok: false, error: "签名时间无效" };
  if (Math.abs((input.now ?? Date.now()) - signedAt) > SIGNATURE_MAX_AGE_MS) {
    return { ok: false, error: "签名已过期" };
  }

  const expected = `sha256=${signatureDigest(input.rawBody, input.timestamp, secret)}`;
  const receivedBuffer = Buffer.from(input.signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    receivedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(receivedBuffer, expectedBuffer)
  ) {
    return { ok: false, error: "签名无效" };
  }
  return { ok: true };
}

export function getActivepiecesReadiness() {
  const secretConfigured = Boolean(webhookSecret());
  const flows = MARKETING_FLOW_KEYS.map((key) => ({
    key,
    env: FLOW_ENV[key],
    configured: Boolean(process.env[FLOW_ENV[key]]?.trim()),
  }));
  return {
    provider: "activepieces" as const,
    configured: secretConfigured && flows.some((flow) => flow.configured),
    secretConfigured,
    flows,
  };
}

export async function dispatchActivepiecesWebhook(input: {
  flowKey: MarketingFlowKey;
  requestId: string;
  payload: Record<string, unknown>;
}): Promise<{
  configured: boolean;
  accepted: boolean;
  status?: number;
  externalRunId?: string;
  response?: unknown;
}> {
  const url = process.env[FLOW_ENV[input.flowKey]]?.trim();
  if (!url || !webhookSecret()) return { configured: false, accepted: false };

  const rawBody = JSON.stringify(input.payload);
  const signed = signActivepiecesPayload(rawBody);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-qingyan-request-id": input.requestId,
      "x-qingyan-timestamp": signed.timestamp,
      "x-qingyan-signature": signed.signature,
    },
    body: rawBody,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Keep non-JSON responses for diagnostics without failing an accepted flow.
  }
  if (!response.ok) {
    throw new Error(`Activepieces ${input.flowKey} 返回 HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  const record = body && typeof body === "object" ? body as Record<string, unknown> : null;
  const externalRunId = record && typeof record.runId === "string"
    ? record.runId
    : record && typeof record.id === "string"
      ? record.id
      : undefined;
  return {
    configured: true,
    accepted: true,
    status: response.status,
    externalRunId,
    response: body,
  };
}
