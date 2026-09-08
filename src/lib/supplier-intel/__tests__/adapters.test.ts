/**
 * S2 — 平台 Adapter：查询计划对象化（§11）/ host 白名单归类 / 噪音过滤（§23）/
 * 每源状态聚合（§20/§44）/ 视频号 DISABLED / 策略门穿透 / 网络禁入锁事务的源码守卫（S2-T28）。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_DISCOVERY_ADAPTERS,
  SUPPLIER_1688_ADAPTER_STATUS,
  douyinSupplierDiscoveryAdapter,
  openWebSupplierAdapter,
  wechatChannelsDiscoveryAdapter,
  xiaohongshuSupplierDiscoveryAdapter,
} from "../adapters";
import { isSupplierIntelError } from "../errors";
import type { DiscoveryProvider, ProviderCallStatus } from "../providers";
import { buildDeterministicBrief } from "../search-brief";

const brief = buildDeterministicBrief({
  requirements: [
    { id: "r1", code: "R-001", text: "IP65 required", category: "TECHNICAL", mandatory: true, mandatorySignal: "required" },
  ],
  productKeywordsZh: ["铝合金外壳"],
  productKeywordsEn: ["aluminum enclosure"],
  capabilityHintsZh: ["CNC铝壳加工"],
});

function fakeProvider(
  results: Array<{ title?: string; url: string; snippet?: string }>,
  status: ProviderCallStatus = "SUCCESS",
): DiscoveryProvider {
  return {
    providerId: "fake",
    policy: { respectsRobots: true, requiresPlatformLogin: false, dataLicense: "test" },
    isAvailable: () => true,
    search: async (q) => ({
      status,
      results:
        status === "SUCCESS"
          ? results.map((r) => ({ title: r.title ?? r.url, url: r.url, snippet: r.snippet ?? "", sourceQuery: q }))
          : [],
    }),
  };
}

async function main() {
  console.log("§11：查询计划对象化（source/query/language/queryType/priority/generatedFrom）");
  const plan = douyinSupplierDiscoveryAdapter.buildQueryPlan(brief);
  assert.ok(plan.length > 0 && plan.length <= 4);
  for (const q of plan) {
    assert.equal(q.source, "DOUYIN");
    assert.ok(q.query.startsWith("site:douyin.com "));
    assert.equal(q.language, "zh");
    assert.ok(["SOCIAL", "CAPABILITY"].includes(q.queryType));
    assert.ok(q.priority >= 1);
    assert.ok(q.generatedFrom.length > 0);
  }

  console.log("抖音：结果只留 DOUYIN host；仿冒/非法/重复 URL 丢弃；SUCCESS 聚合");
  const dres = await douyinSupplierDiscoveryAdapter.discover(
    brief,
    fakeProvider([
      { url: "https://v.douyin.com/abc/", title: "工厂实拍" },
      { url: "https://www.douyin.com/video/7123" },
      { url: "https://douyin.com.evil.com/x" },
      { url: "https://xxfurniture.cn/about" },
      { url: "javascript:alert(1)" },
      { url: "https://v.douyin.com/abc/" },
    ]),
  );
  assert.ok(dres.ok);
  if (dres.ok) {
    assert.equal(dres.sourceStatus, "SUCCESS");
    assert.ok(dres.drafts.length >= 1 && dres.drafts.every((d) => d.platform === "DOUYIN"));
    const urls = dres.drafts.map((d) => d.contentUrl);
    assert.equal(new Set(urls).size, urls.length);
  }

  console.log("§44 聚合：全 EMPTY → EMPTY；全失败 → FAILED + failureReason；混 SUCCESS → SUCCESS");
  const emptyRes = await douyinSupplierDiscoveryAdapter.discover(brief, fakeProvider([], "EMPTY"));
  assert.ok(emptyRes.ok && emptyRes.sourceStatus === "EMPTY");
  const failRes = await douyinSupplierDiscoveryAdapter.discover(brief, fakeProvider([], "TIMEOUT"));
  assert.ok(failRes.ok && failRes.sourceStatus === "FAILED" && failRes.failureReason === "TIMEOUT");
  const rateRes = await douyinSupplierDiscoveryAdapter.discover(brief, fakeProvider([], "RATE_LIMITED"));
  assert.ok(rateRes.ok && rateRes.sourceStatus === "FAILED" && rateRes.failureReason === "RATE_LIMITED");

  console.log("小红书：查询 ≤2 + robots 覆盖率诚实说明");
  const xplan = xiaohongshuSupplierDiscoveryAdapter.buildQueryPlan(brief);
  assert.ok(xplan.length <= 2 && xplan.every((q) => q.query.startsWith("site:xiaohongshu.com ")));
  const xres = await xiaohongshuSupplierDiscoveryAdapter.discover(
    brief,
    fakeProvider([{ url: "https://www.xiaohongshu.com/explore/n1" }]),
  );
  assert.ok(xres.ok && xres.note?.includes("robots"));

  console.log("视频号：DISABLED + USER_ASSISTED 说明（无层 B，不作 M1 依赖）");
  const wres = await wechatChannelsDiscoveryAdapter.discover(brief, fakeProvider([]));
  assert.ok(wres.ok && wres.sourceStatus === "DISABLED" && wres.note?.includes("USER_ASSISTED"));

  console.log("§23 OpenWeb：噪音 host 过滤（pinterest/amazon…），1688 归 ONE688、官网归 WEBSITE");
  const ores = await openWebSupplierAdapter.discover(
    brief,
    fakeProvider([
      { url: "https://detail.1688.com/offer/1.html" },
      { url: "https://xxfurniture.cn/products" },
      { url: "https://www.pinterest.com/pin/999" },
      { url: "https://www.amazon.ca/dp/B000" },
    ]),
  );
  assert.ok(ores.ok);
  if (ores.ok) {
    // fake provider 对每条计划查询都返回同批结果：噪音计数 = 2 × 查询数（URL 级去重在 drafts 层）
    assert.ok(ores.noiseFiltered >= 2, `noiseFiltered=${ores.noiseFiltered}`);
    assert.deepEqual(ores.drafts.map((d) => d.platform).sort(), ["ONE688", "WEBSITE"]);
  }

  console.log("T7 穿透：违规 provider 在 discover 内被拦（PROVIDER_POLICY_BLOCKED）");
  const rogue: DiscoveryProvider = {
    providerId: "rogue-login",
    policy: { respectsRobots: true, requiresPlatformLogin: true, dataLicense: "x" },
    isAvailable: () => true,
    search: async () => ({ status: "SUCCESS", results: [] }),
  };
  try {
    await douyinSupplierDiscoveryAdapter.discover(brief, rogue);
    assert.fail("期望 PROVIDER_POLICY_BLOCKED");
  } catch (e) {
    assert.ok(isSupplierIntelError(e, "PROVIDER_POLICY_BLOCKED"));
  }

  console.log("默认集合 = 四平台；1688 专用 Adapter = DEFERRED（§41，不伪造）");
  assert.equal(DEFAULT_DISCOVERY_ADAPTERS.length, 4);
  assert.equal(SUPPLIER_1688_ADAPTER_STATUS, "DEFERRED");

  console.log("S2-T28 源码守卫：发现编排不在 DB 事务内做网络（discovery-service 零 $transaction）");
  const src = readFileSync(join(process.cwd(), "src/lib/supplier-intel/discovery-service.ts"), "utf8");
  assert.ok(!src.includes("$transaction"), "编排层禁止自开事务——网络调用必须在行锁事务之外");
  assert.ok(src.includes("Phase"), "分阶段纪律注释在场");

  console.log("\nadapters（§11/§23/§44 + T7 + S2-T28）全部通过");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
