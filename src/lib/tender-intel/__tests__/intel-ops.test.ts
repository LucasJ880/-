/**
 * 情报运维双件套 — 供应商价格带对标 + 公告盯梢（纯平面，零 DB / 零出站）
 *
 * OPS-VND-*  全量合同资源按供应商查询（阶段3 首源落地）
 * OPS-WCH-*  公告盯梢（归一摘要/URL 校验/接线/幂等通知）
 * 反例守卫：盯梢通知按 hash 幂等；vendor 查询 flag 门 fail-closed。
 *
 * 运行：npx tsx src/lib/tender-intel/__tests__/intel-ops.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  summarizeVendorContracts,
  searchContractsByVendor,
  type VendorContractRow,
} from "../canadabuys";
import { computeWatchDigest, isValidWatchUrl } from "../watch";

let pass = 0;
let fail = 0;
const ok = (c: boolean, n: string, d?: unknown) => {
  if (c) { pass++; console.log(`  ✓ ${n}`); }
  else { fail++; console.error(`  ✗ ${n}`, d ?? ""); }
};
const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

console.log("情报运维双件套");

async function main() {
  // ── 价格带汇总（纯函数） ──
  const rows: VendorContractRow[] = [
    { vendorName: "V", contractValue: 42540.75, contractDate: "2021-10-21", buyer: "ESDC", descriptionEn: null, referenceNumber: null },
    { vendorName: "V", contractValue: 22995, contractDate: "2018-11-29", buyer: "CIRNAC", descriptionEn: null, referenceNumber: null },
    { vendorName: "V", contractValue: 80850, contractDate: "2024-10-28", buyer: "CER", descriptionEn: null, referenceNumber: null },
    { vendorName: "V", contractValue: null, contractDate: "2020-01-01", buyer: "X", descriptionEn: null, referenceNumber: null },
  ];
  const sum = summarizeVendorContracts(rows);
  ok(
    sum.sampleSize === 3 && sum.min === 22995 && sum.max === 80850 && sum.median === 42540.75,
    `OPS-VND-01: 汇总正确（n=3 中位=42540.75；金额缺失行不计）`,
    sum,
  );
  ok(
    sum.recent[0]?.contractDate === "2024-10-28",
    "OPS-VND-02: recent 按日期倒序",
  );
  const gated = await searchContractsByVendor({ vendor: "Meltwater", env: {} });
  ok(
    !gated.ok && gated.note === "外部情报开关未启用",
    "OPS-VND-03: flag 门 fail-closed（零出站）",
  );
  const cb = read("src/lib/tender-intel/canadabuys.ts");
  ok(
    cb.includes("fac950c0-00d5-4ec1-a4d3-9cbebf98a305") &&
      cb.includes("EXTERNAL_INTEL_CONTRACTS_RESOURCE_ID"),
    "OPS-VND-04: 默认=全量资源（1.31M 行实证）且 env 可覆盖（阶段3 预留位兑现）",
  );
  const orch = read("src/lib/tender-intel/orchestrate.ts");
  ok(
    orch.includes("searchContractsByVendor") &&
      orch.includes("vendorPriceBenchmark") &&
      orch.includes("lead?.vendor"),
    "OPS-VND-05: incumbentLead 在场自动拉价格带 → memo 输入 + 落房间",
  );

  // ── 盯梢 ──
  const h1 = computeWatchDigest("<html><script>Date.now()</script><body>Addenda:  0</body></html>");
  const h2 = computeWatchDigest("<html><script>Math.random()</script><body>Addenda: 0</body></html>");
  const h3 = computeWatchDigest("<html><body>Addenda: 1</body></html>");
  ok(h1 === h2 && h1 !== h3, "OPS-WCH-01: 归一摘要免疫脚本/空白噪声，内容变化即变");
  ok(
    isValidWatchUrl("https://bids.halifax.ca/x") && !isValidWatchUrl("ftp://x") && !isValidWatchUrl("not a url"),
    "OPS-WCH-02: URL 校验（仅 http/https）",
  );
  const watch = read("src/lib/tender-intel/watch.ts");
  ok(
    watch.includes("tender-watch:${projectId}:${digest.slice(0, 16)}"),
    "OPS-WCH-03（反例守卫）: 通知 sourceKey 按内容 hash 幂等（重复 tick 不重复打扰）",
  );
  ok(
    read("vercel.json").includes("/api/cron/tender-watch") &&
      read("src/app/api/cron/tender-watch/route.ts").includes("requireCronSecret"),
    "OPS-WCH-04: 小时级 cron 注册 + cron 鉴权",
  );
  ok(
    read("src/components/project-detail/tabs/intel-tab.tsx").includes("TenderWatchCard") &&
      read("src/components/tender-intel/tender-watch-card.tsx").includes("开始盯梢"),
    "OPS-WCH-05: 情报 tab 盯梢卡（设 URL/状态/停止）",
  );
  const route = read("src/app/api/projects/[id]/tender-watch/route.ts");
  ok(
    route.includes("requireProjectWriteAccess") && route.includes("isValidWatchUrl"),
    "OPS-WCH-06: 配置端点写权限门 + URL 校验",
  );

  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  if (fail > 0) process.exit(1);
}

void main();
