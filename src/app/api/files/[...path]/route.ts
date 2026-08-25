/**
 * GET /api/files/[...path] — 私有 Blob 统一读取代理（B1）
 *
 * 浏览器不再直接访问 Blob 存储 URL；一律经本代理按路径前缀鉴权后流式转发：
 * - visual-builder/{orgId}/...          → org 成员
 * - product-content/{orgId}/...         → org 成员
 * - wechat-visualizer/{orgId}/...       → org 成员
 * - trade-service/{orgId}/...           → org 成员
 * - trade/intelligence/{orgId}/...      → org 成员
 * - visualizer/catalog/{orgId}/...      → org 成员
 * - visualizer/sessions/{sessionId}/... → session 可见性（创建人/负责人/客户创建人/admin）
 * - visualizer/templates/...            → 登录即可（平台 AI 标准安装模板底图）
 * - projects/{projectId}/...            → 项目读权限
 * - temp/brochures/...                  → 登录即可（临时画册）
 *
 * 未匹配任何已知前缀的路径一律 404（不暴露存储结构）。
 * 公开分享页（无登录）不走本代理，走 /api/visualizer/share/[token]/assets。
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import type { AuthUser } from "@/lib/auth";
import { getOrgMembership } from "@/lib/auth";
import { isAdmin } from "@/lib/rbac/roles";
import { db } from "@/lib/db";
import {
  canSeeVisualizerSession,
  SESSION_ACCESS_SELECT,
} from "@/lib/visualizer/access";
import { requireProjectReadAccess } from "@/lib/projects/access";
import { readBlobStream } from "@/lib/files/blob-access";

const notFound = () => NextResponse.json({ error: "文件不存在" }, { status: 404 });
const forbidden = () => NextResponse.json({ error: "无权访问该文件" }, { status: 403 });

async function hasOrgAccess(user: AuthUser, orgId: string): Promise<boolean> {
  if (!orgId) return false;
  if (isAdmin(user.role)) return true;
  const m = await getOrgMembership(user.id, orgId);
  return m?.status === "active";
}

/**
 * 按前缀鉴权。返回：
 * - "ok" 放行；"forbidden" 403；"unknown" 未知前缀（404）
 */
async function authorizeBlobPath(
  request: NextRequest,
  user: AuthUser,
  segments: string[],
): Promise<"ok" | "forbidden" | "unknown"> {
  const [head, second, third] = segments;

  switch (head) {
    case "visual-builder":
    case "product-content":
    case "wechat-visualizer":
    case "trade-service": {
      if (!second) return "unknown";
      return (await hasOrgAccess(user, second)) ? "ok" : "forbidden";
    }
    case "trade": {
      if (second !== "intelligence" || !third) return "unknown";
      return (await hasOrgAccess(user, third)) ? "ok" : "forbidden";
    }
    case "visualizer": {
      if (second === "catalog") {
        if (!third) return "unknown";
        return (await hasOrgAccess(user, third)) ? "ok" : "forbidden";
      }
      if (second === "sessions") {
        if (!third) return "unknown";
        const session = await db.visualizerSession.findUnique({
          where: { id: third },
          select: SESSION_ACCESS_SELECT,
        });
        if (!session) return "forbidden";
        return canSeeVisualizerSession(session, user) ? "ok" : "forbidden";
      }
      // 平台标准安装模板底图：无组织敏感数据，登录即可读
      if (second === "templates") {
        return segments.length >= 3 ? "ok" : "unknown";
      }
      return "unknown";
    }
    case "projects": {
      if (!second) return "unknown";
      const access = await requireProjectReadAccess(request, second);
      return access instanceof NextResponse ? "forbidden" : "ok";
    }
    case "temp": {
      // 临时画册 PDF：登录即可（生命周期短，不含跨组织敏感数据）
      return second === "brochures" ? "ok" : "unknown";
    }
    default:
      return "unknown";
  }
}

export const GET = withAuth<{ path: string[] }>(async (request, ctx, user) => {
  const params = await ctx.params;
  const raw = params.path;
  const segments = (Array.isArray(raw) ? raw : [raw])
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .map((s) => decodeURIComponent(s));

  // 拒绝路径穿越 / 空路径
  if (segments.length === 0 || segments.some((s) => s === "." || s === "..")) {
    return notFound();
  }

  const verdict = await authorizeBlobPath(request, user, segments);
  if (verdict === "unknown") return notFound();
  if (verdict === "forbidden") return forbidden();

  const pathname = segments.join("/");
  const blob = await readBlobStream(pathname);
  if (!blob) return notFound();

  const wantDownload = request.nextUrl.searchParams.get("download") === "1";
  const filenameHint =
    request.nextUrl.searchParams.get("filename") ||
    segments[segments.length - 1] ||
    "download";
  // 去掉路径里的时间戳前缀噪音，保留可读文件名
  const safeName = filenameHint.replace(/[^\w.\u4e00-\u9fff\-()+ ]+/g, "_");

  const headers = new Headers({
    "Content-Type": blob.contentType,
    // 私有内容：仅浏览器本地缓存，短 TTL；文件按 pathname 带时间戳，实际不可变
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  });
  // 不手设 Content-Length：@vercel/blob get() 的 size 取自上游 content-length，
  // ① 上游分块/压缩传输时缺失 → SDK 报 0 → 客户端按 0 截断（生产实测：下载全部 0 字节）；
  // ② 即使非 0 也是压缩后长度，流吐的是解压字节 → 长度不符仍会截断。交给运行时 chunked 编码。
  if (wantDownload) {
    headers.set(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}`,
    );
  }

  return new NextResponse(blob.stream, { status: 200, headers });
});
