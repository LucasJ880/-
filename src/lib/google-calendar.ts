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

  const providerData = {
    type: "google",
    name: "Google Calendar",
    enabled: true,
    accessToken: tokens.access_token ? encryptField(tokens.access_token) : null,
    refreshToken: tokens.refresh_token ? encryptField(tokens.refresh_token) : null,
    tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    accountEmail: userInfo.email ?? null,
    calendarId: "primary",
  };

  if (existing) {
    await db.calendarProvider.update({
      where: { id: existing.id },
      data: providerData,
    });
  } else {
    await db.calendarProvider.create({
      data: { ...providerData, userId },
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
    return [];
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

  // 先拿一次日历列表做 ID → 名称+颜色 的映射
  let calMap: Map<string, { name: string; color: string }> | null = null;
  if (calendarIds.length > 1) {
    try {
      const listRes = await calendar.calendarList.list({ showHidden: false });
      calMap = new Map();
      for (const item of listRes.data.items || []) {
        calMap.set(item.id || "", {
          name: item.summary || "",
          color: item.backgroundColor || "#4285f4",
        });
      }
    } catch { /* ignore */ }
  }

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
        });
      }
    } catch (err) {
      console.error(`Google Calendar fetch error for ${calId}:`, err);
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

export async function updateGoogleEvent(
  userId: string,
  googleEventId: string,
  event: { title: string; startTime: string; endTime: string; allDay: boolean; location?: string | null; description?: string | null },
): Promise<boolean> {
  const provider = await getGoogleProvider(userId);
  if (!provider || !provider.accessToken) return false;

  const client = await getAuthedClient(provider);
  const calendar = google.calendar({ version: "v3", auth: client });

  try {
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

    await calendar.events.update({
      calendarId: provider.calendarId || "primary",
      eventId: googleEventId,
      requestBody: body as Parameters<typeof calendar.events.update>[0] extends { requestBody?: infer R } ? R : never,
    });
    return true;
  } catch (err) {
    console.error("Google Calendar update error:", err);
    return false;
  }
}

export async function deleteGoogleEvent(
  userId: string,
  googleEventId: string,
): Promise<boolean> {
  const provider = await getGoogleProvider(userId);
  if (!provider || !provider.accessToken) return false;

  const client = await getAuthedClient(provider);
  const calendar = google.calendar({ version: "v3", auth: client });

  try {
    await calendar.events.delete({
      calendarId: provider.calendarId || "primary",
      eventId: googleEventId,
    });
    return true;
  } catch (err) {
    console.error("Google Calendar delete error:", err);
    return false;
  }
}
