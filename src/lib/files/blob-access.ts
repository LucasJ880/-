/**
 * 统一 Blob 访问层（B1 — Blob 私有化轨道）
 *
 * 目标：全库 Blob 读写收敛到这里，上传一律 private，浏览器读图走
 * /api/files/[...path] 代理（按路径前缀鉴权），服务端读字节走 readBlobBuffer。
 *
 * 双 store 架构（Vercel Blob 的 store 访问模式创建后不可改，历史 store 是 public）：
 * - 新 private store（BLOB_PRIVATE_READ_WRITE_TOKEN）：所有新上传与私有读取
 * - 旧 public store（BLOB_READ_WRITE_TOKEN）：仅迁移期兼容读取历史对象，
 *   B4 迁移完成后回退分支自然不再命中
 *
 * 路径前缀约定（7 套，历史沿用，不改变既有 pathname 结构）：
 * - visualizer/sessions/{sessionId}/...   → session scope 校验
 * - visualizer/catalog/{orgId}/...        → org 成员校验
 * - visual-builder/{orgId}/...            → org 成员校验
 * - projects/{projectId}/...              → 项目读权限
 * - trade-service/{orgId}/...             → org 成员校验
 * - trade/intelligence/{orgId}/...        → org 成员校验
 * - temp/brochures/...                    → 登录即可（临时画册 PDF）
 */

import { put, get, del } from "@vercel/blob";

export const FILE_PROXY_PREFIX = "/api/files/";

/** private store 的 token；未配置时回退默认 token（本地/测试环境） */
function privateToken(): string | undefined {
  return (
    process.env.BLOB_PRIVATE_READ_WRITE_TOKEN ||
    process.env.BLOB_READ_WRITE_TOKEN
  );
}

/** 旧 public store 的 token（迁移期兼容读取历史对象） */
function legacyToken(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN;
}

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
    token: privateToken(),
  });
  return {
    url: blob.url,
    pathname: args.pathname,
    proxyUrl: toProxyUrl(args.pathname),
  };
}

/** 删除 Blob（按 URL 或 pathname）。双 store 各删一次（del 幂等，不存在不报错）。 */
export async function deleteBlob(urlOrPathname: string): Promise<void> {
  const pathname = blobPathnameFromUrl(urlOrPathname);
  await del(pathname, { token: privateToken() }).catch(() => undefined);
  const legacy = legacyToken();
  if (legacy && legacy !== privateToken()) {
    await del(pathname, { token: legacy }).catch(() => undefined);
  }
}

/**
 * 从「存储的 URL」提取 Blob pathname。
 * 兼容三种历史/现行形态：
 * - Blob 完整 URL（https://xxx.blob.vercel-storage.com/{pathname}）
 * - 代理 URL（/api/files/{pathname}，含带域名的绝对形式）
 * - 纯 pathname
 */
export function blobPathnameFromUrl(urlOrPathname: string): string {
  let path = urlOrPathname;
  if (/^https?:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      // 保底按原字符串处理
    }
  }
  path = path.replace(/^\/+/, "");
  const proxyPrefix = FILE_PROXY_PREFIX.replace(/^\/+/, ""); // "api/files/"
  if (path.startsWith(proxyPrefix)) {
    path = path.slice(proxyPrefix.length);
  }
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
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
 * 先按 private 读新 store（按 pathname）；历史对象未迁移时回退旧 public store。
 */
export async function readBlobStream(
  urlOrPathname: string,
): Promise<BlobStreamResult | null> {
  const pathname = blobPathnameFromUrl(urlOrPathname);

  const tryRead = async (
    target: string,
    access: "private" | "public",
    token: string | undefined,
  ) => {
    try {
      const res = await get(target, { access, token });
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

  return (
    (await tryRead(pathname, "private", privateToken())) ??
    (await tryRead(urlOrPathname, "public", legacyToken())) ??
    (await tryRead(pathname, "public", legacyToken()))
  );
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
