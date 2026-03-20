import { google } from "googleapis";
import { db } from "@/lib/db";

const SCOPES = ["https://www.googleapis.com/auth/calendar.readonly", "https://www.googleapis.com/auth/calendar.events"];

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
    accessToken: tokens.access_token ?? null,
    refreshToken: tokens.refresh_token ?? null,
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
    access_token: provider.accessToken,
    refresh_token: provider.refreshToken,
    expiry_date: provider.tokenExpiry?.getTime(),
  });

  client.on("tokens", async (tokens) => {
    await db.calendarProvider.update({
      where: { id: provider.id },
      data: {
        accessToken: tokens.access_token ?? undefined,
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

export interface GoogleEvent {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  location: string | null;
  source: "google";
}

export async function fetchGoogleEvents(
  userId: string,
  dateStr?: string
): Promise<GoogleEvent[]> {
  const provider = await getGoogleProvider(userId);
  if (!provider || !provider.accessToken) return [];

  const client = await getAuthedClient(provider);
  const calendar = google.calendar({ version: "v3", auth: client });

  const dayStart = dateStr ? new Date(dateStr) : new Date();
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayStart.getDate() + 1);

  try {
    const res = await calendar.events.list({
      calendarId: provider.calendarId || "primary",
      timeMin: dayStart.toISOString(),
      timeMax: dayEnd.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 50,
    });

    return (res.data.items || []).map((item) => {
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
        source: "google" as const,
      };
    });
  } catch (err) {
    console.error("Google Calendar fetch error:", err);
    return [];
  }
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
