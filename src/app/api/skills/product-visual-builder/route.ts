/**
 * POST /api/skills/product-visual-builder — 产品视觉素材生成
 *
 * 链路：session/auth → org membership 校验 → customerId/projectId 归属校验
 *      → 幂等 ensure seed → runProductVisualBuilder → SkillExecution → AuditLog。
 *
 * 默认仍 dry-run（dryRun=true, generateEnabled=false）：model="dry-run"、outputImageUrls=[]。
 * 仅当显式传 generateEnabled=true 且 dryRun=false 时才真实出图（接 image-client + Blob）。
 *
 * 鉴权复用项目统一方式：withAuth（401/停用 403/500 由其统一处理）+ 取用户首个 active org。
 *
 * 安全：
 * - 不信任 body.orgId / body.userId；一律用 session 的 user.id 与服务端解析的 orgId 覆盖。
 * - customerId / projectId 必须属于当前 org，否则 403。
 * - AuditLog 由 service 写入，本 route 不重复写事件；错误响应不泄露堆栈 / prompt / key。
 */

import { NextResponse } from "next/server";
import { withAuth, safeParseBody } from "@/lib/common/api-helpers";
import type { AuthUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { seedBuiltinSkills } from "@/lib/agent-core/skills/seed";
import {
  runProductVisualBuilder,
  PRODUCT_VISUAL_BUILDER_SLUG,
  VPB_ERRORS,
  type VisualBuilderRunOptions,
} from "@/lib/skills/product-visual-builder/service";
import type { VisualImageSize } from "@/lib/skills/product-visual-builder/image-client";
import type {
  ProductType,
  VisualBuilderInput,
  VisualBuilderOutput,
  VisualLanguage,
  VisualStyle,
  VisualUseCase,
} from "@/lib/skills/product-visual-builder/types";

const IMAGE_SIZES: VisualImageSize[] = ["1024x1024", "1024x1536", "1536x1024"];

const PRODUCT_TYPES: ProductType[] = ["blanket", "bathrobe", "pillow", "other"];
const USE_CASES: VisualUseCase[] = [
  "website",
  "catalog",
  "quote_attachment",
  "whatsapp_sales",
  "internal_review",
];
const STYLES: VisualStyle[] = [
  "warm_home",
  "hotel",
  "white_background",
  "spec_sheet",
  "ecommerce",
];
const LANGUAGES: VisualLanguage[] = ["en", "zh", "bilingual"];

/** 校验后的输入（已剔除不可信的 orgId / userId，由服务端注入）。 */
type ValidatedInput = Omit<VisualBuilderInput, "orgId" | "userId">;

type ValidationResult =
  | { ok: true; value: ValidatedInput }
  | { ok: false; error: string };

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** 轻量校验（不引入 Zod，对齐项目现状）。 */
function validateBody(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "请求体格式错误" };
  }
  const b = raw as Record<string, unknown>;

  if (!PRODUCT_TYPES.includes(b.productType as ProductType)) {
    return { ok: false, error: `productType 必须是 ${PRODUCT_TYPES.join(" / ")}` };
  }
  if (!isNonEmptyString(b.productName)) {
    return { ok: false, error: "productName 必须是非空字符串" };
  }
  if (!USE_CASES.includes(b.useCase as VisualUseCase)) {
    return { ok: false, error: `useCase 必须是 ${USE_CASES.join(" / ")}` };
  }
  if (!STYLES.includes(b.style as VisualStyle)) {
    return { ok: false, error: `style 必须是 ${STYLES.join(" / ")}` };
  }
  if (
    !Array.isArray(b.sourceImageUrls) ||
    b.sourceImageUrls.length < 1 ||
    !b.sourceImageUrls.every((u) => isNonEmptyString(u))
  ) {
    return { ok: false, error: "sourceImageUrls 必须是至少 1 个非空字符串的数组" };
  }
  const language: VisualLanguage = LANGUAGES.includes(b.language as VisualLanguage)
    ? (b.language as VisualLanguage)
    : "en";

  const value: ValidatedInput = {
    productType: b.productType as ProductType,
    productName: (b.productName as string).trim(),
    useCase: b.useCase as VisualUseCase,
    style: b.style as VisualStyle,
    sourceImageUrls: b.sourceImageUrls as string[],
    language,
  };

  // 可选字段（存在才带上，不做深校验，留待后续阶段）
  if (Array.isArray(b.sourceImageRoles)) {
    value.sourceImageRoles = b.sourceImageRoles as ValidatedInput["sourceImageRoles"];
  }
  if (b.productFacts && typeof b.productFacts === "object") {
    value.productFacts = b.productFacts as ValidatedInput["productFacts"];
  }
  if (Array.isArray(b.certifications)) {
    value.certifications = b.certifications as ValidatedInput["certifications"];
  }
  if (b.constraints && typeof b.constraints === "object") {
    value.constraints = b.constraints as ValidatedInput["constraints"];
  }
  if (isNonEmptyString(b.customerId)) value.customerId = b.customerId as string;
  if (isNonEmptyString(b.projectId)) value.projectId = b.projectId as string;
  if (isNonEmptyString(b.departmentTag)) value.departmentTag = b.departmentTag as string;

  return { ok: true, value };
}

type ParsedOptions =
  | { ok: true; value: VisualBuilderRunOptions }
  | { ok: false; error: string };

/** 解析运行选项；默认 dry-run（dryRun=true, generateEnabled=false）。 */
function parseOptions(raw: unknown): ParsedOptions {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const dryRun = b.dryRun === undefined ? true : b.dryRun === true;
  const generateEnabled = b.generateEnabled === true;

  let imageSize: VisualImageSize | undefined;
  if (b.imageSize !== undefined) {
    if (!IMAGE_SIZES.includes(b.imageSize as VisualImageSize)) {
      return { ok: false, error: `imageSize 必须是 ${IMAGE_SIZES.join(" / ")}` };
    }
    imageSize = b.imageSize as VisualImageSize;
  }

  return { ok: true, value: { dryRun, generateEnabled, imageSize } };
}

/** 可注入依赖；默认实现绑定真实 db / service。 */
interface RouteDeps {
  resolveOrgId: (userId: string) => Promise<string | null>;
  /** 幂等确保本 org 的内置技能已 seed（复用 seedBuiltinSkills，不写第二套数据）。 */
  ensureBuiltinSkills: (orgId: string) => Promise<void>;
  customerInOrg: (customerId: string, orgId: string) => Promise<boolean>;
  projectInOrg: (projectId: string, orgId: string) => Promise<boolean>;
  runVisualBuilder: (params: {
    orgId: string;
    userId: string;
    input: VisualBuilderInput;
    options: VisualBuilderRunOptions;
  }) => Promise<VisualBuilderOutput>;
}

const realDeps: RouteDeps = {
  resolveOrgId: async (userId) => {
    const m = await db.organizationMember.findFirst({
      where: { userId, status: "active" },
      select: { orgId: true },
    });
    return m?.orgId ?? null;
  },
  // 幂等：seedBuiltinSkills 内部按 @@unique([orgId, slug]) 逐个 findUnique，
  // 已存在则跳过、只创建缺失项，从不 update，不会覆盖用户改过的 prompt。
  ensureBuiltinSkills: async (orgId) => {
    await seedBuiltinSkills(orgId);
  },
  customerInOrg: async (customerId, orgId) => {
    const c = await db.salesCustomer.findFirst({
      where: { id: customerId, orgId },
      select: { id: true },
    });
    return Boolean(c);
  },
  projectInOrg: async (projectId, orgId) => {
    const p = await db.project.findFirst({
      where: { id: projectId, orgId },
      select: { id: true },
    });
    return Boolean(p);
  },
  runVisualBuilder: runProductVisualBuilder,
};

/** 把 service 抛出的错误映射为干净的状态码与公开文案（不泄露 prompt / key / 堆栈）。 */
function mapServiceError(msg: string): { status: number; error: string } | null {
  if (msg.includes(PRODUCT_VISUAL_BUILDER_SLUG) || msg.includes(VPB_ERRORS.SKILL_MISSING)) {
    return {
      status: 400,
      error: "产品视觉技能未初始化，请先初始化组织内置技能（seed builtin skills）",
    };
  }
  if (msg.includes(VPB_ERRORS.SOURCE_INVALID)) {
    return { status: 400, error: "sourceImageUrls 非法：必须是本组织 upload API 返回的图片地址" };
  }
  if (msg.includes(VPB_ERRORS.IMAGE_FAILED)) {
    return { status: 502, error: "图片生成失败，请稍后重试" };
  }
  if (msg.includes(VPB_ERRORS.UPLOAD_FAILED)) {
    return { status: 502, error: "图片存储失败，请稍后重试" };
  }
  if (msg.includes(VPB_ERRORS.EXEC_UPDATE_FAILED)) {
    return { status: 500, error: "执行记录更新失败，请稍后重试" };
  }
  return null;
}

/** 核心处理（已通过 withAuth 拿到可信 user）。纯业务分支，便于单测注入。 */
async function handleVisualBuilder(
  user: AuthUser,
  body: unknown,
  deps: RouteDeps,
): Promise<NextResponse> {
  const orgId = await deps.resolveOrgId(user.id);
  if (!orgId) {
    return NextResponse.json({ error: "无组织：当前账号未加入任何组织" }, { status: 403 });
  }

  const v = validateBody(body);
  if (!v.ok) {
    return NextResponse.json({ error: v.error }, { status: 400 });
  }
  const input = v.value;

  const opts = parseOptions(body);
  if (!opts.ok) {
    return NextResponse.json({ error: opts.error }, { status: 400 });
  }

  if (input.customerId && !(await deps.customerInOrg(input.customerId, orgId))) {
    return NextResponse.json({ error: "指定客户不属于当前组织" }, { status: 403 });
  }
  if (input.projectId && !(await deps.projectInOrg(input.projectId, orgId))) {
    return NextResponse.json({ error: "指定项目不属于当前组织" }, { status: 403 });
  }

  // 首访可用性：调用 service 前幂等确保本 org 已 seed 内置技能。
  // seed 失败时直接返回明确错误，不进入 service、不写 SkillExecution、不误报 completed。
  try {
    await deps.ensureBuiltinSkills(orgId);
  } catch {
    return NextResponse.json(
      { error: "技能初始化失败，请稍后重试" },
      { status: 503 },
    );
  }

  try {
    const output = await deps.runVisualBuilder({
      orgId,
      userId: user.id,
      input: { ...input, orgId, userId: user.id },
      options: opts.value,
    });
    return NextResponse.json(output);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    const mapped = mapServiceError(msg);
    if (mapped) {
      return NextResponse.json({ error: mapped.error }, { status: mapped.status });
    }
    throw e; // 交由 withAuth 统一记录并返回 500（不泄露堆栈）
  }
}

export const POST = withAuth(async (request, _ctx, user) => {
  const body = await safeParseBody(request);
  return handleVisualBuilder(user, body, realDeps);
});

// 仅非生产环境暴露内部函数给单元测试（生产/构建时 NODE_ENV=production，不挂载，零泄露）。
if (process.env.NODE_ENV !== "production") {
  (globalThis as { __pvbRouteInternals?: unknown }).__pvbRouteInternals = {
    handleVisualBuilder,
    validateBody,
  };
}
