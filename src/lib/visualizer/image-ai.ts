import { getAIConfig } from "@/lib/ai/config";

export async function fetchBuffer(url: string): Promise<Buffer | null> {
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
}): Promise<Buffer | null> {
  const cfg = getAIConfig();
  if (!cfg.apiKey) throw new Error("OPENAI_API_KEY missing");

  const form = new FormData();
  form.append("model", cfg.imageModel);
  form.append("prompt", args.prompt);
  form.append("size", "auto");
  form.append(
    "image",
    new File([new Uint8Array(args.imageBuffer)], `source.${extFromMime(args.imageMime)}`, {
      type: args.imageMime,
    }),
  );
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
