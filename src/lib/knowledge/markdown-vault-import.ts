/**
 * Markdown / Obsidian vault 风格导入（平台边缘能力）
 * - 人在 Obsidian 起草 → 导出 md/zip → 写入青砚组织知识（org 隔离）
 * - 不双向同步；青砚仍是组织知识真相源
 */

import { unzipSync, strFromU8 } from "fflate";

export const VAULT_TEXT_EXTENSIONS = new Set(["md", "mdx", "txt", "markdown"]);

export interface VaultFileInput {
  /** 相对路径，如 product/zebra-blinds.md */
  path: string;
  content: string;
}

export interface ParsedVaultDocument {
  title: string;
  content: string;
  category: string;
  tags: string;
  language: string;
  sourcePath: string;
}

export interface ParseVaultOptions {
  defaultCategory?: string;
  defaultLanguage?: string;
  maxFiles?: number;
  maxContentChars?: number;
}

const CATEGORY_ALIASES: Record<string, string> = {
  general: "general",
  通用: "general",
  product: "product",
  products: "product",
  产品: "product",
  faq: "faq",
  faqs: "faq",
  常见问题: "faq",
  case: "case_study",
  cases: "case_study",
  case_study: "case_study",
  案例: "case_study",
  成功案例: "case_study",
  certification: "certification",
  certifications: "certification",
  认证: "certification",
  资质: "certification",
  process: "process",
  processes: "process",
  工艺: "process",
  生产工艺: "process",
  sop: "process",
};

function normalizePath(raw: string): string | null {
  const cleaned = raw.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!cleaned || cleaned.includes("\0")) return null;
  const parts = cleaned.split("/").filter(Boolean);
  if (parts.some((part) => part === ".." || part === ".")) return null;
  // 跳过 Obsidian / 系统垃圾
  if (parts.some((part) => part === ".obsidian" || part === ".git" || part === "__MACOSX")) {
    return null;
  }
  if (parts[parts.length - 1]?.startsWith(".")) return null;
  return parts.join("/");
}

function extOf(path: string): string {
  const base = path.split("/").pop() || "";
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
}

function stripExtension(filename: string): string {
  return filename.replace(/\.(md|mdx|txt|markdown)$/i, "");
}

/** 解析可选 YAML frontmatter */
export function splitFrontmatter(raw: string): {
  body: string;
  meta: Record<string, string>;
} {
  const text = raw.replace(/^\uFEFF/, "");
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) {
    return { body: text.trim(), meta: {} };
  }
  const end = text.indexOf("\n---", 3);
  if (end < 0) return { body: text.trim(), meta: {} };
  const header = text.slice(4, end).trim();
  const body = text.slice(end + 4).replace(/^\r?\n/, "").trim();
  const meta: Record<string, string> = {};
  for (const line of header.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!match) continue;
    const key = match[1]!.toLowerCase();
    let value = match[2]!.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    meta[key] = value;
  }
  return { body, meta };
}

function inferCategory(path: string, meta: Record<string, string>, fallback: string): string {
  const fromMeta = (meta.category || meta.type || "").trim().toLowerCase();
  if (fromMeta && CATEGORY_ALIASES[fromMeta]) return CATEGORY_ALIASES[fromMeta];
  if (fromMeta) return fromMeta.slice(0, 40);

  const folder = path.includes("/")
    ? path.split("/")[0]!.toLowerCase()
    : "";
  if (folder && CATEGORY_ALIASES[folder]) return CATEGORY_ALIASES[folder];
  return fallback;
}

export function parseVaultDocument(
  file: VaultFileInput,
  options: ParseVaultOptions = {},
): ParsedVaultDocument | null {
  const path = normalizePath(file.path);
  if (!path) return null;
  if (!VAULT_TEXT_EXTENSIONS.has(extOf(path))) return null;

  const maxChars = options.maxContentChars ?? 50_000;
  const { body, meta } = splitFrontmatter(file.content);
  if (!body.trim()) return null;

  const filename = path.split("/").pop() || path;
  const title = (meta.title || stripExtension(filename)).trim().slice(0, 200);
  if (!title) return null;

  const tagsRaw = meta.tags || meta.tag || "";
  const tags = tagsRaw
    .replace(/^\[|\]$/g, "")
    .split(/[,，]/)
    .map((t) => t.trim())
    .filter(Boolean)
    .join(",");

  return {
    title,
    content: body.slice(0, maxChars),
    category: inferCategory(path, meta, options.defaultCategory || "product"),
    tags,
    language: (meta.language || options.defaultLanguage || "zh").slice(0, 10),
    sourcePath: path,
  };
}

export function parseVaultFiles(
  files: VaultFileInput[],
  options: ParseVaultOptions = {},
): { documents: ParsedVaultDocument[]; skipped: string[] } {
  const maxFiles = options.maxFiles ?? 200;
  const documents: ParsedVaultDocument[] = [];
  const skipped: string[] = [];

  for (const file of files.slice(0, maxFiles)) {
    const doc = parseVaultDocument(file, options);
    if (!doc) {
      skipped.push(file.path);
      continue;
    }
    documents.push(doc);
  }
  if (files.length > maxFiles) {
    skipped.push(`…另有 ${files.length - maxFiles} 个文件因数量上限未处理`);
  }
  return { documents, skipped };
}

/** 从 ZIP buffer 抽出文本文件（防 zip-slip） */
export function extractTextFilesFromZip(
  buffer: Uint8Array,
  options: { maxEntries?: number; maxTotalBytes?: number } = {},
): VaultFileInput[] {
  const maxEntries = options.maxEntries ?? 300;
  const maxTotalBytes = options.maxTotalBytes ?? 8 * 1024 * 1024;
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(buffer, { filter: (file) => !file.name.endsWith("/") });
  } catch {
    throw new Error("ZIP 无法解压或已损坏");
  }

  const files: VaultFileInput[] = [];
  let total = 0;
  const names = Object.keys(unzipped).slice(0, maxEntries);
  for (const name of names) {
    const path = normalizePath(name);
    if (!path) continue;
    if (!VAULT_TEXT_EXTENSIONS.has(extOf(path))) continue;
    const data = unzipped[name];
    if (!data) continue;
    total += data.byteLength;
    if (total > maxTotalBytes) {
      throw new Error(`ZIP 内文本总大小超过 ${Math.round(maxTotalBytes / 1024 / 1024)}MB`);
    }
    files.push({ path, content: strFromU8(data) });
  }
  return files;
}
