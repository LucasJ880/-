/**
 * 结构化 Diff（不存完整敏感正文优先）
 */

export interface StructuredDiff {
  kind: "text" | "json" | "list" | "empty";
  changed: boolean;
  summary: string;
  lengthDelta?: number;
  shortenedPct?: number;
  removedKeys?: string[];
  addedKeys?: string[];
  changedKeys?: string[];
  notes?: string[];
}

function asText(v: unknown): string {
  if (typeof v === "string") return v;
  if (v == null) return "";
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export function buildStructuredDiff(
  aiOutput: unknown,
  humanOutput: unknown,
): StructuredDiff {
  if (aiOutput == null && humanOutput == null) {
    return { kind: "empty", changed: false, summary: "无差异" };
  }

  const aiText = asText(aiOutput);
  const humanText = asText(humanOutput);
  if (aiText === humanText) {
    return { kind: "text", changed: false, summary: "无修改", lengthDelta: 0 };
  }

  const lengthDelta = humanText.length - aiText.length;
  const shortenedPct =
    aiText.length > 0
      ? Math.max(0, Math.round((1 - humanText.length / aiText.length) * 100))
      : 0;

  const notes: string[] = [];
  if (shortenedPct >= 30) notes.push("正文缩短超过30%");
  if (lengthDelta > 80) notes.push("内容明显加长");
  if (/折扣|discount|优惠/i.test(aiText) && !/折扣|discount|优惠/i.test(humanText)) {
    notes.push("删除折扣相关表述");
  }

  let removedKeys: string[] | undefined;
  let addedKeys: string[] | undefined;
  let changedKeys: string[] | undefined;
  let kind: StructuredDiff["kind"] = "text";

  if (
    typeof aiOutput === "object" &&
    aiOutput &&
    typeof humanOutput === "object" &&
    humanOutput &&
    !Array.isArray(aiOutput) &&
    !Array.isArray(humanOutput)
  ) {
    kind = "json";
    const a = aiOutput as Record<string, unknown>;
    const h = humanOutput as Record<string, unknown>;
    const aKeys = Object.keys(a);
    const hKeys = Object.keys(h);
    removedKeys = aKeys.filter((k) => !(k in h));
    addedKeys = hKeys.filter((k) => !(k in a));
    changedKeys = aKeys.filter(
      (k) => k in h && JSON.stringify(a[k]) !== JSON.stringify(h[k]),
    );
  }

  return {
    kind,
    changed: true,
    summary:
      notes[0] ||
      (shortenedPct >= 30
        ? `缩短约 ${shortenedPct}%`
        : `已编辑（Δ字数 ${lengthDelta}）`),
    lengthDelta,
    shortenedPct,
    removedKeys,
    addedKeys,
    changedKeys,
    notes,
  };
}
