/**
 * product-visual-builder image-client 测试（Phase 1F）
 *
 * 不真实调用 OpenAI：全部通过注入的假 deps（getModel / generate）驱动。
 *
 * 运行：npx tsx src/lib/skills/product-visual-builder/__tests__/image-client.test.ts
 */
import {
  generateProductVisualImage,
  SOURCE_IMAGES_NOT_USED_WARNING,
  type ImageClientDeps,
  type GenerateProductVisualImageParams,
} from "../image-client";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

const MOCK_MODEL = "gpt-image-test";
// 1x1 PNG base64（仅用于测试，不真实上传）
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function makeDeps(over: Partial<ImageClientDeps> = {}): ImageClientDeps & {
  calls: Array<{ model: string; prompt: string; size: string }>;
} {
  const calls: Array<{ model: string; prompt: string; size: string }> = [];
  return {
    getModel: () => MOCK_MODEL,
    generate: async (args) => {
      calls.push(args);
      return [{ base64: TINY_PNG_B64 }];
    },
    includeRaw: false,
    calls,
    ...over,
  };
}

const baseParams: GenerateProductVisualImageParams = {
  prompt: "a warm-home product photo of a coral fleece blanket",
};

async function main() {
  // 1. dryRun=true：不调用 OpenAI
  {
    const deps = makeDeps();
    const r = await generateProductVisualImage({ ...baseParams, dryRun: true }, deps);
    ok(r.status === "dry_run", "dryRun: status=dry_run");
    ok(r.images.length === 0, "dryRun: images=[]");
    ok(r.model === MOCK_MODEL, "dryRun: model 来自 deps");
    ok(deps.calls.length === 0, "dryRun: 未调用 generate");
    ok(r.warnings.some((w) => w.includes("dry-run")), "dryRun: warnings 含 dry-run");
  }

  // 2. generateEnabled=false：不调用 OpenAI
  {
    const deps = makeDeps();
    const r = await generateProductVisualImage({ ...baseParams, generateEnabled: false }, deps);
    ok(r.status === "disabled", "disabled: status=disabled");
    ok(r.images.length === 0, "disabled: images=[]");
    ok(deps.calls.length === 0, "disabled: 未调用 generate");
    ok(r.warnings.some((w) => w.includes("disabled")), "disabled: warnings 含 disabled");
  }

  // 3. 真实调用成功（mock）
  {
    const deps = makeDeps();
    const r = await generateProductVisualImage({ ...baseParams, size: "1024x1536" }, deps);
    ok(r.status === "completed", "completed: status=completed");
    ok(r.images.length > 0, "completed: images.length>0");
    ok(r.images[0].mimeType === "image/png", "completed: mimeType=image/png");
    ok(Boolean(r.images[0].base64), "completed: 有 base64");
    ok(Buffer.isBuffer(r.images[0].buffer), "completed: 有 buffer");
    ok(r.model === MOCK_MODEL, "completed: model 正确");
    ok(deps.calls.length === 1 && deps.calls[0].prompt === baseParams.prompt, "completed: prompt 传入 generate");
    ok(deps.calls[0].size === "1024x1536", "completed: size 传入 generate");
  }

  // 4. 真实调用失败（mock）→ 抛清晰错误，不返回 completed
  {
    const deps = makeDeps({
      generate: async () => {
        throw new Error("upstream 500");
      },
    });
    let threw = false;
    let msg = "";
    try {
      await generateProductVisualImage(baseParams, deps);
    } catch (e) {
      threw = true;
      msg = e instanceof Error ? e.message : String(e);
    }
    ok(threw, "fail: 抛出错误");
    ok(msg.includes("图片生成失败"), "fail: 错误信息清晰");
    ok(!msg.includes(baseParams.prompt), "fail: 错误不含完整 prompt");
  }

  // 4b. 返回空结果 → 抛错，不假装 completed
  {
    const deps = makeDeps({ generate: async () => [] });
    let threw = false;
    try {
      await generateProductVisualImage(baseParams, deps);
    } catch {
      threw = true;
    }
    ok(threw, "empty: 空结果抛错，不返回 completed");
  }

  // 5. sourceImageUrls 行为（Plan B：本阶段不传入模型，但必须明确 warning）
  {
    const deps = makeDeps();
    const r = await generateProductVisualImage(
      { ...baseParams, sourceImageUrls: ["https://blob.test/visual-builder/org/2026/06/b/source-0.jpg"] },
      deps,
    );
    ok(r.warnings.includes(SOURCE_IMAGES_NOT_USED_WARNING), "source: warning 明确未使用参考图");
    ok(!JSON.stringify(deps.calls).includes("source-0.jpg"), "source: sourceImageUrls 未传入 generate");
  }

  // 6. 安全：默认不返回 raw，不含 apiKey
  {
    const deps = makeDeps();
    const r = await generateProductVisualImage(baseParams, deps);
    ok(r.raw === undefined, "security: 默认 raw=undefined");
    const dump = JSON.stringify(r);
    ok(!/sk-/.test(dump) && !dump.toLowerCase().includes("apikey"), "security: 返回值不含 apiKey");
  }

  // 6b. includeRaw=true 时才返回 raw（供非生产排查）
  {
    const deps = makeDeps({ includeRaw: true });
    const r = await generateProductVisualImage(baseParams, deps);
    ok(r.raw !== undefined, "security: includeRaw 时返回 raw");
  }

  // 7. 空 prompt → 抛错
  {
    const deps = makeDeps();
    let threw = false;
    try {
      await generateProductVisualImage({ prompt: "   " }, deps);
    } catch {
      threw = true;
    }
    ok(threw, "prompt: 空 prompt 抛错");
    ok(deps.calls.length === 0, "prompt: 空 prompt 未调用 generate");
  }

  console.log(`product-visual-builder image-client: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
