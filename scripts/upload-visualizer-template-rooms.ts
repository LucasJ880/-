/**
 * 一次性：上传 AI 标准安装模板房间底图到青砚私有 Blob。
 *
 * 用法（在工作树根目录）：
 *   set -a; . /Users/user/Desktop/青砚/.env; . /Users/user/Desktop/青砚/.env.local; set +a
 *   npx tsx scripts/upload-visualizer-template-rooms.ts
 *
 * 不写数据库、不跑 migrate。
 */

import fs from "node:fs";
import path from "node:path";
import { putPrivateBlob, readBlobBuffer } from "@/lib/files/blob-access";

const ASSETS = "/Users/user/.cursor/projects/Users-user-Desktop/assets";

const ROOMS = [
  {
    key: "STANDARD",
    envKey: "VISUALIZER_TEMPLATE_STANDARD_ROOM_URL",
    pathname: "visualizer/templates/standard-floor-to-ceiling.jpg",
    source: path.join(
      ASSETS,
      "67ececa2c5bcfabdff3e2dffadd8889b-d4237561-8d90-45a7-96e0-adf6b791c41f.png",
    ),
    label: "标准落地窗空房间日景",
  },
  {
    key: "LIVING",
    envKey: "VISUALIZER_TEMPLATE_LIVING_ROOM_URL",
    pathname: "visualizer/templates/modern-living-room.jpg",
    source: path.join(
      ASSETS,
      "d93c8fafb24946c2f6b683404a597c27-55fc7f83-7998-4ccb-995f-34b83e4ac9d0.png",
    ),
    label: "现代客厅空窗日景",
  },
] as const;

async function main() {
  const lines: string[] = [
    "# Visualizer AI 标准安装模板底图（本轮上传，私有 Blob 代理路径）",
  ];

  for (const room of ROOMS) {
    if (!fs.existsSync(room.source)) {
      throw new Error(`源文件不存在: ${room.source}`);
    }
    const buffer = fs.readFileSync(room.source);
    console.log(`↑ ${room.label}`);
    console.log(`  source: ${room.source} (${buffer.length} bytes)`);
    console.log(`  pathname: ${room.pathname}`);

    const uploaded = await putPrivateBlob({
      pathname: room.pathname,
      body: buffer,
      contentType: "image/jpeg",
    });

    const readBack = await readBlobBuffer(uploaded.pathname);
    if (!readBack?.buffer?.length) {
      throw new Error(`上传后无法读取: ${room.pathname}`);
    }

    console.log(`  proxyUrl: ${uploaded.proxyUrl}`);
    console.log(`  readBack: ${readBack.buffer.length} bytes, ${readBack.contentType}`);
    // 不打印真实 blob.url，避免把私有存储 URL 泄漏进日志/报告
    lines.push(`${room.envKey}=${uploaded.proxyUrl}`);
  }

  const outEnv = path.join(process.cwd(), ".env.local");
  let existing = "";
  if (fs.existsSync(outEnv)) {
    existing = fs.readFileSync(outEnv, "utf8");
  }
  const filtered = existing
    .split("\n")
    .filter(
      (l) =>
        !l.startsWith("VISUALIZER_TEMPLATE_STANDARD_ROOM_URL=") &&
        !l.startsWith("VISUALIZER_TEMPLATE_LIVING_ROOM_URL=") &&
        !l.startsWith("# Visualizer AI 标准安装模板底图"),
    )
    .join("\n")
    .replace(/\n+$/, "");

  const next = [filtered, "", ...lines, ""].filter((x, i, a) => !(x === "" && a[i - 1] === "")).join("\n");
  fs.writeFileSync(outEnv, next.endsWith("\n") ? next : `${next}\n`);
  console.log(`\n✓ 已写入 ${outEnv}（gitignore，不进 git）`);
  console.log("\n建议环境变量：");
  for (const l of lines.slice(1)) console.log(l);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
