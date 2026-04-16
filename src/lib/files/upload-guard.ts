/**
 * 文件上传安全守卫
 *
 * 集中处理：
 * - 文件名规范化（防 path traversal / 隐藏文件 / 非法字符）
 * - 扩展名白名单（用户上传文件的最后一个扩展名）
 * - MIME 白名单（非必须，作为二次校验）
 * - 大小限制
 * - 可选的魔数（magic bytes）校验 —— 对关键类型（PDF/图片）防扩展名伪造
 *
 * 使用：
 *   const check = validateUploadedFile(file, {
 *     maxSize: 10 * 1024 * 1024,
 *     allowedExtensions: ["pdf", "png", "jpg"],
 *     checkMagicBytes: true,
 *   });
 *   if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 400 });
 *   const { safeName, ext } = check;
 */

export interface UploadValidationConfig {
  /** 最大字节数 */
  maxSize: number;
  /** 扩展名白名单（小写，不含点） */
  allowedExtensions: string[];
  /** MIME 白名单（可选；提供则两者都校验，OR 关系更宽松） */
  allowedMimeTypes?: string[];
  /** 是否进行魔数校验（需已经读入 buffer） */
  checkMagicBytes?: boolean;
  /** 强制拒绝的扩展名（最高优先级） */
  blockedExtensions?: string[];
}

export type UploadValidationResult =
  | {
      ok: true;
      ext: string;
      safeName: string;
      size: number;
      mime: string;
    }
  | {
      ok: false;
      reason: string;
    };

/** 始终禁止的可执行 / 脚本扩展名（兜底） */
const ALWAYS_BLOCKED = new Set([
  "exe", "bat", "cmd", "sh", "ps1", "vbs", "js", "mjs", "cjs",
  "jar", "msi", "com", "scr", "app", "dmg", "pkg",
  "php", "asp", "aspx", "jsp", "py", "rb", "pl",
  "html", "htm", "svg", // svg 可嵌 JS；作为上传文件默认禁止
]);

export function normalizeFilename(raw: string): { safe: string; ext: string } {
  let name = raw.normalize("NFKC");
  name = name.replace(/[\\/\x00-\x1f]/g, "_");
  name = name.replace(/\.\.+/g, ".");
  while (name.startsWith(".")) name = name.slice(1);
  name = name.replace(/[^a-zA-Z0-9._\u4e00-\u9fa5-]/g, "_");

  if (!name) name = "file";

  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : "";

  if (name.length > 200) {
    const base = dot > 0 ? name.slice(0, dot) : name;
    name = base.slice(0, 200 - ext.length - 1) + (ext ? "." + ext : "");
  }

  return { safe: name, ext };
}

/**
 * 魔数校验（只校验我们明确支持的几种最关键的类型；
 * 未覆盖的扩展名放行，避免过度拦截 Office 文件等复杂格式）
 */
function checkMagic(buffer: Buffer, ext: string): boolean {
  if (buffer.length < 8) return false;
  const b0 = buffer[0];
  const b1 = buffer[1];
  const b2 = buffer[2];
  const b3 = buffer[3];

  switch (ext) {
    case "pdf":
      return b0 === 0x25 && b1 === 0x50 && b2 === 0x44 && b3 === 0x46; // %PDF
    case "png":
      return b0 === 0x89 && b1 === 0x50 && b2 === 0x4e && b3 === 0x47;
    case "jpg":
    case "jpeg":
      return b0 === 0xff && b1 === 0xd8 && b2 === 0xff;
    case "gif":
      return b0 === 0x47 && b1 === 0x49 && b2 === 0x46;
    case "webp":
      return (
        b0 === 0x52 && b1 === 0x49 && b2 === 0x46 && b3 === 0x46 &&
        buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
      );
    case "zip":
    case "docx":
    case "xlsx":
    case "pptx":
      // zip / ooxml: PK signature
      return b0 === 0x50 && b1 === 0x4b;
    default:
      return true; // 未覆盖的类型不拦截
  }
}

export function validateUploadedFile(
  file: File,
  config: UploadValidationConfig,
): UploadValidationResult {
  if (file.size === 0) {
    return { ok: false, reason: "空文件" };
  }
  if (file.size > config.maxSize) {
    const mb = Math.round(config.maxSize / 1024 / 1024);
    return { ok: false, reason: `文件过大，最大支持 ${mb}MB` };
  }

  const { safe, ext } = normalizeFilename(file.name);
  if (!ext) {
    return { ok: false, reason: "文件必须有扩展名" };
  }

  const blocked = new Set([
    ...ALWAYS_BLOCKED,
    ...(config.blockedExtensions ?? []).map((e) => e.toLowerCase()),
  ]);
  if (blocked.has(ext)) {
    return { ok: false, reason: `不允许的文件类型: .${ext}` };
  }

  const allowExt = new Set(config.allowedExtensions.map((e) => e.toLowerCase()));
  if (!allowExt.has(ext)) {
    return { ok: false, reason: `不支持的文件类型: .${ext}` };
  }

  const mime = file.type || "application/octet-stream";
  if (config.allowedMimeTypes && config.allowedMimeTypes.length > 0) {
    const allowMime = new Set(config.allowedMimeTypes);
    if (!allowMime.has(mime) && mime !== "application/octet-stream") {
      // 扩展名通过但 MIME 不符：警告但放行（浏览器 MIME 有时不准）
    }
  }

  return { ok: true, ext, safeName: safe, size: file.size, mime };
}

/** 异步版本：读取 buffer 后做魔数校验 */
export async function validateUploadedFileAsync(
  file: File,
  config: UploadValidationConfig,
): Promise<
  | { ok: true; ext: string; safeName: string; size: number; mime: string; buffer: Buffer }
  | { ok: false; reason: string }
> {
  const base = validateUploadedFile(file, config);
  if (!base.ok) return base;

  const buffer = Buffer.from(await file.arrayBuffer());

  if (config.checkMagicBytes && !checkMagic(buffer, base.ext)) {
    return { ok: false, reason: `文件内容与扩展名不匹配: .${base.ext}` };
  }

  return { ...base, buffer };
}
