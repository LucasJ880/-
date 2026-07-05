/**
 * product-visual-builder API route 测试（Phase 1C）
 *
 * 不连接 / 不写入数据库（DATABASE_URL 指向生产）；不调用图片模型 / 不上传 Blob。
 * - 401：直接调真实 POST（无 session cookie → getCurrentUser 返回 null，不触 DB）。
 * - 其余分支：通过 route 在非生产环境暴露的内部函数（handleVisualBuilder / validateBody）
 *   注入内存假依赖测试，避免真实 session / DB。
 *
 * 运行：npx tsx src/app/api/skills/product-visual-builder/__tests__/route.test.ts
 */
import { NextRequest } from "next/server";
import { POST } from "../route";
import "../route"; // 触发 globalThis 内部函数挂载
import type { AuthUser } from "@/lib/auth";
import type { VisualBuilderInput, VisualBuilderOutput } from "@/lib/skills/product-visual-builder/types";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

interface RunOptions {
  dryRun?: boolean;
  generateEnabled?: boolean;
  imageSize?: string;
}
interface RouteDeps {
  resolveOrgId: (userId: string) => Promise<string | null>;
  ensureBuiltinSkills: (orgId: string) => Promise<void>;
  customerInOrg: (customerId: string, orgId: string) => Promise<boolean>;
  projectInOrg: (projectId: string, orgId: string) => Promise<boolean>;
  runVisualBuilder: (params: {
    orgId: string;
    userId: string;
    input: VisualBuilderInput;
    options: RunOptions;
  }) => Promise<VisualBuilderOutput>;
}

type Internals = {
  handleVisualBuilder: (user: AuthUser, body: unknown, deps: RouteDeps) => Promise<Response>;
  validateBody: (raw: unknown) =>
    | { ok: true; value: Omit<VisualBuilderInput, "orgId" | "userId"> }
    | { ok: false; error: string };
};

const internals = (globalThis as { __pvbRouteInternals?: Internals }).__pvbRouteInternals;

const fakeUser: AuthUser = {
  id: "user_real",
  email: "u@example.com",
  name: "U",
  nickname: null,
  avatar: null,
  role: "org_member",
  status: "active",
  canEditCustomers: true,
};

function validBody(over: Record<string, unknown> = {}) {
  return {
    // 故意伪造 orgId/userId，验证被覆盖
    orgId: "EVIL_ORG",
    userId: "EVIL_USER",
    productType: "blanket",
    productName: "Coral Fleece Throw",
    useCase: "website",
    style: "warm_home",
    sourceImageUrls: ["https://blob.example/source-0.jpg"],
    language: "en",
    ...over,
  };
}

function makeOutput(): VisualBuilderOutput {
  return {
    executionId: "exec_1",
    status: "completed",
    outputImageUrls: [],
    finalPrompt: "PROMPT",
    model: "dry-run",
    warnings: ["w1", "w2", "w3", "w4"],
    productFactsUsed: {},
    websitePathSuggestions: [],
    assetNamingSuggestions: [],
    humanReviewRequired: true,
    createdAt: new Date().toISOString(),
  };
}

const captured: {
  value: { orgId: string; userId: string; input: VisualBuilderInput; options: RunOptions } | null;
} = { value: null };

function makeDeps(over: Partial<RouteDeps> = {}): RouteDeps {
  return {
    resolveOrgId: async () => "org_real",
    ensureBuiltinSkills: async () => {},
    customerInOrg: async () => true,
    projectInOrg: async () => true,
    runVisualBuilder: async (params) => {
      captured.value = params;
      return makeOutput();
    },
    ...over,
  };
}

/**
 * 有状态的内存技能存储，镜像 seedBuiltinSkills 语义：
 * 已存在则跳过、只创建缺失项、从不覆盖（不 update）。
 * 用于在不连接生产库的前提下验证 seed 幂等 / 不覆盖 / seed→dry-run 顺序。
 */
function makeStatefulDeps(
  store: Map<string, { id: string; systemPrompt: string }>,
  counters: { created: number; ensured: number; ran: number },
  opts: { failSeed?: boolean } = {},
): RouteDeps {
  const key = (orgId: string) => `${orgId}:product-visual-builder`;
  return {
    resolveOrgId: async () => "org_real",
    ensureBuiltinSkills: async (orgId) => {
      counters.ensured++;
      if (opts.failSeed) throw new Error("seed 写库失败");
      if (!store.has(key(orgId))) {
        store.set(key(orgId), { id: "skill_seeded", systemPrompt: "DEFAULT_PROMPT" });
        counters.created++;
      }
      // 已存在则不动：不重复创建、不覆盖
    },
    customerInOrg: async () => true,
    projectInOrg: async () => true,
    runVisualBuilder: async (params) => {
      counters.ran++;
      // 模拟 service.findSkillId：技能不存在则抛 slug 错误
      if (!store.has(key(params.orgId))) {
        throw new Error(`未找到技能「product-visual-builder」（org=${params.orgId}）`);
      }
      captured.value = params;
      return makeOutput();
    },
  };
}

async function main() {
  if (!internals) {
    console.error("  ✗ 无法获取 route 内部函数（NODE_ENV 可能为 production）");
    process.exit(1);
  }

  // 1. 未登录 → 401（真实 POST，无 session，不触 DB）
  {
    const req = new NextRequest("http://localhost/api/skills/product-visual-builder", {
      method: "POST",
    });
    const res = await POST(req, { params: Promise.resolve({}) });
    ok(res.status === 401, "auth: 未登录返回 401");
  }

  // 2. 校验失败 → 400
  {
    const cases: { body: Record<string, unknown>; label: string }[] = [
      { body: validBody({ productType: "sofa" }), label: "无效 productType" },
      { body: validBody({ useCase: "tiktok" }), label: "无效 useCase" },
      { body: validBody({ style: "vintage" }), label: "无效 style" },
      { body: validBody({ productName: "  " }), label: "空 productName" },
      { body: validBody({ sourceImageUrls: [] }), label: "空 sourceImageUrls" },
    ];
    for (const c of cases) {
      const res = await internals.handleVisualBuilder(fakeUser, c.body, makeDeps());
      ok(res.status === 400, `validate: ${c.label} → 400`);
    }
  }

  // 3. 非 org member → 403
  {
    const res = await internals.handleVisualBuilder(
      fakeUser,
      validBody(),
      makeDeps({ resolveOrgId: async () => null }),
    );
    ok(res.status === 403, "member: 非组织成员 → 403");
  }

  // 4. orgId/userId 覆盖
  {
    captured.value = null;
    const res = await internals.handleVisualBuilder(fakeUser, validBody(), makeDeps());
    ok(res.status === 200, "override: 合法请求 → 200");
    const cap = captured.value as
      | { orgId: string; userId: string; input: VisualBuilderInput }
      | null;
    ok(cap?.orgId === "org_real", "override: orgId 用可信值");
    ok(cap?.userId === "user_real", "override: userId 用可信值");
    ok(cap?.input.orgId === "org_real", "override: input.orgId 被覆盖");
    ok(cap?.input.userId === "user_real", "override: input.userId 被覆盖");
  }

  // 5. customerId 不属于当前 org → 403
  {
    const res = await internals.handleVisualBuilder(
      fakeUser,
      validBody({ customerId: "cust_other" }),
      makeDeps({ customerInOrg: async () => false }),
    );
    ok(res.status === 403, "ownership: customerId 跨组织 → 403");
  }

  // 6. projectId 不属于当前 org → 403
  {
    const res = await internals.handleVisualBuilder(
      fakeUser,
      validBody({ projectId: "proj_other" }),
      makeDeps({ projectInOrg: async () => false }),
    );
    ok(res.status === 403, "ownership: projectId 跨组织 → 403");
  }

  // 7. 合法请求 → dry-run 输出
  {
    const res = await internals.handleVisualBuilder(fakeUser, validBody(), makeDeps());
    ok(res.status === 200, "success: 200");
    const out = (await res.json()) as VisualBuilderOutput;
    ok(out.status === "completed", "success: status=completed");
    ok(out.model === "dry-run", "success: model=dry-run");
    ok(out.outputImageUrls.length === 0, "success: outputImageUrls=[]");
    ok(out.humanReviewRequired === true, "success: humanReviewRequired=true");
    ok(typeof out.executionId === "string" && (out.executionId?.length ?? 0) > 0, "success: executionId 存在");
  }

  // 8. 技能未 seed → 明确 400，不静默成功
  {
    const res = await internals.handleVisualBuilder(
      fakeUser,
      validBody(),
      makeDeps({
        runVisualBuilder: async () => {
          throw new Error("未找到技能「product-visual-builder」（org=org_real）。请先 seed。");
        },
      }),
    );
    ok(res.status === 400, "missing-skill: 返回 400");
    const out = (await res.json()) as { error?: string };
    ok(typeof out.error === "string" && out.error.includes("初始化"), "missing-skill: 错误信息清晰");
  }

  // 9. validateBody language 缺省 → en
  {
    const r = internals.validateBody(validBody({ language: undefined }));
    ok(r.ok === true && r.value.language === "en", "validate: language 缺省为 en");
  }

  // 10. org 已有技能：不重复 seed，正常 dry-run completed
  {
    const store = new Map<string, { id: string; systemPrompt: string }>();
    store.set("org_real:product-visual-builder", { id: "skill_existing", systemPrompt: "CUSTOM" });
    const counters = { created: 0, ensured: 0, ran: 0 };
    const res = await internals.handleVisualBuilder(fakeUser, validBody(), makeStatefulDeps(store, counters));
    const out = (await res.json()) as VisualBuilderOutput;
    ok(res.status === 200, "seed-existing: 200");
    ok(out.status === "completed", "seed-existing: completed");
    ok(counters.created === 0, "seed-existing: 未重复创建");
    ok(counters.ran === 1, "seed-existing: 调用了 dry-run");
  }

  // 11. org 无技能：触发 seed 后继续 dry-run，不再 400
  {
    const store = new Map<string, { id: string; systemPrompt: string }>();
    const counters = { created: 0, ensured: 0, ran: 0 };
    const res = await internals.handleVisualBuilder(fakeUser, validBody(), makeStatefulDeps(store, counters));
    const out = (await res.json()) as VisualBuilderOutput;
    ok(res.status === 200, "seed-missing: 200（不再 400）");
    ok(out.status === "completed", "seed-missing: completed");
    ok(counters.created === 1, "seed-missing: 触发了一次 seed 创建");
    ok(counters.ensured === 1 && counters.ran === 1, "seed-missing: 先 ensure 再 dry-run");
  }

  // 12. seed 失败：明确错误，不调用 dry-run，不写 SkillExecution
  {
    const store = new Map<string, { id: string; systemPrompt: string }>();
    const counters = { created: 0, ensured: 0, ran: 0 };
    captured.value = null;
    const res = await internals.handleVisualBuilder(
      fakeUser,
      validBody(),
      makeStatefulDeps(store, counters, { failSeed: true }),
    );
    ok(res.status === 503, "seed-fail: 返回明确错误 503");
    ok(counters.ran === 0, "seed-fail: 未调用 dry-run（不写 SkillExecution）");
    ok(captured.value === null, "seed-fail: service 未被触达");
    const out = (await res.json()) as { error?: string; status?: string };
    ok(out.status !== "completed", "seed-fail: 不误报 completed");
  }

  // 13. 幂等性：连续两次合法请求不重复创建
  {
    const store = new Map<string, { id: string; systemPrompt: string }>();
    const counters = { created: 0, ensured: 0, ran: 0 };
    const deps = makeStatefulDeps(store, counters);
    await internals.handleVisualBuilder(fakeUser, validBody(), deps);
    await internals.handleVisualBuilder(fakeUser, validBody(), deps);
    ok(counters.ensured === 2, "idempotent: 两次都执行 ensure");
    ok(counters.created === 1, "idempotent: 只创建一次，不重复");
    ok(store.size === 1, "idempotent: store 只有一条记录");
  }

  // 14. 不覆盖已有自定义 prompt
  {
    const store = new Map<string, { id: string; systemPrompt: string }>();
    store.set("org_real:product-visual-builder", { id: "skill_custom", systemPrompt: "USER_EDITED" });
    const counters = { created: 0, ensured: 0, ran: 0 };
    const deps = makeStatefulDeps(store, counters);
    await internals.handleVisualBuilder(fakeUser, validBody(), deps);
    await internals.handleVisualBuilder(fakeUser, validBody(), deps);
    ok(store.get("org_real:product-visual-builder")?.systemPrompt === "USER_EDITED", "no-overwrite: 自定义 prompt 未被重置");
    ok(counters.created === 0, "no-overwrite: 未创建新记录");
  }

  // 15. 默认请求 → options 为 dry-run（dryRun=true, generateEnabled=false）
  {
    captured.value = null;
    await internals.handleVisualBuilder(fakeUser, validBody(), makeDeps());
    const cap15 = captured.value as { options: RunOptions } | null;
    ok(cap15?.options.dryRun === true, "options: 默认 dryRun=true");
    ok(cap15?.options.generateEnabled === false, "options: 默认 generateEnabled=false");
  }

  // 16. generateEnabled=true 且 dryRun=false → 透传 options 给 service
  {
    captured.value = null;
    const res = await internals.handleVisualBuilder(
      fakeUser,
      validBody({ generateEnabled: true, dryRun: false, imageSize: "1024x1536" }),
      makeDeps(),
    );
    ok(res.status === 200, "generate: 200");
    const cap16 = captured.value as { options: RunOptions } | null;
    ok(cap16?.options.generateEnabled === true, "generate: generateEnabled=true 透传");
    ok(cap16?.options.dryRun === false, "generate: dryRun=false 透传");
    ok(cap16?.options.imageSize === "1024x1536", "generate: imageSize 透传");
  }

  // 17. 非法 imageSize → 400
  {
    const res = await internals.handleVisualBuilder(
      fakeUser,
      validBody({ imageSize: "999x999" }),
      makeDeps(),
    );
    ok(res.status === 400, "imageSize: 非法 → 400");
  }

  // 18. service 错误码映射
  {
    const cases: { code: string; status: number; label: string }[] = [
      { code: "VPB_SOURCE_INVALID", status: 400, label: "SOURCE_INVALID→400" },
      { code: "VPB_IMAGE_FAILED", status: 502, label: "IMAGE_FAILED→502" },
      { code: "VPB_UPLOAD_FAILED", status: 502, label: "UPLOAD_FAILED→502" },
      { code: "VPB_EXEC_UPDATE_FAILED", status: 500, label: "EXEC_UPDATE_FAILED→500" },
    ];
    for (const c of cases) {
      const res = await internals.handleVisualBuilder(
        fakeUser,
        validBody({ generateEnabled: true, dryRun: false }),
        makeDeps({
          runVisualBuilder: async () => {
            throw new Error(`${c.code}: 底层细节 sk-secret prompt......`);
          },
        }),
      );
      ok(res.status === c.status, `error-map: ${c.label}`);
      const out = (await res.json()) as { error?: string };
      ok(!String(out.error).includes("sk-secret"), `error-map: ${c.label} 不泄露底层细节`);
    }
  }

  console.log(`product-visual-builder route: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
