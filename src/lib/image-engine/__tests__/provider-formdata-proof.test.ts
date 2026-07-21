/**
 * 证明 Image Edit 请求会把真实图片 bytes 传给 Provider（非仅 URL prompt）
 * 运行：npx tsx src/lib/image-engine/__tests__/provider-formdata-proof.test.ts
 */

import { editProductImage } from "../client";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

async function main() {
  process.env.PRODUCT_CONTENT_IMAGE_DRY_RUN = "0";
  process.env.PRODUCT_CONTENT_IMAGE_GENERATE_ENABLED = "1";

  const primary = Buffer.alloc(1200, 7);
  const ref = Buffer.alloc(800, 9);
  let sawImageField = false;
  let primaryBytes = 0;
  let referenceCount = 0;
  let modelUsed = "";

  const result = await editProductImage(
    {
      orgId: "org_test",
      jobId: "job_test",
      mode: "EXACT",
      sceneType: "white_bg",
      primaryImagePath: "product-content/org/job/primary.jpg",
      referenceImagePaths: ["product-content/org/job/detail.jpg"],
      dryRun: false,
      prompt: "keep product exact",
    },
    {
      readBlob: async (p) => {
        if (p.includes("detail")) {
          return { buffer: ref, contentType: "image/jpeg" };
        }
        return { buffer: primary, contentType: "image/jpeg" };
      },
      runEdit: async (args) => {
        sawImageField = args.imageBuffer.byteLength > 0;
        primaryBytes = args.imageBuffer.byteLength;
        referenceCount = args.referenceImages?.length ?? 0;
        modelUsed = args.model || "";
        // 模拟 Provider 成功返回
        return Buffer.from("fakepng");
      },
    },
  );

  ok(sawImageField, "primary image buffer 传入 Provider");
  ok(primaryBytes === 1200, `primaryBytes=1200 (got ${primaryBytes})`);
  ok(referenceCount === 1, `referenceCount=1 (got ${referenceCount})`);
  ok(Boolean(result.buffer), "返回生成 buffer");
  ok(result.dryRun === false, "非 dry-run");
  ok(
    Number(result.metadata.primaryBytes) === 1200,
    "metadata.primaryBytes 记录",
  );
  ok(
    Number(result.metadata.referenceCount) === 1,
    "metadata.referenceCount 记录",
  );
  ok(!JSON.stringify(result.metadata).includes("http"), "metadata 不含 URL");
  void modelUsed;

  console.log(`\nprovider-formdata-proof: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
