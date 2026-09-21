/**
 * AI 对话附件 — 公共核心（外贸助手 / 主助手 / 项目问青砚 / 收件箱共用）
 *
 * 链路：浏览器把文档交给 /api/ai/upload-file 解析成纯文本（PDF/Word/Excel/CSV/TXT，不落盘），
 * 图片交给 /api/ai/upload-image（或外贸专用 /api/trade/chat/upload-image）：原图存私有 Blob +
 * Vision 识别成文本；发消息时把 { name, kind, size, text, blobPath?, mime? } 随消息提交 →
 * 存进各自消息表的 attachments JSONB → 组装模型输入时按「最新优先」的字符预算展开正文，
 * 超预算的旧附件只留摘要桩；图片标签带 ref，模型可用「重新看图」工具按 ref 看原图。
 *
 * 本文件只有纯函数，不碰 DB / 网络，便于单测。
 */

import { toProxyUrl } from "@/lib/files/blob-url";

/** document = 文档解析文本；image = 图片识别文本（逐字转录 + 画面描述） */
export type ChatAttachmentKind = "document" | "image";

export interface ChatAttachment {
  /** 原文件名（展示 + 模型引用） */
  name: string;
  /** 缺省视为 document（兼容早期数据） */
  kind?: ChatAttachmentKind;
  /** 原文件字节数（仅展示） */
  size: number;
  /** 解析后的文本，≤ MAX_ATTACHMENT_TEXT_CHARS */
  text: string;
  /** 图片原图在私有 Blob 里的 pathname（{root}{orgId}/{userId}/…），追问时重新看图用 */
  blobPath?: string;
  /** 原图 MIME（仅图片） */
  mime?: string;
}

/** 返回给浏览器的形状：不带正文 */
export interface ChatAttachmentSummary {
  name: string;
  kind: ChatAttachmentKind;
  size: number;
  textLength: number;
  /** 图片原图的代理 URL（登录 + org 成员可读），供气泡显示缩略图 */
  fileUrl?: string;
  mime?: string;
}

export const MAX_ATTACHMENTS_PER_MESSAGE = 5;
export const MAX_ATTACHMENT_NAME_CHARS = 200;
/** 与 src/lib/files/parse-buffer.ts 的 MAX_TEXT_LENGTH 对齐 */
export const MAX_ATTACHMENT_TEXT_CHARS = 150_000;
/** 单次模型调用里附件正文的总预算（字符）：预算优先给最新的附件 */
export const ATTACHMENT_PROMPT_BUDGET_CHARS = 60_000;
/** 超预算旧附件桩里保留的开头字符数；剩余预算低于此值时不再零碎展开 */
export const ATTACHMENT_STUB_PREVIEW_CHARS = 300;
export const MAX_ATTACHMENT_BLOB_PATH_CHARS = 400;

/** 图片原图的 Blob 根：按对话产品线分开，便于文件代理按前缀鉴权 */
export const CHAT_BLOB_ROOTS = ["trade-chat/", "ai-chat/"] as const;
export type ChatBlobRoot = (typeof CHAT_BLOB_ROOTS)[number];
export const AI_CHAT_BLOB_ROOT: ChatBlobRoot = "ai-chat/";
export const TRADE_CHAT_BLOB_ROOT: ChatBlobRoot = "trade-chat/";

/** 用户只传附件没打字时，替模型补的指令 */
export const ATTACHMENT_ONLY_PROMPT =
  "（用户没有输入文字，只上传了以下附件。请先概述附件内容与要点，指出值得关注的信息，再问用户想进一步做什么。）";

/** 图片原图的 Blob 路径前缀：按 org + 上传者隔离 */
export function chatImageBlobPrefix(root: ChatBlobRoot, orgId: string, userId: string): string {
  return `${root}${orgId}/${userId}/`;
}

function blobRootOf(blobPath: string): ChatBlobRoot | null {
  for (const root of CHAT_BLOB_ROOTS) {
    if (blobPath.startsWith(root)) return root;
  }
  return null;
}

/** 该 Blob 路径是否属于指定 org（工具重新看图 / 删除前的边界检查） */
export function attachmentBlobPathBelongsTo(blobPath: string, orgId: string): boolean {
  if (!orgId || !blobPath) return false;
  if (blobPath.includes("..") || blobPath.startsWith("/")) return false;
  const root = blobRootOf(blobPath);
  if (!root) return false;
  return blobPath.startsWith(`${root}${orgId}/`);
}

export function attachmentKind(a: { kind?: ChatAttachmentKind }): ChatAttachmentKind {
  return a.kind === "image" ? "image" : "document";
}

export type ParseAttachmentsResult =
  | { ok: true; attachments: ChatAttachment[] }
  | { ok: false; error: string };

/** 校验请求体里的 attachments（来自浏览器，不可信） */
export function parseAttachmentsInput(raw: unknown): ParseAttachmentsResult {
  if (raw === undefined || raw === null) return { ok: true, attachments: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "attachments 必须是数组" };
  if (raw.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    return { ok: false, error: `一条消息最多附 ${MAX_ATTACHMENTS_PER_MESSAGE} 个文件` };
  }
  const attachments: ChatAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return { ok: false, error: "附件格式不正确" };
    const rec = item as Record<string, unknown>;
    const name = typeof rec.name === "string" ? rec.name.trim() : "";
    if (!name) return { ok: false, error: "附件缺少文件名" };
    if (name.length > MAX_ATTACHMENT_NAME_CHARS) {
      return { ok: false, error: `文件名过长：${name.slice(0, 40)}…` };
    }
    const text = typeof rec.text === "string" ? rec.text : "";
    if (!text.trim()) return { ok: false, error: `附件「${name}」没有可分析的文本内容` };
    if (text.length > MAX_ATTACHMENT_TEXT_CHARS) {
      return {
        ok: false,
        error: `附件「${name}」文本过长（上限 ${MAX_ATTACHMENT_TEXT_CHARS} 字符）`,
      };
    }
    const sizeRaw = typeof rec.size === "number" ? rec.size : Number(rec.size);
    const size = Number.isFinite(sizeRaw) && sizeRaw >= 0 ? Math.floor(sizeRaw) : 0;
    const kind: ChatAttachmentKind = rec.kind === "image" ? "image" : "document";
    const entry: ChatAttachment = { name, kind, size, text };
    if (kind === "image") {
      const blobPath = typeof rec.blobPath === "string" ? rec.blobPath.trim() : "";
      if (blobPath) {
        if (
          blobPath.length > MAX_ATTACHMENT_BLOB_PATH_CHARS ||
          !blobRootOf(blobPath) ||
          blobPath.includes("..")
        ) {
          return { ok: false, error: `附件「${name}」的图片路径不合法` };
        }
        entry.blobPath = blobPath;
      }
      const mime = typeof rec.mime === "string" ? rec.mime.trim().toLowerCase() : "";
      if (/^image\/[a-z0-9.+-]+$/.test(mime)) entry.mime = mime;
    }
    attachments.push(entry);
  }
  return { ok: true, attachments };
}

/** 旧客户端只传 fileText/fileName 时，折算成一个文档附件（兼容主助手早期上传） */
export function attachmentsFromLegacyFile(fileText: unknown, fileName: unknown): ChatAttachment[] {
  const text = typeof fileText === "string" ? fileText : "";
  if (!text.trim()) return [];
  const name = (typeof fileName === "string" && fileName.trim()) || "上传文件";
  return [
    {
      name: name.slice(0, MAX_ATTACHMENT_NAME_CHARS),
      kind: "document",
      size: 0,
      text: text.slice(0, MAX_ATTACHMENT_TEXT_CHARS),
    },
  ];
}

/** 从 DB Json 列读回；形状不对一律当作无附件（旧消息 / 手工改库） */
export function readStoredAttachments(raw: unknown): ChatAttachment[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.name !== "string" || typeof rec.text !== "string") continue;
    const entry: ChatAttachment = {
      name: rec.name,
      kind: rec.kind === "image" ? "image" : "document",
      size: typeof rec.size === "number" && Number.isFinite(rec.size) ? rec.size : 0,
      text: rec.text,
    };
    if (typeof rec.blobPath === "string" && blobRootOf(rec.blobPath)) {
      entry.blobPath = rec.blobPath;
    }
    if (typeof rec.mime === "string" && rec.mime) entry.mime = rec.mime;
    out.push(entry);
  }
  return out;
}

export function summarizeAttachments(list: ChatAttachment[]): ChatAttachmentSummary[] {
  return list.map((a) => ({
    name: a.name,
    kind: attachmentKind(a),
    size: a.size,
    textLength: a.text.length,
    ...(a.blobPath ? { fileUrl: toProxyUrl(a.blobPath) } : {}),
    ...(a.mime ? { mime: a.mime } : {}),
  }));
}

/** 附件正文拼成纯文本（给不走对话链路的下游，如后台研究的证据材料） */
export function attachmentsPlainText(list: ChatAttachment[], maxChars: number): string {
  let left = Math.max(0, maxChars);
  const parts: string[] = [];
  for (const a of list) {
    if (left <= 0) break;
    const head = `【${attachmentKind(a) === "image" ? "图片识别" : "文件"}：${a.name}】\n`;
    const body = a.text.slice(0, Math.max(0, left - head.length));
    parts.push(head + body);
    left -= head.length + body.length;
  }
  return parts.join("\n\n");
}

export interface ModelTurnInput {
  role: "user" | "assistant";
  content: string;
  attachments?: ChatAttachment[];
}

export interface ModelTurn {
  role: "user" | "assistant";
  content: string;
}

export function turnsHaveAttachments(turns: ModelTurnInput[]): boolean {
  return turns.some((t) => (t.attachments?.length ?? 0) > 0);
}

/** 文件名进 XML 属性前去掉会破坏结构的字符 */
function attr(value: string): string {
  return value.replace(/["<>\r\n]/g, " ").replace(/\s+/g, " ").trim();
}

/** 图片附件正文前的说明：让模型知道这是识别结果而非原图 */
const IMAGE_NOTE =
  "（图片附件：以下是从图片识别出的文字与画面描述，不是原图；[不清晰] 处不要脑补。需要看视觉细节时用「重新看图」工具按 ref 重新看原图）";

function openTag(a: ChatAttachment, extra: string): string {
  const isImage = attachmentKind(a) === "image";
  const kindAttr = isImage ? ' kind="image"' : "";
  // ref = 原图 Blob 路径：模型追问时传给「重新看图」工具
  const refAttr = isImage && a.blobPath ? ` ref="${attr(a.blobPath)}"` : "";
  return `<attachment name="${attr(a.name)}"${kindAttr}${refAttr} chars="${a.text.length}"${extra}>`;
}

function renderExpanded(a: ChatAttachment, shown: string): string {
  const truncated = shown.length < a.text.length;
  const head = openTag(a, truncated ? ` shown="${shown.length}" truncated="true"` : "");
  const note = attachmentKind(a) === "image" ? `${IMAGE_NOTE}\n` : "";
  const tail = truncated
    ? `\n…（正文已按预算截断：共 ${a.text.length} 字符，仅展示前 ${shown.length} 字符）`
    : "";
  return `${head}\n${note}${shown}${tail}\n</attachment>`;
}

function renderStub(a: ChatAttachment): string {
  const preview = a.text
    .slice(0, ATTACHMENT_STUB_PREVIEW_CHARS)
    .replace(/\s+/g, " ")
    .trim();
  return (
    `${openTag(a, ' omitted="true"')}\n` +
    `（此前上传的附件，正文未随本轮附上；开头：${preview}…）\n` +
    `</attachment>`
  );
}

/** 单轮用户消息 + 已渲染的附件块 → 模型看到的文本 */
export function composeUserContent(content: string, blocks: string[]): string {
  const head = content.trim() || ATTACHMENT_ONLY_PROMPT;
  if (blocks.length === 0) return head;
  return `${head}\n\n以下是用户上传的附件内容：\n\n${blocks.join("\n\n")}`;
}

/**
 * 把带附件的轮次展开成纯文本轮次。
 * 预算从最后一轮往前分配：越新的附件越先拿到预算；预算耗尽后更早的附件只留桩。
 * 不带附件的轮次原样透传（含 assistant 轮）。
 */
export function renderTurnsForModel(
  turns: ModelTurnInput[],
  budgetChars: number = ATTACHMENT_PROMPT_BUDGET_CHARS,
): ModelTurn[] {
  let left = Math.max(0, Math.floor(budgetChars));
  const rendered: ModelTurn[] = new Array(turns.length);
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    const atts = t.attachments ?? [];
    if (t.role !== "user" || atts.length === 0) {
      rendered[i] = { role: t.role, content: t.content };
      continue;
    }
    const blocks: string[] = [];
    for (const a of atts) {
      if (left < ATTACHMENT_STUB_PREVIEW_CHARS) {
        blocks.push(renderStub(a));
        continue;
      }
      const shown = a.text.slice(0, left);
      left -= shown.length;
      blocks.push(renderExpanded(a, shown));
    }
    rendered[i] = { role: "user", content: composeUserContent(t.content, blocks) };
  }
  return rendered;
}

/** 首条消息生成会话标题时的文案来源：有文字用文字，否则用附件名 */
export function attachmentsTitleSource(content: string, attachments: ChatAttachment[]): string {
  const c = content.trim();
  if (c) return c;
  if (attachments.length === 0) return "";
  return attachments.length === 1
    ? `附件：${attachments[0].name}`
    : `附件：${attachments[0].name} 等 ${attachments.length} 个`;
}

/**
 * 追加到 system prompt 的附件规则（各对话产品线共用；viewToolName 为该对话可用的「重新看图」工具名）。
 * 仅当会话里出现过附件时再追加，避免无谓占用上下文。
 */
export function attachmentPromptRules(viewToolName: string): string {
  return `

## 用户附件
- 用户可能上传附件：文档（PDF/Word/Excel/CSV/TXT）正文与图片（截图/产品照/单据/名片等）的识别结果都会以 <attachment name="文件名"> 块附在用户消息后；图片的标 kind="image" 并带 ref，内容是识别出的文字与画面描述（引用时说明来自图片识别，[不清晰] 处不要脑补）。
- 分析时以附件正文为准并注明文件名；标了 omitted 的是早先上传、本轮未附正文的附件，需要其内容时请用户重新上传（其 ref 仍可用于重新看图）。
- 当问题涉及图片的视觉细节（颜色/材质/结构/布局/位置/数量）、识别文本有 [不清晰]、或用户质疑识别结果时，必须调用 ${viewToolName}(ref, question) 重新看原图，不要凭识别文本猜。`;
}
