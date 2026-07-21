import fs from "fs";
import path from "path";

function loadEnvFile(rel: string) {
  const abs = path.join(process.cwd(), rel);
  if (!fs.existsSync(abs)) return;
  for (const line of fs.readFileSync(abs, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
loadEnvFile(".env.local");
loadEnvFile(".env");

import { getAIConfig } from "../src/lib/ai/config";

async function main() {
  const cfg = getAIConfig();
  console.log({
    baseURL: cfg.baseURL,
    imageModel: cfg.imageModel,
    hasKey: Boolean(cfg.apiKey),
  });
  const res = await fetch(`${cfg.baseURL.replace(/\/$/, "")}/models`, {
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
  });
  console.log("models status", res.status);
  const data = (await res.json()) as { data?: Array<{ id: string }>; error?: unknown };
  if (data.error) {
    console.log("error", data.error);
    return;
  }
  const ids = (data.data || [])
    .map((m) => m.id)
    .filter((id) => /image|dall|gpt-image/i.test(id));
  console.log("image-related models:", ids);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
