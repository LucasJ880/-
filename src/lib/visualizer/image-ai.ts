import { getAIConfig } from "@/lib/ai/config";
import { isProxyUrl, readBlobBuffer } from "@/lib/files/blob-access";

export async function fetchBuffer(url: string): Promise<Buffer | null> {
  // 私有 Blob（代理 URL / blob 存储 URL / 纯 pathname）走 SDK 读取；其余外链走 HTTP
  const isBlobManaged =
    isProxyUrl(url) ||
    url.includes(".blob.vercel-storage.com") ||
    !/^https?:\/\//i.test(url);
  if (isBlobManaged) {
    const blob = await readBlobBuffer(url);
    return blob?.buffer ?? null;
  }
  const res = await fetch(url);
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}

function extFromMime(mime: string): string {
  if (mime.includes("jpeg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  return "png";
}

export async function runImageEdit(args: {
  imageBuffer: Buffer;
  imageMime: string;
  prompt: string;
  maskBuffer?: Buffer;
  referenceImages?: Array<{
    buffer: Buffer;
    mime: string;
    fileName?: string;
  }>;
  quality?: "low" | "medium" | "high" | "auto";
  /** 覆盖默认图片模型（来自 ModelRegistry.image） */
  model?: string;
}): Promise<Buffer | null> {
  const cfg = getAIConfig();
  if (!cfg.apiKey) throw new Error("OPENAI_API_KEY missing");

  const form = new FormData();
  form.append("model", args.model || cfg.imageModel);
  form.append("prompt", args.prompt);
  form.append("size", "auto");
  if (args.quality) form.append("quality", args.quality);

  const references = args.referenceImages?.slice(0, 8) ?? [];
  const imageField = references.length > 0 ? "image[]" : "image";
  form.append(
    imageField,
    new File([new Uint8Array(args.imageBuffer)], `source.${extFromMime(args.imageMime)}`, {
      type: args.imageMime,
    }),
  );
  for (const [index, reference] of references.entries()) {
    const fallbackName = `reference-${index + 1}.${extFromMime(reference.mime)}`;
    form.append(
      "image[]",
      new File([new Uint8Array(reference.buffer)], reference.fileName || fallbackName, {
        type: reference.mime,
      }),
    );
  }
  if (args.maskBuffer) {
    form.append(
      "mask",
      new File([new Uint8Array(args.maskBuffer)], "mask.png", { type: "image/png" }),
    );
  }

  const res = await fetch(`${cfg.baseURL.replace(/\/$/, "")}/images/edits`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    console.error("Visualizer image edit failed:", res.status, msg);
    return null;
  }

  const data = await res.json();
  const b64 = data.data?.[0]?.b64_json;
  if (typeof b64 === "string" && b64) {
    return Buffer.from(b64, "base64");
  }
  const url = data.data?.[0]?.url;
  if (typeof url === "string" && url) {
    return fetchBuffer(url);
  }
  return null;
}
