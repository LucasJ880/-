/**
 * 外贸 AI 对话 — 用户消息附件（解析后的文本）
 *
 * 链路：浏览器把文件交给 /api/ai/upload-file 解析成纯文本（PDF/Word/Excel/CSV/TXT，不落盘），
 * 发消息时把 { name, size, text } 随消息提交 → 存进 TradeChatMessage.attachments（JSONB）
 * → 组装模型输入时按「最新优先」的字符预算展开正文，超预算的旧附件只留摘要桩，
 * 这样当轮能分析全文，后续追问也还能引用最近的附件。
 *
 * 本文件只有纯函数，不碰 DB / 网络，便于单测。
 */

/** document = 文档解析文本；image = 图片识别文本（逐字转录 + 画面描述） */
export type TradeChatAttachmentKind = "document" | "image";

export interface TradeChatAttachment {
  /** 原文件名（展示 + 模型引用） */
  name: string;
  /** 缺省视为 document（兼容早期数据） */
  kind?: TradeChatAttachmentKind;
  /** 原文件字节数（仅展示） */
  size: number;
  /** 解析后的文本，≤ MAX_ATTACHMENT_TEXT_CHARS */
  text: string;
}

/** 返回给浏览器的形状：不带正文 */
export interface TradeChatAttachmentSummary {
  name: string;
  kind: TradeChatAttachmentKind;
  size: number;
  textLength: number;
}

export function attachmentKind(a: { kind?: TradeChatAttachmentKind }): TradeChatAttachmentKind {
  return a.kind === "image" ? "image" : "document";
}

export const MAX_ATTACHMENTS_PER_MESSAGE = 5;
export const MAX_ATTACHMENT_NAME_CHARS = 200;
/** 与 src/lib/files/parse-buffer.ts 的 MAX_TEXT_LENGTH 对齐 */
export const MAX_ATTACHMENT_TEXT_CHARS = 150_000;
/** 单次模型调用里附件正文的总预算（字符）：预算优先给最新的附件 */
export const ATTACHMENT_PROMPT_BUDGET_CHARS = 60_000;
/** 超预算旧附件桩里保留的开头字符数；剩余预算低于此值时不再零碎展开 */
export const ATTACHMENT_STUB_PREVIEW_CHARS = 300;

/** 用户只传附件没打字时，替模型补的指令 */
export const ATTACHMENT_ONLY_PROMPT =
  "（用户没有输入文字，只上传了以下附件。请先概述附件内容与要点，指出与外贸业务相关、值得关注的信息，再问用户想进一步做什么。）";

export type ParseAttachmentsResult =
  | { ok: true; attachments: TradeChatAttachment[] }
  | { ok: false; error: string };

/** 校验请求体里的 attachments（来自浏览器，不可信） */
export function parseAttachmentsInput(raw: unknown): ParseAttachmentsResult {
  if (raw === undefined || raw === null) return { ok: true, attachments: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "attachments 必须是数组" };
  if (raw.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    return { ok: false, error: `一条消息最多附 ${MAX_ATTACHMENTS_PER_MESSAGE} 个文件` };
  }
  const attachments: TradeChatAttachment[] = [];
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
    const kind: TradeChatAttachmentKind = rec.kind === "image" ? "image" : "document";
    attachments.push({ name, kind, size, text });
  }
  return { ok: true, attachments };
}

/** 从 DB Json 列读回；形状不对一律当作无附件（旧消息 / 手工改库） */
export function readStoredAttachments(raw: unknown): TradeChatAttachment[] {
  if (!Array.isArray(raw)) return [];
  const out: TradeChatAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.name !== "string" || typeof rec.text !== "string") continue;
    out.push({
      name: rec.name,
      kind: rec.kind === "image" ? "image" : "document",
      size: typeof rec.size === "number" && Number.isFinite(rec.size) ? rec.size : 0,
      text: rec.text,
    });
  }
  return out;
}

export function summarizeAttachments(
  list: TradeChatAttachment[],
): TradeChatAttachmentSummary[] {
  return list.map((a) => ({
    name: a.name,
    kind: attachmentKind(a),
    size: a.size,
    textLength: a.text.length,
  }));
}

export interface ModelTurnInput {
  role: "user" | "assistant";
  content: string;
  attachments?: TradeChatAttachment[];
}

export interface ModelTurn {
  role: "user" | "assistant";
  content: string;
}

/** 文件名进 XML 属性前去掉会破坏结构的字符 */
function attr(value: string): string {
  return value.replace(/["<>\r\n]/g, " ").replace(/\s+/g, " ").trim();
}

/** 图片附件正文前的说明：让模型知道这是识别结果而非原图 */
const IMAGE_NOTE = "（图片附件：以下是从图片识别出的文字与画面描述，不是原图；[不清晰] 处不要脑补）";

function openTag(a: TradeChatAttachment, extra: string): string {
  const kindAttr = attachmentKind(a) === "image" ? ' kind="image"' : "";
  return `<attachment name="${attr(a.name)}"${kindAttr} chars="${a.text.length}"${extra}>`;
}

function renderExpanded(a: TradeChatAttachment, shown: string): string {
  const truncated = shown.length < a.text.length;
  const head = openTag(a, truncated ? ` shown="${shown.length}" truncated="true"` : "");
  const note = attachmentKind(a) === "image" ? `${IMAGE_NOTE}\n` : "";
  const tail = truncated
    ? `\n…（正文已按预算截断：共 ${a.text.length} 字符，仅展示前 ${shown.length} 字符）`
    : "";
  return `${head}\n${note}${shown}${tail}\n</attachment>`;
}

function renderStub(a: TradeChatAttachment): string {
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
export function attachmentsTitleSource(
  content: string,
  attachments: TradeChatAttachment[],
): string {
  const c = content.trim();
  if (c) return c;
  if (attachments.length === 0) return "";
  return attachments.length === 1
    ? `附件：${attachments[0].name}`
    : `附件：${attachments[0].name} 等 ${attachments.length} 个`;
}
