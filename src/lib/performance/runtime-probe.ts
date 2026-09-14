/**
 * 运行时拓扑探针：只暴露 region / plane，不暴露连接串、host 全文、secret。
 */

export type NeonHostCategory = "neon" | "local" | "other" | "unresolved";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

export function readVercelFunctionRegion(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const region = (env.VERCEL_REGION || "").trim().toLowerCase();
  return region || null;
}

export function classifyHostCategory(host: string | null): NeonHostCategory {
  if (!host) return "unresolved";
  const h = host.toLowerCase();
  if (LOCAL_HOSTS.has(h) || h.endsWith(".local") || h.endsWith(".localhost")) {
    return "local";
  }
  if (h.endsWith(".neon.tech") || h.endsWith(".neon.build")) return "neon";
  return "other";
}

/**
 * Neon hostname 形如：
 *   ep-xxx-pooler.c-6.us-east-1.aws.neon.tech
 * 只返回 aws-us-east-1；解析失败 → null（UNKNOWN）。
 */
export function extractNeonAwsRegionFromHost(host: string | null): string | null {
  if (!host) return null;
  const h = host.toLowerCase();
  const m = h.match(/\.([a-z0-9-]+)\.aws\.neon\.tech$/);
  if (!m?.[1]) return null;
  if (!/^[a-z]{2}-[a-z]+-\d+$/.test(m[1])) return null;
  return `aws-${m[1]}`;
}

export function isPooledNeonHost(host: string | null): boolean | null {
  if (!host) return null;
  const first = host.toLowerCase().split(".")[0] || "";
  if (!first) return null;
  return first.endsWith("-pooler");
}

export interface RuntimeTopologyProbe {
  vercelRegion: string | null;
  vercelEnv: string | null;
  dbRegion: string | null;
  dbHostCategory: NeonHostCategory;
  dbPooled: boolean | null;
}

/** 传入已脱敏的 hostname，禁止传入完整 connection string */
export function probeRuntimeTopology(
  host: string | null,
  env: NodeJS.ProcessEnv = process.env,
): RuntimeTopologyProbe {
  return {
    vercelRegion: readVercelFunctionRegion(env),
    vercelEnv: (env.VERCEL_ENV || "").trim().toLowerCase() || null,
    dbRegion: extractNeonAwsRegionFromHost(host),
    dbHostCategory: classifyHostCategory(host),
    dbPooled: isPooledNeonHost(host),
  };
}
