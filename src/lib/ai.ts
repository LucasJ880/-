import OpenAI from "openai";
import { resolveChineseDate, getShanghaiNow } from "@/lib/date/relative-date";

let _client: OpenAI | null = null;

export function getAIClient(): OpenAI {
  if (_client) return _client;

  _client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || "",
    baseURL: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  });

  return _client;
}

export function getModel(): string {
  return process.env.OPENAI_MODEL || "gpt-4o";
}

/* ── Legacy type (kept for backward compat imports) ── */

export interface TaskSuggestion {
  title: string;
  description: string;
  priority: "low" | "medium" | "high" | "urgent";
  dueDate: string | null;
  projectId: string | null;
  project: string | null;
  needReminder: boolean;
}

/* ── New unified types ── */

export interface EventSuggestion {
  title: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  location: string | null;
}

export interface WorkSuggestion {
  type: "task" | "event" | "task_and_event";
  task: TaskSuggestion | null;
  event: EventSuggestion | null;
}

/* ── Extraction helpers ── */

const WORK_JSON_START = "[WORK_JSON]";
const WORK_JSON_END = "[/WORK_JSON]";
const TASK_JSON_START = "[TASK_JSON]";
const TASK_JSON_END = "[/TASK_JSON]";

function stripBlock(text: string, start: string, end: string): { cleanText: string; jsonStr: string | null } {
  const s = text.indexOf(start);
  const e = text.indexOf(end);
  if (s === -1 || e === -1 || e <= s) return { cleanText: text.trim(), jsonStr: null };
  const jsonStr = text.substring(s + start.length, e).trim();
  const cleanText = (text.substring(0, s) + text.substring(e + end.length)).trim();
  return { cleanText, jsonStr };
}

function parseTaskFields(parsed: Record<string, unknown>): TaskSuggestion {
  return {
    title: (parsed.title as string) || "",
    description: (parsed.description as string) || "",
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
    title: (parsed.title as string) || "",
    startTime: (parsed.startTime as string) || "",
    endTime: (parsed.endTime as string) || "",
    allDay: Boolean(parsed.allDay),
    location: (parsed.location as string) || null,
  };
}

/* ── Date post-processing ── */

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
  const now = getShanghaiNow();
  if (suggestion.task) postProcessTask(suggestion.task, now);
  if (suggestion.event) postProcessEvent(suggestion.event, now);
}

/**
 * 从 AI 回复中提取 WorkSuggestion。
 * 优先识别 [WORK_JSON]，回退兼容旧 [TASK_JSON]。
 * 提取后自动执行日期后处理（中文相对日期 → 绝对日期）。
 */
export function extractWorkSuggestion(
  text: string
): { cleanText: string; suggestion: WorkSuggestion | null } {
  // 1. Try new WORK_JSON format
  const work = stripBlock(text, WORK_JSON_START, WORK_JSON_END);
  if (work.jsonStr) {
    try {
      const parsed = JSON.parse(work.jsonStr);

      let suggestion: WorkSuggestion | null = null;

      if (parsed.type === "task_and_event" && parsed.task && parsed.event) {
        suggestion = {
          type: "task_and_event",
          task: parseTaskFields(parsed.task as Record<string, unknown>),
          event: parseEventFields(parsed.event as Record<string, unknown>),
        };
      } else if (parsed.type === "event" && parsed.event) {
        suggestion = { type: "event", task: null, event: parseEventFields(parsed.event) };
      } else if (parsed.type === "task" && parsed.task) {
        suggestion = { type: "task", task: parseTaskFields(parsed.task), event: null };
      } else if (!parsed.type || parsed.type === "task") {
        suggestion = { type: "task", task: parseTaskFields(parsed), event: null };
      }

      if (suggestion) {
        postProcessDates(suggestion);
        return { cleanText: work.cleanText, suggestion };
      }
    } catch { /* fall through */ }
  }

  // 2. Fallback: legacy TASK_JSON
  const legacy = stripBlock(text, TASK_JSON_START, TASK_JSON_END);
  if (legacy.jsonStr) {
    try {
      const parsed = JSON.parse(legacy.jsonStr);
      const suggestion: WorkSuggestion = {
        type: "task",
        task: parseTaskFields(parsed),
        event: null,
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
