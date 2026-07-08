/**
 * 微信可视化生成 — 销售在微信发客户家照片，选 SKU 后收到窗帘效果图
 *
 * 流程：
 *   销售发照片 → 存私有 Blob → Grounding DINO 检测窗户
 *   → 回复「识别到 N 扇窗，请回复 SKU 选择材质」
 *   → 销售回复 SKU（FabricInventory.sku 或可视化目录产品名）
 *   → 多窗合一蒙版 + gpt-image-2 图像编辑生成效果图
 *   → 效果图发回微信（可连续换 SKU 重新生成，回复「取消」结束）
 *
 * 状态存 WeChatGraderContext（30 分钟 TTL，org/user/channel 隔离）。
 * 安全：图片存 wechat-visualizer/{orgId}/ 前缀，经 /api/files 代理按 org 成员鉴权。
 */

import { db } from "@/lib/db";
import {
  putPrivateBlob,
  readBlobBuffer,
} from "@/lib/files/blob-access";
import {
  parseImageSize,
  VISUALIZER_ALLOWED_MIME,
  VISUALIZER_MAX_IMAGE_SIZE,
} from "./upload";
import { runImageEdit } from "./image-ai";
import { createMultiRectEditMaskPng } from "./png-mask";
import {
  detectWindowsWithGroundingDino,
  isGroundingDinoConfigured,
} from "./grounding-dino";
import {
  readGraderContext,
  writeGraderContext,
  type GraderContextKey,
} from "@/lib/ai-grader/wechat-context";
import type { WechatGraderContextState } from "@/lib/ai-grader/wechat-intent-classifier";
import { logAudit } from "@/lib/audit/logger";

const MAX_PIXELS = 8_000_000;
const MAX_WINDOWS = 6;

export type PendingVisualizerState = NonNullable<
  WechatGraderContextState["pendingVisualizer"]
>;
export type WechatVisualizerWindow = PendingVisualizerState["windows"][number];

export interface WechatVisualizerKey extends GraderContextKey {
  externalUserId: string;
}

function extFromMime(mime: string): string {
  if (mime.includes("jpeg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  return "png";
}

async function readPending(
  key: WechatVisualizerKey,
): Promise<PendingVisualizerState | null> {
  const ctx = await readGraderContext(key);
  return ctx?.pendingVisualizer ?? null;
}

async function writePending(
  key: WechatVisualizerKey,
  state: PendingVisualizerState | undefined,
): Promise<void> {
  // 显式 null = 删除该字段（wechat-context 对 null 做删除处理）
  await writeGraderContext(key, { pendingVisualizer: state ?? null });
}

// ── 收图：检测窗户，进入等待 SKU 状态 ────────────────────────

export async function handleWechatVisualizerImage(
  key: WechatVisualizerKey,
  media: { bytes: Buffer; mimeType: string },
): Promise<string> {
  if (!key.orgId) {
    return "请先在『设置 / 微信』完成账号与组织绑定后，再使用图片可视化。";
  }
  if (!isGroundingDinoConfigured()) {
    return "图片已收到，但窗户识别服务未配置（缺 REPLICATE_API_TOKEN），请联系管理员。";
  }
  if (!VISUALIZER_ALLOWED_MIME.includes(media.mimeType as never)) {
    return `暂不支持该图片格式（${media.mimeType}），请发送 JPG/PNG/WebP 照片。`;
  }
  if (media.bytes.length > VISUALIZER_MAX_IMAGE_SIZE) {
    return "图片过大（超过 5MB），请不要勾选「原图」重新发送。";
  }
  const ext = extFromMime(media.mimeType);
  const dims = parseImageSize(media.bytes, ext);
  if (!dims) {
    return "无法读取图片尺寸，请换一张照片重试。";
  }
  if (dims.width * dims.height > MAX_PIXELS) {
    return "图片分辨率过高，请不要勾选「原图」重新发送。";
  }

  // 存私有 Blob（org 隔离前缀，经 /api/files 代理鉴权）
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const pathname = `wechat-visualizer/${key.orgId}/${yyyy}/${mm}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  await putPrivateBlob({
    pathname,
    body: media.bytes,
    contentType: media.mimeType,
  });

  // Grounding DINO 检测
  let windows: WechatVisualizerWindow[];
  try {
    const detections = await detectWindowsWithGroundingDino({
      imageBuffer: media.bytes,
      contentType: media.mimeType,
    });
    windows = detections
      .map((d) => ({
        x1: Math.max(0, Math.round(d.x1)),
        y1: Math.max(0, Math.round(d.y1)),
        x2: Math.min(dims.width, Math.round(d.x2)),
        y2: Math.min(dims.height, Math.round(d.y2)),
        confidence: d.confidence,
      }))
      .filter((w) => w.x2 - w.x1 >= 12 && w.y2 - w.y1 >= 12)
      .slice(0, MAX_WINDOWS);
  } catch (e) {
    console.error("[WechatVisualizer] detect failed:", e);
    return "窗户识别失败，请稍后重新发送照片。";
  }

  if (windows.length === 0) {
    await writePending(key, undefined);
    return "照片已收到，但没有识别到窗户。请换一个角度拍摄（窗户完整入镜、光线充足）后重发。";
  }

  await writePending(key, {
    imagePathname: pathname,
    mimeType: media.mimeType,
    width: dims.width,
    height: dims.height,
    windows,
    stage: "awaiting_sku",
  });

  const lines = windows.map(
    (w, i) => `窗${i + 1}：置信度 ${(w.confidence * 100).toFixed(0)}%`,
  );
  return [
    `📷 照片已收到，识别到 ${windows.length} 扇窗：`,
    ...lines,
    "",
    "请回复产品 SKU 选择材质（例如：RB-3021），",
    "我会生成安装效果图。回复「取消」结束。",
  ].join("\n");
}

// ── 回复：解析 SKU → 生成效果图 ──────────────────────────────

export interface VisualizerReplyResult {
  handled: boolean;
  reply?: string;
  /** 生成的效果图（Blob 代理 URL），由网关经 sendImage 发回微信 */
  imageUrl?: string;
}

interface ResolvedProduct {
  sku: string;
  description: string;
}

/** SKU → 产品描述：优先面料库存 SKU，其次可视化目录产品名。 */
async function resolveProduct(
  orgId: string,
  text: string,
): Promise<ResolvedProduct | null> {
  const q = text.trim();
  if (!q || q.length > 40) return null;

  const fabric = await db.fabricInventory.findFirst({
    where: { sku: { equals: q, mode: "insensitive" } },
    select: { sku: true, productType: true, fabricName: true, color: true },
  });
  if (fabric) {
    return {
      sku: fabric.sku,
      description: `${fabric.productType} window shade, ${fabric.fabricName}${fabric.color ? `, color: ${fabric.color}` : ""}`,
    };
  }

  const catalog = await db.visualizerCatalogProduct.findFirst({
    where: {
      OR: [{ orgId }, { orgId: null }],
      name: { contains: q, mode: "insensitive" },
    },
    select: { name: true, category: true, categoryLabel: true },
  });
  if (catalog) {
    return {
      sku: catalog.name,
      description: `${catalog.category} window covering (${catalog.name})`,
    };
  }
  return null;
}

/** 是否形如 SKU（含数字/连字符的短代码），用于区分「无效 SKU」和普通聊天。 */
function looksLikeSku(text: string): boolean {
  const q = text.trim();
  return (
    q.length >= 2 &&
    q.length <= 30 &&
    /^[A-Za-z0-9][A-Za-z0-9 _\-/]*$/.test(q) &&
    /[0-9-]/.test(q)
  );
}

export async function handleWechatVisualizerReply(
  key: WechatVisualizerKey,
  text: string,
  onProgress?: (text: string) => Promise<void>,
): Promise<VisualizerReplyResult> {
  if (!key.orgId) return { handled: false };
  const pending = await readPending(key);
  if (!pending) return { handled: false };

  const q = text.trim();

  if (["取消", "结束", "不用了", "算了", "cancel"].includes(q)) {
    await writePending(key, undefined);
    return { handled: true, reply: "已结束本次可视化，照片状态已清除。" };
  }

  const product = await resolveProduct(key.orgId!, q);
  if (!product) {
    if (looksLikeSku(q)) {
      return {
        handled: true,
        reply: `未找到 SKU「${q}」对应的产品，请核对后重发；也可以直接回复产品名称。回复「取消」结束。`,
      };
    }
    // 不像 SKU 的普通文字 → 交回常规 AI 链路（保留等待状态）
    return { handled: false };
  }

  // 读原图 + 生成
  const original = await readBlobBuffer(pending.imagePathname);
  if (!original) {
    await writePending(key, undefined);
    return {
      handled: true,
      reply: "原照片已过期，请重新发送照片。",
    };
  }

  if (onProgress) {
    await onProgress(
      `✅ 已选择 ${product.sku}，正在为 ${pending.windows.length} 扇窗生成效果图（约 1 分钟）…`,
    ).catch(() => {});
  }

  const mask = createMultiRectEditMaskPng({
    width: pending.width,
    height: pending.height,
    rects: pending.windows,
  });

  const prompt =
    `Inside the transparent mask areas (window openings), install ${product.description}. ` +
    `Fully cover each window opening with the new window covering, neatly mounted. ` +
    `Photorealistic result: preserve room perspective, wall color, lighting, shadows and everything outside the mask. ` +
    `Do not add text, watermarks, people or furniture.`;

  let edited: Buffer | null;
  try {
    edited = await runImageEdit({
      imageBuffer: original.buffer,
      imageMime: original.contentType,
      maskBuffer: mask,
      prompt,
    });
  } catch (e) {
    console.error("[WechatVisualizer] generate failed:", e);
    edited = null;
  }
  if (!edited) {
    return {
      handled: true,
      reply: "效果图生成失败，请稍后回复 SKU 重试，或回复「取消」结束。",
    };
  }

  // 存结果图（与原图同前缀，org 隔离）
  const outPathname = pending.imagePathname.replace(
    /\.[a-z]+$/i,
    `-render-${Date.now()}.png`,
  );
  const uploaded = await putPrivateBlob({
    pathname: outPathname,
    body: edited,
    contentType: "image/png",
  });

  await writePending(key, { ...pending, stage: "generated", lastSku: product.sku });

  await logAudit({
    userId: key.userId,
    orgId: key.orgId!,
    action: "visualizer.wechat.generate",
    targetType: "visualizer",
    afterData: {
      sku: product.sku,
      windowCount: pending.windows.length,
      outPathname,
    },
  }).catch(() => {});

  return {
    handled: true,
    reply: [
      `🖼 ${product.sku} 效果图已生成（${pending.windows.length} 扇窗）。`,
      "满意可直接转发给客户；想换材质请再回复其他 SKU，回复「取消」结束。",
    ].join("\n"),
    imageUrl: uploaded.proxyUrl,
  };
}
