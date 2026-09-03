/**
 * DiscoveryProvider 抽象 + 策略门（M1-S2，DESIGN §9.3/§9.4）
 *
 * Platform → Adapter → Provider 三层的最下层：获取手段可替换，Adapter 不与任何
 * 一家 provider 强绑定。策略门 fail-closed（H3/H4 机制化落点，T7）：
 *   - 未声明 policy → 拒；
 *   - requiresPlatformLogin=true → M1 一律拒（绝不做登录态自动化）。
 * 第一个实现 = SearchEngineProvider（统一后的 Tavily client）；层 B 外呼受双门：
 * TENDER_EXTERNAL_INTEL_ENABLED + TAVILY_API_KEY（supplier-intel flag 不代开外呼门）。
 */

import { isExternalIntelEnabled } from "@/lib/tender-intel/canadabuys";
import { tavilySearchDetailed, type TavilyCallStatus } from "@/lib/tender-intel/tavily-client";
import { hasWebSearchKey } from "@/lib/tender-intel/websearch";
import { SupplierIntelError } from "./errors";

export interface DiscoveryProviderPolicy {
  respectsRobots: boolean;
  requiresPlatformLogin: boolean;
  dataLicense: string;
}

export interface DiscoveryProviderResult {
  title: string;
  url: string;
  snippet: string;
  sourceQuery: string;
}

/** §37：provider 调用结果显式分级——禁止 catch{}→[] 静默失败 */
export type ProviderCallStatus = TavilyCallStatus;

export interface ProviderSearchOutcome {
  status: ProviderCallStatus;
  results: DiscoveryProviderResult[];
}

export interface DiscoveryProvider {
  readonly providerId: string;
  readonly policy: DiscoveryProviderPolicy;
  /** 冻结契约位：未接线/双门未开 = false（调用方按 DISABLED 处理，不报错不硬闯） */
  isAvailable(env?: NodeJS.ProcessEnv): boolean;
  search(query: string, opts?: { maxResults?: number }): Promise<ProviderSearchOutcome>;
}

/** T7：启用前策略裁决，fail-closed */
export function assertProviderEnabled(provider: DiscoveryProvider): void {
  const policy = provider?.policy;
  if (
    !policy ||
    typeof policy.respectsRobots !== "boolean" ||
    typeof policy.requiresPlatformLogin !== "boolean" ||
    !policy.dataLicense?.trim()
  ) {
    throw new SupplierIntelError(
      "PROVIDER_POLICY_BLOCKED",
      `provider ${provider?.providerId ?? "unknown"} 未完整声明合规策略（fail-closed 拒绝启用）`,
    );
  }
  if (policy.requiresPlatformLogin) {
    throw new SupplierIntelError(
      "PROVIDER_POLICY_BLOCKED",
      `provider ${provider.providerId} 需要平台登录态——M1 一律拒绝（H3：不做登录态自动化）`,
    );
  }
  if (!policy.respectsRobots) {
    throw new SupplierIntelError(
      "PROVIDER_POLICY_BLOCKED",
      `provider ${provider.providerId} 未声明遵守 robots——M1 拒绝启用（H4）`,
    );
  }
}

/** 第一个实现：通用搜索引擎（Tavily）——消费既有合法索引，不自建对平台的爬虫 */
export function createTavilySearchEngineProvider(deps?: {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): DiscoveryProvider {
  const env = deps?.env ?? process.env;
  return {
    providerId: "search-engine:tavily",
    policy: {
      respectsRobots: true,
      requiresPlatformLogin: false,
      dataLicense: "search-engine-index",
    },
    isAvailable(overrideEnv?: NodeJS.ProcessEnv): boolean {
      const e = overrideEnv ?? env;
      return isExternalIntelEnabled(e) && hasWebSearchKey(e);
    },
    async search(query, opts) {
      const detailed = await tavilySearchDetailed(query, {
        env,
        fetchImpl: deps?.fetchImpl,
        maxResults: opts?.maxResults ?? 5,
        snippetMaxChars: 300,
      });
      return {
        status: detailed.status,
        results: detailed.hits.map((h) => ({ ...h, sourceQuery: query })),
      };
    },
  };
}
