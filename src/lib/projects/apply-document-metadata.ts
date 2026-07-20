/**
 * 从已解析文档的 AI 摘要中，回填项目空字段（日期、客户、招标号等）。
 * 只填空值，不覆盖人工已填内容。
 */

import { db } from "@/lib/db";
import type { DocumentAiSummary } from "@/lib/files/ai-summary";

function parseSummary(raw: unknown): DocumentAiSummary | null {
  if (!raw) return null;
  try {
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!obj || typeof obj !== "object") return null;
    return obj as DocumentAiSummary;
  } catch {
    return null;
  }
}

function parseYmd(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  const m = String(dateStr).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

type DateKind =
  | "closeDate"
  | "openDate"
  | "publicDate"
  | "questionCloseDate"
  | "awardDate";

/** 供单测：根据中英标签归类日期字段 */
export function classifyDateLabel(label: string): DateKind | null {
  const t = label.toLowerCase();
  if (
    /开标|opening|bid\s*opening|public\s*opening|开标日|开标时间/.test(t) &&
    !/截标|closing|deadline/.test(t)
  ) {
    return "openDate";
  }
  if (
    /截标|截止|closing|close\s*date|rfb\s*closing|submission\s*deadline|投标截止|报价截止/.test(
      t,
    )
  ) {
    return "closeDate";
  }
  if (
    /提问截止|questions?\s*deadline|bidder.?s?\s*deadline\s*for\s*questions|询标截止/.test(
      t,
    )
  ) {
    return "questionCloseDate";
  }
  if (/中标|award|授予/.test(t)) return "awardDate";
  if (/发出|发布|issued|public\s*date|公告|发标/.test(t)) return "publicDate";
  return null;
}

function pickSolicitation(text: string | null | undefined): string | null {
  if (!text) return null;
  const patterns = [
    /\b(W\d{4}-\d{6})\b/i,
    /\b(COS-?\d{3,})\b/i,
    /\b(Tender\s*#?\s*\d+)\b/i,
    /\b(RFB\s*#?\s*[\w/-]+)\b/i,
    /\b(RFP\s*#?\s*[\w/-]+)\b/i,
    /\b(Solicitation\s*No\.?\s*[:：]?\s*[\w/-]+)\b/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) return m[1].replace(/\s+/g, " ").trim().slice(0, 120);
  }
  return null;
}

export type AppliedProjectMetadata = {
  applied: Record<string, string | number | null>;
  sources: string[];
  skippedBecauseFilled: string[];
};

export async function applyDocumentMetadataToProject(
  projectId: string,
): Promise<AppliedProjectMetadata> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      description: true,
      clientOrganization: true,
      location: true,
      solicitationNumber: true,
      currency: true,
      estimatedValue: true,
      closeDate: true,
      openDate: true,
      publicDate: true,
      questionCloseDate: true,
      awardDate: true,
    },
  });
  if (!project) {
    return { applied: {}, sources: [], skippedBecauseFilled: [] };
  }

  const docs = await db.projectDocument.findMany({
    where: {
      projectId,
      aiSummaryStatus: "done",
      aiSummaryJson: { not: null },
    },
    select: { id: true, title: true, aiSummaryJson: true },
    take: 40,
  });

  const data: Record<string, unknown> = {};
  const sources: string[] = [];
  const skippedBecauseFilled: string[] = [];

  const dateCandidates: Partial<Record<DateKind, { date: Date; from: string }>> =
    {};

  for (const doc of docs) {
    const s = parseSummary(doc.aiSummaryJson);
    if (!s) continue;

    if (!project.clientOrganization && !data.clientOrganization && s.issuingParty) {
      data.clientOrganization = String(s.issuingParty).slice(0, 200);
      sources.push(`clientOrganization←${doc.title}`);
    }

    if (!project.currency && !data.currency && s.currency) {
      data.currency = String(s.currency).slice(0, 16);
      sources.push(`currency←${doc.title}`);
    }

    if (
      project.estimatedValue == null &&
      data.estimatedValue === undefined &&
      s.budget
    ) {
      const num = Number(String(s.budget).replace(/[^\d.]/g, ""));
      if (Number.isFinite(num) && num > 0) {
        data.estimatedValue = num;
        sources.push(`estimatedValue←${doc.title}`);
      }
    }

    if (!project.solicitationNumber && !data.solicitationNumber) {
      const sol =
        pickSolicitation(s.title) ||
        pickSolicitation(s.projectName) ||
        pickSolicitation(doc.title);
      if (sol) {
        data.solicitationNumber = sol;
        sources.push(`solicitationNumber←${doc.title}`);
      }
    }

    if (
      (!project.description || project.description.trim().length < 8) &&
      !data.description &&
      s.summary
    ) {
      data.description = String(s.summary).slice(0, 2000);
      sources.push(`description←${doc.title}`);
    }

    for (const kd of s.keyDates || []) {
      const kind = classifyDateLabel(kd.label || "");
      const d = parseYmd(kd.date);
      if (!kind || !d) continue;
      // 截标等取更晚的候选；发布日取更早
      const prev = dateCandidates[kind];
      if (
        !prev ||
        (kind === "closeDate" && d > prev.date) ||
        (kind === "publicDate" && d < prev.date) ||
        (kind !== "closeDate" && kind !== "publicDate")
      ) {
        dateCandidates[kind] = { date: d, from: `${doc.title}:${kd.label}` };
      }
    }
  }

  for (const kind of [
    "closeDate",
    "openDate",
    "publicDate",
    "questionCloseDate",
    "awardDate",
  ] as DateKind[]) {
    if (project[kind]) {
      skippedBecauseFilled.push(kind);
      continue;
    }
    const cand = dateCandidates[kind];
    if (cand) {
      data[kind] = cand.date;
      sources.push(`${kind}←${cand.from}`);
    }
  }

  if (Object.keys(data).length === 0) {
    return { applied: {}, sources, skippedBecauseFilled };
  }

  await db.project.update({
    where: { id: projectId },
    data,
  });

  if (data.closeDate !== undefined || data.openDate !== undefined) {
    const { syncProjectMilestoneCalendars } = await import(
      "@/lib/projects/sync-milestone-calendar"
    );
    await syncProjectMilestoneCalendars(projectId).catch(() => null);
  }

  const applied: Record<string, string | number | null> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v instanceof Date) applied[k] = v.toISOString();
    else if (typeof v === "number") applied[k] = v;
    else applied[k] = v == null ? null : String(v);
  }

  return { applied, sources, skippedBecauseFilled };
}
