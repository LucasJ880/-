/**
 * GET /api/product-content/templates — 套图模版库列表
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import {
  ALL_ASPECT_RATIOS,
  ALL_RESOLUTIONS,
  DEFAULT_ASPECT_RATIO,
  DEFAULT_RESOLUTION,
  listVisualTemplateSuites,
} from "@/lib/product-content/templates";

export const GET = withAuth(async () => {
  const suites = listVisualTemplateSuites().map((s) => ({
    id: s.id,
    name: s.name,
    category: s.category,
    description: s.description,
    shotCount: s.shotCount,
    shots: s.shots.map((shot) => ({
      key: shot.key,
      label: shot.label,
      styleGroup: shot.styleGroup,
    })),
    uploadSlots: s.uploadSlots,
    fidelityRules: s.fidelityRules,
    supportedAspectRatios: s.supportedAspectRatios,
    supportedResolutions: s.supportedResolutions,
    previewImage: s.previewImage ?? null,
  }));

  return NextResponse.json({
    suites,
    defaults: {
      aspectRatio: DEFAULT_ASPECT_RATIO,
      resolution: DEFAULT_RESOLUTION,
    },
    options: {
      aspectRatios: ALL_ASPECT_RATIOS,
      resolutions: ALL_RESOLUTIONS,
    },
  });
});
