/**
 * S2 — Provider 策略门（T7 fail-closed）+ 调用状态分级（S2-T16/T17/T18/T19）
 * + SearchEngineProvider 双门与零网络映射。
 */
import assert from "node:assert/strict";
import { isSupplierIntelError } from "../errors";
import {
  assertProviderEnabled,
  createTavilySearchEngineProvider,
  type DiscoveryProvider,
} from "../providers";

const OPEN_ENV = { TENDER_EXTERNAL_INTEL_ENABLED: "1", TAVILY_API_KEY: "k" } as NodeJS.ProcessEnv;

function expectBlocked(name: string, p: DiscoveryProvider) {
  try {
    assertProviderEnabled(p);
    assert.fail(`${name}: 期望 PROVIDER_POLICY_BLOCKED`);
  } catch (e) {
    assert.ok(isSupplierIntelError(e, "PROVIDER_POLICY_BLOCKED"), `${name}: 错误码`);
  }
}

function providerWith(fetchImpl: typeof fetch): DiscoveryProvider {
  return createTavilySearchEngineProvider({ env: OPEN_ENV, fetchImpl });
}

async function main() {
  console.log("T7：requiresPlatformLogin=true / 残缺 policy / 不守 robots 一律拒（fail-closed）");
  expectBlocked("login provider", {
    providerId: "commercial:needs-login",
    policy: { respectsRobots: true, requiresPlatformLogin: true, dataLicense: "commercial" },
    isAvailable: () => true,
    search: async () => ({ status: "SUCCESS", results: [] }),
  });
  expectBlocked("no policy", {
    providerId: "mystery",
    // @ts-expect-error 故意残缺
    policy: undefined,
    isAvailable: () => true,
    search: async () => ({ status: "SUCCESS", results: [] }),
  });
  expectBlocked("no robots", {
    providerId: "rogue",
    policy: { respectsRobots: false, requiresPlatformLogin: false, dataLicense: "unknown" },
    isAvailable: () => true,
    search: async () => ({ status: "SUCCESS", results: [] }),
  });

  console.log("双门可用性（外部 gate 严格 ===1 + TAVILY_API_KEY）——S2-T14/T15 的 provider 面");
  assert.equal(createTavilySearchEngineProvider({ env: {} as NodeJS.ProcessEnv }).isAvailable(), false);
  assert.equal(
    createTavilySearchEngineProvider({ env: { TENDER_EXTERNAL_INTEL_ENABLED: "1" } as NodeJS.ProcessEnv }).isAvailable(),
    false,
    "缺 TAVILY_API_KEY → 不可用",
  );
  assert.equal(
    createTavilySearchEngineProvider({ env: { TAVILY_API_KEY: "k" } as NodeJS.ProcessEnv }).isAvailable(),
    false,
    "外部总闸未开 → 不可用",
  );
  const open = createTavilySearchEngineProvider({ env: OPEN_ENV });
  assert.equal(open.isAvailable(), true);
  assertProviderEnabled(open);

  console.log("SUCCESS 映射：hit → {title,url,snippet,sourceQuery}");
  const okProvider = providerWith((async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      results: [
        { title: "佛山铝壳工厂", url: "https://v.douyin.com/abc/", content: "车间实拍" },
        { url: "https://detail.1688.com/offer/1.html", content: "铝合金外壳定制" },
      ],
    }),
  })) as unknown as typeof fetch);
  const okOutcome = await okProvider.search("site:douyin.com 铝壳 工厂实拍");
  assert.equal(okOutcome.status, "SUCCESS");
  assert.equal(okOutcome.results.length, 2);
  assert.equal(okOutcome.results[0].sourceQuery, "site:douyin.com 铝壳 工厂实拍");

  console.log("S2-T18：空结果 → EMPTY（不是 FAILED）");
  const empty = await providerWith((async () => ({
    ok: true,
    status: 200,
    json: async () => ({ results: [] }),
  })) as unknown as typeof fetch).search("q");
  assert.equal(empty.status, "EMPTY");

  console.log("S2-T17：HTTP 429 → RATE_LIMITED（显式，不吞）");
  const limited = await providerWith((async () => ({ ok: false, status: 429 })) as unknown as typeof fetch).search("q");
  assert.equal(limited.status, "RATE_LIMITED");

  console.log("401/403 → AUTH_ERROR");
  const auth = await providerWith((async () => ({ ok: false, status: 401 })) as unknown as typeof fetch).search("q");
  assert.equal(auth.status, "AUTH_ERROR");

  console.log("S2-T16：Abort 超时 → TIMEOUT");
  const abortErr = Object.assign(new Error("aborted"), { name: "AbortError" });
  const timeout = await providerWith((async () => {
    throw abortErr;
  }) as unknown as typeof fetch).search("q");
  assert.equal(timeout.status, "TIMEOUT");

  console.log("S2-T19：一般异常 → PROVIDER_ERROR（不被 catch{}→[] 吞成假空）");
  const broken = await providerWith((async () => {
    throw new Error("network down");
  }) as unknown as typeof fetch).search("q");
  assert.equal(broken.status, "PROVIDER_ERROR");
  assert.deepEqual(broken.results, []);

  console.log("\nproviders-policy（T7 + S2-T16..T19）全部通过");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
