import type { VisualizerDetectedRegionDraft } from "./types";

type AiCandidate = {
  label?: unknown;
  x1?: unknown;
  y1?: unknown;
  x2?: unknown;
  y2?: unknown;
  confidence?: unknown;
  reason?: unknown;
};

export function stripJsonFence(input: string): string {
  return input.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function toFiniteNumber(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

export function normalizeDetectedRegionCandidates(
  raw: unknown,
  size: { width: number; height: number },
): VisualizerDetectedRegionDraft[] {
  const arr = Array.isArray((raw as { windows?: unknown })?.windows)
    ? (raw as { windows: unknown[] }).windows
    : Array.isArray(raw)
      ? raw
      : [];

  const drafts: VisualizerDetectedRegionDraft[] = [];
  for (const [idx, item] of arr.entries()) {
    const c = item as AiCandidate;
    const x1 = toFiniteNumber(c.x1);
    const y1 = toFiniteNumber(c.y1);
    const x2 = toFiniteNumber(c.x2);
    const y2 = toFiniteNumber(c.y2);
    if (x1 == null || y1 == null || x2 == null || y2 == null) continue;

    const left = clamp(Math.min(x1, x2), 0, size.width);
    const top = clamp(Math.min(y1, y2), 0, size.height);
    const right = clamp(Math.max(x1, x2), 0, size.width);
    const bottom = clamp(Math.max(y1, y2), 0, size.height);
    const w = right - left;
    const h = bottom - top;
    if (w < 12 || h < 12) continue;

    const confidence = clamp(toFiniteNumber(c.confidence) ?? 0.5, 0, 1);
    drafts.push({
      id: `ai-window-${idx + 1}`,
      label:
        typeof c.label === "string" && c.label.trim()
          ? c.label.trim().slice(0, 40)
          : `AI 窗户 ${idx + 1}`,
      shape: "rect",
      points: [
        [Math.round(left), Math.round(top)],
        [Math.round(right), Math.round(bottom)],
      ],
      confidence,
      reason:
        typeof c.reason === "string" && c.reason.trim()
          ? c.reason.trim().slice(0, 120)
          : null,
    });
  }

  return drafts.sort((a, b) => b.confidence - a.confidence).slice(0, 8);
}
