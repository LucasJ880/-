/**
 * 青砚 AI 响应解析器
 *
 * 从 AI 回复文本中提取结构化数据。
 * 从旧 src/lib/ai.ts 迁移而来，增加了类型安全和容错。
 */

import { resolveChineseDate } from "@/lib/date/relative-date";
import { nowToronto } from "@/lib/time";
import type {
  TaskSuggestion,
  EventSuggestion,
  WorkSuggestion,
  StageAdvanceSuggestion,
  SupplierRecommendSuggestion,
  SupplierRecommendItem,
} from "./schemas";
import { STAGE_ORDER } from "@/lib/tender/stage-transition";

// ── Block 标记 ────────────────────────────────────────────────

const WORK_JSON_START = "[WORK_JSON]";
const WORK_JSON_END = "[/WORK_JSON]";
const TASK_JSON_START = "[TASK_JSON]";
const TASK_JSON_END = "[/TASK_JSON]";

// ── 内部工具 ──────────────────────────────────────────────────

function stripBlock(
  text: string,
  start: string,
  end: string
): { cleanText: string; jsonStr: string | null } {
  const s = text.indexOf(start);
  const e = text.indexOf(end);
  if (s === -1 || e === -1 || e <= s) return { cleanText: text.trim(), jsonStr: null };
  const jsonStr = text.substring(s + start.length, e).trim();
  const cleanText = (text.substring(0, s) + text.substring(e + end.length)).trim();
  return { cleanText, jsonStr };
}

function parseTaskFields(parsed: Record<string, unknown>): TaskSuggestion {
  return {
    title: String(parsed.title || ""),
    description: String(parsed.description || ""),
    priority: ["low", "medium", "high", "urgent"].includes(parsed.priority as string)
      ? (parsed.priority as TaskSuggestion["priority"])
      : "medium",
    dueDate: (parsed.dueDate as string) || null,
    projectId: (parsed.projectId as string) || null,
    project: (parsed.project as string) || null,
    needReminder: Boolean(parsed.needReminder),
  };
}

function parseEventFields(parsed: Record<string, unknown>): EventSuggestion {
  return {
    title: String(parsed.title || ""),
    startTime: String(parsed.startTime || ""),
    endTime: String(parsed.endTime || ""),
    allDay: Boolean(parsed.allDay),
    location: (parsed.location as string) || null,
  };
}

function parseStageAdvanceFields(
  parsed: Record<string, unknown>
): StageAdvanceSuggestion | null {
  const sa = parsed.stageAdvance as Record<string, unknown> | undefined;
  const fields = sa ?? parsed;

  const targetStage = String(fields.targetStage || "");
  if (!STAGE_ORDER.includes(targetStage as (typeof STAGE_ORDER)[number])) return null;

  const reason = String(fields.reason || "");
  if (!reason) return null;

  const rawConfidence = Number(fields.confidence);
  const confidence = Number.isFinite(rawConfidence) ? Math.max(0, Math.min(1, rawConfidence)) : 0.5;

  const rawEvidence = fields.evidence;
  const evidence = Array.isArray(rawEvidence)
    ? rawEvidence.filter((e): e is string => typeof e === "string")
    : [];

  return {
    projectId: String(fields.projectId || ""),
    project: String(fields.project || ""),
    targetStage,
    reason,
    confidence,
    evidence,
  };
}

function parseSupplierRecommendFields(
  parsed: Record<string, unknown>
): SupplierRecommendSuggestion | null {
  const sr = (parsed.supplierRecommend as Record<string, unknown>) ?? parsed;

  const rawSuppliers = sr.suppliers;
  if (!Array.isArray(rawSuppliers) || rawSuppliers.length === 0) return null;

  const suppliers: SupplierRecommendItem[] = [];
  for (const item of rawSuppliers.slice(0, 5)) {
    if (typeof item !== "object" || !item) continue;
    const s = item as Record<string, unknown>;
    const supplierId = String(s.supplierId || "");
    const supplierName = String(s.supplierName || "");
    if (!supplierId || !supplierName) continue;
    const rawScore = Number(s.matchScore);
    suppliers.push({
      supplierId,
      supplierName,
      reason: String(s.reason || ""),
      matchScore: Number.isFinite(rawScore) ? Math.max(0, Math.min(100, rawScore)) : 50,
    });
  }

  if (suppliers.length === 0) return null;

  return {
    projectId: String(sr.projectId || ""),
    project: String(sr.project || ""),
    suppliers,
  };
}

// ── 日期后处理 ────────────────────────────────────────────────

function fmtTime(h: number, m: number): string {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function addOneHour(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return fmtTime(h + 1, m);
}

function postProcessTask(task: TaskSuggestion, now: Date): void {
  if (!task.dueDate) return;
  const r = resolveChineseDate(task.dueDate, now);
  if (r) task.dueDate = r.date;
}

function postProcessEvent(event: EventSuggestion, now: Date): void {
  const startR = resolveChineseDate(event.startTime, now);
  if (!startR) return;

  if (startR.time) {
    event.startTime = `${startR.date}T${startR.time}`;
    event.allDay = false;
    const endR = resolveChineseDate(event.endTime, now);
    if (endR?.time) {
      event.endTime = `${endR.date}T${endR.time}`;
    } else {
      event.endTime = `${startR.date}T${addOneHour(startR.time)}`;
    }
  } else {
    event.startTime = `${startR.date}T00:00`;
    event.endTime = `${startR.date}T23:59`;
    event.allDay = true;
  }
}

function postProcessDates(suggestion: WorkSuggestion): void {
  const now = nowToronto();
  if (suggestion.task) postProcessTask(suggestion.task, now);
  if (suggestion.event) postProcessEvent(suggestion.event, now);
}

// ── 公开 API ──────────────────────────────────────────────────

/**
 * 从 AI 回复中提取 WorkSuggestion。
 * 优先识别 [WORK_JSON]，回退兼容旧 [TASK_JSON]。
 */
export function extractWorkSuggestion(
  text: string
): { cleanText: string; suggestion: WorkSuggestion | null } {
  // 1. WORK_JSON
  const work = stripBlock(text, WORK_JSON_START, WORK_JSON_END);
  if (work.jsonStr) {
    try {
      const parsed = JSON.parse(work.jsonStr);
      let suggestion: WorkSuggestion | null = null;

      if (parsed.type === "supplier_recommend") {
        const sr = parseSupplierRecommendFields(parsed);
        if (sr) {
          suggestion = { type: "supplier_recommend", task: null, event: null, stageAdvance: null, supplierRecommend: sr };
        }
      } else if (parsed.type === "stage_advance") {
        const sa = parseStageAdvanceFields(parsed);
        if (sa) {
          suggestion = { type: "stage_advance", task: null, event: null, stageAdvance: sa, supplierRecommend: null };
        }
      } else if (parsed.type === "task_and_event" && parsed.task && parsed.event) {
        suggestion = {
          type: "task_and_event",
          task: parseTaskFields(parsed.task as Record<string, unknown>),
          event: parseEventFields(parsed.event as Record<string, unknown>),
          stageAdvance: null,
          supplierRecommend: null,
        };
      } else if (parsed.type === "event" && parsed.event) {
        suggestion = { type: "event", task: null, event: parseEventFields(parsed.event), stageAdvance: null, supplierRecommend: null };
      } else if (parsed.type === "task" && parsed.task) {
        suggestion = { type: "task", task: parseTaskFields(parsed.task), event: null, stageAdvance: null, supplierRecommend: null };
      } else if (!parsed.type || parsed.type === "task") {
        suggestion = { type: "task", task: parseTaskFields(parsed), event: null, stageAdvance: null, supplierRecommend: null };
      }

      if (suggestion) {
        postProcessDates(suggestion);
        return { cleanText: work.cleanText, suggestion };
      }
    } catch { /* fall through */ }
  }

  // 2. Legacy TASK_JSON
  const legacy = stripBlock(text, TASK_JSON_START, TASK_JSON_END);
  if (legacy.jsonStr) {
    try {
      const parsed = JSON.parse(legacy.jsonStr);
      const suggestion: WorkSuggestion = {
        type: "task",
        task: parseTaskFields(parsed),
        event: null,
        stageAdvance: null,
        supplierRecommend: null,
      };
      postProcessDates(suggestion);
      return { cleanText: legacy.cleanText, suggestion };
    } catch { /* fall through */ }
  }

  return { cleanText: text.trim(), suggestion: null };
}

/** @deprecated Use extractWorkSuggestion instead */
export function extractTaskSuggestion(
  text: string
): { cleanText: string; suggestion: TaskSuggestion | null } {
  const { cleanText, suggestion } = extractWorkSuggestion(text);
  return { cleanText, suggestion: suggestion?.task ?? null };
}
