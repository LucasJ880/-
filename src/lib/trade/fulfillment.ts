/**
 * 外贸客户服务工单 — 处理方（加拿大团队）履约层
 *
 * 职责：
 * - 对工单输入图运行 gpt-image-2 出图（复用 visualizer 的 runImageEdit）。
 * - 把交付物写回工单（资产归属客户 org），更新状态。
 * - 把交付结果通过客户专属微信通道回传给客户。
 *
 * 隔离：所有访问按 fulfillmentOrgId 校验（见 service-request 的 fulfillment helper）；
 * 回传时按工单的客户 org + 来源通道发送，处理方接触不到客户 org 的其它数据 / bid 数据。
 */

import { putPrivateBlob } from "@/lib/files/blob-access";
import { logger } from "@/lib/common/logger";
import { runImageEdit, fetchBuffer } from "@/lib/visualizer/image-ai";
import { sendToExternalUser } from "@/lib/messaging/gateway";
import type { ChannelType } from "@/lib/messaging/types";
import {
  getFulfillmentRequest,
  addDeliverableForFulfillment,
  setFulfillmentStatus,
} from "./service-request";

const BLOB_PREFIX = "trade-service";

function extFromMime(mime: string): string {
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  return "png";
}

/**
 * 对工单的某个输入图运行 gpt-image-2 出图，并把结果作为交付物挂回工单。
 *
 * @returns 新建的 deliverable 资产（含 fileUrl）。
 */
export async function runDesignImageForRequest(input: {
  requestId: string;
  fulfillmentOrgId: string;
  inputAssetId: string;
  prompt: string;
  createdById?: string | null;
}) {
  const request = await getFulfillmentRequest(input.requestId, input.fulfillmentOrgId);
  if (!request) {
    throw new Error("工单不存在或未指派给当前处理方");
  }

  const inputAsset = request.assets.find(
    (a) => a.id === input.inputAssetId && a.kind === "input",
  );
  if (!inputAsset) {
    throw new Error("输入图资产不存在");
  }

  const mime = inputAsset.mimeType || "image/png";
  const srcBuffer = await fetchBuffer(inputAsset.fileUrl);
  if (!srcBuffer) {
    throw new Error("无法读取输入图");
  }

  const outBuffer = await runImageEdit({
    imageBuffer: srcBuffer,
    imageMime: mime,
    prompt: input.prompt,
  });
  if (!outBuffer) {
    throw new Error("gpt-image-2 出图失败");
  }

  const ts = Date.now();
  const pathname = `${BLOB_PREFIX}/${request.orgId}/${request.id}/deliverables/${ts}.png`;
  const blob = await putPrivateBlob({
    pathname,
    body: outBuffer,
    contentType: "image/png",
  });

  const asset = await addDeliverableForFulfillment({
    requestId: request.id,
    fulfillmentOrgId: input.fulfillmentOrgId,
    fileUrl: blob.proxyUrl,
    fileName: `design_${ts}.png`,
    mimeType: "image/png",
    meta: { prompt: input.prompt, sourceAssetId: inputAsset.id, model: "gpt-image-2" },
    createdById: input.createdById ?? null,
  });

  await setFulfillmentStatus({
    requestId: request.id,
    fulfillmentOrgId: input.fulfillmentOrgId,
    status: "in_progress",
  });

  logger.info("trade.fulfillment.design_image", {
    requestId: request.id,
    fulfillmentOrgId: input.fulfillmentOrgId,
    assetId: asset.id,
  });

  return asset;
}

/**
 * 交付：把工单的交付物（图片/文本）回传给客户微信，并把工单标记为 delivered。
 *
 * @param deliverableAssetId 可选，指定要回传的交付物；不传则取最新一个 deliverable。
 * @param message 可选附带文本说明。
 */
export async function deliverRequestToClient(input: {
  requestId: string;
  fulfillmentOrgId: string;
  deliverableAssetId?: string | null;
  message?: string | null;
}): Promise<{ delivered: boolean; sent: boolean; sendError?: string }> {
  const request = await getFulfillmentRequest(input.requestId, input.fulfillmentOrgId);
  if (!request) {
    throw new Error("工单不存在或未指派给当前处理方");
  }

  const deliverables = request.assets.filter((a) => a.kind === "deliverable");
  const target = input.deliverableAssetId
    ? deliverables.find((a) => a.id === input.deliverableAssetId)
    : deliverables[deliverables.length - 1];

  // 回传给客户微信（按客户 org + 来源通道）。无来源通道信息时只标记交付、不发送。
  let sent = false;
  let sendError: string | undefined;
  const channel = request.sourceChannel as ChannelType | null;
  const to = request.externalUserId;

  if (channel && to) {
    const text =
      (input.message?.trim() || `您的需求「${request.title}」已处理完成，请查收。`) +
      (target && !target.mimeType?.startsWith("image/") ? `\n交付物：${target.fileUrl}` : "");
    const res = await sendToExternalUser({
      channel,
      orgId: request.orgId,
      to,
      text,
      imageUrl: target?.mimeType?.startsWith("image/") ? target.fileUrl : undefined,
    });
    sent = res.ok;
    sendError = res.error;
  } else {
    sendError = "工单无来源通道信息，无法自动回传";
  }

  await setFulfillmentStatus({
    requestId: request.id,
    fulfillmentOrgId: input.fulfillmentOrgId,
    status: "delivered",
  });

  logger.info("trade.fulfillment.delivered", {
    requestId: request.id,
    fulfillmentOrgId: input.fulfillmentOrgId,
    sent,
    sendError,
  });

  return { delivered: true, sent, sendError };
}
