/**
 * B4 — 历史 Blob 数据私有化迁移
 *
 * 用法：
 *   npx tsx scripts/migrate-blob-private.ts                 # dry-run（默认，只读，不改任何东西）
 *   MIGRATE_CONFIRM=yes npx tsx scripts/migrate-blob-private.ts --write   # 真实迁移
 *
 * 步骤（write 模式）：
 *   0) 安全门禁：--write 必须搭配 MIGRATE_CONFIRM=yes；生产库指纹需再加 ALLOW_PRODUCTION=yes
 *   1) JSON 备份：导出所有含 Blob URL 的表字段到 backups/blob-private-migration/
 *   2) Blob 对象迁移：list() 全部对象 → 已知前缀 + 仍可公开访问的 → 原路径 re-put access:"private"
 *   3) DB URL 重写：把存储的 *.blob.vercel-storage.com URL 改写为 /api/files/ 代理 URL
 *      （含 SkillExecution.inputJson/outputJson 文本内嵌 URL）
 *   4) 校验：抽样确认迁移后对象可经 SDK 读取、未鉴权 HTTP 拉取不再 200
 *
 * dry-run 只输出将要做什么，不上传、不写库、不备份文件。
 */

import { list, put, get } from "@vercel/blob";
import { db } from "@/lib/db";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const WRITE = process.argv.includes("--write");

const KNOWN_PREFIXES = [
  "visualizer/",
  "visual-builder/",
  "projects/",
  "trade/",
  "trade-service/",
  "temp/",
];

const FILE_PROXY_PREFIX = "/api/files/";
const BLOB_HOST_RE = /^https?:\/\/[^/]*\.blob\.vercel-storage\.com\//i;
/** JSON 文本内嵌 URL 匹配（到引号/空白/反斜杠为止） */
const BLOB_URL_IN_TEXT_RE = /https?:\/\/[^/\s"'\\]*\.blob\.vercel-storage\.com\/[^\s"'\\]+/g;

function pathnameOf(url: string): string | null {
  if (!BLOB_HOST_RE.test(url)) return null;
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\/+/, ""));
  } catch {
    return null;
  }
}

function isKnownPrefix(pathname: string): boolean {
  return KNOWN_PREFIXES.some((p) => pathname.startsWith(p));
}

function toProxyUrl(pathname: string): string {
  return (
    FILE_PROXY_PREFIX +
    pathname
      .split("/")
      .filter(Boolean)
      .map((s) => encodeURIComponent(s))
      .join("/")
  );
}

/** 把字符串字段值转换为代理 URL；不属于已知前缀的 blob URL 返回 null（保持不动并告警）。 */
function convertFieldValue(v: string | null): { next: string; pathname: string } | "skip" | "unknown" {
  if (!v) return "skip";
  const pathname = pathnameOf(v);
  if (!pathname) return "skip"; // 已是代理 URL / 外链 / data URL
  if (!isKnownPrefix(pathname)) return "unknown";
  return { next: toProxyUrl(pathname), pathname };
}

function convertTextUrls(text: string | null): { next: string; hits: string[] } | null {
  if (!text) return null;
  const hits: string[] = [];
  const next = text.replace(BLOB_URL_IN_TEXT_RE, (m) => {
    const pathname = pathnameOf(m);
    if (!pathname || !isKnownPrefix(pathname)) return m;
    hits.push(pathname);
    return toProxyUrl(pathname);
  });
  return hits.length > 0 ? { next, hits } : null;
}

function safeDbId(url: string | undefined): string {
  if (!url) return "<DATABASE_URL 未设置>";
  try {
    const u = new URL(url);
    return `${u.hostname}${u.port ? ":" + u.port : ""}${u.pathname}`;
  } catch {
    return "<无法解析 DATABASE_URL>";
  }
}

function looksLikeProduction(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    const dbName = u.pathname.replace(/^\//, "");
    const marker = /(smoke|branch|dev|preview|staging|test)/i;
    return dbName === "neondb" && !marker.test(u.hostname) && !marker.test(dbName);
  } catch {
    return false;
  }
}

function ts(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** 未鉴权 HTTP 拉取：200 视为 public 遗留对象。 */
async function isPubliclyReadable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(15000) });
    // 读掉 body 避免连接泄漏
    await res.arrayBuffer().catch(() => undefined);
    return res.ok;
  } catch {
    return false;
  }
}

interface FieldSpec {
  model: string;
  fields: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delegate: any;
}

function fieldSpecs(): FieldSpec[] {
  return [
    { model: "ProjectDocument", fields: ["url", "blobUrl"], delegate: db.projectDocument },
    { model: "Supplier", fields: ["brochureUrl"], delegate: db.supplier },
    { model: "TradeIntelligenceAsset", fields: ["fileUrl"], delegate: db.tradeIntelligenceAsset },
    { model: "TradeServiceAsset", fields: ["fileUrl"], delegate: db.tradeServiceAsset },
    { model: "RoomAttachment", fields: ["fileUrl"], delegate: db.roomAttachment },
    { model: "MeasurementPhoto", fields: ["fileUrl"], delegate: db.measurementPhoto },
    { model: "VisualizerSourceImage", fields: ["fileUrl"], delegate: db.visualizerSourceImage },
    { model: "VisualizerVariant", fields: ["exportImageUrl"], delegate: db.visualizerVariant },
    { model: "VisualizerCatalogProduct", fields: ["previewImageUrl"], delegate: db.visualizerCatalogProduct },
  ];
}

async function main() {
  console.log(`━━━ B4 Blob 私有化迁移（${WRITE ? "WRITE" : "dry-run"}）━━━`);
  console.log("DB:", safeDbId(process.env.DATABASE_URL));
  console.log("BLOB_READ_WRITE_TOKEN:", process.env.BLOB_READ_WRITE_TOKEN ? "已设置" : "未设置");

  if (WRITE) {
    if (process.env.MIGRATE_CONFIRM !== "yes") {
      console.error("✗ write 模式必须显式设置 MIGRATE_CONFIRM=yes");
      process.exit(1);
    }
    if (looksLikeProduction(process.env.DATABASE_URL) && process.env.ALLOW_PRODUCTION !== "yes") {
      console.error("✗ 当前 DATABASE_URL 疑似生产库（neondb 且无 branch 标识）。");
      console.error("  请先在 Neon branch 演练；确认要对生产执行时再加 ALLOW_PRODUCTION=yes。");
      process.exit(1);
    }
  }

  // ── 1) DB 侧扫描（+ write 时备份）─────────────────────────
  const backup: Record<string, unknown[]> = {};
  const dbPlans: Array<{
    model: string;
    id: string;
    updates: Record<string, string>;
  }> = [];
  const unknownPrefixUrls: string[] = [];

  for (const spec of fieldSpecs()) {
    const rows: Array<Record<string, unknown>> = await spec.delegate.findMany();
    const touched = rows.filter((r) =>
      spec.fields.some((f) => typeof r[f] === "string" && BLOB_HOST_RE.test(r[f] as string)),
    );
    backup[spec.model] = touched;

    for (const row of touched) {
      const updates: Record<string, string> = {};
      for (const f of spec.fields) {
        const v = typeof row[f] === "string" ? (row[f] as string) : null;
        const conv = convertFieldValue(v);
        if (conv === "skip") continue;
        if (conv === "unknown") {
          unknownPrefixUrls.push(`${spec.model}.${f}#${row.id}: ${v}`);
          continue;
        }
        updates[f] = conv.next;
      }
      if (Object.keys(updates).length > 0) {
        dbPlans.push({ model: spec.model, id: row.id as string, updates });
      }
    }
    console.log(`  ${spec.model}: 全表 ${rows.length} 行，含存储 URL ${touched.length} 行`);
  }

  // SkillExecution JSON 文本
  const skillExecs = await db.skillExecution.findMany({
    select: { id: true, inputJson: true, outputJson: true },
  });
  const skillExecPlans: Array<{ id: string; data: { inputJson?: string; outputJson?: string } }> = [];
  let skillExecHits = 0;
  const skillExecBackup: unknown[] = [];
  for (const e of skillExecs) {
    const data: { inputJson?: string; outputJson?: string } = {};
    const inConv = convertTextUrls(e.inputJson);
    const outConv = convertTextUrls(e.outputJson);
    if (inConv) {
      data.inputJson = inConv.next;
      skillExecHits += inConv.hits.length;
    }
    if (outConv) {
      data.outputJson = outConv.next;
      skillExecHits += outConv.hits.length;
    }
    if (data.inputJson !== undefined || data.outputJson !== undefined) {
      skillExecPlans.push({ id: e.id, data });
      skillExecBackup.push(e);
    }
  }
  backup["SkillExecution"] = skillExecBackup;
  console.log(`  SkillExecution: ${skillExecs.length} 行，需重写 ${skillExecPlans.length} 行（内嵌 URL ${skillExecHits} 处）`);

  // ── 2) Blob 对象扫描 ────────────────────────────────────
  const blobObjects: Array<{ url: string; pathname: string; size: number }> = [];
  let skippedForeign = 0;
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    let cursor: string | undefined;
    do {
      const page = await list({ cursor, limit: 1000 });
      for (const b of page.blobs) {
        if (isKnownPrefix(b.pathname)) {
          blobObjects.push({ url: b.url, pathname: b.pathname, size: b.size });
        } else {
          skippedForeign++;
        }
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    console.log(`  Blob 存储: 已知前缀对象 ${blobObjects.length} 个（未知前缀跳过 ${skippedForeign} 个）`);
  } else {
    console.log("  Blob 存储: 未设置 BLOB_READ_WRITE_TOKEN，跳过对象扫描（仅 DB 分析）");
  }

  // 检测哪些仍是 public
  const publicObjects: typeof blobObjects = [];
  for (const b of blobObjects) {
    if (await isPubliclyReadable(b.url)) publicObjects.push(b);
  }
  console.log(`  其中仍可未鉴权访问（public 遗留）: ${publicObjects.length} 个`);

  // ── dry-run 汇总 ────────────────────────────────────────
  console.log("\n━━━ 计划 ━━━");
  console.log(`  Blob 对象重传为 private: ${publicObjects.length} 个`);
  console.log(`  DB 字段重写: ${dbPlans.length} 行 + SkillExecution ${skillExecPlans.length} 行`);
  if (unknownPrefixUrls.length > 0) {
    console.log(`  ⚠ 未知前缀 URL（保持不动，请人工确认）: ${unknownPrefixUrls.length} 条`);
    unknownPrefixUrls.slice(0, 10).forEach((u) => console.log(`    - ${u}`));
  }

  if (!WRITE) {
    console.log("\ndry-run 结束（未做任何修改）。真实执行：MIGRATE_CONFIRM=yes ... --write");
    process.exit(0);
  }

  // ── 3) 备份 ─────────────────────────────────────────────
  const dir = join(process.cwd(), "backups", "blob-private-migration");
  mkdirSync(dir, { recursive: true });
  const backupPath = join(dir, `pre-migration_${ts()}.json`);
  writeFileSync(
    backupPath,
    JSON.stringify(
      { exportedAt: new Date().toISOString(), db: safeDbId(process.env.DATABASE_URL), tables: backup },
      null,
      2,
    ),
  );
  console.log(`\n✓ 备份完成: ${backupPath}`);

  // ── 4) Blob 对象迁移（原路径 re-put private）────────────
  let migrated = 0;
  const failures: string[] = [];
  for (const b of publicObjects) {
    try {
      const got = await get(b.url, { access: "public" });
      if (!got || got.statusCode !== 200 || !got.stream) {
        throw new Error("读取失败");
      }
      const chunks: Uint8Array[] = [];
      const reader = got.stream.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }
      const buffer = Buffer.concat(chunks);
      if (buffer.length !== b.size) {
        throw new Error(`大小不一致 expected=${b.size} got=${buffer.length}`);
      }
      await put(b.pathname, buffer, {
        access: "private",
        allowOverwrite: true,
        contentType: got.blob.contentType || undefined,
      });
      migrated++;
      if (migrated % 20 === 0) console.log(`  ...已迁移 ${migrated}/${publicObjects.length}`);
    } catch (e) {
      failures.push(`${b.pathname}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`✓ Blob 对象迁移完成: ${migrated} 成功, ${failures.length} 失败`);
  failures.slice(0, 10).forEach((f) => console.log(`  ✗ ${f}`));
  if (failures.length > 0) {
    console.error("存在迁移失败对象，停止 DB 重写（数据未损坏：对象仍可访问，DB 未改）。");
    process.exit(1);
  }

  // ── 5) DB 重写 ──────────────────────────────────────────
  let rewritten = 0;
  for (const plan of dbPlans) {
    const spec = fieldSpecs().find((s) => s.model === plan.model)!;
    await spec.delegate.update({ where: { id: plan.id }, data: plan.updates });
    rewritten++;
  }
  for (const plan of skillExecPlans) {
    await db.skillExecution.update({ where: { id: plan.id }, data: plan.data });
    rewritten++;
  }
  console.log(`✓ DB 重写完成: ${rewritten} 行`);

  // ── 6) 校验 ─────────────────────────────────────────────
  const samples = publicObjects.slice(0, 5);
  let verifyOk = true;
  for (const s of samples) {
    const got = await get(s.pathname, { access: "private" }).catch(() => null);
    const sdkOk = Boolean(got && got.statusCode === 200);
    const stillPublic = await isPubliclyReadable(s.url);
    console.log(`  校验 ${s.pathname}: SDK 读取=${sdkOk ? "✓" : "✗"} 未鉴权访问=${stillPublic ? "仍可(✗)" : "已阻断(✓)"}`);
    if (!sdkOk || stillPublic) verifyOk = false;
  }
  console.log(verifyOk ? "\n✓ 迁移完成，校验通过" : "\n⚠ 迁移完成，但校验存在异常，请人工检查");
  process.exit(verifyOk ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
