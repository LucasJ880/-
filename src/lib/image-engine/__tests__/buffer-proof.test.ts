/**
 * 图像引擎 buffer 证明
 * 运行：npx tsx src/lib/image-engine/__tests__/buffer-proof.test.ts
 */

import type { ImageEditDeps } from "@/lib/image-engine/client";
import { editProductImage } from "@/lib/image-engine/client";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

async function testDryRunReadsBuffers() {
  const primaryBuffer = Buffer.from("primary-image-bytes");
  const refBuffer = Buffer.from("reference-image-bytes");
  let readCalls = 0;
  let editCalled = false;
  let capturedRefs: Array<{ buffer: Buffer }> = [];

  const deps: ImageEditDeps = {
    readBlob: async (path: string) => {
      readCalls += 1;
      if (path === "primary.png") {
        return { buffer: primaryBuffer, contentType: "image/png" };
      }
      if (path === "detail.png") {
        return { buffer: refBuffer, contentType: "image/png" };
      }
      return null;
    },
    runEdit: async (input) => {
      editCalled = true;
      capturedRefs = input.referenceImages ?? [];
      return Buffer.from("edited");
    },
  };

  const prevDryRun = process.env.PRODUCT_CONTENT_IMAGE_DRY_RUN;
  process.env.PRODUCT_CONTENT_IMAGE_DRY_RUN = "1";

  try {
    const result = await editProductImage(
      {
        orgId: "org1",
        jobId: "job1",
        mode: "EXACT",
        sceneType: "white_bg",
        primaryImagePath: "primary.png",
        referenceImagePaths: ["detail.png"],
        prompt: "",
        dryRun: true,
      },
      deps,
    );

    ok(readCalls >= 2, "dry-run 仍读取主图与参考图");
    ok(!editCalled, "dry-run 不调用 provider");
    ok(result.dryRun === true, "返回 dryRun=true");
    ok(Number(result.metadata.primaryBytes) > 0, "metadata.primaryBytes > 0");
    ok(Number(result.metadata.referenceCount) === 1, "metadata.referenceCount=1");
    ok(Number(result.metadata.referenceBytes) > 0, "metadata.referenceBytes > 0");
    ok(Boolean(result.metadata.requestId), "metadata 含 requestId");
  } finally {
    if (prevDryRun === undefined) delete process.env.PRODUCT_CONTENT_IMAGE_DRY_RUN;
    else process.env.PRODUCT_CONTENT_IMAGE_DRY_RUN = prevDryRun;
  }
}

async function testLiveEditPassesReferences() {
  const primaryBuffer = Buffer.from("primary-live");
  const refBuffer = Buffer.from("ref-live");
  let capturedRefs: Array<{ buffer: Buffer }> = [];

  const deps: ImageEditDeps = {
    readBlob: async (path: string) => {
      if (path === "primary.png") {
        return { buffer: primaryBuffer, contentType: "image/png" };
      }
      if (path === "texture.png") {
        return { buffer: refBuffer, contentType: "image/png" };
      }
      return null;
    },
    runEdit: async (input) => {
      capturedRefs = input.referenceImages ?? [];
      return Buffer.from("edited-live");
    },
  };

  const prevDryRun = process.env.PRODUCT_CONTENT_IMAGE_DRY_RUN;
  const prevEnabled = process.env.PRODUCT_CONTENT_IMAGE_GENERATE_ENABLED;
  delete process.env.PRODUCT_CONTENT_IMAGE_DRY_RUN;
  process.env.PRODUCT_CONTENT_IMAGE_GENERATE_ENABLED = "1";

  try {
    const result = await editProductImage(
      {
        orgId: "org1",
        jobId: "job1",
        mode: "STUDIO",
        sceneType: "bedroom",
        primaryImagePath: "primary.png",
        referenceImagePaths: ["texture.png"],
        prompt: "",
        dryRun: false,
      },
      deps,
    );

    ok(Boolean(result.buffer), "非 dry-run 返回 buffer");
    ok(capturedRefs.length === 1, "runImageEdit 收到 1 张参考图");
    ok(capturedRefs[0]?.buffer.byteLength > 0, "参考图 bytes > 0");
    ok(Number(result.metadata.latencyMs) >= 0, "metadata 含 latencyMs");
  } finally {
    if (prevDryRun === undefined) delete process.env.PRODUCT_CONTENT_IMAGE_DRY_RUN;
    else process.env.PRODUCT_CONTENT_IMAGE_DRY_RUN = prevDryRun;
    if (prevEnabled === undefined) delete process.env.PRODUCT_CONTENT_IMAGE_GENERATE_ENABLED;
    else process.env.PRODUCT_CONTENT_IMAGE_GENERATE_ENABLED = prevEnabled;
  }
}

async function main() {
  await testDryRunReadsBuffers();
  await testLiveEditPassesReferences();
  console.log(`\nbuffer-proof: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

void main();
