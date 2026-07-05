/**
 * product-visual-builder source upload API 测试（Phase 1E）
 *
 * 不连接 / 不写 DB；不触真实 Blob 网络（注入假 uploadImage）；不调用图片模型。
 * - 401：直接调真实 POST（无 session → getCurrentUser 返回 null，不触 DB）。
 * - 其余分支：通过非生产环境暴露的内部函数 handleUpload 注入内存假依赖。
 *
 * 运行：npx tsx src/app/api/skills/product-visual-builder/upload/__tests__/route.test.ts
 */
import { NextRequest, NextResponse } from "next/server";
import { POST } from "../route";
import "../route";
import type { AuthUser } from "@/lib/auth";
import {
  buildVisualBuilderBlobPath,
  type UploadImageParams,
  type UploadImageResult,
} from "@/lib/skills/product-visual-builder/storage";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

interface UploadFile {
  name: string;
  type: string;
  size: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
}
interface UploadInputs {
  files: UploadFile[];
  executionId?: string;
  assetRole?: string;
  orgId?: string;
}
type OrgResolution =
  | { ok: true; orgId: string }
  | { ok: false; response: NextResponse };
interface UploadRouteDeps {
  resolveOrg: (
    user: AuthUser,
    requestedOrgId?: string | null,
  ) => Promise<OrgResolution>;
  uploadImage: (params: UploadImageParams) => Promise<UploadImageResult>;
}
type Internals = {
  handleUpload: (user: AuthUser, inputs: UploadInputs, deps: UploadRouteDeps) => Promise<Response>;
};

const internals = (globalThis as { __pvbUploadRouteInternals?: Internals }).__pvbUploadRouteInternals;

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

function fakeFile(name: string, type: string, size: number): UploadFile {
  return {
    name,
    type,
    size,
    arrayBuffer: async () => Buffer.alloc(Math.max(size, 1), 1).buffer,
  };
}

const uploadCalls: UploadImageParams[] = [];

function makeDeps(over: Partial<UploadRouteDeps> = {}): UploadRouteDeps {
  return {
    resolveOrg: async () => ({ ok: true, orgId: "org_real" }),
    // 假上传：不触网络，路径用真实 buildVisualBuilderBlobPath 生成（验证可信 orgId / index 递增）
    uploadImage: async (params) => {
      uploadCalls.push(params);
      const pathname = buildVisualBuilderBlobPath({
        orgId: params.orgId,
        executionId: params.executionId,
        assetRole: params.assetRole,
        index: params.index,
        ext: params.ext,
      });
      return {
        url: `https://blob.test/${pathname}`,
        pathname,
        contentType: params.mimeType,
        sizeBytes: params.buffer?.length,
        dryRun: false,
        accessMode: "private",
      };
    },
    ...over,
  };
}

type UploadResponse = {
  success?: boolean;
  error?: string;
  sourceImageUrls?: string[];
  assets?: Array<{ url: string; pathname: string; assetRole: string; contentType: string; sizeBytes?: number }>;
  publicBlobNotice?: string;
  uploadBatchId?: string;
};

async function main() {
  if (!internals) {
    console.error("  ✗ 无法获取 upload route 内部函数（NODE_ENV 可能为 production）");
    process.exit(1);
  }

  // 1. 未登录 → 401
  {
    const req = new NextRequest("http://localhost/api/skills/product-visual-builder/upload", {
      method: "POST",
    });
    const res = await POST(req, { params: Promise.resolve({}) });
    ok(res.status === 401, "auth: 未登录 → 401");
  }

  // 2. 无 org member → 403
  {
    const res = await internals.handleUpload(
      fakeUser,
      { files: [fakeFile("a.jpg", "image/jpeg", 1024)] },
      makeDeps({
        resolveOrg: async () => ({
          ok: false,
          response: NextResponse.json({ error: "未加入任何组织，无法继续" }, { status: 403 }),
        }),
      }),
    );
    ok(res.status === 403, "member: 非组织成员 → 403");
  }

  // 2b. 多组织未指定 orgId → 400（标准 org 解析语义）
  {
    const res = await internals.handleUpload(
      fakeUser,
      { files: [fakeFile("a.jpg", "image/jpeg", 1024)] },
      makeDeps({
        resolveOrg: async (_user, requestedOrgId) =>
          requestedOrgId
            ? { ok: true, orgId: requestedOrgId }
            : {
                ok: false,
                response: NextResponse.json(
                  { error: "缺少 orgId，或您属于多个组织请在请求中指定 orgId" },
                  { status: 400 },
                ),
              },
      }),
    );
    ok(res.status === 400, "multi-org: 多组织未指定 orgId → 400");
  }

  // 3. 合法 jpg/png/webp 上传 → success + sourceImageUrls + assets
  {
    uploadCalls.length = 0;
    const res = await internals.handleUpload(
      fakeUser,
      {
        executionId: "batch_1",
        files: [
          fakeFile("front.jpg", "image/jpeg", 2048),
          fakeFile("tex.png", "image/png", 4096),
          fakeFile("pack.webp", "image/webp", 8192),
        ],
      },
      makeDeps(),
    );
    ok(res.status === 200, "upload: 200");
    const out = (await res.json()) as UploadResponse;
    ok(out.success === true, "upload: success=true");
    ok((out.sourceImageUrls?.length ?? 0) === 3, "upload: sourceImageUrls 有 3 个");
    ok((out.assets?.length ?? 0) === 3, "upload: assets 有 3 个");
    ok(Boolean(out.assets?.[0]?.pathname), "upload: asset 有 pathname");
    ok(typeof out.publicBlobNotice === "string" && out.publicBlobNotice.length > 0, "upload: 含 publicBlobNotice");
  }

  // 4. 路径使用可信 orgId（客户端 orgId 仅作选择，路径必须用 resolveOrg 校验后的值）
  {
    uploadCalls.length = 0;
    const res = await internals.handleUpload(
      fakeUser,
      { executionId: "batch_x", orgId: "EVIL_ORG", files: [fakeFile("a.jpg", "image/jpeg", 1024)] },
      // resolveOrg 校验后只返回可信 orgId；路径必须用该值
      makeDeps({ resolveOrg: async () => ({ ok: true, orgId: "org_real" }) }),
    );
    const out = (await res.json()) as UploadResponse;
    ok(Boolean(out.assets?.[0]?.pathname.startsWith("visual-builder/org_real/")), "trusted-org: 路径用可信 orgId");
    ok(!JSON.stringify(out).includes("EVIL"), "trusted-org: 无客户端伪造 orgId");
  }

  // 5. 超过 5MB source → 400
  {
    const res = await internals.handleUpload(
      fakeUser,
      { files: [fakeFile("big.jpg", "image/jpeg", 5 * 1024 * 1024 + 1)] },
      makeDeps(),
    );
    ok(res.status === 400, "size: >5MB → 400");
  }

  // 6. 非法 MIME → 400
  {
    for (const mime of ["application/pdf", "image/svg+xml", "text/plain", "application/octet-stream"]) {
      const res = await internals.handleUpload(
        fakeUser,
        { files: [fakeFile("a.png", mime, 1024)] },
        makeDeps(),
      );
      ok(res.status === 400, `mime: 拒绝 ${mime} → 400`);
    }
  }

  // 7. 非法扩展名 → 400
  {
    for (const name of ["a.exe", "a.svg", "a.pdf", "noext"]) {
      const res = await internals.handleUpload(
        fakeUser,
        { files: [fakeFile(name, "image/png", 1024)] },
        makeDeps(),
      );
      ok(res.status === 400, `ext: 拒绝 ${name} → 400`);
    }
  }

  // 8. 空文件 → 400
  {
    const res = await internals.handleUpload(
      fakeUser,
      { files: [fakeFile("a.jpg", "image/jpeg", 0)] },
      makeDeps(),
    );
    ok(res.status === 400, "empty: 空文件 → 400");
  }

  // 9. assetRole 传 generated/spec-sheet/lifestyle → 拒绝（仅允许 source）
  {
    for (const role of ["generated", "spec-sheet", "lifestyle"]) {
      const res = await internals.handleUpload(
        fakeUser,
        { assetRole: role, files: [fakeFile("a.jpg", "image/jpeg", 1024)] },
        makeDeps(),
      );
      ok(res.status === 400, `role: 拒绝 assetRole=${role} → 400`);
    }
  }

  // 10. 多文件 index 递增
  {
    uploadCalls.length = 0;
    await internals.handleUpload(
      fakeUser,
      {
        executionId: "batch_seq",
        files: [
          fakeFile("a.jpg", "image/jpeg", 1024),
          fakeFile("b.png", "image/png", 1024),
          fakeFile("c.webp", "image/webp", 1024),
        ],
      },
      makeDeps(),
    );
    ok(
      uploadCalls.map((c) => c.index).join(",") === "0,1,2",
      "multi: index 递增 0,1,2",
    );
    ok(
      uploadCalls.every((c) => c.assetRole === "source"),
      "multi: 全部 assetRole=source",
    );
  }

  // 11. 文件名注入 → 400（中文 / 空格 / ../ / query / slash）
  {
    for (const name of ["源图.jpg", "a b.jpg", "../e.png", "x.png?y=1"]) {
      const res = await internals.handleUpload(
        fakeUser,
        { files: [fakeFile(name, "image/png", 1024)] },
        makeDeps(),
      );
      ok(res.status === 400, `filename: 拒绝 ${JSON.stringify(name)} → 400`);
    }
  }

  console.log(`product-visual-builder upload route: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
