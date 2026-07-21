/**
 * 启动前模型配置检查
 *
 * 运行：npx tsx scripts/check-model-config.ts
 */

import fs from "fs";
import path from "path";
import {
  getModelRegistrySnapshot,
  listRetiredModelsInUse,
  ModelRegistry,
  OPENAI_BUILTIN,
  ProviderRouter,
} from "../src/lib/ai/model-registry";
import { getAIConfig, isAIConfigured } from "../src/lib/ai/config";
import { getPreferredImageModel, pickImageProvider } from "../src/lib/image-engine/types";

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

async function probeOpenAI() {
  const cfg = getAIConfig();
  if (!cfg.apiKey) {
    return {
      projectHint: "(no API key)",
      imageModels: [] as string[],
      chatModelsSample: [] as string[],
      imageEditAvailable: false,
      visionAvailable: false,
      toolCallingAvailable: false,
    };
  }

  const res = await fetch(`${cfg.baseURL.replace(/\/$/, "")}/models`, {
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
  });
  if (!res.ok) {
    return {
      projectHint: `models HTTP ${res.status}`,
      imageModels: [] as string[],
      chatModelsSample: [] as string[],
      imageEditAvailable: false,
      visionAvailable: false,
      toolCallingAvailable: false,
    };
  }

  const data = (await res.json()) as { data?: Array<{ id: string }> };
  const ids = (data.data || []).map((m) => m.id);
  const imageModels = ids.filter((id) => /image|dall/i.test(id));
  const chatModelsSample = ids
    .filter((id) => /gpt-5\.6|gpt-4o|o3|o4/i.test(id))
    .slice(0, 12);

  const preferredImage = ModelRegistry.image;
  const imageEditAvailable =
    imageModels.includes(preferredImage) ||
    imageModels.some(
      (id) =>
        id === OPENAI_BUILTIN.image ||
        id.startsWith(`${OPENAI_BUILTIN.image}-`),
    );

  return {
    projectHint: "ok",
    imageModels,
    chatModelsSample,
    imageEditAvailable,
    visionAvailable: Boolean(
      ids.includes(ModelRegistry.vision) ||
        ids.some((id) => id.startsWith("gpt-5.6") || id.startsWith("gpt-4o")),
    ),
    toolCallingAvailable: Boolean(
      ids.includes(ModelRegistry.chat) ||
        ids.some((id) => id.startsWith("gpt-5.6")),
    ),
  };
}

async function main() {
  const snap = getModelRegistrySnapshot();
  const cfg = getAIConfig();
  const probe = await probeOpenAI();
  const provider = pickImageProvider({
    mode: "EXACT",
    geometryClass: "DEFORMABLE_SURFACE",
  });

  const activeModels = [
    snap.chat,
    snap.reasoning,
    snap.fast,
    snap.image,
    snap.imagePinned,
    snap.vision,
  ];
  const retired = listRetiredModelsInUse(activeModels);

  console.log("═══ Qingyan Model Config Check ═══");
  console.log("");
  console.log("Chat Model:           ", snap.chat);
  console.log("Reasoning Model:      ", snap.reasoning);
  console.log("Fast Model:           ", snap.fast);
  console.log("Image Model:          ", snap.image);
  console.log("Pinned Image Version: ", snap.imagePinned);
  console.log("Product Content Image:", snap.productContentImage);
  console.log("Vision Model:         ", snap.vision);
  console.log("");
  console.log("Provider:             ", snap.provider);
  console.log("Preferred Chat:       ", snap.preferredChatModel);
  console.log("Preferred Reasoning:  ", snap.preferredReasoningModel);
  console.log("Preferred Image:      ", getPreferredImageModel());
  console.log("Image Provider:       ", provider.id, `(${provider.label})`);
  console.log("Router Chat:          ", ProviderRouter.getChatModel());
  console.log("Router Reasoning:     ", ProviderRouter.getReasoningModel());
  console.log("Router Image:         ", ProviderRouter.getImageModel());
  console.log("");
  console.log("OpenAI Configured:    ", isAIConfigured());
  console.log("OpenAI Base URL:      ", cfg.baseURL);
  console.log("OpenAI Project:       ", probe.projectHint);
  console.log("Image Models (acct):  ", probe.imageModels.slice(0, 20).join(", ") || "(none)");
  console.log("Chat Models (sample): ", probe.chatModelsSample.join(", ") || "(none)");
  console.log("Image Edit Available: ", probe.imageEditAvailable);
  console.log("Vision Available:     ", probe.visionAvailable);
  console.log("Tool Calling Available:", probe.toolCallingAvailable);
  console.log("");

  if (retired.length > 0) {
    console.error("❌ 仍在使用已淘汰模型默认值:", retired.join(", "));
    process.exit(1);
  }

  if (!probe.imageEditAvailable && isAIConfigured()) {
    console.warn(
      `⚠️  账号当前未见 ${OPENAI_BUILTIN.image}；真实出图可能失败。`,
    );
  } else {
    console.log("✅ 无淘汰模型默认值；Registry 正常。");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
