/**
 * product-visual-builder dry-run service 测试（Phase 1B-Service）
 *
 * 通过注入内存假依赖验证记录链路，**不连接 / 不写入数据库**
 * （当前 DATABASE_URL 指向生产，禁止在测试中真实写库）。
 *
 * 运行：npx tsx src/lib/skills/product-visual-builder/__tests__/service.test.ts
 */
import {
  runProductVisualBuilderDryRun,
  runProductVisualBuilder,
  PRODUCT_VISUAL_BUILDER_SLUG,
  VPB_ERRORS,
  type VisualBuilderDeps,
  type SkillExecutionRecord,
} from "../service";
import type { AuditLogParams } from "@/lib/audit/logger";
import type { VisualBuilderInput } from "../types";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

function baseInput(overrides: Partial<VisualBuilderInput> = {}): VisualBuilderInput {
  return {
    // 故意填入“不可信”的 orgId/userId，验证 service 用 params 覆盖
    orgId: "EVIL_ORG",
    userId: "EVIL_USER",
    productType: "blanket",
    productName: "Coral Fleece Throw",
    useCase: "website",
    style: "warm_home",
    sourceImageUrls: ["https://blob.example/source-0.jpg", "https://blob.example/source-1.jpg"],
    sourceImageRoles: ["front", "texture"],
    productFacts: { material: "100% polyester coral fleece", sizes: ["150x200cm"] },
    language: "en",
    ...overrides,
  };
}

/** 构造记录型假依赖（不连库）。 */
function makeFakeDeps(opts: { skillId: string | null }) {
  const executions: SkillExecutionRecord[] = [];
  const audits: AuditLogParams[] = [];
  const deps: VisualBuilderDeps = {
    findSkillId: async () => opts.skillId,
    createExecution: async (record) => {
      executions.push(record);
      return { id: `exec_${executions.length}` };
    },
    logAudit: async (params) => {
      audits.push(params);
    },
    now: () => 1000,
  };
  return { deps, executions, audits };
}

async function main() {
  // 1. dry-run 成功写入 SkillExecution（经假依赖）
  {
    const { deps, executions, audits } = makeFakeDeps({ skillId: "skill_pvb" });
    const output = await runProductVisualBuilderDryRun(
      { orgId: "org_real", userId: "user_real", input: baseInput() },
      deps,
    );

    ok(output.status === "completed", "success: status=completed");
    ok(output.outputImageUrls.length === 0, "success: outputImageUrls 为空");
    ok(output.model === "dry-run", "success: model=dry-run");
    ok(output.humanReviewRequired === true, "success: humanReviewRequired=true");
    ok(typeof output.executionId === "string" && (output.executionId?.length ?? 0) > 0, "success: executionId 存在");

    ok(executions.length === 1, "success: 写入 1 条 SkillExecution");
    const rec = executions[0];
    ok(rec.skillId === "skill_pvb", "success: skillId 指向 product-visual-builder");
    ok(rec.success === true, "success: SkillExecution.success=true");
    ok(rec.toolCalls === null, "success: toolCalls=null");
    ok(rec.tokenCount === null, "success: tokenCount=null");
    ok(rec.promptSnapshot.length > 0, "success: promptSnapshot 存在");

    const parsedInput = JSON.parse(rec.inputJson) as VisualBuilderInput;
    ok(parsedInput.orgId === "org_real", "success: inputJson.orgId 被 params 覆盖");
    ok(parsedInput.userId === "user_real", "success: inputJson.userId 被 params 覆盖");

    const parsedOutput = JSON.parse(rec.outputJson) as { finalPrompt?: string };
    ok(
      typeof parsedOutput.finalPrompt === "string" && (parsedOutput.finalPrompt?.length ?? 0) > 0,
      "success: outputJson.finalPrompt 存在",
    );

    // AuditLog
    const actions = audits.map((a) => a.action);
    ok(actions.includes("visual_builder.generate.requested"), "audit: requested 已写");
    ok(actions.includes("visual_builder.generate.completed"), "audit: completed 已写");
    // 审计不得含完整 prompt / 图片 URL
    const auditDump = JSON.stringify(audits);
    ok(!auditDump.includes("source-0.jpg"), "audit: 不含 sourceImageUrls");
    ok(!auditDump.includes(parsedOutput.finalPrompt ?? "___PROMPT___"), "audit: 不含完整 prompt");
  }

  // 2. missing AgentSkill：明确抛错，不静默失败
  {
    const { deps, executions } = makeFakeDeps({ skillId: null });
    let threw = false;
    try {
      await runProductVisualBuilderDryRun(
        { orgId: "org_real", userId: "user_real", input: baseInput() },
        deps,
      );
    } catch (e) {
      threw = true;
      ok(
        e instanceof Error && e.message.includes(PRODUCT_VISUAL_BUILDER_SLUG),
        "missing: 错误信息含技能 slug",
      );
    }
    ok(threw, "missing: 未找到技能时抛错");
    ok(executions.length === 0, "missing: 未写入 SkillExecution");
  }

  // 3. 不调用图片模型 / 不上传 Blob（行为断言）
  {
    const { deps, executions } = makeFakeDeps({ skillId: "skill_pvb" });
    const output = await runProductVisualBuilderDryRun(
      { orgId: "org_real", userId: "user_real", input: baseInput() },
      deps,
    );
    ok(output.outputImageUrls.length === 0, "no-image: outputImageUrls 为空");
    ok(output.model === "dry-run", "no-image: model=dry-run");
    ok(executions[0].toolCalls === null, "no-image: toolCalls=null");
  }

  // ── Phase 1G：真实生成路径（全部用假依赖，不调用 OpenAI / 不上传 Blob）──

  function genInput(over: Partial<VisualBuilderInput> = {}): VisualBuilderInput {
    return baseInput({
      sourceImageUrls: ["https://blob.test/visual-builder/org_real/2026/06/up/source-0.jpg"],
      ...over,
    });
  }

  function makeGenDeps(
    opts: {
      skillId?: string | null;
      failImage?: boolean;
      failUpload?: boolean;
      failUpdate?: boolean;
      emptyImages?: boolean;
    } = {},
  ) {
    const executions: SkillExecutionRecord[] = [];
    const updates: Array<{ id: string; outputJson: string; success: boolean; durationMs: number }> = [];
    const audits: AuditLogParams[] = [];
    const calls = { generate: 0, upload: 0 };
    const deps: VisualBuilderDeps = {
      findSkillId: async () => (opts.skillId === undefined ? "skill_pvb" : opts.skillId),
      createExecution: async (record) => {
        executions.push(record);
        return { id: `exec_${executions.length}` };
      },
      logAudit: async (params) => {
        audits.push(params);
      },
      now: () => 1000,
      generateImage: async () => {
        calls.generate++;
        if (opts.failImage) throw new Error("upstream 500 sk-secret-leak");
        if (opts.emptyImages) return { model: "gpt-image-test", images: [], warnings: [] };
        return {
          model: "gpt-image-test",
          images: [{ base64: "QUFBQQ==", buffer: Buffer.from("QUFBQQ==", "base64") }],
          warnings: ["img-warn"],
        };
      },
      uploadImage: async (args) => {
        calls.upload++;
        if (opts.failUpload) throw new Error("blob 503");
        const pathname = `visual-builder/${args.orgId}/2026/06/${args.executionId}/${args.assetRole}-${args.index}.png`;
        return {
          url: `https://blob.test/${pathname}`,
          pathname,
          contentType: "image/png",
          sizeBytes: args.buffer?.length,
          dryRun: false,
          accessMode: "private",
        };
      },
      updateExecution: async (id, patch) => {
        if (opts.failUpdate) throw new Error("db update fail");
        updates.push({ id, ...patch });
      },
    };
    return { deps, executions, updates, audits, calls };
  }

  // G1. 默认请求仍 dry-run（不调用 image-client / 不上传）
  {
    const { deps, executions, audits, calls } = makeGenDeps();
    const out = await runProductVisualBuilder(
      { orgId: "org_real", userId: "user_real", input: baseInput(), options: {} },
      deps,
    );
    ok(out.model === "dry-run", "G1: model=dry-run");
    ok(out.outputImageUrls.length === 0, "G1: outputImageUrls=[]");
    ok(calls.generate === 0 && calls.upload === 0, "G1: 未调用 image-client / upload");
    ok(executions.length === 1, "G1: 写入 SkillExecution");
    const actions = audits.map((a) => a.action);
    ok(actions.includes("visual_builder.generate.requested"), "G1: audit requested");
    ok(actions.includes("visual_builder.generate.completed"), "G1: audit completed");
  }

  // G2. generateEnabled=true 且 dryRun=false → 真实生成
  {
    const { deps, executions, updates, audits, calls } = makeGenDeps();
    const out = await runProductVisualBuilder(
      {
        orgId: "org_real",
        userId: "user_real",
        input: genInput(),
        options: { generateEnabled: true, dryRun: false, imageSize: "1024x1024" },
      },
      deps,
    );
    ok(out.status === "completed", "G2: status=completed");
    ok(calls.generate === 1, "G2: image-client 调用一次");
    ok(calls.upload === 1, "G2: storage 调用一次");
    ok(out.outputImageUrls.length === 1, "G2: outputImageUrls 有值");
    ok(out.model === "gpt-image-test", "G2: model 为 mock model");
    ok(out.humanReviewRequired === true, "G2: humanReviewRequired=true");
    ok(executions.length === 1 && executions[0].success === false, "G2: 先写占位 SkillExecution(success=false)");
    ok(updates.length === 1 && updates[0].success === true, "G2: 成功后 update success=true");
    const parsed = JSON.parse(updates[0].outputJson) as { outputImageUrls?: string[] };
    ok((parsed.outputImageUrls?.length ?? 0) === 1, "G2: outputJson 含 outputImageUrls");
    ok(audits.map((a) => a.action).includes("visual_builder.generate.completed"), "G2: audit completed");
  }

  // G3. image-client 失败
  {
    const { deps, updates, audits, calls } = makeGenDeps({ failImage: true });
    let threw = false;
    let msg = "";
    try {
      await runProductVisualBuilder(
        { orgId: "org_real", userId: "user_real", input: genInput(), options: { generateEnabled: true, dryRun: false } },
        deps,
      );
    } catch (e) {
      threw = true;
      msg = e instanceof Error ? e.message : "";
    }
    ok(threw && msg.includes(VPB_ERRORS.IMAGE_FAILED), "G3: 抛 IMAGE_FAILED");
    ok(calls.upload === 0, "G3: 未上传 generated Blob");
    ok(updates.length === 1 && updates[0].success === false, "G3: 占位记录标记 success=false");
    ok(audits.map((a) => a.action).includes("visual_builder.generate.failed"), "G3: audit failed");
  }

  // G4. storage 上传失败
  {
    const { deps, updates, audits, calls } = makeGenDeps({ failUpload: true });
    let threw = false;
    let msg = "";
    try {
      await runProductVisualBuilder(
        { orgId: "org_real", userId: "user_real", input: genInput(), options: { generateEnabled: true, dryRun: false } },
        deps,
      );
    } catch (e) {
      threw = true;
      msg = e instanceof Error ? e.message : "";
    }
    ok(threw && msg.includes(VPB_ERRORS.UPLOAD_FAILED), "G4: 抛 UPLOAD_FAILED");
    ok(calls.generate === 1, "G4: image-client 已调用");
    ok(updates.length === 1 && updates[0].success === false, "G4: 记录标记失败");
    ok(audits.map((a) => a.action).includes("visual_builder.generate.failed"), "G4: audit failed");
  }

  // G5. sourceImageUrls 非本 org
  {
    const { deps, executions, calls } = makeGenDeps();
    let threw = false;
    let msg = "";
    try {
      await runProductVisualBuilder(
        {
          orgId: "org_real",
          userId: "user_real",
          input: genInput({ sourceImageUrls: ["https://evil.com/x.jpg"] }),
          options: { generateEnabled: true, dryRun: false },
        },
        deps,
      );
    } catch (e) {
      threw = true;
      msg = e instanceof Error ? e.message : "";
    }
    ok(threw && msg.includes(VPB_ERRORS.SOURCE_INVALID), "G5: 抛 SOURCE_INVALID");
    ok(calls.generate === 0 && calls.upload === 0, "G5: 未调用 image-client / storage");
    ok(executions.length === 0, "G5: 未创建 SkillExecution");
  }

  // G6. dryRun=true 即使 generateEnabled=true → 仍 dry-run
  {
    const { deps, calls } = makeGenDeps();
    const out = await runProductVisualBuilder(
      { orgId: "org_real", userId: "user_real", input: baseInput(), options: { generateEnabled: true, dryRun: true } },
      deps,
    );
    ok(out.model === "dry-run", "G6: 仍 dry-run");
    ok(calls.generate === 0 && calls.upload === 0, "G6: 未真实出图");
  }

  // G7. generateEnabled=false 即使 dryRun=false → 仍 dry-run
  {
    const { deps, calls } = makeGenDeps();
    const out = await runProductVisualBuilder(
      { orgId: "org_real", userId: "user_real", input: baseInput(), options: { generateEnabled: false, dryRun: false } },
      deps,
    );
    ok(out.model === "dry-run", "G7: 仍 dry-run");
    ok(calls.generate === 0 && calls.upload === 0, "G7: 未真实出图");
  }

  // G8. 不泄露敏感信息
  {
    const { deps, updates, audits } = makeGenDeps();
    const out = await runProductVisualBuilder(
      { orgId: "org_real", userId: "user_real", input: genInput(), options: { generateEnabled: true, dryRun: false } },
      deps,
    );
    ok(!JSON.stringify(out).toLowerCase().includes("apikey"), "G8: 输出不含 apiKey");
    ok(!updates[0].outputJson.includes("sk-"), "G8: outputJson 不含 sk- key");
    const auditDump = JSON.stringify(audits);
    ok(!auditDump.includes(out.finalPrompt), "G8: audit 不含完整 prompt");
    ok(!auditDump.includes("source-0.jpg"), "G8: audit 不含 sourceImageUrls");
  }

  console.log(`product-visual-builder service: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
