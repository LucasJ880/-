import type {
  ProductGeometryClass,
  ProductProtectionRules,
  VisualGenerationMode,
} from "@/lib/product-content/types";
import { ProviderRouter } from "@/lib/ai/model-registry";

export interface ImageEngineProvider {
  id: string;
  label: string;
  supportsEdit: boolean;
  highFidelity: boolean;
}

export interface ImageEditResult {
  buffer?: Buffer;
  provider: string;
  model?: string;
  dryRun: boolean;
  metadata: Record<string, unknown>;
}

export interface ProviderRouteInput {
  mode: VisualGenerationMode;
  geometryClass?: ProductGeometryClass;
  highCostAllowed?: boolean;
}

export const IMAGE_PROVIDERS: ImageEngineProvider[] = [
  { id: "openai_image_edit", label: "OpenAI Image Edit", supportsEdit: true, highFidelity: true },
  { id: "openai_image_generate", label: "OpenAI Image Generate", supportsEdit: false, highFidelity: false },
  /** 未来 Fallback 插槽（尚未接入） */
  { id: "gemini_image", label: "Gemini Image", supportsEdit: true, highFidelity: true },
  { id: "qwen_image_edit", label: "Qwen Image Edit", supportsEdit: true, highFidelity: true },
  { id: "flux", label: "Flux", supportsEdit: false, highFidelity: false },
  { id: "placeholder", label: "Placeholder", supportsEdit: false, highFidelity: false },
];

/** Image Engine 取图模型：统一走 ProviderRouter */
export function getPreferredImageModel(): string {
  return ProviderRouter.getImageModel();
}

export function pickImageProvider(input: ProviderRouteInput): ImageEngineProvider {
  const { mode, geometryClass = "DEFORMABLE_SURFACE" } = input;

  // 第一阶段：OpenAI Image Edit 为唯一启用路径
  if (mode === "EXACT" || (mode === "STUDIO" && geometryClass === "DEFORMABLE_SURFACE")) {
    return IMAGE_PROVIDERS.find((p) => p.id === "openai_image_edit")!;
  }

  if (mode === "CREATIVE" && input.highCostAllowed) {
    return IMAGE_PROVIDERS.find((p) => p.id === "openai_image_edit")!;
  }

  return (
    IMAGE_PROVIDERS.find((p) => p.id === "openai_image_edit") ??
    IMAGE_PROVIDERS[0]
  );
}

export function listProviderFallbacks(primaryId: string): ImageEngineProvider[] {
  return IMAGE_PROVIDERS.filter((p) => p.id !== primaryId);
}

export function buildImagePrompt(args: {
  mode: VisualGenerationMode;
  sceneType: string;
  productName?: string;
  material?: string;
  color?: string;
  protection?: ProductProtectionRules;
}): string {
  const parts: string[] = [];
  const name = args.productName?.trim() || "home textile product";

  if (args.mode === "EXACT") {
    parts.push(
      `Edit this product photo of ${name}. Keep exact product shape, pattern, color, logo and text unchanged.`,
    );
    if (args.sceneType === "white_bg") {
      parts.push(
        "Place on pure white background (#FFFFFF), soft studio lighting, no shadows on background, e-commerce catalog ready, product centered.",
      );
    }
  } else if (args.mode === "STUDIO") {
    parts.push(
      `Create a professional studio scene featuring ${name}. Preserve product identity, logo and label text exactly.`,
    );
    if (args.material) parts.push(`Material: ${args.material}.`);
    if (args.color) parts.push(`Color: ${args.color}.`);

    if (args.sceneType === "bedroom") {
      parts.push(
        "Modern bedroom setting, neatly made bed, neutral decor, warm natural daylight, product as hero textile on bed.",
      );
    } else if (args.sceneType === "hotel") {
      parts.push(
        "Upscale hotel room, crisp white linens, minimalist luxury, soft ambient lighting, product showcased on bed or bench.",
      );
    } else if (args.sceneType === "marketing_layout") {
      parts.push(
        "Marketing layout composition with clean negative space for copy, subtle props, editorial catalog style, product prominent.",
      );
    } else if (args.sceneType === "lifestyle") {
      parts.push("Natural lifestyle setting, professional catalog photography.");
    } else {
      parts.push("Professional catalog photography, cohesive styling.");
    }
  } else {
    parts.push(
      `Creative marketing composition for ${name}. Product must remain recognizable.`,
    );
  }

  const p = args.protection;
  if (p?.preserveLogo) parts.push("Do not alter brand logo.");
  if (p?.preserveText) parts.push("Do not alter printed text on product.");
  if (p?.preservePattern) parts.push("Preserve fabric pattern exactly.");
  if (!p?.allowBackgroundChange && args.mode === "EXACT") {
    parts.push("Background change only if specified.");
  }

  return parts.join(" ");
}

export function defaultProtectionRules(
  mode: VisualGenerationMode,
): ProductProtectionRules {
  if (mode === "EXACT") {
    return {
      preserveLogo: true,
      preserveText: true,
      preservePattern: true,
      preserveColor: true,
      preserveShape: true,
      allowBackgroundChange: true,
      allowSceneProps: false,
    };
  }
  if (mode === "STUDIO") {
    return {
      preserveLogo: true,
      preserveText: true,
      preservePattern: true,
      preserveColor: true,
      preserveShape: true,
      allowBackgroundChange: true,
      allowSceneProps: true,
    };
  }
  return {
    preserveLogo: true,
    preserveText: true,
    preservePattern: false,
    preserveColor: false,
    preserveShape: true,
    allowBackgroundChange: true,
    allowSceneProps: true,
  };
}
