/**
 * 试用：奶油拱形卧室床品套图 + 用户提供的 3 张床品实拍
 *
 * 用法：
 *   PRODUCT_CONTENT_LOCAL_STORE=1 PRODUCT_CONTENT_IMAGE_DRY_RUN=0 \
 *     npx tsx scripts/trial-mint-palace-bedding.ts
 */

import fs from "fs";
import path from "path";

function loadEnvFile(rel: string) {
  const abs = path.join(process.cwd(), rel);
  if (!fs.existsSync(abs)) return;
  for (const line of fs.readFileSync(abs, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
loadEnvFile(".env.local");
loadEnvFile(".env");

process.env.PRODUCT_CONTENT_LOCAL_STORE = "1";
process.env.PRODUCT_CONTENT_IMAGE_DRY_RUN = "0";
process.env.PRODUCT_CONTENT_IMAGE_GENERATE_ENABLED = "1";

import { db } from "../src/lib/db";
import { putPrivateBlob, readBlobBuffer } from "../src/lib/files/blob-access";
import {
  addJobInput,
  createProductContentJob,
} from "../src/lib/product-content/jobs/service";
import { runVisualTemplateSuite } from "../src/lib/product-content/templates";

const ASSETS = "/Users/user/.cursor/projects/Users-user-Desktop/assets";
const FRONT = path.join(
  ASSETS,
  "765c79f7c945b4e149b4da43f5a9b0c1-6d41cf6a-6996-4ad2-a1e5-22dd2b1b282e.png",
);
const SIDE = path.join(
  ASSETS,
  "f452c99f32c3a8a783c2b80011311bc2-c7e91902-35c7-423b-aa56-47ed59d71a71.png",
);
const DETAIL = path.join(
  ASSETS,
  "6da17e8d80832a15283f056e5d27ef43-b32915d2-4b2b-47a1-bebe-2450ab25fd95.png",
);

const OUT_DIR = path.join(
  process.env.HOME || "/Users/user",
  "Desktop",
  "床品套图试用-mint_palace_bedding_v1",
);
const ORG_CODE = process.env.SMOKE_ORG_CODE || "sunny-home-deco";

async function uploadSlot(args: {
  orgId: string;
  jobId: string;
  userId: string;
  filePath: string;
  purpose: "product_front" | "product_side" | "product_detail";
  fileName: string;
}) {
  const buf = fs.readFileSync(args.filePath);
  const put = await putPrivateBlob({
    pathname: `product-content/${args.orgId}/${args.jobId}/01_Source/${args.fileName}`,
    body: buf,
    contentType: "image/png",
  });
  await addJobInput({
    orgId: args.orgId,
    userId: args.userId,
    jobId: args.jobId,
    inputType: "image",
    blobPathname: put.pathname,
    mimeType: "image/png",
    fileName: args.fileName,
    purpose: args.purpose,
  });
  return put.pathname;
}

async function main() {
  for (const p of [FRONT, SIDE, DETAIL]) {
    if (!fs.existsSync(p)) throw new Error(`缺少素材: ${p}`);
  }

  const org = await db.organization.findFirst({ where: { code: ORG_CODE } });
  if (!org) throw new Error(`组织不存在 ${ORG_CODE}`);
  const mem = await db.organizationMember.findFirst({
    where: { orgId: org.id, status: "active" },
  });
  if (!mem) throw new Error("无组织成员");

  const job = await createProductContentJob({
    orgId: org.id,
    userId: mem.userId,
    title: `床品套图试用 mint_palace ${new Date().toISOString().slice(0, 19)}`,
    executionMode: "AUTOPILOT",
    industryPack: "home_textile",
  });

  await uploadSlot({
    orgId: org.id,
    jobId: job.id,
    userId: mem.userId,
    filePath: FRONT,
    purpose: "product_front",
    fileName: "front.png",
  });
  await uploadSlot({
    orgId: org.id,
    jobId: job.id,
    userId: mem.userId,
    filePath: SIDE,
    purpose: "product_side",
    fileName: "side.png",
  });
  await uploadSlot({
    orgId: org.id,
    jobId: job.id,
    userId: mem.userId,
    filePath: DETAIL,
    purpose: "product_detail",
    fileName: "detail.png",
  });

  console.log("jobId:", job.id);
  console.log("suite: mint_palace_bedding_v1 · 3:4 · 1K · 8 shots");

  const result = await runVisualTemplateSuite({
    orgId: org.id,
    jobId: job.id,
    userId: mem.userId,
    suiteId: "mint_palace_bedding_v1",
    aspectRatio: "3:4",
    resolution: "1K",
    dryRun: false,
  });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const saved: string[] = [];
  for (const o of result.outputs) {
    const row = await db.visualOutput.findUnique({ where: { id: o.outputId } });
    if (!row?.blobPathname) {
      console.warn("缺 blob:", o.shotKey, o.outputId);
      continue;
    }
    const { buffer } = await readBlobBuffer(row.blobPathname);
    const dest = path.join(OUT_DIR, `${o.shotKey}.png`);
    fs.writeFileSync(dest, buffer);
    saved.push(dest);
    console.log("saved", dest);
  }

  console.log(
    JSON.stringify(
      {
        jobId: job.id,
        reviewUrl: `/product-content/${job.id}`,
        shotCount: result.shotCount,
        outDir: OUT_DIR,
        saved,
      },
      null,
      2,
    ),
  );

  if (result.shotCount !== 8) {
    throw new Error(`期望 8 张，实际 ${result.shotCount}`);
  }
  console.log("✅ trial-mint-palace-bedding done");
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
