/**
 * Grounding DINO 窗户检测客户端（经 Replicate 托管推理）
 *
 * 为什么不用 GPT 视觉：语言模型报坐标存在架构性漂移（可偏差上百像素），
 * Grounding DINO 是专为「文字 → 精确边界框」训练的开放词汇检测器，
 * 定位精度和稳定性远高于 VLM，单次调用 <1s、成本约 $0.001。
 *
 * 流程：私有 Blob 图片字节 → Replicate Files API（图片不公开，24h 自动过期）
 *      → 创建 prediction（Prefer: wait 同步等待）→ 解析 detections → IoU 去重。
 *
 * 输出坐标为原图像素坐标系，与 normalizeDetectedRegionCandidates 的候选格式兼容。
 */

const REPLICATE_API = "https://api.replicate.com/v1";

/** adirik/grounding-dino 的固定版本（可用 env 覆盖以便升级时灰度）。 */
const GROUNDING_DINO_VERSION =
  process.env.REPLICATE_GROUNDING_DINO_VERSION ||
  "efd10a8ddc57ea28773327e881ce95e20cc1d734c589f7dd01d2036921ed78aa";

/** 检测查询词：面向窗帘场景，窗户 + 已装窗帘/百叶帘都算目标区域。 */
const WINDOW_QUERY = "window, glass door, curtain, blinds";

const BOX_THRESHOLD = 0.3;
const TEXT_THRESHOLD = 0.25;

export interface DinoDetectionCandidate {
  label: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  confidence: number;
  reason: string;
}

export function isGroundingDinoConfigured(): boolean {
  return Boolean(process.env.REPLICATE_API_TOKEN);
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}` };
}

/** 上传图片字节到 Replicate Files API，返回可作为模型输入的临时 URL。 */
async function uploadImageForInference(
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  const form = new FormData();
  form.append(
    "content",
    new File([new Uint8Array(buffer)], "detect-source", { type: contentType }),
  );
  const res = await fetch(`${REPLICATE_API}/files`, {
    method: "POST",
    headers: authHeaders(),
    body: form,
  });
  if (!res.ok) {
    throw new Error(`Replicate file upload failed: ${res.status}`);
  }
  const data = await res.json();
  const url = data?.urls?.get;
  if (typeof url !== "string" || !url) {
    throw new Error("Replicate file upload: missing urls.get");
  }
  return url;
}

interface RawDetection {
  bbox?: unknown;
  confidence?: unknown;
  label?: unknown;
}

function iou(a: DinoDetectionCandidate, b: DinoDetectionCandidate): number {
  const ix = Math.max(
    0,
    Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1),
  );
  const iy = Math.max(
    0,
    Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1),
  );
  const inter = ix * iy;
  const areaA = (a.x2 - a.x1) * (a.y2 - a.y1);
  const areaB = (b.x2 - b.x1) * (b.y2 - b.y1);
  const union = areaA + areaB - inter;
  return union > 0 ? inter / union : 0;
}

/** 简单 NMS：按置信度降序，IoU > 0.6 的重叠框只保留最高分的。 */
export function dedupeDetections(
  candidates: DinoDetectionCandidate[],
  iouThreshold = 0.6,
): DinoDetectionCandidate[] {
  const sorted = [...candidates].sort((a, b) => b.confidence - a.confidence);
  const kept: DinoDetectionCandidate[] = [];
  for (const c of sorted) {
    if (kept.every((k) => iou(k, c) < iouThreshold)) kept.push(c);
  }
  return kept;
}

export function parseDinoDetections(raw: unknown): DinoDetectionCandidate[] {
  const detections = Array.isArray(
    (raw as { detections?: unknown })?.detections,
  )
    ? ((raw as { detections: unknown[] }).detections as RawDetection[])
    : [];

  const out: DinoDetectionCandidate[] = [];
  for (const d of detections) {
    if (!Array.isArray(d.bbox) || d.bbox.length !== 4) continue;
    const [x1, y1, x2, y2] = d.bbox.map(Number);
    if (![x1, y1, x2, y2].every(Number.isFinite)) continue;
    const confidence =
      typeof d.confidence === "number" && Number.isFinite(d.confidence)
        ? d.confidence
        : 0.5;
    const label = typeof d.label === "string" && d.label.trim() ? d.label.trim() : "window";
    out.push({
      label,
      x1,
      y1,
      x2,
      y2,
      confidence,
      reason: `Grounding DINO detected "${label}"`,
    });
  }
  return dedupeDetections(out);
}

/**
 * 检测照片中的窗户区域。
 * 失败抛错（由调用方决定是否回退到 VLM 路径），不静默返回空数组。
 */
export async function detectWindowsWithGroundingDino(args: {
  imageBuffer: Buffer;
  contentType: string;
}): Promise<DinoDetectionCandidate[]> {
  if (!isGroundingDinoConfigured()) {
    throw new Error("REPLICATE_API_TOKEN not configured");
  }

  const imageUrl = await uploadImageForInference(
    args.imageBuffer,
    args.contentType,
  );

  const res = await fetch(`${REPLICATE_API}/predictions`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
      Prefer: "wait=60",
    },
    body: JSON.stringify({
      version: GROUNDING_DINO_VERSION,
      input: {
        image: imageUrl,
        query: WINDOW_QUERY,
        box_threshold: BOX_THRESHOLD,
        text_threshold: TEXT_THRESHOLD,
        show_visualisation: false,
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`Replicate prediction failed: ${res.status}`);
  }
  const prediction = await res.json();
  if (prediction.status !== "succeeded") {
    throw new Error(
      `Replicate prediction status=${prediction.status}${prediction.error ? `: ${prediction.error}` : ""}`,
    );
  }
  return parseDinoDetections(prediction.output);
}
