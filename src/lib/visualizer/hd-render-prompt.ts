/**
 * HD Render prompt 组装（纯函数，便于单测）。
 */

export type HdPromptProductOption = {
  productName: string;
  productCategory: string;
  color: string | null;
  colorHex: string | null;
  opacity: number;
  mountingType: string | null;
};

export type HdPromptReferenceLine = {
  index: number; // 1-based among reference images (image 2+)
  role: string;
  productName: string;
  sourceType: string;
  verificationStatus?: string | null;
};

function categoryGuidance(categories: string[]): string[] {
  const set = new Set(categories.map((c) => c.toLowerCase()));
  const lines: string[] = [];

  if (set.has("drapery") || set.has("sheer") || set.has("motorized")) {
    lines.push(
      "For drapery/sheer: generate realistic folds, natural draping, correct header, track placement, fabric depth and shadows. Do not leave a flat color panel.",
    );
  }
  if (set.has("roller") || set.has("solar") || set.has("blackout_roller") || set.has("dual")) {
    lines.push(
      "For roller shades: correct top hardware, straight fabric plane, level bottom bar, realistic fabric grain.",
    );
  }
  if (set.has("zebra")) {
    lines.push(
      "For zebra shades: preserve alternating sheer and opaque horizontal bands, correct top cassette, level bottom bar.",
    );
  }
  if (set.has("honeycomb")) {
    lines.push(
      "For honeycomb: visible and evenly spaced cellular pleats, top rail and bottom rail, correct stacking geometry.",
    );
  }
  if (set.has("vertical")) {
    lines.push(
      "For vertical blinds: individual vertical vanes, realistic spacing, tilt, thickness, shadows, and correct headrail.",
    );
  }
  if (
    set.has("horizontal") ||
    set.has("wood_blind") ||
    set.has("faux_wood") ||
    set.has("aluminum_blind")
  ) {
    lines.push(
      "For horizontal blinds: individual slats, realistic spacing, tilt, thickness and shadows, correct headrail.",
    );
  }
  return lines;
}

export function buildHdRenderPrompt(args: {
  productOptions: HdPromptProductOption[];
  references: HdPromptReferenceLine[];
  customInstruction?: string | null;
}): string {
  const referenceGuide = args.references.map(
    (r) =>
      `Input image ${r.index + 1}: ${r.role} reference for product "${r.productName}"; source=${r.sourceType}; verification=${r.verificationStatus ?? "draft"}.`,
  );
  const selectedProductGuide = args.productOptions.map(
    (option) =>
      `Use ${option.productName} (${option.productCategory}), color ${option.color ?? "default"} ${option.colorHex ?? ""}, ` +
      `opacity ${Math.round(option.opacity * 100)}%, mounting ${option.mountingType ?? "unspecified"}.`,
  );
  const customInstruction =
    typeof args.customInstruction === "string" && args.customInstruction.trim()
      ? `Sales instruction: ${args.customInstruction.trim().slice(0, 500)}.`
      : "";

  const categories = args.productOptions.map((p) => p.productCategory);

  return [
    "Create a high-definition photorealistic window covering sales visualization.",
    "The room image is the authoritative scene.",
    "Input image 1 is the customer's original or cleaned room photo (NOT a composited preview with solid product color blocks).",
    "The mask identifies the only area where a window covering may be installed.",
    "Do not preserve or recreate any flat colored placement rectangle.",
    "Generate a photorealistic, physically plausible installed window-covering product.",
    "The final result must show realistic construction, material texture, depth, hardware, folds or slats, shadows and interaction with the existing room lighting.",
    "No flat color block may remain in the final image.",
    "Preserve all room areas outside the mask, including furniture, walls, floor, ceiling, windows and architecture.",
    ...referenceGuide,
    ...selectedProductGuide,
    "Real installed references are authoritative. AI-generated style references are secondary guidance only.",
    "Use later input images only as product identity, construction, texture, material, and style references. Do not copy their rooms or backgrounds.",
    "Replace only the masked window-covering areas. Keep every other pixel visually consistent with input image 1.",
    "Match the selected product category, band pattern or folds, hardware, mounting, material texture, opacity, and color as closely as possible.",
    ...categoryGuidance(categories),
    "Add realistic edges, natural shadows, and physically plausible light transmission through sheer or translucent fabric.",
    "Do not add windows, furniture, decor, people, text, logos, watermarks, or a different time of day.",
    customInstruction,
    "Output one photorealistic image with the same aspect ratio as input image 1.",
  ]
    .filter(Boolean)
    .join(" ");
}
