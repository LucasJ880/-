import type { VisualTemplateSuite, VisualTemplateShot } from "./types";
import {
  DEFAULT_IMPORT_FIDELITY_RULES,
  DEFAULT_IMPORT_UPLOAD_SLOTS,
  type ImportedShotDraft,
  type VisualTemplateImportManifest,
} from "./import-types";
import { ALL_ASPECT_RATIOS, ALL_RESOLUTIONS } from "./options";

const SHARED_FIDELITY = [
  "PRIMARY IMAGE is the ground-truth product photo. Preserve EXACT product identity with photoreal fidelity.",
  "Keep exact pattern/print, colors, collar/trim, belt/accessories, pockets and fabric texture from the primary photo.",
  "Do NOT invent a different print or colorway. Do NOT invent logos or brand marks.",
  "Prefer under-stylizing over inventing details. Only use product references from THIS job.",
].join(" ");

const SHARED_EMBED =
  "Photoreal embedding: natural fabric weight, soft contact shadows, believable folds, correct scale/perspective, scene-matched lighting. Must NOT look like a flat cutout pasted onto a background.";

const SHARED_NO_TEXT =
  "CRITICAL: Absolutely NO text, letters, numbers, watermarks, logos, brand marks, Chinese/English overlays, marketplace branding, or material callouts anywhere.";

function slugKey(raw: string, index: number): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || `shot_${index + 1}`;
}

export function buildPromptBodyFromImportShot(shot: ImportedShotDraft): string {
  const parts = [
    `Create an Amazon-style e-commerce product image based on the primary product photo.`,
    SHARED_FIDELITY,
    `Composition brief: ${shot.compositionNotes.trim()}`,
  ];
  if (shot.extraPrompt?.trim()) {
    parts.push(shot.extraPrompt.trim());
  }
  parts.push(SHARED_EMBED, SHARED_NO_TEXT);
  return parts.join(" ");
}

export function buildSuiteFromImportManifest(
  manifest: VisualTemplateImportManifest,
  publicBasePath: string,
): VisualTemplateSuite {
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(manifest.id)) {
    throw new Error(
      `非法 suite id: ${manifest.id}（需小写字母数字/下划线/连字符）`,
    );
  }
  if (!manifest.shots?.length) {
    throw new Error(`模版 ${manifest.id} 缺少 shots`);
  }

  const shots: VisualTemplateShot[] = manifest.shots.map((s, i) => ({
    key: slugKey(s.key, i),
    label: s.label.trim() || `构图 ${i + 1}`,
    styleGroup: s.styleGroup?.trim() || "imported",
    mode: s.mode ?? "STUDIO",
    styleRefs: s.styleRefs ?? "both",
    promptBody: buildPromptBodyFromImportShot(s),
  }));

  const files = manifest.files ?? {};
  const previewName = files.preview ?? "preview.jpg";
  const modelName = files.styleModel ?? "style-model.jpg";
  const displayName = files.styleDisplay ?? "style-display.jpg";

  return {
    id: manifest.id,
    name: manifest.name.trim(),
    category: manifest.category.trim() || "imported",
    description: manifest.description.trim(),
    shotCount: shots.length,
    shots,
    uploadSlots: manifest.uploadSlots?.length
      ? manifest.uploadSlots
      : DEFAULT_IMPORT_UPLOAD_SLOTS,
    fidelityRules: manifest.fidelityRules?.length
      ? manifest.fidelityRules
      : DEFAULT_IMPORT_FIDELITY_RULES,
    supportedAspectRatios: manifest.supportedAspectRatios?.length
      ? manifest.supportedAspectRatios
      : [...ALL_ASPECT_RATIOS],
    supportedResolutions: manifest.supportedResolutions?.length
      ? manifest.supportedResolutions
      : [...ALL_RESOLUTIONS],
    quality: manifest.quality ?? "high",
    previewImage: `${publicBasePath}/${previewName}`,
    styleAssetPaths: {
      model: `${publicBasePath}/${modelName}`,
      display: `${publicBasePath}/${displayName}`,
    },
  };
}
