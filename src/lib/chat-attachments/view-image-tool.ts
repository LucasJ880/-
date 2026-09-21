/**
 * 「重新看图」工具（agent-core）——各对话产品线按各自的 domain 把同一描述符注册进既有目录：
 * - tools/trade.ts   → trade_view_attachment_image（domain=trade，外贸对话）
 * - tools/context.ts → chat_view_attachment_image（domain=system，主助手 / 项目问青砚等所有角色可用）
 *
 * 本文件只提供纯执行函数与描述符构造器，不持有注册表（架构守卫：新工具注册进既有目录文件）。
 * 用户消息里的 <attachment kind="image" ref="…"> 给出 ref（原图 Blob 路径），
 * 执行时校验 ref 属于当前 org 后读原图，按问题重新识别。
 */

import type { ToolDefinition, ToolDomain, ToolExecutionContext, ToolExecutionResult } from "@/lib/agent-core/types";
import { readBlobBuffer } from "@/lib/files/blob-access";
import { answerQuestionAboutImage } from "@/lib/ai/image-to-text";
import { attachmentBlobPathBelongsTo } from "./core";

export const VIEW_ATTACHMENT_IMAGE_DESCRIPTION =
  "重新查看用户在本对话里上传的图片附件原图，并回答一个具体问题。用户消息里的 <attachment kind=\"image\" ref=\"…\"> 给出 ref。当问题涉及图片的视觉细节（颜色、材质、结构、布局、位置、数量）、识别文本标了 [不清晰]、或用户质疑识别结果时使用；不要凭识别文本猜。";

/** 与注册无关的纯执行逻辑（V1 伪协议工具也复用） */
export async function viewAttachmentImage(input: {
  orgId: string;
  ref: string;
  question: string;
}): Promise<{ ok: true; answer: string; model: string; fileName: string } | { ok: false; error: string }> {
  const ref = input.ref.trim();
  const question = input.question.trim();
  if (!question) return { ok: false, error: "question 不能为空" };
  // 边界：只能看当前 org 自己的对话图片
  if (!attachmentBlobPathBelongsTo(ref, input.orgId)) {
    return { ok: false, error: "ref 不合法或不属于当前组织" };
  }
  const blob = await readBlobBuffer(ref);
  if (!blob) return { ok: false, error: "找不到该图片附件（可能已被删除）" };
  const fileName = ref.split("/").pop() ?? "image";
  const { text, model } = await answerQuestionAboutImage(
    { buffer: blob.buffer, mime: blob.contentType, fileName },
    question,
  );
  return { ok: true, answer: text, model, fileName };
}

/** 构造工具描述符；由既有目录文件（tools/trade.ts、tools/context.ts）负责注册 */
export function buildViewAttachmentImageTool(opts: { name: string; domain: ToolDomain }): ToolDefinition {
  return {
    name: opts.name,
    description: VIEW_ATTACHMENT_IMAGE_DESCRIPTION,
    domain: opts.domain,
    parameters: {
      type: "object",
      properties: {
        ref: { type: "string", description: "附件标签里的 ref（trade-chat/… 或 ai-chat/… 路径）" },
        question: { type: "string", description: "要从图片里看什么，具体到细节（中文）" },
      },
      required: ["ref", "question"],
    },
    execute: async (ctx: ToolExecutionContext): Promise<ToolExecutionResult> => {
      const result = await viewAttachmentImage({
        orgId: ctx.orgId,
        ref: (ctx.args.ref as string | undefined) ?? "",
        question: (ctx.args.question as string | undefined) ?? "",
      });
      if (!result.ok) return { success: false, data: null, error: result.error };
      return {
        success: true,
        data: { ref: (ctx.args.ref as string) ?? "", question: ctx.args.question, answer: result.answer, model: result.model },
      };
    },
  };
}
