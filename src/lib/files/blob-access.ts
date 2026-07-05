/**
 * 统一 Blob 访问层（B1 — Blob 私有化轨道）
 *
 * 目标：全库 Blob 读写收敛到这里，上传一律 private，浏览器读图走
 * /api/files/[...path] 代理（按路径前缀鉴权），服务端读字节走 readBlobBuffer。
 *
 * 路径前缀约定（7 套，历史沿用，不改变既有 pathname 结构）：
 * - visualizer/sessions/{sessionId}/...   → session scope 校验
 * - visualizer/catalog/{orgId}/...        → org 成员校验
 * - visual-builder/{orgId}/...            → org 成员校验
 * - projects/{projectId}/...              → 项目读权限
 * - trade-service/{orgId}/...             → org 成员校验
 * - trade/intelligence/{orgId}/...        → org 成员校验
 * - temp/brochures/...                    → 登录即可（临时画册 PDF）
 *
 * 迁移期兼容：历史对象仍是 public，readBlob 先按 private 读，
 * 失败回退 public 读；B4 迁移完成后回退分支自然不再命中。
 */

import { put, get, del } from "@vercel/blob";

export const FILE_PROXY_PREFIX = "/api/files/";

export interface PutPrivateBlobArgs {
  pathname: string;
  body: Buffer | ArrayBuffer | ReadableStream | Blob | string;
  contentType?: string;
}

export interface PutPrivateBlobResult {
  /** Blob 存储原始 URL（私有对象需鉴权，不可直接给浏览器） */
  url: string;
  pathname: string;
  /** 给浏览器用的代理 URL（登录 + 前缀鉴权后流式转发） */
  proxyUrl: string;
}

/** 上传私有 Blob（统一入口；新代码不要再直接 import @vercel/blob 的 put）。 */
export async function putPrivateBlob(
  args: PutPrivateBlobArgs,
): Promise<PutPrivateBlobResult> {
  const blob = await put(args.pathname, args.body, {
    access: "private",
    contentType: args.contentType,
  });
  return {
    url: blob.url,
    pathname: args.pathname,
    proxyUrl: toProxyUrl(args.pathname),
  };
}

/** 删除 Blob（按 URL 或 pathname）。 */
export async function deleteBlob(urlOrPathname: string): Promise<void> {
  await del(urlOrPathname);
}

/**
 * 从 Blob 完整 URL 提取 pathname（去掉 store host 与查询串）。
 * 传入已是 pathname 时原样返回（去掉开头的 /）。
 */
export function blobPathnameFromUrl(urlOrPathname: string): string {
  if (!/^https?:\/\//i.test(urlOrPathname)) {
    return urlOrPathname.replace(/^\/+/, "");
  }
  try {
    const u = new URL(urlOrPathname);
    return decodeURIComponent(u.pathname.replace(/^\/+/, ""));
  } catch {
    return urlOrPathname.replace(/^\/+/, "");
  }
}

/** 存储 URL / pathname → 浏览器可用的代理 URL。 */
export function toProxyUrl(urlOrPathname: string): string {
  const pathname = blobPathnameFromUrl(urlOrPathname);
  const encoded = pathname
    .split("/")
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  return `${FILE_PROXY_PREFIX}${encoded}`;
}

/** 判断一个 URL 是否已是本系统代理 URL（避免重复包装）。 */
export function isProxyUrl(url: string): boolean {
  return url.startsWith(FILE_PROXY_PREFIX);
}

export interface BlobStreamResult {
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  size: number | null;
}

/**
 * 服务端读 Blob（流式）。
 * 先按 private 读；对象不存在或仍是历史 public 对象时回退 public 读。
 */
export async function readBlobStream(
  urlOrPathname: string,
): Promise<BlobStreamResult | null> {
  const target = urlOrPathname;

  const tryRead = async (access: "private" | "public") => {
    try {
      const res = await get(target, { access });
      if (res && res.statusCode === 200 && res.stream) {
        return {
          stream: res.stream,
          contentType: res.blob.contentType || "application/octet-stream",
          size: res.blob.size ?? null,
        };
      }
      return null;
    } catch {
      return null;
    }
  };

  return (await tryRead("private")) ?? (await tryRead("public"));
}

/** 服务端读 Blob 全量字节（微信出站 / 文档解析 / Vision base64 用）。 */
export async function readBlobBuffer(
  urlOrPathname: string,
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const res = await readBlobStream(urlOrPathname);
  if (!res) return null;
  const chunks: Uint8Array[] = [];
  const reader = res.stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return { buffer: Buffer.concat(chunks), contentType: res.contentType };
}
