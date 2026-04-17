import { google } from "googleapis";
import { db } from "@/lib/db";
import { startOfDayToronto, endOfDayToronto } from "@/lib/time";
import { encryptField, decryptField } from "@/lib/crypto";

// userinfo.* 用于换取令牌后读取 Google 账号邮箱；仅有 calendar.* 时访问 userinfo 会 401
const SCOPES = [
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
];

/** 去掉 Vercel / 粘贴时常见的首尾空格、换行，避免换码时 redirect_uri 与授权步不一致 */
export function getGoogleOAuthEnv() {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID?.trim() ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim() ?? "",
    redirectUri: process.env.GOOGLE_REDIRECT_URI?.trim() ?? "",
  };
}

function getOAuth2Client() {
  const { clientId, clientSecret, redirectUri } = getGoogleOAuthEnv();
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function getAuthUrl(): string {
  const client = getOAuth2Client();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
  });
}

export async function handleCallback(code: string, userId: string) {
  const { redirectUri } = getGoogleOAuthEnv();
  if (!redirectUri) {
    throw new Error("GOOGLE_REDIRECT_URI is not set");
  }
  const client = getOAuth2Client();
  const { tokens } = await client.getToken({
    code,
    redirect_uri: redirectUri,
  });
  client.setCredentials(tokens);

  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const { data: userInfo } = await oauth2.userinfo.get();

  const existing = await db.calendarProvider.findFirst({
    where: { userId, type: "google" },
  });

  const encryptedAccess = tokens.access_token
    ? encryptField(tokens.access_token)
    : null;
  const encryptedRefresh = tokens.refresh_token
    ? encryptField(tokens.refresh_token)
    : null;

  if (existing) {
    // 重连：保留用户之前勾选的 calendarId（可能是多个共享日历，逗号分隔），
    // 并在 Google 未返回新 refresh_token 时保留旧的（避免下次续期失败）。
    await db.calendarProvider.update({
      where: { id: existing.id },
      data: {
        enabled: true,
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh ?? existing.refreshToken,
        tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        accountEmail: userInfo.email ?? null,
        // calendarId 故意不更新，保留用户之前的选择
      },
    });
  } else {
    await db.calendarProvider.create({
      data: {
        userId,
        type: "google",
        name: "Google Calendar",
        enabled: true,
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        accountEmail: userInfo.email ?? null,
        calendarId: "primary",
      },
    });
  }

  return { email: userInfo.email };
}

async function getAuthedClient(provider: {
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiry: Date | null;
  id: string;
}) {
  const client = getOAuth2Client();
  client.setCredentials({
    access_token: provider.accessToken ? decryptField(provider.accessToken) : undefined,
    refresh_token: provider.refreshToken ? decryptField(provider.refreshToken) : undefined,
    expiry_date: provider.tokenExpiry?.getTime(),
  });

  client.on("tokens", async (tokens) => {
    await db.calendarProvider.update({
      where: { id: provider.id },
      data: {
        accessToken: tokens.access_token ? encryptField(tokens.access_token) : undefined,
        tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
      },
    });
  });

  return client;
}

export async function getGoogleProvider(userId: string) {
  return db.calendarProvider.findFirst({
    where: { userId, type: "google", enabled: true },
  });
}

/**
 * Google OAuth token 失效（invalid_grant / invalid_token / 401）时抛出此错误。
 * API route 可据此返回 401 + { error: "token_expired" }，前端显示重连提示。
 */
export class GoogleTokenExpiredError extends Error {
  constructor() {
    super("GOOGLE_TOKEN_EXPIRED");
    this.name = "GoogleTokenExpiredError";
  }
}

/**
 * 其他 Google API 错误（scope 不足 / 403 / 500 等）。API route 据此返回 500
 * 并把原始错误信息回传给前端，避免"静默空列表"无法诊断。
 */
export class GoogleCalendarApiError extends Error {
  status: number;
  reason: string;
  constructor(status: number, reason: string, originalMessage?: string) {
    super(originalMessage || `Google API error ${status}: ${reason}`);
    this.name = "GoogleCalendarApiError";
    this.status = status;
    this.reason = reason;
  }
}

function isGoogleTokenError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as {
    code?: number | string;
    response?: { status?: number; data?: { error?: string } };
    data?: { error?: string };
    message?: string;
  };
  const status = typeof e.code === "number" ? e.code : e.response?.status;
  const errCode = e.response?.data?.error || e.data?.error;
  if (status === 401) return true;
  if (errCode === "invalid_grant" || errCode === "invalid_token") return true;
  if (typeof e.message === "string" && /invalid_grant|invalid_token/i.test(e.message)) return true;
  return false;
}

async function markGoogleProviderDisabled(providerId: string) {
  try {
    await db.calendarProvider.update({
      where: { id: providerId },
      data: { enabled: false },
    });
  } catch {
    /* best-effort, ignore */
  }
}

export interface GoogleCalendarInfo {
  id: string;
  summary: string;
  description?: string;
  backgroundColor: string;
  foregroundColor: string;
  primary: boolean;
  accessRole: string;
  selected: boolean;
}

export interface GoogleEvent {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  location: string | null;
  source: "google";
  calendarId?: string;
  calendarName?: string;
  color?: string;
  description?: string | null;
  htmlLink?: string | null;
  recurringEventId?: string | null;
  /** 来源日历对当前用户的访问权限：owner / writer / reader / freeBusyReader */
  accessRole?: string;
}

/**
 * 获取用户所有可见的 Google 日历列表（包含共享日历、订阅日历）
 */
export async function listGoogleCalendars(
  userId: string,
): Promise<GoogleCalendarInfo[]> {
  const provider = await getGoogleProvider(userId);
  if (!provider || !provider.accessToken) return [];

  const client = await getAuthedClient(provider);
  const calendar = google.calendar({ version: "v3", auth: client });

  try {
    const res = await calendar.calendarList.list({ showHidden: false });
    return (res.data.items || []).map((item) => ({
      id: item.id || "",
      summary: item.summary || "(无名称)",
      description: item.description || undefined,
      backgroundColor: item.backgroundColor || "#4285f4",
      foregroundColor: item.foregroundColor || "#ffffff",
      primary: item.primary === true,
      accessRole: item.accessRole || "reader",
      selected: item.selected === true,
    }));
  } catch (err) {
    console.error("Google Calendar list error:", err);
    if (isGoogleTokenError(err)) {
      await markGoogleProviderDisabled(provider.id);
      throw new GoogleTokenExpiredError();
    }
    // 非 token 错误（403 scope 不足 / 管理员限制 / 500 等）：
    // 不再静默返回 []，而是抛出详细错误以便前端诊断
    const e = err as {
      code?: number | string;
      response?: { status?: number; data?: { error?: { message?: string } | string } };
      message?: string;
    };
    const status =
      typeof e.code === "number" ? e.code : e.response?.status ?? 500;
    const rawData = e.response?.data?.error;
    const reason =
      typeof rawData === "string"
        ? rawData
        : rawData?.message || e.message || "unknown";
    throw new GoogleCalendarApiError(status, reason, e.message);
  }
}

/**
 * 从单个日历拉取事件（兼容旧接口，单天）
 */
export async function fetchGoogleEvents(
  userId: string,
  dateStr?: string
): Promise<GoogleEvent[]> {
  return fetchGoogleEventsRange(userId, { dateStr });
}

/**
 * 从多个日历拉取事件，支持自定义时间范围
 */
export async function fetchGoogleEventsRange(
  userId: string,
  opts: {
    dateStr?: string;
    timeMin?: string;
    timeMax?: string;
    calendarIds?: string[];
  } = {},
): Promise<GoogleEvent[]> {
  const provider = await getGoogleProvider(userId);
  if (!provider || !provider.accessToken) return [];

  const client = await getAuthedClient(provider);
  const calendar = google.calendar({ version: "v3", auth: client });

  let timeMin: string;
  let timeMax: string;

  if (opts.timeMin && opts.timeMax) {
    timeMin = new Date(opts.timeMin).toISOString();
    timeMax = new Date(opts.timeMax).toISOString();
  } else {
    const ref = opts.dateStr ? new Date(opts.dateStr + "T12:00:00") : new Date();
    timeMin = startOfDayToronto(ref).toISOString();
    timeMax = endOfDayToronto(ref).toISOString();
  }

  // 如果没指定日历，从数据库读取用户选择的日历，默认只有 primary
  let calendarIds = opts.calendarIds;
  if (!calendarIds || calendarIds.length === 0) {
    const selectedRaw = provider.calendarId || "primary";
    // calendarId 字段可存逗号分隔的多个日历 ID
    calendarIds = selectedRaw.split(",").map((s) => s.trim()).filter(Boolean);
    if (calendarIds.length === 0) calendarIds = ["primary"];
  }

  const allEvents: GoogleEvent[] = [];

  // 先拿一次日历列表做 ID → 名称+颜色+accessRole 的映射
  let calMap: Map<string, { name: string; color: string; accessRole: string }> | null = null;
  try {
    const listRes = await calendar.calendarList.list({ showHidden: false });
    calMap = new Map();
    for (const item of listRes.data.items || []) {
      calMap.set(item.id || "", {
        name: item.summary || "",
        color: item.backgroundColor || "#4285f4",
        accessRole: item.accessRole || "reader",
      });
    }
  } catch { /* ignore */ }

  for (const calId of calendarIds) {
    try {
      const res = await calendar.events.list({
        calendarId: calId,
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 100,
      });

      const info = calMap?.get(calId);
      for (const item of res.data.items || []) {
        const allDay = Boolean(item.start?.date);
        allEvents.push({
          id: item.id || "",
          title: item.summary || "(无标题)",
          startTime: allDay
            ? `${item.start!.date}T00:00:00`
            : item.start?.dateTime || "",
          endTime: allDay
            ? `${item.end!.date}T23:59:59`
            : item.end?.dateTime || "",
          allDay,
          location: item.location || null,
          source: "google" as const,
          calendarId: calId,
          calendarName: info?.name || (calId === "primary" ? "主日历" : calId),
          color: item.colorId ? undefined : info?.color,
          description: item.description || null,
          htmlLink: item.htmlLink || null,
          recurringEventId: item.recurringEventId || null,
          accessRole: info?.accessRole || "reader",
        });
      }
    } catch (err) {
      console.error(`Google Calendar fetch error for ${calId}:`, err);
      // token 失效是致命错，无需继续遍历其他日历，直接停用并上抛
      if (isGoogleTokenError(err)) {
        await markGoogleProviderDisabled(provider.id);
        throw new GoogleTokenExpiredError();
      }
      // 非 token 错：该日历可能被删 / 权限变更等，跳过继续其他日历
    }
  }

  return allEvents.sort((a, b) =>
    new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
  );
}

export async function pushEventToGoogle(
  userId: string,
  event: { title: string; startTime: string; endTime: string; allDay: boolean; location?: string | null }
): Promise<string | null> {
  const provider = await getGoogleProvider(userId);
  if (!provider || !provider.accessToken) return null;

  const client = await getAuthedClient(provider);
  const calendar = google.calendar({ version: "v3", auth: client });

  try {
    const body: Record<string, unknown> = {
      summary: event.title,
      location: event.location || undefined,
    };

    if (event.allDay) {
      const dateOnly = event.startTime.split("T")[0];
      const endDate = event.endTime.split("T")[0];
      const nextDay = new Date(endDate);
      nextDay.setDate(nextDay.getDate() + 1);
      body.start = { date: dateOnly };
      body.end = { date: nextDay.toISOString().split("T")[0] };
    } else {
      body.start = { dateTime: new Date(event.startTime).toISOString() };
      body.end = { dateTime: new Date(event.endTime).toISOString() };
    }

    const res = await calendar.events.insert({
      calendarId: provider.calendarId || "primary",
      requestBody: body as Parameters<typeof calendar.events.insert>[0] extends { requestBody?: infer R } ? R : never,
    });

    return res.data.id || null;
  } catch (err) {
    console.error("Google Calendar push error:", err);
    return null;
  }
}

/**
 * 更新 Google 事件。
 * - scope="single"：仅改当前实例（默认）。对重复事件的单次 instance 也适用。
 * - scope="series"：改整个重复系列（patch recurringEventId 指向的母事件）。
 *   注意：母事件修改会波及所有未来实例，但不修改 recurrence 规则本身。
 */
export async function updateGoogleEvent(
  userId: string,
  opts: {
    eventId: string;
    calendarId?: string;
    scope?: "single" | "series";
    data: {
      title: string;
      startTime: string;
      endTime: string;
      allDay: boolean;
      location?: string | null;
      description?: string | null;
    };
  },
): Promise<{ ok: boolean; error?: string }> {
  const provider = await getGoogleProvider(userId);
  if (!provider || !provider.accessToken) return { ok: false, error: "未连接 Google 日历" };

  const client = await getAuthedClient(provider);
  const calendar = google.calendar({ version: "v3", auth: client });

  const calId = opts.calendarId || provider.calendarId?.split(",")[0] || "primary";
  const scope = opts.scope || "single";
  const { data: event } = opts;

  try {
    let targetEventId = opts.eventId;

    // 修改整个系列：先拿当前事件的 recurringEventId（母事件 ID），再 patch 母事件
    if (scope === "series") {
      const detail = await calendar.events.get({ calendarId: calId, eventId: opts.eventId });
      const motherId = detail.data.recurringEventId || opts.eventId;
      targetEventId = motherId;
    }

    const body: Record<string, unknown> = {
      summary: event.title,
      location: event.location || undefined,
      description: event.description || undefined,
    };

    if (event.allDay) {
      const dateOnly = event.startTime.split("T")[0];
      const endDate = event.endTime.split("T")[0];
      const nextDay = new Date(endDate);
      nextDay.setDate(nextDay.getDate() + 1);
      body.start = { date: dateOnly };
      body.end = { date: nextDay.toISOString().split("T")[0] };
    } else {
      body.start = { dateTime: new Date(event.startTime).toISOString() };
      body.end = { dateTime: new Date(event.endTime).toISOString() };
    }

    await calendar.events.patch({
      calendarId: calId,
      eventId: targetEventId,
      requestBody: body as Parameters<typeof calendar.events.patch>[0] extends { requestBody?: infer R } ? R : never,
    });
    return { ok: true };
  } catch (err) {
    console.error("Google Calendar update error:", err);
    if (isGoogleTokenError(err)) {
      await markGoogleProviderDisabled(provider.id);
      throw new GoogleTokenExpiredError();
    }
    const e = err as { response?: { data?: { error?: { message?: string } } }; message?: string };
    return {
      ok: false,
      error: e.response?.data?.error?.message || e.message || "更新失败",
    };
  }
}

/**
 * 删除 Google 事件。
 * - scope="single"：仅删当前实例
 * - scope="series"：删除整个重复系列
 */
export async function deleteGoogleEvent(
  userId: string,
  opts: {
    eventId: string;
    calendarId?: string;
    scope?: "single" | "series";
  },
): Promise<{ ok: boolean; error?: string }> {
  const provider = await getGoogleProvider(userId);
  if (!provider || !provider.accessToken) return { ok: false, error: "未连接 Google 日历" };

  const client = await getAuthedClient(provider);
  const calendar = google.calendar({ version: "v3", auth: client });

  const calId = opts.calendarId || provider.calendarId?.split(",")[0] || "primary";
  const scope = opts.scope || "single";

  try {
    let targetEventId = opts.eventId;

    if (scope === "series") {
      const detail = await calendar.events.get({ calendarId: calId, eventId: opts.eventId });
      targetEventId = detail.data.recurringEventId || opts.eventId;
    }

    await calendar.events.delete({
      calendarId: calId,
      eventId: targetEventId,
    });
    return { ok: true };
  } catch (err) {
    console.error("Google Calendar delete error:", err);
    if (isGoogleTokenError(err)) {
      await markGoogleProviderDisabled(provider.id);
      throw new GoogleTokenExpiredError();
    }
    const e = err as { response?: { data?: { error?: { message?: string } } }; message?: string };
    return {
      ok: false,
      error: e.response?.data?.error?.message || e.message || "删除失败",
    };
  }
}

/**
 * 获取单个事件详情（含 recurringEventId / htmlLink / description 等）。
 */
export async function getGoogleEventDetail(
  userId: string,
  opts: { eventId: string; calendarId?: string },
): Promise<GoogleEvent | null> {
  const provider = await getGoogleProvider(userId);
  if (!provider || !provider.accessToken) return null;

  const client = await getAuthedClient(provider);
  const calendar = google.calendar({ version: "v3", auth: client });

  const calId = opts.calendarId || provider.calendarId?.split(",")[0] || "primary";

  try {
    const { data: item } = await calendar.events.get({
      calendarId: calId,
      eventId: opts.eventId,
    });
    const allDay = Boolean(item.start?.date);
    return {
      id: item.id || "",
      title: item.summary || "(无标题)",
      startTime: allDay
        ? `${item.start!.date}T00:00:00`
        : item.start?.dateTime || "",
      endTime: allDay
        ? `${item.end!.date}T23:59:59`
        : item.end?.dateTime || "",
      allDay,
      location: item.location || null,
      source: "google",
      calendarId: calId,
      description: item.description || null,
      htmlLink: item.htmlLink || null,
      recurringEventId: item.recurringEventId || null,
    };
  } catch (err) {
    if (isGoogleTokenError(err)) {
      await markGoogleProviderDisabled(provider.id);
      throw new GoogleTokenExpiredError();
    }
    console.error("Google Calendar getDetail error:", err);
    return null;
  }
}
