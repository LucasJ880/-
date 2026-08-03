/**
 * Aivora 成片接口只读 smoke(契约 docs/AIVORA_SYNC_CONTRACT.md §9 线上部分)
 *
 * 用法:
 *   # 仅验证错误 token → 401(无需真实 token)
 *   AIVORA_API_URL=https://reelforge-delta.vercel.app \
 *     npx tsx scripts/aivora-smoke-readonly.ts --expect-401-only
 *
 *   # 完整只读联调(需真实 token;只 GET,不写库)
 *   AIVORA_API_URL=… AIVORA_API_KEY=… npx tsx scripts/aivora-smoke-readonly.ts
 *
 * 不写业务数据、不打印 token。
 */
import { parseArgs } from "node:util";
import {
  getAivoraVideosEndpoint,
  mapAivoraItem,
  parseAivoraPage,
} from "../src/lib/operations/aivora";

const HOOK_TYPES = new Set(["POV", "Curiosity", "Stat", "Reveal", "Pain", "Demo"]);
const BRAND_PLACEMENTS = new Set(["natural", "planar_track", "corner_badge"]);
const TIMEOUT_MS = 20_000;

let passed = 0;
let failed = 0;
function ok(cond: boolean, name: string, detail = "") {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function get(url: string, token: string | null): Promise<Response> {
  return fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
}

async function main() {
  const { values } = parseArgs({
    options: { "expect-401-only": { type: "boolean", default: false } },
  });

  const baseUrl = process.env.AIVORA_API_URL?.trim();
  if (!baseUrl) {
    console.error("缺少 AIVORA_API_URL");
    process.exit(2);
  }
  const endpoint = getAivoraVideosEndpoint(baseUrl);
  console.log(`Aivora 只读 smoke → ${endpoint}`);

  // §9-3:故意错 token 得到 401
  const bad = await get(`${endpoint}?limit=1`, "invalid-token-for-smoke-test");
  ok(bad.status === 401, "错误 token → 401", `实际 ${bad.status}`);
  const noAuth = await get(`${endpoint}?limit=1`, null);
  ok(noAuth.status === 401, "缺失 token → 401", `实际 ${noAuth.status}`);

  const token = process.env.AIVORA_API_KEY?.trim();
  if (values["expect-401-only"] || !token) {
    if (!token) console.log("  (未提供 AIVORA_API_KEY,跳过带鉴权用例)");
    finish();
    return;
  }

  // §9-1:带 token 首拉 200,条目可映射、id 唯一非空
  const res = await get(`${endpoint}?limit=200`, token);
  ok(res.status === 200, "带 token 首拉 → 200", `实际 ${res.status}`);
  if (res.status !== 200) return finish();
  const page = parseAivoraPage(await res.json(), 200);
  console.log(
    `  … videos=${page.videos.length} count=${page.count} skipped_unbranded=${page.skippedUnbranded} next_since=${page.nextSince}`,
  );
  ok(page.count === page.videos.length, "meta.count 与可映射条数一致(无非法条目)");
  const ids = new Set(page.videos.map((v) => v.externalId));
  ok(ids.size === page.videos.length, "videos[].id 全部非空且唯一(幂等键)");

  // §9-4:枚举与契约 §4 一致(null = 未知,允许)
  const badEnum = page.videos.filter(
    (v) =>
      (v.hookType !== null && !HOOK_TYPES.has(v.hookType)) ||
      (v.brandPlacement !== null && !BRAND_PLACEMENTS.has(v.brandPlacement)),
  );
  ok(
    badEnum.length === 0,
    "hook_type / brand_placement 枚举域合法",
    badEnum
      .slice(0, 3)
      .map((v) => `${v.externalId}:${v.hookType}/${v.brandPlacement}`)
      .join(","),
  );
  const noCompletedAt = page.videos.filter(
    (v) => !v.completedAt || Number.isNaN(Date.parse(v.completedAt)),
  );
  ok(noCompletedAt.length === 0, "completed_at 均为合法时间(游标依赖)", `${noCompletedAt.length} 条异常`);

  // §9-2:用 next_since 增量拉,返回的都是该时刻之后完成的(只读侧验证)
  if (page.nextSince) {
    const res2 = await get(
      `${endpoint}?limit=200&since=${encodeURIComponent(page.nextSince)}`,
      token,
    );
    ok(res2.status === 200, "next_since 增量拉 → 200", `实际 ${res2.status}`);
    if (res2.status === 200) {
      const page2 = parseAivoraPage(await res2.json(), 200);
      const cutoff = Date.parse(page.nextSince);
      const stale = page2.videos.filter(
        (v) => v.completedAt !== null && Date.parse(v.completedAt) <= cutoff,
      );
      ok(
        stale.length === 0,
        `增量第二轮无重复(本轮 ${page2.videos.length} 条,均晚于 next_since)`,
        `${stale.length} 条不晚于游标`,
      );
    }
  } else {
    console.log("  (next_since 为 null,跳过增量用例 —— 下轮沿用上一次 since)");
  }

  // 附:mapAivoraItem 对首条真实数据的往返检查
  if (page.videos.length > 0) {
    const sample = page.videos[0];
    ok(
      mapAivoraItem({
        id: sample.externalId,
        video_url: sample.videoUrl,
        title: sample.title,
        completed_at: sample.completedAt,
      }) !== null,
      "真实样本可稳定映射",
    );
  }

  finish();
}

function finish() {
  console.log(`\naivora smoke: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("smoke 执行异常:", e instanceof Error ? e.message : e);
  process.exit(1);
});
