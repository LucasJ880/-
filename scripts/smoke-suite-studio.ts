/**
 * 套图工作室冒烟：模版库 + 四槽登记 + dry-run 生成
 *
 * 用法：
 *   PRODUCT_CONTENT_LOCAL_STORE=1 npx tsx scripts/smoke-suite-studio.ts
 *   PRODUCT_CONTENT_LOCAL_STORE=1 PRODUCT_CONTENT_IMAGE_DRY_RUN=0 npx tsx scripts/smoke-suite-studio.ts --real
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

process.env.PRODUCT_CONTENT_LOCAL_STORE =
  process.env.PRODUCT_CONTENT_LOCAL_STORE || "1";

const REAL = process.argv.includes("--real");
if (!REAL) process.env.PRODUCT_CONTENT_IMAGE_DRY_RUN = "1";
else {
  process.env.PRODUCT_CONTENT_IMAGE_DRY_RUN = "0";
  process.env.PRODUCT_CONTENT_IMAGE_GENERATE_ENABLED = "1";
}

import { db } from "../src/lib/db";
import { putPrivateBlob } from "../src/lib/files/blob-access";
import {
  addJobInput,
  createProductContentJob,
} from "../src/lib/product-content/jobs/service";
import {
  listVisualTemplateSuites,
  runVisualTemplateSuite,
} from "../src/lib/product-content/templates";

const PRIMARY =
  "/Users/user/Desktop/梦馨家纺网站/2026 产品图片/浴袍 bathrobe/印花浴袍PRINT BATHROBE/印花双面绒浴袍MX-BR-P202601.jpg";
const ORG_CODE = process.env.SMOKE_ORG_CODE || "sunny-home-deco";

async function main() {
  const suites = listVisualTemplateSuites();
  console.log(
    "templates:",
    suites.map((s) => `${s.id}(${s.shotCount})`).join(", "),
  );
  if (!suites.some((s) => s.id === "amazon_realism_bathrobe_v1")) {
    throw new Error("缺少首套模板 amazon_realism_bathrobe_v1");
  }
  if (!fs.existsSync(PRIMARY)) throw new Error(`缺少主图 ${PRIMARY}`);

  const org = await db.organization.findFirst({ where: { code: ORG_CODE } });
  if (!org) throw new Error(`组织不存在 ${ORG_CODE}`);
  const mem = await db.organizationMember.findFirst({
    where: { orgId: org.id, status: "active" },
  });
  if (!mem) throw new Error("无组织成员");

  const job = await createProductContentJob({
    orgId: org.id,
    userId: mem.userId,
    title: `套图工作室冒烟 ${new Date().toISOString().slice(0, 19)}`,
    executionMode: "AUTOPILOT",
    industryPack: "home_textile",
  });

  const buf = fs.readFileSync(PRIMARY);
  const put = await putPrivateBlob({
    pathname: `product-content/${org.id}/${job.id}/01_Source/front-smoke.jpg`,
    body: buf,
    contentType: "image/jpeg",
  });
  await addJobInput({
    orgId: org.id,
    userId: mem.userId,
    jobId: job.id,
    inputType: "image",
    blobPathname: put.pathname,
    mimeType: "image/jpeg",
    fileName: "front-smoke.jpg",
    purpose: "product_front",
  });

  const result = await runVisualTemplateSuite({
    orgId: org.id,
    jobId: job.id,
    userId: mem.userId,
    suiteId: "amazon_realism_bathrobe_v1",
    aspectRatio: "9:16",
    resolution: "1K",
    dryRun: !REAL,
  });

  console.log(
    JSON.stringify(
      {
        jobId: job.id,
        suiteId: result.suiteId,
        aspectRatio: result.aspectRatio,
        resolution: result.resolution,
        shotCount: result.shotCount,
        outputs: result.outputs,
        real: REAL,
      },
      null,
      2,
    ),
  );

  if (result.shotCount !== 4) throw new Error("应产出 4 张");
  for (const o of result.outputs) {
    const row = await db.visualOutput.findUnique({ where: { id: o.outputId } });
    const meta = (row?.metadata || {}) as Record<string, unknown>;
    if (meta.templateSuiteId !== "amazon_realism_bathrobe_v1") {
      throw new Error("metadata.templateSuiteId 缺失");
    }
    if (meta.aspectRatio !== "9:16" || meta.resolution !== "1K") {
      throw new Error("metadata 比例/分辨率不正确");
    }
  }

  console.log("✅ smoke-suite-studio passed");
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
